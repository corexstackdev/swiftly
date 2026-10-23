/**
 * Query definitions, one per authoring mode.
 *
 * Every string field may contain `{{ }}` bindings. They are never interpolated:
 * the server turns each one into a driver-level parameter.
 */

/** Permits a binding in identifier position, where a parameter is not legal. */
export interface IdentifierAllowlistEntry {
  /** The binding expression, as written between the braces. */
  binding: string;
  allowedValues: string[];
}

/**
 * A named value injected when a query runs. SQL (or a function argument) writes
 * `{{ region }}`; this maps `region` to a widget binding or a literal so the
 * statement itself does not hard-code `{{ Form1.data.Region }}`.
 *
 * On a global query, `value` is the default for every page. A page can override
 * it through `PageDsl.queryVariables` so each screen passes its own widgets.
 */
export interface QueryVariable {
  name: string;
  /** Literal, `{{ Form1.data.Name }}`, or a dotted widget path. */
  value: string;
}

export interface RawSqlDefinition {
  kind: 'raw_sql';
  sql: string;
  identifierAllowlist?: IdentifierAllowlistEntry[];
}

export type ParameterDirection = 'in' | 'out' | 'inout';

export interface RoutineArgument {
  name: string;
  direction: ParameterDirection;
  typeHint?: string;
  /** Literal or `{{ }}` expression. Absent for pure OUT parameters. */
  value?: string;
}

export interface StoredProcedureDefinition {
  kind: 'stored_procedure';
  schema?: string;
  procedureName: string;
  arguments: RoutineArgument[];
}

export interface FunctionDefinition {
  kind: 'function';
  schema?: string;
  functionName: string;
  /** Functions take IN arguments only; `direction` is carried over from introspection. */
  arguments: (Omit<RoutineArgument, 'direction'> & { direction?: ParameterDirection })[];
  /** `SELECT * FROM fn(...)` rather than `SELECT fn(...) AS result`. */
  tableValued?: boolean;
}

export type BuilderOperation = 'select' | 'insert' | 'update' | 'delete';

export type BuilderOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like'
  | 'ilike'
  | 'in'
  | 'not_in'
  | 'is_null'
  | 'is_not_null';

export interface BuilderFilter {
  column: string;
  operator: BuilderOperator;
  value?: string;
  /** How this filter joins the previous one. Ignored on the first. */
  conjunction?: 'and' | 'or';
}

export interface BuilderSort {
  column: string;
  direction: 'asc' | 'desc';
}

export interface BuilderDefinition {
  kind: 'builder';
  operation: BuilderOperation;
  schema?: string;
  table: string;
  /** Select only; empty selects every column. */
  columns?: string[];
  /** Insert and update: column -> literal or `{{ }}` expression. */
  values?: Record<string, string>;
  filters?: BuilderFilter[];
  sort?: BuilderSort[];
  limit?: string;
  offset?: string;
}

/** The modes a SQL datasource compiles. */
export type QueryDefinition =
  | RawSqlDefinition
  | StoredProcedureDefinition
  | FunctionDefinition
  | BuilderDefinition;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface KeyValueEntry {
  key: string;
  value: string;
  enabled: boolean;
}

export type ApiBody =
  | { type: 'none' }
  | { type: 'json'; content: string }
  | { type: 'raw'; content: string; contentType: string }
  | { type: 'graphql'; document: string; variables?: string }
  | { type: 'form_urlencoded'; entries: KeyValueEntry[] };

export interface ApiDefinition {
  kind: 'api';
  protocol: 'rest' | 'graphql' | 'soap';
  method: HttpMethod;
  /** Resolved against the datasource's base URL. */
  path: string;
  queryParams?: KeyValueEntry[];
  headers?: KeyValueEntry[];
  body?: ApiBody;
}

export type AnyQueryDefinition = QueryDefinition | ApiDefinition;
