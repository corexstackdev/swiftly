import type { ActionDsl } from '@swiftly/shared';
import type { ValueFormat } from './formatValue';
import { asArray, isRow } from './coerce';

/**
 * What a table knows about one of its columns.
 *
 * Order is the array's own order, so moving a column is moving an element and
 * there is no separate index to keep in step with it.
 *
 * A column does not have to exist in the data. `source: 'static'` is a column the
 * table adds — a blank field for someone to fill in, a flag defaulted to No — and
 * its value comes from `defaultValue` rather than from the row. That is what
 * makes "add a column with a default" a column setting rather than a change to
 * the query behind it.
 *
 * `source: 'actions'` is a column of buttons — Edit, Delete, Download — the
 * builder picks, rather than a value from the row.
 */

export type TableRowActionKind = 'edit' | 'delete' | 'download';

export interface TableRowAction {
  kind: TableRowActionKind;
  /** Button label. With an icon, blank means icon-only. */
  label?: string;
  /**
   * react-icons export name (`FiEdit2`) or a short emoji. Omitted uses the
   * kind's default; an empty string is an explicit "text only".
   */
  icon?: string;
  /** Download: column holding a URL or the file contents. */
  downloadKey?: string;
  /** Download: column holding the file name. */
  fileNameKey?: string;
  /** Handlers that run when this button is clicked, in order. */
  onClick?: ActionDsl[];
}

export const TABLE_ROW_ACTION_KINDS: {
  kind: TableRowActionKind;
  label: string;
  icon: string;
  event: 'onRowEdit' | 'onRowDelete' | 'onRowDownload';
}[] = [
  { kind: 'edit', label: 'Edit', icon: 'FiEdit2', event: 'onRowEdit' },
  { kind: 'delete', label: 'Delete', icon: 'FiTrash2', event: 'onRowDelete' },
  { kind: 'download', label: 'Download', icon: 'FiDownload', event: 'onRowDownload' },
];

export function actionMeta(kind: TableRowActionKind) {
  return TABLE_ROW_ACTION_KINDS.find((entry) => entry.kind === kind) ?? TABLE_ROW_ACTION_KINDS[0]!;
}

export function isActionsColumn(column: TableColumnConfig): boolean {
  return column.source === 'actions';
}

export interface TableColumnConfig {
  key: string;
  label?: string;
  width?: number;
  /** Omitted from the table. Stays in this list so it can be shown again. */
  hidden?: boolean;
  align?: 'left' | 'center' | 'right';
  /** Cells can be typed into, and the edit is published rather than written back. */
  editable?: boolean;
  /** Where the cell's value comes from. */
  source?: 'data' | 'static' | 'actions';
  /** Used by a static column, and by a data column wherever the row has nothing. */
  defaultValue?: unknown;
  /** Buttons shown when `source` is `actions`. */
  actions?: TableRowAction[];

  /* Presentation, shared with the Text widget's formatter. */
  format?: ValueFormat;
  decimals?: number;
  currency?: string;
  dateStyle?: 'short' | 'medium' | 'long';
  prefix?: string;
  suffix?: string;
  emptyText?: string;
}

/** Tolerates a half-edited value: anything without a string key is dropped. */
export function normaliseColumns(value: unknown): TableColumnConfig[] {
  return asArray(value).flatMap((entry) => {
    if (!isRow(entry)) return [];
    const record = entry;
    if (typeof record.key !== 'string' || record.key === '') return [];

    const source =
      record.source === 'static' || record.source === 'actions' ? record.source : 'data';

    return [
      {
        key: record.key,
        label: typeof record.label === 'string' ? record.label : undefined,
        width: Number.isFinite(Number(record.width)) ? Number(record.width) : undefined,
        hidden: record.hidden === true,
        align: (['left', 'center', 'right'] as const).find((a) => a === record.align),
        editable: source === 'actions' ? false : record.editable === true,
        source,
        defaultValue: record.defaultValue,
        actions: source === 'actions' ? normaliseActions(record.actions) : undefined,
        format: record.format as ValueFormat | undefined,
        decimals: Number.isFinite(Number(record.decimals)) ? Number(record.decimals) : undefined,
        currency: typeof record.currency === 'string' ? record.currency : undefined,
        dateStyle: (['short', 'medium', 'long'] as const).find((d) => d === record.dateStyle),
        prefix: typeof record.prefix === 'string' ? record.prefix : undefined,
        suffix: typeof record.suffix === 'string' ? record.suffix : undefined,
        emptyText: typeof record.emptyText === 'string' ? record.emptyText : undefined,
      },
    ];
  });
}

function normaliseActions(value: unknown): TableRowAction[] {
  const allowed = new Set<TableRowActionKind>(['edit', 'delete', 'download']);
  const seen = new Set<TableRowActionKind>();
  const actions: TableRowAction[] = [];

  for (const entry of asArray(value)) {
    if (!isRow(entry)) continue;
    const kind = entry.kind as TableRowActionKind;
    if (!allowed.has(kind) || seen.has(kind)) continue;
    seen.add(kind);
    actions.push({
      kind,
      label: typeof entry.label === 'string' && entry.label.trim() !== '' ? entry.label : undefined,
      icon: typeof entry.icon === 'string' ? entry.icon : undefined,
      downloadKey: typeof entry.downloadKey === 'string' ? entry.downloadKey : undefined,
      fileNameKey: typeof entry.fileNameKey === 'string' ? entry.fileNameKey : undefined,
      onClick: normaliseHandlers(entry.onClick),
    });
  }

  const order = TABLE_ROW_ACTION_KINDS.map((entry) => entry.kind);
  return actions.sort((left, right) => order.indexOf(left.kind) - order.indexOf(right.kind));
}

function normaliseHandlers(value: unknown): ActionDsl[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const handlers = value.filter(
    (entry): entry is ActionDsl =>
      Boolean(entry) && typeof entry === 'object' && typeof (entry as { type?: unknown }).type === 'string',
  );
  return handlers.length > 0 ? handlers : undefined;
}

/** One data column per key, with optional keys already hidden. */
export function seedDataColumns(
  keys: string[],
  hiddenKeys: Iterable<string> = [],
): TableColumnConfig[] {
  const hidden = hiddenKeys instanceof Set ? hiddenKeys : new Set(hiddenKeys);
  return keys.map((key) => ({
    key,
    source: 'data' as const,
    ...(hidden.has(key) ? { hidden: true } : {}),
  }));
}

export function defaultActionsColumn(existing: TableColumnConfig[]): TableColumnConfig {
  let index = 1;
  let key = 'actions';
  while (existing.some((column) => column.key === key)) {
    index += 1;
    key = `actions${index}`;
  }
  return {
    key,
    label: 'Actions',
    source: 'actions',
    width: 96,
    align: 'right',
    actions: [
      { kind: 'edit', icon: 'FiEdit2' },
      { kind: 'delete', icon: 'FiTrash2' },
    ],
  };
}

/**
 * The columns to render, and in what order.
 *
 * With nothing configured the table shows every key of the first row, which is
 * what makes a freshly bound query useful immediately. Once columns are
 * configured they are the whole truth — including their order, including
 * columns marked hidden, and including static columns the data has never heard
 * of.
 *
 * Hidden is a setting on a configured column, not the same as a missing one.
 * Filtering hidden columns out before recording which keys are already claimed
 * made hide a no-op: the key looked new and was appended visible again. Known
 * keys therefore include hidden columns, and an empty visible list after a
 * real configuration means the builder hid everything, not "show all".
 *
 * A configured column whose key has since vanished from the data is kept rather
 * than dropped: a query that stops returning a field is a thing to notice, and
 * silently removing the column hides it.
 */
export function resolveColumns(
  configured: TableColumnConfig[],
  firstRow: Record<string, unknown> | undefined,
  sourceColumns: string[] = [],
): TableColumnConfig[] {
  const rowKeys =
    firstRow && typeof firstRow === 'object' && !Array.isArray(firstRow)
      ? Object.keys(firstRow)
      : [];
  const dataKeys = uniqueKeys([...sourceColumns, ...rowKeys]);

  if (configured.length === 0) {
    return dataKeys.map((key) => ({ key, source: 'data' as const }));
  }

  const visible = configured.filter((column) => !column.hidden);
  const known = new Set(configured.map((column) => column.key));
  const missing = dataKeys.filter((key) => !known.has(key));
  if (missing.length === 0) return visible;

  const actions = visible.filter((column) => column.source === 'actions');
  const rest = visible.filter((column) => column.source !== 'actions');
  return [
    ...rest,
    ...missing.map((key) => ({ key, source: 'data' as const })),
    ...actions,
  ];
}

function uniqueKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const key of keys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(key);
  }
  return unique;
}

/** The raw value behind one cell, before any formatting. */
export function cellValue(
  row: Record<string, unknown>,
  column: TableColumnConfig,
): unknown {
  if (column.source === 'actions') return undefined;
  if (column.source === 'static') return column.defaultValue;

  const value = isRow(row) ? row[column.key] : undefined;
  return value === undefined || value === null || value === '' ? column.defaultValue ?? value : value;
}
