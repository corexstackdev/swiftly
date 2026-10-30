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
  /**
   * Execute-time page window from a server-paged table. Not an authoring field —
   * the query editor does not write these; `applyBuilderPageWindow` does.
   */
  limit?: string;
  offset?: string;
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

/**
 * Bindings a server-paged table (or list) sends so a SELECT can fetch one page.
 * The runtime writes these; the compiler turns them into LIMIT/OFFSET.
 */
export const PAGE_WINDOW_LIMIT_BINDING = '__page.limit';
export const PAGE_WINDOW_OFFSET_BINDING = '__page.offset';

/** Strips comments so LIMIT inside `-- LIMIT 10` is not treated as paging. */
function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/**
 * True when the statement already windows itself — a second LIMIT would be a
 * syntax error, and a wrapping OFFSET would skip inside the author's page.
 * `table.offset` is not a clause: the keyword must not follow `.` or an ident.
 */
export function sqlAlreadyHasPageClause(sql: string): boolean {
  const stripped = stripSqlComments(sql);
  return (
    /(?<![\w."`\[\]])\bLIMIT\s+\S/i.test(stripped) ||
    /(?<![\w."`\[\]])\bOFFSET\s+\S/i.test(stripped) ||
    /(?<![\w."`\[\]])\bFETCH\s+(?:NEXT|FIRST)\s+\S/i.test(stripped)
  );
}

/** SELECT / WITH that is a single statement, so a LIMIT suffix is legal. */
export function sqlAcceptsPageWindow(sql: string): boolean {
  const stripped = stripSqlComments(sql).replace(/;+\s*$/, '').trim();
  if (stripped.includes(';')) return false;
  return /^(WITH|SELECT)\b/i.test(stripped);
}

function pageWindowFields(
  bindings: Record<string, unknown>,
): { limit?: string; offset?: string } | null {
  const limit = bindings[PAGE_WINDOW_LIMIT_BINDING];
  const offset = bindings[PAGE_WINDOW_OFFSET_BINDING];
  if (limit == null && offset == null) return null;

  const next: { limit?: string; offset?: string } = {};
  if (limit != null && Number.isFinite(Number(limit))) {
    next.limit = String(Math.max(1, Math.floor(Number(limit))));
  }
  if (offset != null && Number.isFinite(Number(offset))) {
    next.offset = String(Math.max(0, Math.floor(Number(offset))));
  }
  return next.limit == null && next.offset == null ? null : next;
}

/**
 * Applies the window a server-paged widget asked for onto a SELECT.
 * Builder queries get limit/offset fields. Raw SQL that has no LIMIT / OFFSET
 * of its own gets the same fields, which the compiler appends as a suffix.
 * Raw SQL that already pages itself is left alone.
 */
export function applyBuilderPageWindow(
  definition: unknown,
  bindings: Record<string, unknown> | undefined,
): unknown {
  if (!definition || typeof definition !== 'object' || !bindings) return definition;
  const pageWindow = pageWindowFields(bindings);
  if (!pageWindow) return definition;

  const current = definition as QueryDefinition;
  if (current.kind === 'builder') {
    if (current.operation !== 'select') return definition;
    return { ...current, ...pageWindow };
  }

  if (current.kind === 'raw_sql') {
    if (!sqlAcceptsPageWindow(current.sql) || sqlAlreadyHasPageClause(current.sql)) {
      return definition;
    }
    return { ...current, ...pageWindow };
  }

  return definition;
}
