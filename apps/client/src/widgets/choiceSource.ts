import type { PropertyDefinition } from '@swiftly/shared';
import { asSourceList, sourceDataError } from './coerce';

/**
 * Shared option list for Select, Checkbox Group, and Radio Group.
 *
 * JSON paste, a binding, or a JavaScript function that returns values,
 * `{label,value}` rows, an object map, or a query-shaped `{ data: [...] }`.
 */

export interface ChoiceOption {
  label: string;
  value: unknown;
}

export function optionsSource(properties: Record<string, unknown>): unknown {
  if (properties.sourceKind === 'js') return properties.sourceJs;
  if (properties.sourceKind === 'query') return properties.sourceData;
  return properties.sourceData ?? properties.options;
}

/** Rows for Table (and later List): JSON, a JS function, a query, or the legacy `data` binding. */
export function rowSource(properties: Record<string, unknown>): unknown {
  if (properties.sourceKind === 'js') return properties.sourceJs;
  if (properties.sourceKind === 'query') return properties.sourceData;
  return properties.sourceData ?? properties.data;
}

function queryName(properties: Record<string, unknown>): string {
  return typeof properties.sourceQuery === 'string' ? properties.sourceQuery.trim() : '';
}

export function rowSourceConfigured(properties: Record<string, unknown>): boolean {
  if (properties.sourceKind === 'js') {
    const source = properties.sourceJs;
    return source !== undefined && source !== null && source !== '';
  }
  if (properties.sourceKind === 'query') return queryName(properties) !== '';
  const json = properties.sourceData ?? properties.data;
  return json !== undefined && json !== null && json !== '';
}

export function emptyRowHint(properties: Record<string, unknown>): string {
  if (properties.sourceKind === 'js') return 'Pick a JavaScript function that returns rows';
  if (properties.sourceKind === 'query') {
    return queryName(properties)
      ? 'Waiting for the query to return rows'
      : 'Pick a query that returns rows';
  }
  return 'Paste JSON in Source Data';
}

export function normaliseChoiceOptions(properties: Record<string, unknown>): ChoiceOption[] {
  const raw = asSourceList(optionsSource(properties));
  if (raw.length === 0) return [];

  const labelKey = typeof properties.labelKey === 'string' ? properties.labelKey : 'label';
  const valueKey = typeof properties.valueKey === 'string' ? properties.valueKey : 'value';

  return raw.map((item) => {
    if (item !== null && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      return {
        label: String(record[labelKey] ?? record.label ?? record.value ?? ''),
        value: record[valueKey] ?? record.value ?? record[labelKey],
      };
    }
    return { label: String(item), value: item };
  });
}

export function choiceSourceError(properties: Record<string, unknown>): string | null {
  return sourceDataError(optionsSource(properties));
}

export function emptyChoiceHint(properties: Record<string, unknown>): string {
  if (properties.sourceKind === 'js') return 'Pick a JavaScript function that returns options';
  if (properties.sourceKind === 'query') {
    return queryName(properties)
      ? 'Waiting for the query to return options'
      : 'Pick a query that returns options';
  }
  return 'Paste JSON in Source Data';
}

/** Data-section fields: JSON or a JS function, plus label/value keys. */
export const CHOICE_SOURCE_PROPERTIES: PropertyDefinition[] = [
  {
    key: 'sourceKind',
    label: 'Options from',
    control: 'select',
    expectedType: 'string',
    bindable: false,
    defaultValue: 'json',
    options: [
      { value: 'json', label: 'JSON' },
      { value: 'js', label: 'JavaScript' },
      { value: 'query', label: 'Query' },
    ],
    helpText:
      'Paste or bind JSON, call a JavaScript function, or bind a query that returns rows.',
  },
  {
    key: 'sourceData',
    label: 'Source Data',
    control: 'json',
    expectedType: 'any',
    bindable: true,
    defaultValue: '[\n  { "label": "Option 1", "value": "1" },\n  { "label": "Option 2", "value": "2" }\n]',
    placeholder: '[{"label":"Red","value":"red"}]',
    visibleWhen: { key: 'sourceKind', oneOf: ['json', undefined] },
    helpText:
      'JSON array or object. Examples: [{"label":"Red","value":"red"}] or ["Red","Green"]. Bindings such as {{ GetRegions.data }} also work.',
  },
  {
    key: 'sourceJs',
    label: 'JavaScript function',
    control: 'js_function',
    expectedType: 'any',
    bindable: true,
    visibleWhen: { key: 'sourceKind', equals: 'js' },
    placeholder: '{{ Utils.getOptions() }}',
    helpText:
      'Return an array of values or { label, value } objects. Pass another field when the list depends on it: {{ dropdowns.shippingcity(Select3.value) }}.',
  },
  {
    key: 'sourceQuery',
    label: 'Query',
    control: 'query_picker',
    expectedType: 'string',
    bindable: false,
    visibleWhen: { key: 'sourceKind', equals: 'query' },
    helpText: 'Options load from this query’s result as soon as you pick it.',
  },
  {
    key: 'labelKey',
    label: 'Label field',
    control: 'text',
    expectedType: 'string',
    bindable: false,
    defaultValue: 'label',
    helpText: 'Property on each JSON object to show in the list.',
  },
  {
    key: 'valueKey',
    label: 'Value field',
    control: 'text',
    expectedType: 'string',
    bindable: false,
    defaultValue: 'value',
    helpText: 'Property on each JSON object stored as the selected value.',
  },
  {
    key: 'options',
    label: 'Options',
    control: 'code',
    expectedType: 'any',
    bindable: true,
    visibleWhen: { key: 'sourceKind', equals: '__legacy__' },
  },
];

export const ROW_SOURCE_PROPERTIES: PropertyDefinition[] = [
  {
    key: 'sourceKind',
    label: 'Rows from',
    control: 'select',
    expectedType: 'string',
    bindable: false,
    defaultValue: 'json',
    options: [
      { value: 'json', label: 'JSON' },
      { value: 'js', label: 'JavaScript' },
      { value: 'query', label: 'Query' },
    ],
    helpText:
      'Paste or bind JSON, call a JavaScript function, or bind a PostgreSQL (or other) query that returns rows.',
  },
  {
    key: 'sourceData',
    label: 'Source Data',
    control: 'json',
    expectedType: 'any',
    bindable: true,
    defaultValue: '[]',
    placeholder: '[{"id":1,"name":"Ada"}]',
    visibleWhen: { key: 'sourceKind', oneOf: ['json', undefined] },
    helpText:
      'JSON array of row objects. Bindings such as {{ GetOrders.data }} also work. A function can return the same shape, or { data: [...] }.',
  },
  {
    key: 'sourceJs',
    label: 'JavaScript function',
    control: 'js_function',
    expectedType: 'any',
    bindable: true,
    visibleWhen: { key: 'sourceKind', equals: 'js' },
    placeholder: '{{ Utils.getRows() }}',
    helpText:
      'Return an array of row objects, or { data: [...] }. async and fetch() are allowed — return the JSON (not console.log).',
  },
  {
    key: 'sourceQuery',
    label: 'Query',
    control: 'query_picker',
    expectedType: 'string',
    bindable: false,
    visibleWhen: { key: 'sourceKind', equals: 'query' },
    helpText: 'Rows load from this query’s result as soon as you pick it.',
  },
  {
    key: 'data',
    label: 'Table data',
    control: 'code',
    expectedType: 'array',
    bindable: true,
    visibleWhen: { key: 'sourceKind', equals: '__legacy__' },
  },
];
