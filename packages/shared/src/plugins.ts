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
}

export interface SchemaNamespace {
  name: string;
  tables: TableMetadata[];
  routines: RoutineMetadata[];
}

export interface DbSchema {
  fetchedAt: string;
  schemas: SchemaNamespace[];
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
  /** Releases pooled connections held for a datasource. */
  dispose?(datasourceId: string): Promise<void>;
}
