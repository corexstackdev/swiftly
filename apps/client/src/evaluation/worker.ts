/// <reference lib="webworker" />
import type { EvaluationError, EvaluationMap } from '@vinodapp/shared';
import { parseBinding, type ParsedBinding } from './parser';
import { affectedSubgraph, buildGraph, type SortedGraph } from './graph';

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

self.onmessage = (event: MessageEvent<EvaluateRequest>) => {
  const message = event.data;
  if (message.type !== 'evaluate') return;

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
  const scope: Record<string, unknown> = { ...dataTree };

  for (const path of toEvaluate) {
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

    evaluated[path] = evaluateBinding(binding, scope, path);

    // Results feed the scope so a later binding in the order sees them.
    writePath(scope, path, evaluated[path]!.value);
  }

  lastEvaluated = evaluated;

  const response: EvaluateResponse = {
    type: 'result',
    requestId: message.requestId,
    evaluated,
    cycles: graph.cycles,
    durationMs: performance.now() - started,
    recomputed: toEvaluate.length,
  };
  self.postMessage(response);
};

function evaluateBinding(
  binding: ParsedBinding,
  scope: Record<string, unknown>,
  path: string,
): { value: unknown; error?: EvaluationError } {
  if (binding.syntaxError) {
    return {
      value: undefined,
      error: { message: binding.syntaxError, path, kind: 'syntax' },
    };
  }

  const results: unknown[] = [];
  for (const expression of binding.expressions) {
    try {
      results.push(run(expression, scope));
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
  return fn(scope);
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
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
