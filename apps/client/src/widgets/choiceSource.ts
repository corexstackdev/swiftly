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

const WHEN_VALUE_HAS_SOURCE = { key: 'sourceKind', oneOf: ['json', 'js', 'query'] };

/**
 * A single figure or one record — for card body text, not a list and not the
 * card chrome. Same three sources as a table: JSON, a JavaScript function, a
 * query. The widget reads the first row (or a scalar) and shows that field.
 */
export const VALUE_SOURCE_PROPERTIES: PropertyDefinition[] = [
  {
    key: 'sourceKind',
    label: 'Data from',
    control: 'select',
    expectedType: 'string',
    bindable: false,
    defaultValue: 'none',
    options: [
      { value: 'none', label: 'None' },
      { value: 'json', label: 'JSON' },
      { value: 'js', label: 'JavaScript' },
      { value: 'query', label: 'Query' },
    ],
    helpText:
      'Same sources as a table. The text uses the first row, or a single number the function or query returns.',
  },
  {
    key: 'sourceData',
    label: 'Source Data',
    control: 'json',
    expectedType: 'any',
    bindable: true,
    placeholder: '{{ GetTotals.data }}',
    visibleWhen: { key: 'sourceKind', equals: 'json' },
    helpText:
      'JSON, a binding such as {{ GetTotals.data }}, or a single number. A `{ data: [...] }` query result works too.',
  },
  {
    key: 'sourceJs',
    label: 'JavaScript function',
    control: 'js_function',
    expectedType: 'any',
    bindable: true,
    visibleWhen: { key: 'sourceKind', equals: 'js' },
    placeholder: '{{ Utils.totalProducts() }}',
    helpText:
      'Return a number, a row object, or { data: [...] }. The text shows the first row or the number itself.',
  },
  {
    key: 'sourceQuery',
    label: 'Query',
    control: 'query_picker',
    expectedType: 'string',
    bindable: false,
    visibleWhen: { key: 'sourceKind', equals: 'query' },
    helpText: 'The text reads this query’s result as soon as you pick it.',
  },
  {
    key: 'valueKey',
    label: 'Value field',
    control: 'text',
    expectedType: 'string',
    bindable: false,
    visibleWhen: WHEN_VALUE_HAS_SOURCE,
    helpText:
      'Column shown as the text. Leave blank if the source is already a single number, or has one column.',
  },
];

export function valueSource(properties: Record<string, unknown>): unknown {
  if (properties.sourceKind === 'js') return properties.sourceJs;
  if (properties.sourceKind === 'query') return properties.sourceData;
  if (properties.sourceKind === 'json') return properties.sourceData;
  return undefined;
}

export function valueSourceConfigured(properties: Record<string, unknown>): boolean {
  if (properties.sourceKind === 'js') {
    const source = properties.sourceJs;
    return source !== undefined && source !== null && source !== '';
  }
  if (properties.sourceKind === 'query') return queryName(properties) !== '';
  if (properties.sourceKind === 'json') {
    const json = properties.sourceData;
    return json !== undefined && json !== null && json !== '';
  }
  return false;
}

export function emptyValueHint(properties: Record<string, unknown>): string {
  if (properties.sourceKind === 'js') return 'Pick a JavaScript function that returns a value or a row';
  if (properties.sourceKind === 'query') {
    return queryName(properties) ? 'Waiting for the query to return' : 'Pick a query';
  }
  if (properties.sourceKind === 'json') return 'Paste JSON or bind {{ Query.data }}';
  return '';
}

export function mappedField(item: Record<string, unknown> | null, key: unknown): unknown {
  if (!item || typeof key !== 'string' || key.trim() === '') return undefined;
  const value = item[key.trim()];
  return value === undefined ? undefined : value;
}

/** First-row field, a scalar, or the only column on a one-column row. */
export function mappedSourceValue(
  properties: Record<string, unknown>,
  item: Record<string, unknown> | null,
  source: unknown,
): unknown {
  const fromKey = mappedField(item, properties.valueKey);
  if (fromKey !== undefined) return fromKey;
  if (typeof source === 'number' || typeof source === 'boolean') return source;
  if (typeof source === 'string') {
    const text = source.trim();
    if (text && !text.startsWith('{') && !text.startsWith('[') && !text.startsWith('{{')) {
      const numeric = Number(text);
      return Number.isFinite(numeric) ? numeric : text;
    }
  }
  if (item) {
    const keys = Object.keys(item);
    if (keys.length === 1) return item[keys[0]];
  }
  return undefined;
}
