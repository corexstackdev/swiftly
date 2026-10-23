import {
  jsObjectsOnPage,
  queriesOnPage,
  type ApplicationDsl,
  type PageDsl,
  type QueryEntity,
  type QueryResult,
  type WidgetDsl,
} from '@swiftly/shared';
import { localQueryVariableNames, resolvedQueryVariables } from './queryVariables';
import { getWidgetDefinition } from '@/widgets/registry';
import { jsObjectStub } from './jsObjects';

/**
 * Builds the two inputs the evaluation worker needs:
 *
 *  - `dataTree`: current entity state — query results, widget values, page params.
 *    This is what expressions read.
 *  - `bindings`: every bindable property, keyed `Entity.property`. This is what
 *    expressions are written in.
 *
 * Keeping them separate is what lets the DSL hold only expressions while evaluated
 * values stay derived state that is never persisted.
 */

export interface QueryRuntimeState {
  data: Record<string, unknown>[];
  /** Column names the driver reported, used when a row object has no keys yet. */
  columns?: string[];
  isLoading: boolean;
  error: string | null;
  lastRunAt: number | null;
}

export interface BuildInput {
  dsl: ApplicationDsl;
  page: PageDsl;
  queryState: Record<string, QueryRuntimeState>;
  /** Values widgets write back: an input's text, a table's selected row. */
  widgetState: Record<string, Record<string, unknown>>;
  pageParams: Record<string, string>;
  pageQuery: Record<string, string>;
  currentUser: { id: string; name: string; email: string } | null;
}

export interface DataTreeResult {
  dataTree: Record<string, unknown>;
  bindings: Record<string, unknown>;
  /**
   * Synthetic binding path -> the expression text it came from, for the `{{ }}`
   * expressions that live inside query definitions rather than widget properties.
   * The server asks for bindings by expression text, so this is how the evaluated
   * values get keyed back to what the server will look up.
   */
  queryExpressions: Record<string, string>;
}

/** Pulls every `{{ }}` expression out of a query definition, at any depth. */
export function collectQueryExpressions(query: QueryEntity, page?: PageDsl): string[] {
  const found: string[] = [];

  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      const pattern = /\{\{([\s\S]*?)\}\}/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(value)) !== null) found.push(match[1]!.trim());
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value !== null && typeof value === 'object') {
      Object.values(value).forEach(visit);
    }
  };

  visit(query.definition);
  visit(resolvedQueryVariables(query, page));
  return [...new Set(found)];
}

export function buildDataTree(input: BuildInput): DataTreeResult {
  const dataTree: Record<string, unknown> = {
    page: { params: input.pageParams, query: input.pageQuery, name: input.page.name },
    appState: input.dsl.appState ?? {},
    currentUser: input.currentUser,
  };
  const bindings: Record<string, unknown> = {};
  const queryExpressions: Record<string, string> = {};

  for (const query of queriesOnPage(input.dsl.queries, input.page.id)) {
    // Expressions inside the query itself are bindings too: the table name a filter
    // reads, the value a WHERE clause compares against. They are registered here so
    // the same dependency graph evaluates them.
    const locals = localQueryVariableNames(query);
    collectQueryExpressions(query, input.page).forEach((expression, index) => {
      // Query-local names (`{{ region }}`) are filled at run from query.variables.
      // Evaluating them here against the page tree would look like a missing widget.
      if (locals.has(expression) || expression === 'params' || expression.startsWith('params.')) {
        return;
      }
      const path = `__query.${query.name}.${index}`;
      bindings[path] = `{{ ${expression} }}`;
      queryExpressions[path] = expression;
    });

    const state = input.queryState[query.name];
    dataTree[query.name] = {
      data: state?.data ?? [],
      isLoading: state?.isLoading ?? false,
      error: state?.error ?? null,
      lastRunAt: state?.lastRunAt ?? null,
    };
  }

  for (const jsObject of jsObjectsOnPage(input.dsl.jsObjects, input.page.id)) {
    // Source, not compiled functions: the worker receives this tree over
    // postMessage, which cannot clone a function. `widgets` / `document` are
    // reserved so a helper cannot shadow the control catalog or DOM lookups.
    if (jsObject.name === 'widgets' || jsObject.name === 'controls' || jsObject.name === 'document') continue;
    dataTree[jsObject.name] = jsObjectStub(jsObject.name, jsObject.code);
  }

  walkWidgets(input.page.widgets, (widget) => {
    const definition = getWidgetDefinition(widget.type);
    const exposed = input.widgetState[widget.name] ?? {};

    // Widget state first: an input's current text is data, not a binding.
    const entity: Record<string, unknown> = {
      ...exposed,
      id: widget.id,
      name: widget.name,
      type: widget.type,
      className: widget.properties.className ?? widget.properties.class ?? '',
    };

    for (const section of definition?.properties ?? []) {
      for (const property of section.properties) {
        const value = widget.properties[property.key];
        if (property.bindable && typeof value === 'string' && value.includes('{{')) {
          bindings[`${widget.name}.${property.key}`] = value;
        } else if (value !== undefined) {
          entity[property.key] = value;
        }
      }
    }

    registerQuerySourceBinding(widget, bindings);

    /*
     * A key the widget declares as exposed state is its own answer to what it is
     * currently showing, so it wins over a property of the same name. Text is
     * where this first bit: its `text` property is the raw value and its `text`
     * state is the formatted one, and the static property was quietly shadowing
     * the very thing the panel advertises under "Exposed state".
     *
     * Only declared keys, so undeclared internals still cannot clobber config.
     */
    for (const entry of definition?.exposedState ?? []) {
      if (entry.key in exposed) entity[entry.key] = exposed[entry.key];
      else if (entity[entry.key] === undefined) entity[entry.key] = null;
    }

    dataTree[widget.name] = entity;
  });

  return { dataTree, bindings, queryExpressions };
}

export function walkWidgets(widgets: WidgetDsl[], visit: (widget: WidgetDsl) => void): void {
  for (const widget of widgets) {
    visit(widget);
    if (widget.children) walkWidgets(widget.children, visit);
  }
}

/** Applies evaluated results onto a widget's properties for rendering. */
export function resolveProperties(
  widget: WidgetDsl,
  evaluated: Record<string, { value: unknown; error?: unknown }>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...widget.properties };
  for (const [key, value] of Object.entries(widget.properties)) {
    if (typeof value === 'string' && value.includes('{{')) {
      const result = evaluated[`${widget.name}.${key}`];
      resolved[key] = result ? result.value : undefined;
    }
  }
  if (widget.properties.sourceKind === 'query') {
    const result = evaluated[`${widget.name}.sourceData`];
    if (result) resolved.sourceData = result.value;
  }
  return resolved;
}

/**
 * Queries a widget is mapped to. Binding a table (or select) to a query is the
 * signal to load it — the widget should not wait for a separate Run click.
 */
export function boundQueryNames(widgets: WidgetDsl[]): string[] {
  const names = new Set<string>();
  walkWidgets(widgets, (widget) => {
    if (widget.properties.sourceKind !== 'query') return;
    const name =
      typeof widget.properties.sourceQuery === 'string' ? widget.properties.sourceQuery.trim() : '';
    if (name) names.add(name);
  });
  return [...names];
}

/**
 * Rows/options come from the query runtime, not from a leftover JSON property or
 * a worker tick that has not caught up yet. Mapping `sourceQuery` is enough.
 */
export function applyQuerySource(
  properties: Record<string, unknown>,
  queryState: Record<string, QueryRuntimeState>,
): Record<string, unknown> {
  if (properties.sourceKind !== 'query') return properties;
  const name =
    typeof properties.sourceQuery === 'string' ? properties.sourceQuery.trim() : '';
  if (!name) return properties;
  const state = queryState[name];
  if (!state) return properties;
  return {
    ...properties,
    sourceData: state.data,
    sourceColumns: state.columns,
    sourceLoading: state.isLoading,
    queryError: state.error,
  };
}

/** A widget whose rows/options come from a named query reads `{{ Query.data }}`. */
function registerQuerySourceBinding(
  widget: WidgetDsl,
  bindings: Record<string, unknown>,
): void {
  if (widget.properties.sourceKind !== 'query') return;
  const queryName =
    typeof widget.properties.sourceQuery === 'string' ? widget.properties.sourceQuery.trim() : '';
  if (!queryName) return;
  bindings[`${widget.name}.sourceData`] = `{{ ${queryName}.data }}`;
}

export function emptyQueryState(): QueryRuntimeState {
  return { data: [], isLoading: false, error: null, lastRunAt: null };
}

export function toQueryState(result: QueryResult): QueryRuntimeState {
  const data = Array.isArray(result.rows) ? result.rows : [];
  const columns = (result.columns ?? []).map((column) => column.name).filter(Boolean);
  return { data, columns: columns.length > 0 ? columns : undefined, isLoading: false, error: null, lastRunAt: Date.now() };
}
