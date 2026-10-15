/**
 * DOM-shaped lookups for tenant JS.
 *
 * Event code and JS objects find controls by the Id / Class fields on the
 * widget, then read and assign `value` and other properties on the result —
 * `document.getElementById(id).value = x`, `getElementsByClassName(cls)[0]`.
 *
 * The lookup tables themselves are not tenant globals (`widgets` is not in
 * scope). They travel on this symbol so `new Function` never sees them.
 */
export const CONTROL_LOOKUP = Symbol('swiftlyControlLookup');

export interface ControlLookup<T> {
  byId: (id: string) => T | undefined;
  byName: (name: string) => T | undefined;
  byClass: (className: string) => T[];
}

export interface ControlDocument<T> {
  getElementById: (id: string) => T | undefined;
  getElementByName: (name: string) => T | undefined;
  getElementsByName: (name: string) => T[];
  getElementsByClassName: (className: string) => T[];
  querySelector: (selector: string) => T | undefined;
  querySelectorAll: (selector: string) => T[];
  /** Short aliases: `document.byId(id).value = x` */
  byId: (id: string) => T | undefined;
  byName: (name: string) => T | undefined;
  byClass: (className: string) => T[];
}

/** Id first, then widget name, so either field from the property panel works. */
export function elementById<T>(lookup: ControlLookup<T>, id: string): T | undefined {
  const key = String(id ?? '').trim();
  if (!key) return undefined;
  return lookup.byId(key) ?? lookup.byName(key);
}

export function matchByClass<T extends { className: string }>(all: T[], className: string): T[] {
  const needles = String(className ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (needles.length === 0) return [];
  return all.filter((api) => {
    const tokens = new Set(String(api.className).split(/\s+/).filter(Boolean));
    return needles.every((needle) => tokens.has(needle));
  });
}

export function elementsByClassName<T>(lookup: ControlLookup<T>, className: string): T[] {
  return lookup.byClass(String(className ?? ''));
}

export function elementByName<T>(lookup: ControlLookup<T>, name: string): T | undefined {
  const key = String(name ?? '').trim();
  if (!key) return undefined;
  return lookup.byName(key) ?? lookup.byId(key);
}

export function createControlDocument<T>(lookup: ControlLookup<T>): ControlDocument<T> {
  const getElementById = (id: string) => elementById(lookup, id);
  const getElementByName = (name: string) => elementByName(lookup, name);
  const getElementsByName = (name: string) => {
    const el = getElementByName(name);
    return el ? [el] : [];
  };
  const getElementsByClassName = (className: string) => elementsByClassName(lookup, className);
  const querySelectorAll = (selector: string) => queryControls(selector, lookup);
  const querySelector = (selector: string) => querySelectorAll(selector)[0];

  return {
    getElementById,
    getElementByName,
    getElementsByName,
    getElementsByClassName,
    querySelector,
    querySelectorAll,
    byId: getElementById,
    byName: getElementByName,
    byClass: getElementsByClassName,
  };
}

export function attachControlGlobals<T>(
  scope: Record<string, unknown>,
  lookup: ControlLookup<T>,
): Record<string, unknown> {
  const document = createControlDocument(lookup);
  (scope as Record<PropertyKey, unknown>)[CONTROL_LOOKUP] = lookup;
  scope.document = document;
  scope.getElementById = document.getElementById;
  scope.getElementByName = document.getElementByName;
  scope.getElementsByName = document.getElementsByName;
  scope.getElementsByClassName = document.getElementsByClassName;
  scope.querySelector = document.querySelector;
  scope.querySelectorAll = document.querySelectorAll;
  scope.byId = document.byId;
  scope.byName = document.byName;
  scope.byClass = document.byClass;
  if (scope.console === undefined) scope.console = globalThis.console;
  delete scope.widgets;
  delete scope.controls;
  return scope;
}

export function controlLookupFrom(scope: Record<string, unknown>): ControlLookup<unknown> | undefined {
  const lookup = (scope as Record<PropertyKey, unknown>)[CONTROL_LOOKUP];
  if (lookup && typeof lookup === 'object' && typeof (lookup as ControlLookup<unknown>).byId === 'function') {
    return lookup as ControlLookup<unknown>;
  }
  return undefined;
}

function queryControls<T>(selector: string, lookup: ControlLookup<T>): T[] {
  const raw = selector.trim();
  if (!raw) return [];

  const hash = raw.match(/^#([A-Za-z_][\w-]*)$/);
  if (hash) {
    const el = elementById(lookup, hash[1]!);
    return el ? [el] : [];
  }

  if (raw.startsWith('.') && !/\s/.test(raw)) {
    const classes = raw.split('.').filter(Boolean);
    if (classes.length === 0) return [];
    if (classes.length === 1) return lookup.byClass(classes[0]!);
    const [first, ...rest] = classes;
    return lookup.byClass(first!).filter((el) => {
      const tokens = new Set(String((el as { className?: unknown }).className ?? '').split(/\s+/));
      return rest.every((cls) => tokens.has(cls));
    });
  }

  const attr = raw.match(/^\[(id|class|className|name)\s*=\s*['"]?([^'"\]]+)['"]?\]$/i);
  if (attr) {
    const key = attr[1]!.toLowerCase();
    const value = attr[2]!;
    if (key === 'id') {
      const el = elementById(lookup, value);
      return el ? [el] : [];
    }
    if (key === 'name') {
      const el = elementByName(lookup, value);
      return el ? [el] : [];
    }
    return lookup.byClass(value);
  }

  const el = elementById(lookup, raw) ?? elementByName(lookup, raw);
  return el ? [el] : [];
}
