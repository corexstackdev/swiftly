import type { ColumnMetadata, ValidationRule } from '@swiftly/shared';

/**
 * Table → form field mapping.
 *
 * A builder should not have to place an Input, then a DatePicker, then a Switch
 * by hand after pointing the form at a table. Each column's SQL type picks the
 * control; identity and primary-key columns stay off unless they are ticked.
 */

export const FORM_FIELD_WIDGETS = [
  { type: 'input', label: 'Text input' },
  { type: 'select', label: 'Select' },
  { type: 'number_input', label: 'Number' },
  { type: 'currency_input', label: 'Currency' },
  { type: 'date_picker', label: 'Date' },
  { type: 'switch', label: 'Switch' },
  { type: 'checkbox', label: 'Checkbox' },
] as const;

export type FormFieldWidgetType = (typeof FORM_FIELD_WIDGETS)[number]['type'];

export type FormChoiceSourceKind = 'json' | 'js' | 'query';

/** Same options a dropped Select stores: JSON, a JS function, or a query. */
export interface FormChoiceSource {
  sourceKind: FormChoiceSourceKind;
  sourceData?: unknown;
  sourceJs?: unknown;
  sourceQuery?: string;
  labelKey: string;
  valueKey: string;
}

export const DEFAULT_SELECT_JSON =
  '[\n  { "label": "Option 1", "value": "1" },\n  { "label": "Option 2", "value": "2" }\n]';

export function defaultChoiceSource(): FormChoiceSource {
  return {
    sourceKind: 'json',
    sourceData: DEFAULT_SELECT_JSON,
    labelKey: 'label',
    valueKey: 'value',
  };
}

export interface FormColumnChoice {
  column: ColumnMetadata;
  widgetType: FormFieldWidgetType;
  label: string;
  widgetName: string;
  selected: boolean;
  choiceSource?: FormChoiceSource;
}

export function labelForWidgetType(type: FormFieldWidgetType): string {
  return FORM_FIELD_WIDGETS.find((entry) => entry.type === type)?.label ?? type;
}

export function mapColumnToFormChoice(column: ColumnMetadata): FormColumnChoice {
  const widgetType = inferFormWidgetType(column);
  const selected = !(column.isIdentity || column.isPrimaryKey);
  return {
    column,
    widgetType,
    label: humanizeColumnName(column.name),
    widgetName: widgetNameFromColumn(column.name),
    selected,
    choiceSource: widgetType === 'select' ? defaultChoiceSource() : undefined,
  };
}

export function inferFormWidgetType(column: ColumnMetadata): FormFieldWidgetType {
  const type = normaliseDataType(column.dataType);
  const name = column.name.toLowerCase();

  if (isBooleanType(type, name)) return 'switch';
  if (isDateTimeType(type) || isDateType(type)) return 'date_picker';
  if (isCurrencyName(name) && isNumericType(type)) return 'currency_input';
  if (isNumericType(type)) return 'number_input';
  if (isSelectType(type, name)) return 'select';
  return 'input';
}

export function propertiesForFormField(
  column: ColumnMetadata,
  widgetType: FormFieldWidgetType,
  choiceSource?: FormChoiceSource,
): Record<string, unknown> {
  const label = humanizeColumnName(column.name);
  const required =
    column.nullable === false && !column.hasDefault && !column.isIdentity;
  const validation: ValidationRule[] = required ? [{ kind: 'required' }] : [];
  const type = normaliseDataType(column.dataType);
  const name = column.name.toLowerCase();

  if (widgetType === 'number_input') {
    return {
      label,
      placeholder: column.name,
      validation: isIntegerType(type) ? [...validation, { kind: 'integer' }] : validation,
      step: isIntegerType(type) ? 1 : 0.01,
    };
  }

  if (widgetType === 'currency_input') {
    return { label, validation };
  }

  if (widgetType === 'date_picker') {
    return { label, includeTime: isDateTimeType(type), validation };
  }

  if (widgetType === 'select') {
    const source = choiceSource ?? defaultChoiceSource();
    return {
      label,
      placeholder: 'Select…',
      validation,
      sourceKind: source.sourceKind,
      sourceData: source.sourceKind === 'json' ? source.sourceData : undefined,
      sourceJs: source.sourceKind === 'js' ? source.sourceJs : undefined,
      sourceQuery: source.sourceKind === 'query' ? source.sourceQuery : undefined,
      labelKey: source.labelKey || 'label',
      valueKey: source.valueKey || 'value',
    };
  }

  if (widgetType === 'switch' || widgetType === 'checkbox') {
    return { label };
  }

  const inputType = name.includes('email')
    ? 'email'
    : name.includes('phone') || name.includes('mobile') || name.includes('tel')
      ? 'tel'
      : 'text';
  const extra: ValidationRule[] = inputType === 'email' ? [{ kind: 'email' }] : [];
  return {
    label,
    placeholder: column.name,
    inputType,
    validation: [...validation, ...extra],
  };
}

export function humanizeColumnName(name: string): string {
  const spaced = name
    .replace(/[_\-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  if (!spaced) return name;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function widgetNameFromColumn(name: string): string {
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const pascal = parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  if (!pascal) return 'Field';
  return /^[A-Za-z_]/.test(pascal) ? pascal : `Field${pascal}`;
}

export function prettyTableTitle(table: string): string {
  return humanizeColumnName(table);
}

export function readFormImportSource(
  properties: Record<string, unknown>,
): { datasourceId: string; schema: string; table: string } | null {
  const raw = properties.importSource;
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (
    typeof record.datasourceId !== 'string' ||
    typeof record.schema !== 'string' ||
    typeof record.table !== 'string'
  ) {
    return null;
  }
  return {
    datasourceId: record.datasourceId,
    schema: record.schema,
    table: record.table,
  };
}

function normaliseDataType(dataType: string): string {
  return dataType.toLowerCase().replace(/"/g, '').trim();
}

function isBooleanType(type: string, name: string): boolean {
  if (type === 'boolean' || type === 'bool' || type === 'bit') return true;
  if (type === 'tinyint' && /^(is|has|can|should)_/.test(name)) return true;
  return false;
}

function isDateTimeType(type: string): boolean {
  return (
    type.includes('timestamp') ||
    type.includes('timestamptz') ||
    type.includes('datetime') ||
    type === 'time' ||
    type.startsWith('time ')
  );
}

function isDateType(type: string): boolean {
  return type === 'date' || type.startsWith('date ');
}

function isNumericType(type: string): boolean {
  return (
    isIntegerType(type) ||
    type === 'numeric' ||
    type === 'decimal' ||
    type === 'real' ||
    type === 'float' ||
    type === 'double' ||
    type === 'double precision' ||
    type === 'money'
  );
}

function isIntegerType(type: string): boolean {
  return (
    type === 'integer' ||
    type === 'int' ||
    type === 'int2' ||
    type === 'int4' ||
    type === 'int8' ||
    type === 'bigint' ||
    type === 'smallint' ||
    type === 'tinyint' ||
    type === 'serial' ||
    type === 'bigserial'
  );
}

function isCurrencyName(name: string): boolean {
  return /(amount|price|cost|total|fee|salary|wage|balance|revenue|payment)/.test(name);
}

function isSelectType(type: string, name: string): boolean {
  if (type === 'user-defined' || type.includes('enum')) return true;
  const token = name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
  return /(^|_)(status|state|type|kind|method|country|city|gender|category|region|role|mode|priority)$/.test(
    token,
  );
}
