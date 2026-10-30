/**
 * The datasource plugin contract.
 *
 * Adding an integration means implementing this interface and registering the
 * plugin; nothing else on either side changes.
 */

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

/**
 * The subset of a schema validator the platform relies on. A zod schema satisfies
 * it structurally, so plugins pass zod schemas without this package depending on zod.
 */
export interface ConfigSchema<T> {
  safeParse(input: unknown):
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: { path: (string | number)[]; message: string }[] };
      };
}

export type ConfigFieldControl = 'text' | 'number' | 'password' | 'select' | 'toggle' | 'textarea';

/** One field of the generated connection form. */
export interface ConfigFieldDefinition {
  /** Dotted path into the config object, e.g. `auth.token`. */
  key: string;
  label: string;
  control: ConfigFieldControl;
  placeholder?: string;
  helpText?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: { label: string; value: string }[];
  visibleWhen?: { key: string; equals: unknown };
  /** Stored encrypted and never returned to the client. */
  secret?: boolean;
  section?: string;
}

export type PluginCategory = 'database' | 'api' | 'storage' | 'saas';

export interface PluginCapabilities {
  rawSql: boolean;
  storedProcedures: boolean;
  functions: boolean;
  visualBuilder: boolean;
  transactions: boolean;
  multiStatement: boolean;
  introspection: boolean;
  readOnlyConnections: boolean;
  pagination: boolean;
  /** Create and alter schemas, tables, columns, and rows from the Data screen. */
  schemaAdmin: boolean;
}

/* ------------------------------------------------------------------ *
 * Execution
 * ------------------------------------------------------------------ */

export type StatementType = 'read' | 'write' | 'ddl' | 'call' | 'unknown';

/** What `prepare` hands back: everything needed to execute, minus the values. */
export interface PreparedQuery {
  /** Plugin-private; only the plugin that prepared it reads it. */
  payload: unknown;
  /** Value expressions, in parameter order. The client is asked to evaluate these. */
  expressions: string[];
  /** Expressions in identifier position, checked against an allowlist at execution. */
  identifierExpressions: string[];
  /** Decides read-replica routing and whether `query:write` is required. */
  statementType: StatementType;
  outputParameters: { name: string; typeHint?: string }[];
}

export interface EvaluatedBindings {
  /** One value per entry in `PreparedQuery.expressions`. */
  values: unknown[];
  /** One value per entry in `PreparedQuery.identifierExpressions`. */
  identifierValues: string[];
}

export interface ExecutionContext {
  datasourceId: string;
  organizationId: string;
  userId: string;
  environment: string;
  timeoutMs: number;
  maxRows: number;
  readOnly: boolean;
  /** Set on the connection so database-side row-level security can read them. */
  sessionVariables?: Record<string, string>;
  signal: AbortSignal;
}

export interface ColumnMetadata {
  name: string;
  dataType: string;
  nullable?: boolean;
  isPrimaryKey?: boolean;
  isIdentity?: boolean;
  hasDefault?: boolean;
  defaultValue?: string | null;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  columns?: ColumnMetadata[];
  affectedRows?: number;
  /** More rows existed than `maxRows` allowed. */
  truncated?: boolean;
  durationMs: number;
  messages?: string[];
  outputParameters?: Record<string, unknown>;
}

export interface TestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
  serverVersion?: string;
}

/* ------------------------------------------------------------------ *
 * Introspection
 * ------------------------------------------------------------------ */

export interface TableMetadata {
  name: string;
  kind: 'table' | 'view';
  columns: ColumnMetadata[];
}

export interface RoutineParameter {
  name: string;
  dataType: string;
  direction: 'in' | 'out' | 'inout';
  ordinal?: number;
  hasDefault?: boolean;
}

export interface RoutineMetadata {
  name: string;
  kind: 'procedure' | 'function';
  parameters: RoutineParameter[];
  /** Postgres `RETURNS SETOF` / table functions — call with `SELECT * FROM fn(...)`. */
  returnsSet?: boolean;
}

export interface SchemaPrivileges {
  /** Can look up and read objects in this schema. */
  usage: boolean;
  /** Can create or alter tables in this schema. */
  create: boolean;
}

export interface SchemaNamespace {
  name: string;
  tables: TableMetadata[];
  routines: RoutineMetadata[];
  owner?: string;
  privileges?: SchemaPrivileges;
}

export interface DbSchema {
  fetchedAt: string;
  /** Database role this connection is using. */
  connectedUser?: string;
  schemas: SchemaNamespace[];
}

/* ------------------------------------------------------------------ *
 * Schema administration (optional — SQL databases)
 * ------------------------------------------------------------------ */

export type ColumnDefaultKind = 'none' | 'null' | 'now' | 'uuid' | 'literal';

export interface ColumnSpec {
  name: string;
  dataType: string;
  nullable?: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  identity?: boolean;
  defaultKind?: ColumnDefaultKind;
  defaultValue?: string;
}

export interface ColumnPatch {
  dataType?: string;
  nullable?: boolean;
  defaultKind?: ColumnDefaultKind;
  defaultValue?: string;
}

export interface CreateTableInput {
  schema: string;
  name: string;
  columns: ColumnSpec[];
}

export interface TableRowsPage {
  rows: Record<string, unknown>[];
  columns: ColumnMetadata[];
  totalRows: number;
  durationMs: number;
}

export interface SchemaAdmin<TConfig = unknown> {
  createSchema(config: TConfig, name: string): Promise<void>;
  dropSchema(config: TConfig, name: string, cascade?: boolean): Promise<void>;
  createTable(config: TConfig, input: CreateTableInput): Promise<void>;
  dropTable(config: TConfig, schema: string, table: string): Promise<void>;
  renameTable(config: TConfig, schema: string, table: string, newName: string): Promise<void>;
  addColumn(config: TConfig, schema: string, table: string, column: ColumnSpec): Promise<void>;
  alterColumn(
    config: TConfig,
    schema: string,
    table: string,
    name: string,
    patch: ColumnPatch,
  ): Promise<void>;
  dropColumn(config: TConfig, schema: string, table: string, name: string): Promise<void>;
  renameColumn(
    config: TConfig,
    schema: string,
    table: string,
    name: string,
    newName: string,
  ): Promise<void>;
  listRows(
    config: TConfig,
    schema: string,
    table: string,
    options: { limit: number; offset: number },
  ): Promise<TableRowsPage>;
  insertRow(
    config: TConfig,
    schema: string,
    table: string,
    values: Record<string, unknown>,
  ): Promise<void>;
  updateRow(
    config: TConfig,
    schema: string,
    table: string,
    key: Record<string, unknown>,
    values: Record<string, unknown>,
  ): Promise<void>;
  deleteRows(
    config: TConfig,
    schema: string,
    table: string,
    keys: Record<string, unknown>[],
  ): Promise<void>;
}

/* ------------------------------------------------------------------ *
 * The plugin
 * ------------------------------------------------------------------ */

export interface DatasourcePlugin<TConfig = unknown, TQuery = unknown> {
  readonly id: string;
  readonly name: string;
  readonly category: PluginCategory;
  readonly configSchema: ConfigSchema<TConfig>;
  /** Dotted config paths that are encrypted at rest and redacted on read. */
  readonly secretFields: string[];
  readonly configFields: ConfigFieldDefinition[];
  readonly querySchema: ConfigSchema<TQuery>;
  readonly capabilities: PluginCapabilities;

  test(config: TConfig): Promise<TestResult>;
  prepare(query: TQuery): PreparedQuery;
  execute(
    config: TConfig,
    prepared: PreparedQuery,
    bindings: EvaluatedBindings,
    ctx: ExecutionContext,
  ): Promise<QueryResult>;
  introspect?(config: TConfig): Promise<DbSchema>;
  schemaAdmin?: SchemaAdmin<TConfig>;
  /** Releases pooled connections held for a datasource. */
  dispose?(datasourceId: string): Promise<void>;
}
