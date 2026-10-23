import type { PageDsl, QueryEntity, QueryVariable } from '@swiftly/shared';
import { evaluateExpression, resolveValue } from './evaluateSync';
import { isBinding } from './parser';

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const WIDGET_PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/;
const RESERVED = new Set([
  'params',
  'event',
  'page',
  'appState',
  'currentUser',
  'document',
  'widgets',
  'window',
  'undefined',
  'null',
]);

export function queryVariablesOf(query: QueryEntity | null | undefined): QueryVariable[] {
  if (!query || !Array.isArray(query.variables)) return [];
  return query.variables.filter(
    (variable) => variable && typeof variable.name === 'string' && typeof variable.value === 'string',
  );
}

export function localQueryVariableNames(query: QueryEntity | null | undefined): Set<string> {
  return new Set(
    queryVariablesOf(query)
      .map((variable) => variable.name.trim())
      .filter((name) => VARIABLE_NAME.test(name) && !RESERVED.has(name)),
  );
}

export function isQueryVariableName(name: string): boolean {
  return VARIABLE_NAME.test(name) && !RESERVED.has(name);
}

/** Page-level overrides for a global query, keyed as they were authored. */
export function pageQueryVariableOverrides(
  page: PageDsl | undefined | null,
  queryId: string,
): QueryVariable[] {
  if (!page || !Array.isArray(page.queryVariables)) return [];
  const entry = page.queryVariables.find((item) => item.queryId === queryId);
  if (!entry || !Array.isArray(entry.variables)) return [];
  return entry.variables.filter(
    (variable) => variable && typeof variable.name === 'string' && typeof variable.value === 'string',
  );
}

/**
 * Variables this query will actually run with on a page: declared names, with
 * this page's values winning over the query's defaults when the query is global.
 */
export function resolvedQueryVariables(
  query: QueryEntity,
  page?: PageDsl | null,
): QueryVariable[] {
  const declared = queryVariablesOf(query);
  if (query.pageId || !page) return declared;
  const overrides = new Map(
    pageQueryVariableOverrides(page, query.id).map((variable) => [
      variable.name.trim(),
      variable.value,
    ]),
  );
  return declared.map((variable) => {
    const override = overrides.get(variable.name.trim());
    if (override !== undefined && override !== '') return { ...variable, value: override };
    return variable;
  });
}

export function upsertPageQueryVariables(
  page: PageDsl,
  queryId: string,
  variables: QueryVariable[],
): void {
  const rest = (page.queryVariables ?? []).filter((entry) => entry.queryId !== queryId);
  const cleaned = variables.filter(
    (variable) =>
      variable &&
      typeof variable.name === 'string' &&
      variable.name.trim() !== '' &&
      typeof variable.value === 'string' &&
      variable.value !== '',
  );
  if (cleaned.length > 0) page.queryVariables = [...rest, { queryId, variables: cleaned }];
  else page.queryVariables = rest.length > 0 ? rest : undefined;
}

export function setPageQueryVariableValue(
  page: PageDsl,
  queryId: string,
  name: string,
  value: string,
): void {
  const next = pageQueryVariableOverrides(page, queryId).filter((variable) => variable.name !== name);
  if (value !== '') next.push({ name, value });
  upsertPageQueryVariables(page, queryId, next);
}

export function removePageQueryBindings(pages: PageDsl[] | undefined, queryId: string): void {
  if (!pages) return;
  for (const page of pages) {
    if (!page.queryVariables) continue;
    page.queryVariables = page.queryVariables.filter((entry) => entry.queryId !== queryId);
    if (page.queryVariables.length === 0) delete page.queryVariables;
  }
}

/** Widget bindings belong on a page, not as a global query's default. */
export function isPageSpecificVariableValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return isBinding(trimmed) || WIDGET_PATH.test(trimmed);
}

/**
 * Evaluates this query's named variables against the page scope, then writes
 * them onto that scope as `name` and `params.name` so SQL `{{ name }}` resolves
 * the same way a function argument does.
 */
export function bindQueryVariables(
  query: QueryEntity,
  scope: Record<string, unknown>,
  page?: PageDsl | null,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const variable of resolvedQueryVariables(query, page)) {
    const name = variable.name.trim();
    if (!isQueryVariableName(name)) continue;
    const value = evaluateVariableValue(variable.value, scope);
    params[name] = value;
    scope[name] = value;
  }
  scope.params = params;
  return params;
}

export function evaluateVariableValue(raw: string, scope: Record<string, unknown>): unknown {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (isBinding(trimmed)) return resolveValue(trimmed, scope) ?? null;
  if (WIDGET_PATH.test(trimmed)) {
    const outcome = evaluateExpression(trimmed, scope);
    return outcome.error ? null : (outcome.value ?? null);
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  return trimmed;
}

export function nextVariableName(existing: QueryVariable[]): string {
  const taken = new Set(existing.map((variable) => variable.name));
  let index = 1;
  while (taken.has(`var${index}`)) index += 1;
  return `var${index}`;
}
