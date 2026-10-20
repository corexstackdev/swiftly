import {
  queriesOnPage,
  type ActionDsl,
  type ApplicationDsl,
  type QueryEntity,
  type WidgetDsl,
} from '@swiftly/shared';
import { isBinding, parseBinding } from '@/evaluation/parser';
import { flatten } from './widgetOps';
import type { JsBindingRef } from './jsObjectOps';

export function findQueryBindings(dsl: ApplicationDsl, query: QueryEntity): JsBindingRef[] {
  const refs: JsBindingRef[] = [];
  const matches = (text: string) => referencesName(text, query.name);

  for (const page of dsl.pages) {
    if (query.pageId && page.id !== query.pageId) continue;
    for (const widget of flatten(page.widgets)) {
      collectFromWidget(widget, page.name, query.name, matches, refs);
    }
  }

  for (const other of dsl.queries) {
    if (other.id === query.id) continue;
    collectValue(other.definition, `Query ${other.name}`, matches, refs);
  }

  for (const object of dsl.jsObjects ?? []) {
    if (query.pageId && object.pageId && object.pageId !== query.pageId) continue;
    if (matches(object.code)) {
      refs.push({ location: `JS ${object.name}`, snippet: truncate(object.code) });
    }
  }

  collectValue(dsl.navigation, 'Navigation', matches, refs);
  collectValue(dsl.appState, 'App state', matches, refs);

  return refs;
}

export function rewriteEntityName(
  dsl: ApplicationDsl,
  oldName: string,
  newName: string,
  scope: { pageId?: string; skipQueryId?: string; skipJsId?: string } = {},
): void {
  if (!oldName || oldName === newName) return;

  const pages = scope.pageId
    ? dsl.pages.filter((page) => page.id === scope.pageId)
    : dsl.pages;

  for (const page of pages) {
    for (const widget of flatten(page.widgets)) {
      rewriteWidget(widget, oldName, newName);
    }
  }

  for (const query of dsl.queries) {
    if (query.id === scope.skipQueryId) continue;
    if (scope.pageId && query.pageId && query.pageId !== scope.pageId) continue;
    query.definition = rewriteValue(query.definition, oldName, newName) as typeof query.definition;
  }

  for (const object of dsl.jsObjects ?? []) {
    if (object.id && object.id === scope.skipJsId) continue;
    if (scope.pageId && object.pageId && object.pageId !== scope.pageId) continue;
    object.code = rewriteText(object.code, oldName, newName);
  }

  if (!scope.pageId) {
    dsl.navigation = rewriteValue(dsl.navigation, oldName, newName) as typeof dsl.navigation;
    dsl.appState = rewriteValue(dsl.appState, oldName, newName) as typeof dsl.appState;
  }
}

export function cloneQuery(query: QueryEntity, patch: Partial<QueryEntity>): QueryEntity {
  return {
    ...query,
    ...patch,
    definition: structuredClone(query.definition),
    settings: { ...query.settings },
  };
}

export function resolveQuery(
  queries: QueryEntity[] | undefined,
  name: string,
  pageId: string,
): QueryEntity | undefined {
  return queriesOnPage(queries, pageId).find((query) => query.name === name);
}

function rewriteWidget(widget: WidgetDsl, oldName: string, newName: string): void {
  if (widget.properties) {
    if (widget.properties.sourceQuery === oldName) widget.properties.sourceQuery = newName;
    for (const [key, value] of Object.entries(widget.properties)) {
      widget.properties[key] = rewriteValue(value, oldName, newName);
    }
  }
  if (widget.events) {
    for (const [event, actions] of Object.entries(widget.events)) {
      widget.events[event] = rewriteActions(actions, oldName, newName);
    }
  }
}

function rewriteActions(actions: ActionDsl[] | undefined, oldName: string, newName: string): ActionDsl[] {
  if (!actions) return [];
  return actions.map((action) => {
    if (action.type === 'runQuery') {
      return {
        ...action,
        queryName: action.queryName === oldName ? newName : action.queryName,
        onSuccess: rewriteActions(action.onSuccess, oldName, newName),
        onError: rewriteActions(action.onError, oldName, newName),
      };
    }
    if (action.type === 'runJsFunction') {
      const prefix = `${oldName}.`;
      const path = action.path.startsWith(prefix)
        ? `${newName}.${action.path.slice(prefix.length)}`
        : action.path === oldName
          ? newName
          : action.path;
      return {
        ...action,
        path,
        widgetName: action.widgetName === oldName ? newName : action.widgetName,
      };
    }
    return rewriteValue(action, oldName, newName) as ActionDsl;
  });
}

function rewriteValue(value: unknown, oldName: string, newName: string): unknown {
  if (typeof value === 'string') return rewriteText(value, oldName, newName);
  if (Array.isArray(value)) return value.map((item) => rewriteValue(item, oldName, newName));
  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      next[key] = rewriteValue(item, oldName, newName);
    }
    return next;
  }
  return value;
}

function rewriteText(text: string, oldName: string, newName: string): string {
  return text.replace(nameToken(oldName), newName);
}

function collectFromWidget(
  widget: WidgetDsl,
  pageName: string,
  queryName: string,
  matches: (text: string) => boolean,
  refs: JsBindingRef[],
): void {
  if (widget.properties?.sourceQuery === queryName) {
    refs.push({
      location: `${pageName} / ${widget.name}.sourceQuery`,
      snippet: queryName,
    });
  }
  for (const [key, value] of Object.entries(widget.properties ?? {})) {
    if (key === 'sourceQuery') continue;
    collectValue(value, `${pageName} / ${widget.name}.${key}`, matches, refs);
  }
  for (const [event, actions] of Object.entries(widget.events ?? {})) {
    collectActions(actions, `${pageName} / ${widget.name}.${event}`, queryName, matches, refs);
  }
}

function collectActions(
  actions: ActionDsl[] | undefined,
  location: string,
  queryName: string,
  matches: (text: string) => boolean,
  refs: JsBindingRef[],
): void {
  if (!actions) return;
  for (const action of actions) {
    collectValue(action.enabledWhen, `${location} · only run when`, matches, refs);
    switch (action.type) {
      case 'runQuery':
        if (action.queryName === queryName) {
          refs.push({ location: `${location} · run query`, snippet: queryName });
        }
        collectActions(action.onSuccess, `${location} · on success`, queryName, matches, refs);
        collectActions(action.onError, `${location} · on error`, queryName, matches, refs);
        break;
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
      case 'copyToClipboard':
        collectValue(action.value, `${location} · clipboard`, matches, refs);
        break;
      case 'setWidget':
        collectValue(action.widgetName, `${location} · component`, matches, refs);
        collectValue(action.value, `${location} · set widget`, matches, refs);
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

function referencesName(text: string, name: string): boolean {
  const token = nameToken(name);
  if (isBinding(text)) {
    const parsed = parseBinding(text);
    if (parsed.dependencies.some((path) => path === name || path.startsWith(`${name}.`))) {
      return true;
    }
    return parsed.expressions.some((expression) => token.test(expression));
  }
  return token.test(text);
}

function nameToken(name: string): RegExp {
  return new RegExp(`\\b${escapeRegExp(name)}\\b`, 'g');
}

function truncate(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > 140 ? `${compact.slice(0, 137)}…` : compact;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
