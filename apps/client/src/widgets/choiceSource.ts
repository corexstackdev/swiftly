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
  return properties.sourceData ?? properties.options;
}

/** Rows for Table (and later List): JSON, a JS function, or the legacy `data` binding. */
export function rowSource(properties: Record<string, unknown>): unknown {
  if (properties.sourceKind === 'js') return properties.sourceJs;
  return properties.sourceData ?? properties.data;
}

export function rowSourceConfigured(properties: Record<string, unknown>): boolean {
  if (properties.sourceKind === 'js') {
    const source = properties.sourceJs;
    return source !== undefined && source !== null && source !== '';
  }
  const json = properties.sourceData ?? properties.data;
  return json !== undefined && json !== null && json !== '';
}

export function emptyRowHint(properties: Record<string, unknown>): string {
  if (properties.sourceKind === 'js') return 'Pick a JavaScript function that returns rows';
  if (properties.sourceKind === 'query') return 'Query datasources are coming soon';
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
  return properties.sourceKind === 'js'
    ? 'Pick a JavaScript function that returns options'
    : 'Paste JSON in Source Data';
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
    ],
    helpText:
      'Paste or bind JSON, or call a JavaScript function that returns the options. SQL functions can be added later.',
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
      'Return an array of values or { label, value } objects. async and fetch() are allowed — return the data, not console.log.',
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

const TABLE_SAMPLE_JSON = `[
  { "id": 1041, "customer": "Fabrikam", "region": "APAC", "status": "Shipped", "total": 2310.75 },
  { "id": 1042, "customer": "Northwind Traders", "region": "EMEA", "status": "Picking", "total": 1250 },
  { "id": 1043, "customer": "Contoso", "region": "EMEA", "status": "Shipped", "total": 890.5 }
]`;

/**
 * Table Data section: same JSON / JavaScript split as Select, with Query reserved
 * for a later datasource. Legacy `data` bindings still resolve.
 */
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
      { value: 'query', label: 'Query — coming soon', disabled: true },
    ],
    helpText:
      'Paste or bind JSON, or call a JavaScript function that returns rows. Query and other datasources will be added next.',
  },
  {
    key: 'sourceData',
    label: 'Source Data',
    control: 'json',
    expectedType: 'any',
    bindable: true,
    defaultValue: TABLE_SAMPLE_JSON,
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
    key: 'data',
    label: 'Table data',
    control: 'code',
    expectedType: 'array',
    bindable: true,
    visibleWhen: { key: 'sourceKind', equals: '__legacy__' },
  },
];
