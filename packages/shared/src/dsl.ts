/**
 * The application DSL.
 *
 * This is the document the editor writes, the server stores and versions, and the
 * runtime renders. It holds expressions only; evaluated values are derived state
 * and are never persisted.
 */

import type { AnyQueryDefinition, QueryVariable } from './queries';

/** Bumped whenever the document shape changes in a way that needs a migration. */
export const DSL_VERSION = 1;

export interface ApplicationDsl {
  dslVersion: number;
  appId: string;
  name: string;
  pages: PageDsl[];
  queries: QueryEntity[];
  jsObjects: JsObjectDsl[];
  navigation: NavigationDsl;
  theme: ThemeDsl;
  /** App-wide state, readable as `{{ appState.key }}` and written by `setState`. */
  appState: Record<string, unknown>;
}

/* ------------------------------------------------------------------ *
 * Pages and widgets
 * ------------------------------------------------------------------ */

export interface PageDsl {
  id: string;
  name: string;
  slug: string;
  /** Exactly one page is the landing page; publishing rejects a document without one. */
  isDefault: boolean;
  icon?: string;
  /** Enforced by the server on the runtime route; hiding a nav item is cosmetic. */
  requiredPermissions?: string[];
  widgets: WidgetDsl[];
  /**
   * Page-specific values for global query variables. The SQL stays on the query
   * (`{{ orderId }}`); this page maps `orderId` to a widget or literal.
   */
  queryVariables?: PageQueryVariables[];
}

/** One global query's variable values on a given page. */
export interface PageQueryVariables {
  queryId: string;
  variables: QueryVariable[];
}

export interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WidgetDsl {
  id: string;
  /** Unique within the page; the name bindings use, e.g. `{{ Table1.selectedRow }}`. */
  name: string;
  type: string;
  properties: Record<string, unknown>;
  layout: WidgetLayout;
  /** Present on containers, even when empty. */
  children?: WidgetDsl[];
  /** Event key -> actions. Takes precedence over an `action_list` property of the same key. */
  events?: Record<string, ActionDsl[]>;
}

export interface JsObjectDsl {
  id?: string;
  name: string;
  code: string;
  /**
   * Page this object belongs to. Absent means app-level: available on every page
   * (including older documents that were written before objects were per-page).
   */
  pageId?: string;
}

/** True when the entity is app-level rather than tied to one page. */
export function isAppLevelEntity(entity: { pageId?: string }): boolean {
  return !entity.pageId;
}

/** Objects visible on a page: app-level ones, plus those created on this page. */
export function jsObjectsOnPage(
  objects: JsObjectDsl[] | undefined,
  pageId: string,
): JsObjectDsl[] {
  return (objects ?? []).filter((object) => !object.pageId || object.pageId === pageId);
}

/* ------------------------------------------------------------------ *
 * Navigation and theme
 * ------------------------------------------------------------------ */

export type NavTarget =
  | { kind: 'page'; pageId: string; params?: Record<string, string> }
  | { kind: 'url'; href: string; newTab?: boolean }
  | { kind: 'group' };

export interface NavItemDsl {
  id: string;
  label: string;
  icon?: string;
  target: NavTarget;
  children?: NavItemDsl[];
  /** Expression; a falsy result hides the item. */
  visibleWhen?: string;
}

export interface NavigationDsl {
  style: 'sidebar' | 'topbar' | 'none';
  title?: string;
  collapsedByDefault?: boolean;
  items: NavItemDsl[];
}

export interface ThemeDsl {
  primaryColor: string;
  borderRadius: string;
  fontFamily: string;
  density: 'compact' | 'comfortable';
  mode: 'light' | 'dark';
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

export type NotificationVariant = 'info' | 'success' | 'warning' | 'error';

/** How Control component writes into another widget. */
export type SetWidgetMethod = 'setValue' | 'clearValue' | 'setDisabled' | 'setProperty' | 'setOptions';

/**
 * One event handler. Several of these run, in order, when a widget event fires.
 *
 * `enabledWhen` is an expression (`{{ event.row.status === 'open' }}` or raw JS);
 * a falsy result skips this handler and continues with the next.
 */
export type ActionDsl = {
  enabledWhen?: string;
} & (
  | { type: 'runQuery'; queryName: string; onSuccess?: ActionDsl[]; onError?: ActionDsl[] }
  | {
      type: 'navigate';
      to: { kind: 'page'; pageId: string; params?: Record<string, string> } | { kind: 'url'; href: string };
      newTab?: boolean;
    }
  | { type: 'navigateBack' }
  | { type: 'showNotification'; message: string; variant: NotificationVariant }
  | { type: 'openModal'; widgetName: string }
  | { type: 'closeModal'; widgetName: string }
  | { type: 'setState'; key: string; value: unknown }
  | { type: 'runJs'; code: string }
  /**
   * Call an exported function on a JS object, e.g. `dropdowns.shippingcity`.
   * The function receives the event’s `value` (then the event). If `widgetName`
   * is set, the return value is written onto that widget (`setOptions` by default).
   */
  | {
      type: 'runJsFunction';
      path: string;
      widgetName?: string;
      method?: SetWidgetMethod;
      property?: string;
    }
  | { type: 'download'; data: unknown; fileName: string; mimeType: string }
  | { type: 'copyToClipboard'; value: string }
  | {
      type: 'setWidget';
      widgetName: string;
      method: SetWidgetMethod;
      property?: string;
      value?: unknown;
    }
);

export type ActionType = ActionDsl['type'];

/* ------------------------------------------------------------------ *
 * Queries
 * ------------------------------------------------------------------ */

export type QueryMode = 'raw_sql' | 'stored_procedure' | 'function' | 'builder' | 'api';

export interface QuerySettings {
  /** Capped by the server's QUERY_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Capped by the server's QUERY_MAX_ROWS. */
  maxRows?: number;
  /** Only read statements are ever cached. */
  cache?: { enabled: boolean; ttlSeconds: number };
}

export interface QueryEntity {
  id: string;
  name: string;
  datasourceId: string;
  mode: QueryMode;
  definition: AnyQueryDefinition;
  runOnPageLoad: boolean;
  /** Ask the user before running, for queries that change data. */
  confirmBeforeRun?: boolean;
  settings: QuerySettings;
  /**
   * Named values injected into this query's binding scope as `{{ name }}` and
   * `{{ params.name }}`. Lets inline SQL call a function or filter a view without
   * hard-coding widget paths in the statement.
   *
   * On a global query these are defaults; each page may override them via
   * `PageDsl.queryVariables`.
   */
  variables?: QueryVariable[];
  /**
   * Page this query belongs to. Absent means app-level: available on every page
   * (including older documents, which were all app-level).
   */
  pageId?: string;
}

/** Queries visible on a page: app-level ones, plus those created on this page. */
export function queriesOnPage(
  queries: QueryEntity[] | undefined,
  pageId: string,
): QueryEntity[] {
  return (queries ?? []).filter((query) => !query.pageId || query.pageId === pageId);
}
