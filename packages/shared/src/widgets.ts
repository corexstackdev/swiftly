/**
 * The widget contract.
 *
 * Built-in widgets and tenant-authored custom components describe themselves with
 * the same definition, which is what gives a custom component the property panel,
 * binding support and validation the built-ins have.
 */

import type { WidgetLayout } from './dsl';

export type WidgetCategory = 'layout' | 'input' | 'display' | 'data' | 'chart' | 'media' | 'custom';

export type PropertyControl =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'toggle'
  | 'color'
  | 'code'
  | 'spacing'
  | 'action_list'
  | 'validation_rules'
  | 'column_config'
  | 'tab_list'
  | 'query_picker'
  | 'page_picker'
  | 'js_function'
  | 'json';

export type ExpectedType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any';

/** Shows a property only while another property has one of the given values. */
export interface VisibleWhen {
  key: string;
  equals?: unknown;
  oneOf?: unknown[];
}

export interface PropertyDefinition {
  key: string;
  label: string;
  control: PropertyControl;
  expectedType: ExpectedType;
  /** Whether the value may be a `{{ }}` binding. */
  bindable: boolean;
  defaultValue?: unknown;
  helpText?: string;
  placeholder?: string;
  options?: { value: string; label: string; disabled?: boolean }[];
  visibleWhen?: VisibleWhen;
}

export interface PropertySection {
  name: string;
  properties: PropertyDefinition[];
}

export interface WidgetEventDefinition {
  key: string;
  label: string;
  payloadKeys?: string[];
}

/** State a widget writes back, readable as `{{ Widget.key }}`. */
export interface ExposedStateDefinition {
  key: string;
  type: ExpectedType;
  description: string;
}

export interface WidgetDefinition {
  type: string;
  displayName: string;
  category: WidgetCategory;
  icon: string;
  isContainer?: boolean;
  /**
   * How a container places its children: on the free coordinate grid, in cells
   * it lays out itself, or in document order (a navbar row, a menu).
   */
  childLayout?: 'grid' | 'cells' | 'flow';
  defaultLayout: WidgetLayout;
  minSize: { w: number; h: number };
  events: WidgetEventDefinition[];
  exposedState: ExposedStateDefinition[];
  properties: PropertySection[];
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export type ValidationKind =
  | 'required'
  | 'minLength'
  | 'maxLength'
  | 'min'
  | 'max'
  | 'numeric'
  | 'integer'
  | 'email'
  | 'url'
  | 'regex'
  | 'matchesField'
  | 'custom'
  | 'asyncQuery';

/**
 * Evaluated client-side for inline feedback and re-checked server-side by any
 * query that consumes the value.
 */
export interface ValidationRule {
  id?: string;
  kind: ValidationKind;
  /** The rule's parameter: a length, a bound, a pattern, an expression result. */
  value?: string | number;
  /** Replaces the default failure message. */
  message?: string;
  /** Pre-evaluated condition; a falsy value skips the rule. */
  appliesWhen?: unknown;
}

/* ------------------------------------------------------------------ *
 * Tabs
 * ------------------------------------------------------------------ */

export type TabDisplayMode = 'text' | 'icon' | 'icon_text';

/** One visual state of a tab. Unset fields inherit the widget's own styling. */
export interface TabStateStyle {
  foreground?: string;
  background?: string;
  fontWeight?: 'normal' | 'medium' | 'semibold' | 'bold';
  fontSize?: number;
  italic?: boolean;
  underline?: boolean;
}

export interface TabDefinition {
  id: string;
  label: string;
  icon?: string;
  display?: TabDisplayMode;
  normal?: TabStateStyle;
  selected?: TabStateStyle;
}
