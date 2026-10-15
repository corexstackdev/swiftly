import type { WidgetDsl } from '@swiftly/shared';
import { walkWidgets } from '@/evaluation/dataTree';
import { attachControlGlobals, matchByClass } from './controlDocument';

/**
 * The object a JS event handler sees for each control.
 *
 * Lookups use Id / Class (`document.getElementById`, `getElementsByClassName`).
 * Assign `.value` or other properties directly; `setValue` remains as an alias.
 */
const RESERVED_SCOPE_NAMES = new Set([
  'widgets',
  'controls',
  'document',
  'page',
  'appState',
  'event',
  'module',
  'exports',
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

const IDENTITY_KEYS = new Set(['id', 'name', 'type']);

export interface WidgetRuntimeApi {
  id: string;
  name: string;
  type: string;
  className: string;
  /** Alias of className, so handlers can read `Select1.class`. */
  class: string;
  properties: Record<string, unknown>;
  value: unknown;
  text: unknown;
  selected: unknown;
  disabled: boolean;
  options: unknown;
  setValue: (value: unknown) => void;
  setText: (value: unknown) => void;
  setSelected: (value: unknown) => void;
  setDisabled: (disabled: boolean) => void;
  /** Replace a Select (or similar) option list at runtime. */
  setOptions: (data: unknown) => void;
  setProperty: (key: string, value: unknown) => void;
  getProperty: (key: string) => unknown;
  setAttribute: (key: string, value: unknown) => void;
  getAttribute: (key: string) => unknown;
}

export function buildWidgetScope(input: {
  widgets: WidgetDsl[];
  getState: (name: string) => Record<string, unknown>;
  getProperties: (name: string) => Record<string, unknown>;
  setState: (name: string, patch: Record<string, unknown>) => void;
  setOverride: (name: string, patch: Record<string, unknown>) => void;
}): Record<string, unknown> {
  const byName = new Map<string, WidgetRuntimeApi>();
  const byId = new Map<string, WidgetRuntimeApi>();
  const all: WidgetRuntimeApi[] = [];

  walkWidgets(input.widgets, (widget) => {
    const api = createWidgetApi(widget, input);
    byName.set(widget.name, api);
    byId.set(widget.id, api);
    all.push(api);
  });

  const lookupById = (id: string) => byId.get(String(id));
  const lookupByName = (name: string) => byName.get(String(name));
  const lookupByClass = (className: string) => matchByClass(all, className);

  const scope: Record<string, unknown> = {};
  attachControlGlobals(scope, {
    byId: lookupById,
    byName: lookupByName,
    byClass: lookupByClass,
  });

  for (const api of all) {
    if (!RESERVED_SCOPE_NAMES.has(api.name)) scope[api.name] = api;
    if (!RESERVED_SCOPE_NAMES.has(api.id)) scope[api.id] = api;
  }

  return scope;
}

function createWidgetApi(
  widget: WidgetDsl,
  input: {
    getState: (name: string) => Record<string, unknown>;
    getProperties: (name: string) => Record<string, unknown>;
    setState: (name: string, patch: Record<string, unknown>) => void;
    setOverride: (name: string, patch: Record<string, unknown>) => void;
  },
): WidgetRuntimeApi {
  const readValue = (): unknown => {
    const state = input.getState(widget.name);
    if (state.value !== undefined) return state.value;
    if (state.text !== undefined) return state.text;
    if (state.selected !== undefined) return state.selected;
    const properties = input.getProperties(widget.name);
    return properties.defaultValue ?? properties.text;
  };

  const setValue = (value: unknown): void => {
    input.setState(widget.name, { value, text: value, selected: value });
  };

  const classNameOf = (): string => {
    const properties = input.getProperties(widget.name);
    return String(properties.className ?? properties.class ?? '');
  };

  const setProperty = (key: string, value: unknown): void => {
    if (!key || IDENTITY_KEYS.has(key)) return;
    if (key === 'value' || key === 'text') {
      setValue(value);
      return;
    }
    if (key === 'selected') {
      input.setState(widget.name, { value, selected: value });
      return;
    }
    if (key === 'class' || key === 'className') {
      input.setOverride(widget.name, { className: String(value ?? '') });
      return;
    }
    if (key === 'disabled') {
      input.setOverride(widget.name, { disabled: Boolean(value) });
      return;
    }
    if (key === 'options') {
      input.setOverride(widget.name, { sourceKind: 'json', sourceData: value });
      return;
    }
    input.setOverride(widget.name, { [key]: value });
  };

  const api: WidgetRuntimeApi = {
    get id() {
      return widget.id;
    },
    get name() {
      return widget.name;
    },
    get type() {
      return widget.type;
    },
    get className() {
      return classNameOf();
    },
    set className(value: string) {
      setProperty('className', value);
    },
    get class() {
      return classNameOf();
    },
    set class(value: string) {
      setProperty('className', value);
    },
    get properties() {
      return { ...input.getProperties(widget.name) };
    },
    get value() {
      return readValue();
    },
    set value(value: unknown) {
      setValue(value);
    },
    get text() {
      const state = input.getState(widget.name);
      return state.text ?? readValue();
    },
    set text(value: unknown) {
      setValue(value);
    },
    get selected() {
      const state = input.getState(widget.name);
      return state.selected ?? readValue();
    },
    set selected(value: unknown) {
      input.setState(widget.name, { value, selected: value });
    },
    get disabled() {
      return Boolean(input.getProperties(widget.name).disabled);
    },
    set disabled(value: boolean) {
      setProperty('disabled', value);
    },
    get options() {
      const properties = input.getProperties(widget.name);
      return properties.sourceData ?? properties.data ?? properties.options ?? properties.sourceJs;
    },
    set options(data: unknown) {
      setProperty('options', data);
    },
    setValue,
    setText: setValue,
    setSelected: (value: unknown) => {
      input.setState(widget.name, { value, selected: value });
    },
    setDisabled: (disabled: boolean) => {
      setProperty('disabled', disabled);
    },
    setOptions: (data: unknown) => {
      setProperty('options', data);
    },
    setProperty,
    getProperty: (key: string) => input.getProperties(widget.name)[key],
    setAttribute: setProperty,
    getAttribute: (key: string) => input.getProperties(widget.name)[key],
  };

  return new Proxy(api, {
    set(target, prop, value, receiver) {
      if (typeof prop !== 'string') return false;
      if (IDENTITY_KEYS.has(prop)) return true;
      if (Reflect.has(target, prop)) {
        Reflect.set(target, prop, value, receiver);
        return true;
      }
      setProperty(prop, value);
      return true;
    },
  });
}
