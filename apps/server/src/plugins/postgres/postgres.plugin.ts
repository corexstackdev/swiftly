import { Injectable, Logger } from '@nestjs/common';
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
} from '@vinodapp/shared';
import { compile, resolveParameters, type CompiledStatement } from '../sql/compiler';
import { applyIdentifierBindings } from '../sql-binding';

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
    { key: 'host', label: 'Host', control: 'text', required: true, placeholder: 'db.internal.acme.com', section: 'Connection' },
    { key: 'port', label: 'Port', control: 'number', defaultValue: 5432, section: 'Connection' },
    { key: 'database', label: 'Database', control: 'text', required: true, section: 'Connection' },
    { key: 'user', label: 'User', control: 'text', required: true, section: 'Credentials' },
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
  };

  private readonly logger = new Logger(PostgresPlugin.name);
  private readonly pools = new Map<string, Pool>();

  async test(config: PostgresConfig): Promise<TestResult> {
    const started = Date.now();
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

      // rowMode 'array' keeps duplicate column names distinct, which a `SELECT a.id,
      // b.id` would otherwise collapse before the table widget ever sees them.
      const result = await client.query<unknown[]>({
        text: sql,
        values,
        rowMode: 'array',
      });

      const columns: ColumnMetadata[] = (result.fields ?? []).map((field) => ({
        name: field.name,
        dataType: String(field.dataTypeID),
      }));

      const rows = result.rows.slice(0, ctx.maxRows).map((row) => {
        const object: Record<string, unknown> = {};
        columns.forEach((column, index) => {
          object[column.name] = row[index];
        });
        return object;
      });

      return {
        rows,
        columns,
        affectedRows: result.rowCount ?? undefined,
        truncated: result.rows.length > ctx.maxRows,
        durationMs: Date.now() - started,
      };
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
      client?.release();
    }
  }

  async introspect(config: PostgresConfig): Promise<DbSchema> {
    const pool = new Pool({ ...this.toPoolConfig(config), max: 1 });
    try {
      const [columns, routines] = await Promise.all([
        pool.query<{
          table_schema: string;
          table_name: string;
          table_type: string;
          column_name: string;
          data_type: string;
          is_nullable: string;
        }>(
          `SELECT c.table_schema, c.table_name, t.table_type,
                  c.column_name, c.data_type, c.is_nullable
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
