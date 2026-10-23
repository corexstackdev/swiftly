/// <reference lib="webworker" />
import type { EvaluationError, EvaluationMap } from '@swiftly/shared';
import { parseBinding, type ParsedBinding } from './parser';
import { isAbsentPropertyError } from './evaluateSync';
import { affectedSubgraph, buildGraph, type SortedGraph } from './graph';
import { hydrateJsObjects, isJsObjectStub } from './jsObjects';

/**
 * The evaluation worker.
 *
 * Bindings run off the main thread for one reason above all: a builder will
 * eventually write `{{ while(true){} }}`, and when they do the editor must stay
 * responsive enough to let them delete it. A runaway expression blocks this worker,
 * not the UI, and the host can terminate and restart it.
 */

interface EvaluateRequest {
  type: 'evaluate';
  requestId: number;
  /** Entity state: query results, widget values, page params, app state. */
  dataTree: Record<string, unknown>;
  /** Bindable property path -> raw property value (binding or literal). */
  bindings: Record<string, unknown>;
  /** When present, only these paths and their dependents are recomputed. */
  changedPaths?: string[];
}

interface EvaluateResponse {
  type: 'result';
  requestId: number;
  evaluated: EvaluationMap;
  cycles: string[][];
  durationMs: number;
  /** Paths actually recomputed, for the editor's performance readout. */
  recomputed: number;
}

/** Parsed bindings and the graph survive between messages so typing does not re-parse the page. */
let parsedCache = new Map<string, ParsedBinding>();
let graph: SortedGraph | null = null;
let graphKey = '';
let lastEvaluated: EvaluationMap = {};
let latestRequestId = 0;

/**
 * Resolved `async` / `fetch` results, keyed by the expression and the values it
 * actually reads. A table bound to `{{ Utils.fetchPosts() }}` must not hit the
 * network again every time an unrelated input changes.
 */
const asyncCache = new Map<string, unknown>();
const asyncInflight = new Map<string, Promise<unknown>>();

self.onmessage = (event: MessageEvent<EvaluateRequest>) => {
  const message = event.data;
  if (message.type !== 'evaluate') return;
  void runEvaluate(message);
};

async function runEvaluate(message: EvaluateRequest): Promise<void> {
  latestRequestId = message.requestId;
  const started = performance.now();
  const { dataTree, bindings, changedPaths } = message;

  // Reparse only what changed; the cache is keyed by the raw text so an unchanged
  // property costs nothing.
  const parsed = new Map<string, ParsedBinding>();
  const nodes: { path: string; dependencies: string[] }[] = [];

  for (const [path, value] of Object.entries(bindings)) {
    if (typeof value !== 'string' || !value.includes('{{')) continue;
    const cached = parsedCache.get(path);
    const binding = cached && cached.raw === value ? cached : parseBinding(value);
    parsed.set(path, binding);
    nodes.push({ path, dependencies: binding.dependencies });
  }
  parsedCache = parsed;

  // Rebuild the graph only when the shape changed, not when values did.
  const key = nodes.map((n) => `${n.path}:${n.dependencies.join(',')}`).join('|');
  if (key !== graphKey || !graph) {
    graph = buildGraph(nodes);
    graphKey = key;
  }

  const cycleNodes = new Set(graph.cycles.flat());
  const toEvaluate =
    changedPaths && changedPaths.length > 0 && Object.keys(lastEvaluated).length > 0
      ? affectedSubgraph(graph, changedPaths).filter((p) => parsed.has(p))
      : graph.order.filter((p) => parsed.has(p));

  const evaluated: EvaluationMap = changedPaths ? { ...lastEvaluated } : {};
  const scope: Record<string, unknown> = hydrateJsObjects({ ...dataTree });

  for (const path of toEvaluate) {
    if (latestRequestId !== message.requestId) return;
    const binding = parsed.get(path);
    if (!binding) continue;

    if (cycleNodes.has(path)) {
      const cycle = graph.cycles.find((c) => c.includes(path)) ?? [path];
      evaluated[path] = {
        value: undefined,
        error: {
          message: `Circular dependency: ${cycle.join(' -> ')} -> ${cycle[0]}`,
          path,
          kind: 'cycle',
        },
      };
      continue;
    }

    evaluated[path] = await evaluateBinding(binding, scope, path, dataTree);

    // Results feed the scope so a later binding in the order sees them.
    writePath(scope, path, evaluated[path]!.value);
  }

  if (latestRequestId !== message.requestId) return;

  lastEvaluated = evaluated;

  const response: EvaluateResponse = {
    type: 'result',
    requestId: message.requestId,
    evaluated: cloneableMap(evaluated),
    cycles: graph.cycles,
    durationMs: performance.now() - started,
    recomputed: toEvaluate.length,
  };
  self.postMessage(response);
}

async function evaluateBinding(
  binding: ParsedBinding,
  scope: Record<string, unknown>,
  path: string,
  dataTree: Record<string, unknown>,
): Promise<{ value: unknown; error?: EvaluationError }> {
  if (binding.syntaxError) {
    return {
      value: undefined,
      error: { message: binding.syntaxError, path, kind: 'syntax' },
    };
  }

  const results: unknown[] = [];
  for (const expression of binding.expressions) {
    try {
      results.push(await resolveExpression(expression, scope, binding.dependencies, dataTree));
    } catch (error) {
      return {
        value: undefined,
        error: {
          message: error instanceof Error ? error.message : String(error),
          path,
          kind: error instanceof ReferenceError ? 'reference' : 'runtime',
        },
      };
    }
  }

  // `{{ x }}` alone keeps the value's type; anything interleaved with text becomes
  // a string. A table bound to `{{ Query.data }}` must receive the array itself.
  if (binding.parts.length === 2 && binding.parts[0] === '' && binding.parts[1] === '') {
    return { value: results[0] };
  }

  let out = binding.parts[0] ?? '';
  results.forEach((result, index) => {
    out += stringify(result);
    out += binding.parts[index + 1] ?? '';
  });
  return { value: out };
}

async function resolveExpression(
  expression: string,
  scope: Record<string, unknown>,
  dependencies: string[],
  dataTree: Record<string, unknown>,
): Promise<unknown> {
  const value = run(expression, scope);
  if (!isThenable(value)) return value;

  const cacheKey = asyncCacheKey(expression, dependencies, dataTree);
  if (asyncCache.has(cacheKey)) return asyncCache.get(cacheKey);

  let pending = asyncInflight.get(cacheKey);
  if (!pending) {
    pending = Promise.resolve(value).then((resolved) => {
      if (resolved === undefined || resolved === null) {
        throw new Error(
          'The function finished but returned nothing. Return the data (for example `return response.json()`), not `console.log(...)`.',
        );
      }
      rememberAsync(cacheKey, resolved);
      return resolved;
    });
    asyncInflight.set(cacheKey, pending);
  }

  try {
    return await pending;
  } finally {
    asyncInflight.delete(cacheKey);
  }
}

function isThenable(value: unknown): value is Promise<unknown> {
  return Boolean(value && (typeof value === 'object' || typeof value === 'function') && typeof (value as Promise<unknown>).then === 'function');
}

function asyncCacheKey(
  expression: string,
  dependencies: string[],
  dataTree: Record<string, unknown>,
): string {
  const parts = [expression];
  for (const path of dependencies) {
    parts.push(`${path}=${snapshotPath(dataTree, path)}`);
  }
  return parts.join('\n');
}

function snapshotPath(tree: Record<string, unknown>, path: string): string {
  const [entity, prop] = path.split('.');
  if (!entity) return '';
  const value = tree[entity];
  if (isJsObjectStub(value)) return `js:${value.code}`;
  if (prop === undefined) return stableSnapshot(value);
  if (value && typeof value === 'object') {
    return stableSnapshot((value as Record<string, unknown>)[prop]);
  }
  return '';
}

function stableSnapshot(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'function') return '[function]';
  if (isJsObjectStub(value)) return `js:${value.code}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function rememberAsync(cacheKey: string, value: unknown): void {
  asyncCache.set(cacheKey, value);
  if (asyncCache.size <= 40) return;
  const oldest = asyncCache.keys().next().value;
  if (oldest !== undefined) asyncCache.delete(oldest);
}

const compiled = new Map<string, (scope: Record<string, unknown>) => unknown>();

/**
 * Compiles an expression once and reuses it. `with` gives the expression direct
 * access to entity names without a prefix, which is what makes `{{ Table1.data }}`
 * read naturally — this is the builder's own code running in the builder's own
 * browser, and the server re-derives everything it trusts from the stored DSL.
 */
function run(expression: string, scope: Record<string, unknown>): unknown {
  let fn = compiled.get(expression);
  if (!fn) {
    // eslint-disable-next-line no-new-func
    fn = new Function(
      'scope',
      `with (scope) { return (${expression}); }`,
    ) as (scope: Record<string, unknown>) => unknown;
    compiled.set(expression, fn);
    if (compiled.size > 2000) compiled.clear();
  }
  try {
    return fn(scope);
  } catch (error) {
    // `Table1.selectedRow.id` with no row selected is empty, not a page error.
    if (isAbsentPropertyError(error)) return undefined;
    throw error;
  }
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'function') {
    return value.name ? `[Function ${value.name}]` : '[Function]';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Structured clone cannot carry functions. A binding that returns one (or an
 * object holding one) would otherwise fail postMessage and leave the page unevaluated.
 */
function cloneableMap(evaluated: EvaluationMap): EvaluationMap {
  const next: EvaluationMap = {};
  for (const [path, result] of Object.entries(evaluated)) {
    next[path] = { ...result, value: toCloneable(result.value) };
  }
  return next;
}

function toCloneable(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  const type = typeof value;
  if (type === 'function') {
    if (isThenable(value)) return undefined;
    const name = (value as { name?: string }).name;
    return name ? `[Function ${name}]` : '[Function]';
  }
  if (type === 'symbol' || type === 'bigint') return String(value);
  if (type !== 'object') return value;
  if (isThenable(value)) return undefined;
  const object = value as object;
  if (seen.has(object)) return '[Circular]';
  seen.add(object);
  if (Array.isArray(value)) return value.map((entry) => toCloneable(entry, seen));
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = toCloneable(entry, seen);
  }
  return out;
}

/** Writes `Entity.property` into the scope so dependents read the evaluated value. */
function writePath(scope: Record<string, unknown>, path: string, value: unknown): void {
  const [entity, ...rest] = path.split('.');
  if (!entity) return;
  if (rest.length === 0) {
    scope[entity] = value;
    return;
  }
  const container = (scope[entity] ??= {}) as Record<string, unknown>;
  let cursor = container;
  for (const segment of rest.slice(0, -1)) {
    cursor = (cursor[segment] ??= {}) as Record<string, unknown>;
  }
  cursor[rest[rest.length - 1]!] = value;
}

export type { EvaluateRequest, EvaluateResponse };
