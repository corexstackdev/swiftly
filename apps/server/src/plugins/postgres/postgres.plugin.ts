import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { z } from 'zod';
import type {
  ConfigFieldDefinition,
  ConfigSchema,
  ColumnMetadata,
  DatasourcePlugin,
  DbSchema,
  EvaluatedBindings,
  ExecutionContext,
  PreparedQuery,
  QueryDefinition,
  QueryResult,
  RoutineMetadata,
  TestResult,
} from '@swiftly/shared';
import { compile, resolveParameters, type CompiledStatement } from '../sql/compiler';
import { applyIdentifierBindings } from '../sql-binding';
import {
  isPlatformPostgresTarget,
  PLATFORM_POSTGRES_BLOCKED_MESSAGE,
} from './platform-target';
import { createPostgresSchemaAdmin } from './schema-admin';

const configSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().positive().default(5432),
  database: z.string().min(1),
  user: z.string().min(1),
  password: z.string().default(''),
  ssl: z.enum(['disable', 'require', 'verify-full']).default('disable'),
  /** PEM bundle for verify-full. */
  sslRootCert: z.string().optional(),
  poolSize: z.coerce.number().int().min(1).max(50).default(5),
  /** Optional read replica; read statements are routed here when present. */
  replicaHost: z.string().optional(),
});

type PostgresConfig = z.infer<typeof configSchema>;

@Injectable()
export class PostgresPlugin implements DatasourcePlugin<PostgresConfig, QueryDefinition> {
  readonly id = 'postgres';
  readonly name = 'PostgreSQL';
  readonly category = 'database' as const;
  readonly configSchema = configSchema;
  readonly secretFields = ['password', 'sslRootCert'];
  readonly configFields: ConfigFieldDefinition[] = [
    { key: 'host', label: 'Host', control: 'text', required: true, placeholder: 'db.example.com', section: 'Connection' },
    { key: 'port', label: 'Port', control: 'number', defaultValue: 5432, section: 'Connection' },
    { key: 'database', label: 'Database', control: 'text', required: true, placeholder: 'mydb', section: 'Connection' },
    { key: 'user', label: 'User', control: 'text', required: true, placeholder: 'postgres', section: 'Credentials' },
    { key: 'password', label: 'Password', control: 'password', secret: true, section: 'Credentials' },
    {
      key: 'ssl', label: 'SSL mode', control: 'select', defaultValue: 'disable', section: 'Security',
      options: [
        { label: 'Disable', value: 'disable' },
        { label: 'Require (no certificate check)', value: 'require' },
        { label: 'Verify full', value: 'verify-full' },
      ],
    },
    {
      key: 'sslRootCert', label: 'Root certificate (PEM)', control: 'textarea', secret: true, section: 'Security',
      visibleWhen: { key: 'ssl', equals: 'verify-full' },
    },
    { key: 'poolSize', label: 'Pool size', control: 'number', defaultValue: 5, helpText: 'Connections held per environment', section: 'Advanced' },
    { key: 'replicaHost', label: 'Read replica host', control: 'text', helpText: 'Read-only queries are routed here when set', section: 'Advanced' },
  ];

  readonly querySchema = z.any() as unknown as ConfigSchema<QueryDefinition>;

  readonly capabilities = {
    rawSql: true,
    storedProcedures: true,
    functions: true,
    visualBuilder: true,
    transactions: true,
    multiStatement: true,
    introspection: true,
    readOnlyConnections: true,
    pagination: true,
    schemaAdmin: true,
  };

  private readonly logger = new Logger(PostgresPlugin.name);
  private readonly pools = new Map<string, Pool>();
  readonly schemaAdmin = createPostgresSchemaAdmin<PostgresConfig>((config, work) =>
    this.withClient(config, work),
  );

  constructor(private readonly configService: ConfigService) {}

  async test(config: PostgresConfig): Promise<TestResult> {
    const started = Date.now();
    if (this.isBlocked(config)) {
      return { ok: false, message: PLATFORM_POSTGRES_BLOCKED_MESSAGE, latencyMs: Date.now() - started };
    }
    const pool = new Pool({ ...this.toPoolConfig(config), max: 1, connectionTimeoutMillis: 8000 });
    try {
      const result = await pool.query<{ version: string }>('SELECT version()');
      return {
        ok: true,
        message: 'Connection successful',
        serverVersion: result.rows[0]?.version,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      return { ok: false, message: describeError(error), latencyMs: Date.now() - started };
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  prepare(query: QueryDefinition): PreparedQuery {
    const compiled = compile(query, 'postgres');
    return {
      payload: compiled,
      expressions: compiled.expressions,
      identifierExpressions: compiled.identifierBindings.map((b) => b.expression),
      statementType: compiled.statementType,
      outputParameters: compiled.outputParameters,
    };
  }

  async execute(
    config: PostgresConfig,
    prepared: PreparedQuery,
    bindings: EvaluatedBindings,
    ctx: ExecutionContext,
  ): Promise<QueryResult> {
    this.assertAllowed(config);
    const compiled = prepared.payload as CompiledStatement;
    const sql = applyIdentifierBindings(
      compiled.sql,
      compiled.identifierBindings,
      bindings.identifierValues,
    );
    // Literals the compiler resolved are interleaved with the evaluated values, so
    // the driver still receives one parameter per placeholder.
    const values = resolveParameters(compiled, bindings.values);

    const pool = this.getPool(config, ctx);
    const started = Date.now();
    let client: PoolClient | undefined;

    const onAbort = () => client?.release(new Error('Query aborted'));
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    try {
      client = await pool.connect();

      // Timeouts are set on the server side too, so a runaway query is stopped by
      // Postgres rather than only being abandoned by us.
      await client.query(`SET LOCAL statement_timeout = ${Math.floor(ctx.timeoutMs)}`);
      if (ctx.readOnly) {
        await client.query('SET LOCAL transaction_read_only = on');
      }
      for (const [key, value] of Object.entries(ctx.sessionVariables ?? {})) {
        // Session variables drive database-side RLS; the value is parameterised.
        await client.query('SELECT set_config($1, $2, true)', [key, value]);
      }

      if (!sql || typeof sql !== 'string') {
        throw new Error('This query has no SQL to run');
      }

      // rowMode 'array' keeps duplicate column names distinct, which a `SELECT a.id,
      // b.id` would otherwise collapse before the table widget ever sees them.
      const result = await client.query({
        text: sql,
        values,
        rowMode: 'array',
      });

      const materialised = materialisePgResult(result, ctx.maxRows);

      return {
        rows: materialised.rows,
        columns: materialised.columns,
        affectedRows: materialised.rowCount,
        truncated: materialised.truncated,
        durationMs: Date.now() - started,
      };
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
      client?.release();
    }
  }

  async introspect(config: PostgresConfig): Promise<DbSchema> {
    this.assertAllowed(config);
    const pool = new Pool({ ...this.toPoolConfig(config), max: 1 });
    try {
      const [namespacesResult, columns, routines] = await Promise.all([
        pool.query<{ schema_name: string }>(
          `SELECT schema_name
             FROM information_schema.schemata
            WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
              AND schema_name NOT LIKE 'pg\\_%' ESCAPE '\\'
            ORDER BY schema_name`,
        ),
        pool.query<{
          table_schema: string;
          table_name: string;
          table_type: string;
          column_name: string;
          data_type: string;
          is_nullable: string;
          column_default: string | null;
          is_identity: string;
          is_primary_key: boolean;
        }>(
          `SELECT c.table_schema, c.table_name, t.table_type,
                  c.column_name,
                  CASE
                    WHEN c.character_maximum_length IS NOT NULL
                         AND c.data_type IN ('character varying', 'character')
                      THEN c.data_type || '(' || c.character_maximum_length || ')'
                    WHEN c.data_type IN ('numeric', 'decimal') AND c.numeric_precision IS NOT NULL
                      THEN c.data_type || '(' || c.numeric_precision
                           || COALESCE(', ' || c.numeric_scale, '') || ')'
                    ELSE c.data_type
                  END AS data_type,
                  c.is_nullable,
                  c.column_default,
                  c.is_identity,
                  EXISTS (
                    SELECT 1
                      FROM information_schema.table_constraints tc
                      JOIN information_schema.key_column_usage kcu
                        ON kcu.constraint_name = tc.constraint_name
                       AND kcu.table_schema = tc.table_schema
                     WHERE tc.constraint_type = 'PRIMARY KEY'
                       AND tc.table_schema = c.table_schema
                       AND tc.table_name = c.table_name
                       AND kcu.column_name = c.column_name
                  ) AS is_primary_key
             FROM information_schema.columns c
             JOIN information_schema.tables t
               ON t.table_schema = c.table_schema AND t.table_name = c.table_name
            WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY c.table_schema, c.table_name, c.ordinal_position`,
        ),
        pool.query<{
          routine_schema: string;
          routine_name: string;
          routine_type: string;
          parameters: unknown;
        }>(
          `SELECT n.nspname AS routine_schema,
                  p.proname  AS routine_name,
                  CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END AS routine_type,
                  COALESCE(
                    json_agg(
                      json_build_object(
                        'name', COALESCE(pa.name, 'arg' || pa.ordinal),
                        'dataType', pa.type_name,
                        'direction', pa.direction,
                        'ordinal', pa.ordinal
                      ) ORDER BY pa.ordinal
                    ) FILTER (WHERE pa.ordinal IS NOT NULL),
                    '[]'
                  ) AS parameters
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             LEFT JOIN LATERAL (
               SELECT ordinality AS ordinal,
                      COALESCE(p.proargnames[ordinality], '') AS name,
                      format_type(type_oid, NULL) AS type_name,
                      CASE COALESCE(p.proargmodes[ordinality], 'i')
                        WHEN 'o' THEN 'out' WHEN 'b' THEN 'inout' ELSE 'in'
                      END AS direction
                 FROM unnest(COALESCE(p.proallargtypes, p.proargtypes::oid[]))
                      WITH ORDINALITY AS a(type_oid, ordinality)
             ) pa ON TRUE
            WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
            GROUP BY n.nspname, p.proname, p.prokind, p.oid`,
        ),
      ]);

      const namespaces = new Map<
        string,
        { tables: Map<string, { kind: string; columns: ColumnMetadata[] }>; routines: RoutineMetadata[] }
      >();

      const namespaceFor = (name: string) => {
        let entry = namespaces.get(name);
        if (!entry) {
          entry = { tables: new Map(), routines: [] };
          namespaces.set(name, entry);
        }
        return entry;
      };

      for (const row of namespacesResult.rows) {
        namespaceFor(row.schema_name);
      }

      for (const row of columns.rows) {
        const ns = namespaceFor(row.table_schema);
        let table = ns.tables.get(row.table_name);
        if (!table) {
          table = {
            kind: row.table_type === 'VIEW' ? 'view' : 'table',
            columns: [],
          };
          ns.tables.set(row.table_name, table);
        }
        table.columns.push({
          name: row.column_name,
          dataType: row.data_type,
          nullable: row.is_nullable === 'YES',
          isPrimaryKey: row.is_primary_key,
          isIdentity:
            row.is_identity === 'YES' ||
            (typeof row.column_default === 'string' && row.column_default.startsWith('nextval(')),
          hasDefault: row.column_default !== null,
          defaultValue: row.column_default,
        });
      }

      for (const row of routines.rows) {
        const ns = namespaceFor(row.routine_schema);
        ns.routines.push({
          name: row.routine_name,
          kind: row.routine_type === 'procedure' ? 'procedure' : 'function',
          parameters: (row.parameters as RoutineMetadata['parameters']) ?? [],
        });
      }

      return {
        fetchedAt: new Date().toISOString(),
        schemas: [...namespaces.entries()].map(([name, entry]) => ({
          name,
          tables: [...entry.tables.entries()].map(([tableName, table]) => ({
            name: tableName,
            kind: table.kind as 'table' | 'view',
            columns: table.columns,
          })),
          routines: entry.routines,
        })),
      };
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  async dispose(datasourceId: string): Promise<void> {
    for (const [key, pool] of this.pools.entries()) {
      if (key.startsWith(`${datasourceId}:`)) {
        this.pools.delete(key);
        await pool.end().catch(() => undefined);
      }
    }
  }

  private isBlocked(config: PostgresConfig): boolean {
    return isPlatformPostgresTarget(config, this.configService.get<string>('DATABASE_URL', ''));
  }

  private assertAllowed(config: PostgresConfig): void {
    if (this.isBlocked(config)) {
      throw new Error(PLATFORM_POSTGRES_BLOCKED_MESSAGE);
    }
  }

  private async withClient<T>(
    config: PostgresConfig,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    this.assertAllowed(config);
    const pool = new Pool({ ...this.toPoolConfig(config), max: 1 });
    try {
      const client = await pool.connect();
      try {
        return await work(client);
      } finally {
        client.release();
      }
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  private getPool(config: PostgresConfig, ctx: ExecutionContext): Pool {
    const useReplica = ctx.readOnly && Boolean(config.replicaHost);
    const key = `${ctx.datasourceId}:${ctx.environment}:${useReplica ? 'replica' : 'primary'}`;

    let pool = this.pools.get(key);
    if (!pool) {
      pool = new Pool({
        ...this.toPoolConfig(useReplica ? { ...config, host: config.replicaHost! } : config),
        max: config.poolSize,
        idleTimeoutMillis: 30_000,
      });
      pool.on('error', (error) => this.logger.warn(`Idle pool error: ${error.message}`));
      this.pools.set(key, pool);
    }
    return pool;
  }

  private toPoolConfig(config: PostgresConfig): PoolConfig {
    return {
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl:
        config.ssl === 'disable'
          ? false
          : config.ssl === 'require'
            ? { rejectUnauthorized: false }
            : { rejectUnauthorized: true, ca: config.sslRootCert },
    };
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * node-pg usually returns `{ rows, fields }`. A multi-statement batch can return
 * an array of those, and some command tags omit `rows` entirely — both of which
 * used to throw `Cannot read properties of undefined (reading 'slice')` before
 * the table ever saw a column name.
 */
function materialisePgResult(
  result: unknown,
  maxRows: number,
): {
  rows: Record<string, unknown>[];
  columns: ColumnMetadata[];
  truncated: boolean;
  rowCount?: number;
} {
  const batches = Array.isArray(result) && !hasRows(result) ? result : [result];
  let chosen: PgBatch | undefined;
  for (let index = batches.length - 1; index >= 0; index -= 1) {
    const batch = asPgBatch(batches[index]);
    if (batch && Array.isArray(batch.rows)) {
      chosen = batch;
      break;
    }
  }
  chosen ??= asPgBatch(batches[batches.length - 1]) ?? { rows: [], fields: [] };

  const rawRows = Array.isArray(chosen.rows) ? chosen.rows : [];
  const fields = chosen.fields ?? [];
  let columns: ColumnMetadata[] = fields.map((field) => ({
    name: field.name,
    dataType: String(field.dataTypeID ?? ''),
  }));

  if (columns.length === 0) {
    const fromRow = keysFromRow(rawRows[0]);
    columns = fromRow.map((name) => ({ name, dataType: 'unknown' }));
  }

  const truncated = rawRows.length > maxRows;
  const rows = rawRows.slice(0, maxRows).map((row) => rowToObject(row, columns));

  return {
    rows,
    columns,
    truncated,
    rowCount: chosen.rowCount ?? undefined,
  };
}

type PgBatch = {
  rows?: unknown[];
  fields?: { name: string; dataTypeID?: number }[];
  rowCount?: number | null;
};

function hasRows(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && 'rows' in (value as object);
}

function asPgBatch(value: unknown): PgBatch | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  return value as PgBatch;
}

function keysFromRow(row: unknown): string[] {
  if (row !== null && typeof row === 'object' && !Array.isArray(row)) {
    return Object.keys(row as Record<string, unknown>);
  }
  return [];
}

function rowToObject(row: unknown, columns: ColumnMetadata[]): Record<string, unknown> {
  if (Array.isArray(row)) {
    const object: Record<string, unknown> = {};
    if (columns.length > 0) {
      columns.forEach((column, index) => {
        object[column.name] = row[index];
      });
      return object;
    }
    row.forEach((cell, index) => {
      object[`column_${index + 1}`] = cell;
    });
    return object;
  }
  if (row !== null && typeof row === 'object') {
    return row as Record<string, unknown>;
  }
  return { value: row };
}
