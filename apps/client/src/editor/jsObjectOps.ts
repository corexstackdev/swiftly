import {
  jsObjectsOnPage,
  type ActionDsl,
  type ApplicationDsl,
  type JsObjectDsl,
  type WidgetDsl,
} from '@swiftly/shared';
import { isBinding, parseBinding } from '@/evaluation/parser';
import { loadJsObject } from '@/evaluation/jsObjects';
import { flatten } from './widgetOps';

export interface JsBindingRef {
  location: string;
  snippet: string;
}

const RESERVED = new Set(['page', 'appState', 'currentUser']);

export function isJsIdentifier(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

export function nextAvailableName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  let index = 1;
  while (taken.has(`${name}${index}`)) index += 1;
  return `${name}${index}`;
}

/** Names that would collide in the evaluation tree on a given page. */
export function takenJsNames(
  dsl: ApplicationDsl,
  pageId: string,
  exceptId?: string,
): Set<string> {
  const taken = new Set<string>(RESERVED);
  for (const query of dsl.queries) taken.add(query.name);
  const page = dsl.pages.find((candidate) => candidate.id === pageId);
  if (page) {
    for (const widget of flatten(page.widgets)) taken.add(widget.name);
  }
  for (const object of jsObjectsOnPage(dsl.jsObjects, pageId)) {
    if (object.id && object.id === exceptId) continue;
    taken.add(object.name);
  }
  return taken;
}

export function copyJsName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  return nextAvailableName(`${name}Copy`, taken);
}

/**
 * Every place in the document that reads this JS object — widget bindings,
 * query definitions, other JS objects, and action payloads.
 */
export function findJsObjectBindings(dsl: ApplicationDsl, jsObject: JsObjectDsl): JsBindingRef[] {
  const refs: JsBindingRef[] = [];
  const matches = (text: string) => referencesJsObject(text, jsObject.name);

  for (const page of dsl.pages) {
    if (jsObject.pageId && page.id !== jsObject.pageId) continue;
    for (const widget of flatten(page.widgets)) {
      collectFromWidget(widget, page.name, matches, refs);
    }
  }

  for (const query of dsl.queries) {
    collectValue(query.definition, `Query ${query.name}`, matches, refs);
  }

  for (const other of dsl.jsObjects ?? []) {
    if (other.id && jsObject.id && other.id === jsObject.id) continue;
    if (other.name === jsObject.name && other === jsObject) continue;
    if (matches(other.code)) {
      refs.push({ location: `JS ${other.name}`, snippet: truncate(other.code) });
    }
  }

  collectValue(dsl.navigation, 'Navigation', matches, refs);
  collectValue(dsl.appState, 'App state', matches, refs);

  return refs;
}

function referencesJsObject(text: string, name: string): boolean {
  const token = new RegExp(`\\b${escapeRegExp(name)}\\b`);
  if (isBinding(text)) {
    const parsed = parseBinding(text);
    if (parsed.dependencies.some((path) => path === name || path.startsWith(`${name}.`))) {
      return true;
    }
    return parsed.expressions.some((expression) => token.test(expression));
  }
  return token.test(text);
}

function collectFromWidget(
  widget: WidgetDsl,
  pageName: string,
  matches: (text: string) => boolean,
  refs: JsBindingRef[],
): void {
  for (const [key, value] of Object.entries(widget.properties ?? {})) {
    collectValue(value, `${pageName} / ${widget.name}.${key}`, matches, refs);
  }
  for (const [event, actions] of Object.entries(widget.events ?? {})) {
    collectActions(actions, `${pageName} / ${widget.name}.${event}`, matches, refs);
  }
}

function collectActions(
  actions: ActionDsl[] | undefined,
  location: string,
  matches: (text: string) => boolean,
  refs: JsBindingRef[],
): void {
  if (!actions) return;
  for (const action of actions) {
    switch (action.type) {
      case 'showNotification':
        collectValue(action.message, `${location} · notification`, matches, refs);
        break;
      case 'runJs':
        collectValue(action.code, `${location} · run JS`, matches, refs);
        break;
      case 'runJsFunction':
        collectValue(action.path, `${location} · JS function`, matches, refs);
        break;
      case 'setState':
        collectValue(action.value, `${location} · setState`, matches, refs);
        break;
      case 'download':
        collectValue(action.data, `${location} · download`, matches, refs);
        collectValue(action.fileName, `${location} · file name`, matches, refs);
        break;
      case 'runQuery':
        collectActions(action.onSuccess, `${location} · on success`, matches, refs);
        collectActions(action.onError, `${location} · on error`, matches, refs);
        break;
      default:
        collectValue(action, location, matches, refs);
        break;
    }
  }
}

function collectValue(
  value: unknown,
  location: string,
  matches: (text: string) => boolean,
  refs: JsBindingRef[],
): void {
  if (typeof value === 'string') {
    if (matches(value)) refs.push({ location, snippet: truncate(value) });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectValue(item, location, matches, refs));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectValue(item, location, matches, refs));
  }
}

function truncate(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > 140 ? `${compact.slice(0, 137)}…` : compact;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface JsFunctionOption {
  objectName: string;
  functionName: string;
  /** `Utils.format` — what the picker stores before wrapping in `{{ }}`. */
  path: string;
}

/** Exported functions on the JS objects visible on this page. */
export function listJsFunctions(objects: JsObjectDsl[] | undefined): JsFunctionOption[] {
  const listed: JsFunctionOption[] = [];
  for (const object of objects ?? []) {
    const exported = loadJsObject(object.name, object.code);
    for (const [functionName, value] of Object.entries(exported)) {
      if (typeof value !== 'function') continue;
      listed.push({
        objectName: object.name,
        functionName,
        path: `${object.name}.${functionName}`,
      });
    }
  }
  return listed.sort((a, b) => a.path.localeCompare(b.path));
}

export function jsCallBinding(path: string): string {
  return `{{ ${path}() }}`;
}

/** `Utils.format` from `{{ Utils.format() }}` or `{{ Utils.format(Input1.text) }}`. */
export function pathFromJsCall(binding: unknown): string {
  if (typeof binding !== 'string') return '';
  const match = binding.match(/^\{\{\s*([A-Za-z_]\w*\.[A-Za-z_]\w*)\s*\(/);
  return match?.[1] ?? '';
}
