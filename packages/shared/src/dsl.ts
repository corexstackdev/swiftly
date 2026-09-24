/**
 * The application DSL.
 *
 * This is the document the editor writes, the server stores and versions, and the
 * runtime renders. It holds expressions only; evaluated values are derived state
 * and are never persisted.
 */

import type { AnyQueryDefinition } from './queries';

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

export type ActionDsl =
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
  | { type: 'download'; data: unknown; fileName: string; mimeType: string };

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
}
