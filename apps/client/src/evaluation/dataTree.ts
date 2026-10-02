import type { ApplicationDsl, PageDsl, QueryEntity, QueryResult, WidgetDsl } from '@swiftly/shared';
import { getWidgetDefinition } from '@/widgets/registry';

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
export function collectQueryExpressions(query: QueryEntity): string[] {
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

  for (const query of input.dsl.queries) {
    // Expressions inside the query itself are bindings too: the table name a filter
    // reads, the value a WHERE clause compares against. They are registered here so
    // the same dependency graph evaluates them.
    collectQueryExpressions(query).forEach((expression, index) => {
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

  for (const jsObject of input.dsl.jsObjects ?? []) {
    dataTree[jsObject.name] = loadJsObject(jsObject.name, jsObject.code);
  }

  walkWidgets(input.page.widgets, (widget) => {
    const definition = getWidgetDefinition(widget.type);
    const exposed = input.widgetState[widget.name] ?? {};

    // Widget state first: an input's current text is data, not a binding.
    const entity: Record<string, unknown> = { ...exposed };

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
  return resolved;
}

export function emptyQueryState(): QueryRuntimeState {
  return { data: [], isLoading: false, error: null, lastRunAt: null };
}

export function toQueryState(result: QueryResult): QueryRuntimeState {
  return { data: result.rows, isLoading: false, error: null, lastRunAt: Date.now() };
}

/**
 * Compiles a JS object's exported members into a callable namespace. Failures are
 * swallowed into an empty namespace so one broken helper cannot blank the page —
 * the error surfaces on the JS object itself in the editor.
 */
const jsObjectCache = new Map<string, { code: string; exports: Record<string, unknown> }>();

function loadJsObject(name: string, code: string): Record<string, unknown> {
  const cached = jsObjectCache.get(name);
  if (cached && cached.code === code) return cached.exports;

  let exports: Record<string, unknown> = {};
  try {
    // eslint-disable-next-line no-new-func
    const factory = new Function(`"use strict"; const module = { exports: {} }; ${code}; return module.exports;`);
    exports = (factory() ?? {}) as Record<string, unknown>;
  } catch {
    exports = {};
  }

  jsObjectCache.set(name, { code, exports });
  return exports;
}
