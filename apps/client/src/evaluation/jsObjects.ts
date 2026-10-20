/**
 * Tenant JS objects.
 *
 * Compiled functions cannot cross the worker boundary — structured clone
 * rejects them, which is how `Utils.format` used to crash evaluation. The data
 * tree therefore carries source code, and whoever actually runs an expression
 * (the worker, or the synchronous query path) compiles it on their own side.
 *
 * Compilation injects `document.getElementById` / `getElementsByClassName` so a
 * helper used from a binding — `{{ Utils.options() }}` — can read the same
 * lookup API as an event handler.
 */

import { attachControlGlobals, matchByClass } from '@/runtime/controlDocument';
import { attachJsObjects, compileJsObject } from './runEventJs';

export const JS_OBJECT_KIND = '__swiftlyJsObject';

export interface JsObjectStub {
  [JS_OBJECT_KIND]: true;
  name: string;
  code: string;
}

interface ControlCatalogItem {
  id: string;
  name: string;
  type: string;
  className: string;
}

export function jsObjectStub(name: string, code: string): JsObjectStub {
  return { [JS_OBJECT_KIND]: true, name, code };
}

export function isJsObjectStub(value: unknown): value is JsObjectStub {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as Record<string, unknown>)[JS_OBJECT_KIND] === true &&
      typeof (value as JsObjectStub).code === 'string',
  );
}

const cache = new Map<string, { code: string; exports: Record<string, unknown>; error?: string }>();

export interface JsObjectInspection {
  exports: Record<string, unknown>;
  error?: string;
}

/**
 * Compiles a JS object's source into a callable namespace. Failures become an
 * empty object so one broken helper cannot blank the page. The picker and JS
 * panel read `error` so a syntax mistake is visible instead of an empty list.
 *
 * Evaluation goes through `hydrateJsObjects` so it can resolve
 * `document.getElementById` against the page.
 */
export function inspectJsObject(name: string, code: string): JsObjectInspection {
  const cached = cache.get(name);
  if (cached && cached.code === code) {
    return { exports: cached.exports, error: cached.error };
  }

  let exports: Record<string, unknown> = {};
  let error: string | undefined;
  try {
    exports = compileJsObject(code, {});
  } catch (caught) {
    exports = {};
    error = caught instanceof Error ? caught.message : String(caught);
  }

  cache.set(name, { code, exports, error });
  return { exports, error };
}

export function loadJsObject(name: string, code: string): Record<string, unknown> {
  return inspectJsObject(name, code).exports;
}

/** Replaces serialisable stubs with compiled namespaces. Does not mutate `tree`. */
export function hydrateJsObjects(tree: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...tree };
  const lookup = buildEvalWidgetsIndex(next);
  attachControlGlobals(next, lookup);

  const objects: { name: string; code: string }[] = [];
  for (const [key, value] of Object.entries(next)) {
    if (!isJsObjectStub(value)) continue;
    objects.push({ name: value.name || key, code: value.code });
    next[key] = {};
  }
  attachJsObjects(next, objects);
  return next;
}

function buildEvalWidgetsIndex(tree: Record<string, unknown>) {
  const byName = new Map<string, ReturnType<typeof readOnlyWidget>>();
  const byId = new Map<string, ReturnType<typeof readOnlyWidget>>();
  const all: ReturnType<typeof readOnlyWidget>[] = [];

  for (const item of catalogItemsFromTree(tree)) {
    const raw = tree[item.name];
    const entity =
      raw && typeof raw === 'object' && !isJsObjectStub(raw)
        ? { ...item, ...(raw as Record<string, unknown>) }
        : { ...item };
    const api = readOnlyWidget(entity);
    byName.set(item.name, api);
    byId.set(item.id, api);
    all.push(api);
  }

  return {
    byId: (id: string) => byId.get(String(id)),
    byName: (name: string) => byName.get(String(name)),
    byClass: (className: string) => matchByClass(all, className),
  };
}

function catalogItemsFromTree(tree: Record<string, unknown>): ControlCatalogItem[] {
  const items: ControlCatalogItem[] = [];
  for (const [key, value] of Object.entries(tree)) {
    if (
      key === 'page' ||
      key === 'appState' ||
      key === 'currentUser' ||
      key === 'widgets' ||
      key === 'controls' ||
      key === 'document'
    ) {
      continue;
    }
    if (!value || typeof value !== 'object' || isJsObjectStub(value)) continue;
    const record = value as Record<string, unknown>;
    if (typeof record.id === 'string' && typeof record.name === 'string' && typeof record.type === 'string') {
      items.push({
        id: record.id,
        name: record.name,
        type: record.type,
        className: String(record.className ?? record.class ?? ''),
      });
    }
  }
  return items;
}

function noop(): void {}

function readOnlyWidget(entity: Record<string, unknown>) {
  const classNameOf = (): string => String(entity.className ?? entity.class ?? '');
  const readValue = (): unknown => entity.value ?? entity.text ?? entity.selected ?? entity.defaultValue;
  return {
    get id() {
      return String(entity.id ?? '');
    },
    get name() {
      return String(entity.name ?? '');
    },
    get type() {
      return String(entity.type ?? '');
    },
    get className() {
      return classNameOf();
    },
    set className(_value: string) {},
    get class() {
      return classNameOf();
    },
    set class(_value: string) {},
    get properties() {
      return { ...entity };
    },
    get value() {
      return readValue();
    },
    set value(_value: unknown) {},
    get text() {
      return entity.text ?? readValue();
    },
    set text(_value: unknown) {},
    get selected() {
      return entity.selected ?? readValue();
    },
    set selected(_value: unknown) {},
    get disabled() {
      return Boolean(entity.disabled);
    },
    set disabled(_value: boolean) {},
    get options() {
      return entity.sourceData ?? entity.options ?? entity.sourceJs;
    },
    set options(_value: unknown) {},
    setValue: noop,
    setText: noop,
    setSelected: noop,
    setDisabled: noop,
    setOptions: noop,
    setProperty: noop,
    getProperty: (key: string) => entity[key],
    setAttribute: noop,
    getAttribute: (key: string) => entity[key],
  };
}
