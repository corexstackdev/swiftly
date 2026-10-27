import { Injectable } from '@nestjs/common';
import mysql, { type Pool, type PoolOptions } from 'mysql2/promise';
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

const configSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().positive().default(3306),
  database: z.string().min(1),
  user: z.string().min(1),
  password: z.string().default(''),
  ssl: z.enum(['disable', 'require']).default('disable'),
  poolSize: z.coerce.number().int().min(1).max(50).default(5),
});

type MysqlConfig = z.infer<typeof configSchema>;

@Injectable()
export class MysqlPlugin implements DatasourcePlugin<MysqlConfig, QueryDefinition> {
  readonly id = 'mysql';
  readonly name = 'MySQL / MariaDB';
  readonly category = 'database' as const;
  readonly configSchema = configSchema;
  readonly secretFields = ['password'];
  readonly configFields: ConfigFieldDefinition[] = [
    { key: 'host', label: 'Host', control: 'text', required: true, section: 'Connection' },
    { key: 'port', label: 'Port', control: 'number', defaultValue: 3306, section: 'Connection' },
    { key: 'database', label: 'Database', control: 'text', required: true, section: 'Connection' },
    { key: 'user', label: 'User', control: 'text', required: true, section: 'Credentials' },
    { key: 'password', label: 'Password', control: 'password', secret: true, section: 'Credentials' },
    {
      key: 'ssl', label: 'SSL mode', control: 'select', defaultValue: 'disable', section: 'Security',
      options: [
        { label: 'Disable', value: 'disable' },
        { label: 'Require', value: 'require' },
      ],
    },
    { key: 'poolSize', label: 'Pool size', control: 'number', defaultValue: 5, section: 'Advanced' },
  ];

  readonly querySchema = z.any() as unknown as ConfigSchema<QueryDefinition>;

  readonly capabilities = {
    rawSql: true,
    storedProcedures: true,
    functions: true,
    visualBuilder: true,
    transactions: true,
    multiStatement: false,
    introspection: true,
    readOnlyConnections: true,
    pagination: true,
    schemaAdmin: false,
  };

  private readonly pools = new Map<string, Pool>();

  async test(config: MysqlConfig): Promise<TestResult> {
    const started = Date.now();
    try {
      const connection = await mysql.createConnection(this.toOptions(config));
      const [rows] = await connection.query<mysql.RowDataPacket[]>('SELECT VERSION() AS version');
      await connection.end();
      return {
        ok: true,
        message: 'Connection successful',
        serverVersion: String(rows[0]?.version ?? ''),
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - started,
      };
    }
  }

  prepare(query: QueryDefinition): PreparedQuery {
    const compiled = compile(query, 'mysql');
    return {
      payload: compiled,
      expressions: compiled.expressions,
      identifierExpressions: compiled.identifierBindings.map((b) => b.expression),
      statementType: compiled.statementType,
      outputParameters: compiled.outputParameters,
    };
  }

  async execute(
    config: MysqlConfig,
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
    const connection = await pool.getConnection();

    try {
      if (ctx.readOnly) {
        await connection.query('SET SESSION TRANSACTION READ ONLY');
      }
      // MySQL caps execution server-side in milliseconds via the optimizer hint.
      const [rows, fields] = await connection.query({
        sql,
        values,
        timeout: ctx.timeoutMs,
      });

      const columns: ColumnMetadata[] = Array.isArray(fields)
        ? fields.map((field: { name: string; type?: unknown }) => ({
            name: field.name,
            dataType: String(field.type ?? ''),
          }))
        : [];

      if (!Array.isArray(rows)) {
        const info = rows as mysql.ResultSetHeader;
        return {
          rows: [],
          columns,
          affectedRows: info.affectedRows,
          truncated: false,
          durationMs: Date.now() - started,
        };
      }

      const data = rows as Record<string, unknown>[];
      return {
        rows: data.slice(0, ctx.maxRows),
        columns,
        truncated: data.length > ctx.maxRows,
        durationMs: Date.now() - started,
      };
    } finally {
      connection.release();
    }
  }

  async introspect(config: MysqlConfig): Promise<DbSchema> {
    const connection = await mysql.createConnection(this.toOptions(config));
    try {
      const [columnRows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT c.TABLE_SCHEMA, c.TABLE_NAME, t.TABLE_TYPE,
                c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE
           FROM information_schema.COLUMNS c
           JOIN information_schema.TABLES t
             ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
          WHERE c.TABLE_SCHEMA = ?
          ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`,
        [config.database],
      );

      const [routineRows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT r.ROUTINE_NAME, r.ROUTINE_TYPE, p.PARAMETER_NAME,
                p.DATA_TYPE, p.PARAMETER_MODE, p.ORDINAL_POSITION
           FROM information_schema.ROUTINES r
           LEFT JOIN information_schema.PARAMETERS p
             ON p.SPECIFIC_NAME = r.ROUTINE_NAME
            AND p.SPECIFIC_SCHEMA = r.ROUTINE_SCHEMA
          WHERE r.ROUTINE_SCHEMA = ?
          ORDER BY r.ROUTINE_NAME, p.ORDINAL_POSITION`,
        [config.database],
      );

      const tables = new Map<string, { kind: 'table' | 'view'; columns: ColumnMetadata[] }>();
      for (const row of columnRows) {
        const name = String(row.TABLE_NAME);
        let table = tables.get(name);
        if (!table) {
          table = { kind: row.TABLE_TYPE === 'VIEW' ? 'view' : 'table', columns: [] };
          tables.set(name, table);
        }
        table.columns.push({
          name: String(row.COLUMN_NAME),
          dataType: String(row.DATA_TYPE),
          nullable: row.IS_NULLABLE === 'YES',
        });
      }

      const routines = new Map<string, RoutineMetadata>();
      for (const row of routineRows) {
        const name = String(row.ROUTINE_NAME);
        let routine = routines.get(name);
        if (!routine) {
          routine = {
            name,
            kind: row.ROUTINE_TYPE === 'PROCEDURE' ? 'procedure' : 'function',
            parameters: [],
          };
          routines.set(name, routine);
        }
        if (row.PARAMETER_NAME) {
          routine.parameters.push({
            name: String(row.PARAMETER_NAME),
            dataType: String(row.DATA_TYPE),
            direction: String(row.PARAMETER_MODE ?? 'IN').toLowerCase() as 'in' | 'out' | 'inout',
            ordinal: Number(row.ORDINAL_POSITION),
            hasDefault: false,
          });
        }
      }

      return {
        fetchedAt: new Date().toISOString(),
        schemas: [
          {
            name: config.database,
            tables: [...tables.entries()].map(([name, table]) => ({ name, ...table })),
            routines: [...routines.values()],
          },
        ],
      };
    } finally {
      await connection.end();
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

  private getPool(config: MysqlConfig, ctx: ExecutionContext): Pool {
    const key = `${ctx.datasourceId}:${ctx.environment}`;
    let pool = this.pools.get(key);
    if (!pool) {
      pool = mysql.createPool({
        ...this.toOptions(config),
        connectionLimit: config.poolSize,
        waitForConnections: true,
      });
      this.pools.set(key, pool);
    }
    return pool;
  }

  private toOptions(config: MysqlConfig): PoolOptions {
    return {
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl === 'require' ? { rejectUnauthorized: false } : undefined,
      // Prepared statements are the default path; disabling multi-statement mode
      // removes stacked-query injection as a category of risk entirely.
      multipleStatements: false,
      dateStrings: true,
    };
  }
}
