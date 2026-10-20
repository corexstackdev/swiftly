/**
 * Runs tenant JS from a widget event.
 *
 * Bindings evaluate in a worker against a snapshot. Event handlers need the live
 * controls — `document.getElementById(id).value = x` — so they compile on this
 * tick with that scope in the function's environment.
 */

import {
  attachControlGlobals,
  controlLookupFrom,
  type ControlLookup,
} from '@/runtime/controlDocument';

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const RESERVED_PARAMS = new Set([
  'module',
  'exports',
  'event',
  'undefined',
  'NaN',
  'Infinity',
  'arguments',
  'eval',
]);
const SCOPE_INDEX_NAMES = new Set([
  'widgets',
  'controls',
  'document',
  'page',
  'appState',
  'getElementById',
  'getElementByName',
  'getElementsByName',
  'getElementsByClassName',
  'querySelector',
  'querySelectorAll',
  'byId',
  'byName',
  'byClass',
]);

const EMPTY_LOOKUP: ControlLookup<unknown> = {
  byId: (_id: string) => undefined,
  byName: (_name: string) => undefined,
  byClass: (_className: string) => [],
};

/**
 * Select/input onChange payloads are `{ value, source }`. Callers write
 * `shippingcity(country)`, so pass `event.value` first and the full event second.
 * Table row events have no `value` and still receive the event object.
 */
export function jsFunctionCallArgs(event: unknown): unknown[] {
  if (event !== null && typeof event === 'object' && 'value' in event) {
    return [(event as Record<string, unknown>).value, event];
  }
  return [event];
}

export function runJsFunction(
  code: string,
  functionName: string,
  scope: Record<string, unknown>,
  event: unknown,
): unknown {
  const exports = compileJsObject(code, scope);
  const fn = exports[functionName];
  if (typeof fn !== 'function') {
    throw new Error(`Function "${functionName}" is not exported`);
  }
  return (fn as (...args: unknown[]) => unknown).call(exports, ...jsFunctionCallArgs(event));
}

/** Call an already-compiled JS object method with `this` bound to the object. */
export function callJsFunction(
  scope: Record<string, unknown>,
  objectName: string,
  functionName: string,
  event: unknown,
): unknown {
  const namespace = scope[objectName];
  if (!namespace || typeof namespace !== 'object') {
    throw new Error(`Unknown JS object “${objectName}”`);
  }
  const fn = (namespace as Record<string, unknown>)[functionName];
  if (typeof fn !== 'function') {
    throw new Error(`Function "${functionName}" is not exported`);
  }
  return (fn as (...args: unknown[]) => unknown).call(namespace, ...jsFunctionCallArgs(event));
}

export function runJsSource(code: string, scope: Record<string, unknown>, event: unknown): unknown {
  const env = withWidgetGlobals(scope);
  const keys = scopeParamKeys(env);
  // eslint-disable-next-line no-new-func
  const fn = new Function(...keys, 'event', `"use strict";\n${code}`);
  return fn(...keys.map((key) => env[key]), event);
}

export function compileJsObject(code: string, scope: Record<string, unknown>): Record<string, unknown> {
  const env = withWidgetGlobals(scope);
  const keys = scopeParamKeys(env);
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    ...keys,
    `"use strict";
     const module = { exports: {} };
     const exports = module.exports;
     ${code};
     return module.exports;`,
  );
  const result = factory(...keys.map((key) => env[key]));
  return result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
}

/**
 * Compiles every JS object into `scope` so event code can call `Utils.format`
 * and object methods can call each other. Placeholders are filled in place so
 * an earlier object still sees a later one's exports.
 *
 * Always compiles, even when a placeholder is already there — otherwise a stub
 * or empty object left on the tree would skip injection of `document`.
 */
export function attachJsObjects(
  scope: Record<string, unknown>,
  objects: { name: string; code: string }[],
): void {
  const pending: { name: string; code: string }[] = [];
  for (const object of objects) {
    if (!IDENTIFIER.test(object.name) || RESERVED_PARAMS.has(object.name)) continue;
    if (SCOPE_INDEX_NAMES.has(object.name)) continue;
    if (!isFillableNamespace(scope[object.name])) scope[object.name] = {};
    pending.push(object);
  }
  for (const object of pending) {
    try {
      Object.assign(
        scope[object.name] as Record<string, unknown>,
        compileJsObject(object.code, scope),
      );
    } catch {
      // A broken helper must not block other actions; the call site reports it.
    }
  }
}

/** `Utils.onCityChange` from a stored action path. */
export function splitJsFunctionPath(path: string): { objectName: string; functionName: string } | null {
  const match = path.trim().match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/);
  if (!match) return null;
  return { objectName: match[1]!, functionName: match[2]! };
}

const HIDDEN_SCOPE_KEYS = new Set(['widgets', 'controls']);

function scopeParamKeys(scope: Record<string, unknown>): string[] {
  return Object.keys(scope).filter(
    (key) => IDENTIFIER.test(key) && !RESERVED_PARAMS.has(key) && !HIDDEN_SCOPE_KEYS.has(key),
  );
}

function withWidgetGlobals(scope: Record<string, unknown>): Record<string, unknown> {
  const lookup = controlLookupFrom(scope) ?? EMPTY_LOOKUP;
  const next = { ...scope };
  attachControlGlobals(next, lookup);
  return next;
}

function isFillableNamespace(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.__swiftlyJsObject === true) return false;
  if (typeof record.getElementById === 'function' || typeof record.setValue === 'function') {
    return false;
  }
  return true;
}
