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
 */
export interface TableColumnConfig {
  key: string;
  label?: string;
  width?: number;
  hidden?: boolean;
  align?: 'left' | 'center' | 'right';
  /** Cells can be typed into, and the edit is published rather than written back. */
  editable?: boolean;
  /** Where the cell's value comes from. */
  source?: 'data' | 'static';
  /** Used by a static column, and by a data column wherever the row has nothing. */
  defaultValue?: unknown;

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

    return [
      {
        key: record.key,
        label: typeof record.label === 'string' ? record.label : undefined,
        width: Number.isFinite(Number(record.width)) ? Number(record.width) : undefined,
        hidden: record.hidden === true,
        align: (['left', 'center', 'right'] as const).find((a) => a === record.align),
        editable: record.editable === true,
        source: record.source === 'static' ? 'static' : 'data',
        defaultValue: record.defaultValue,
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

/**
 * The columns to render, and in what order.
 *
 * With nothing configured the table shows every key of the first row, which is
 * what makes a freshly bound query useful immediately. Once columns are
 * configured they are the whole truth — including their order, and including
 * static columns the data has never heard of.
 *
 * A configured column whose key has since vanished from the data is kept rather
 * than dropped: a query that stops returning a field is a thing to notice, and
 * silently removing the column hides it.
 */
export function resolveColumns(
  configured: TableColumnConfig[],
  firstRow: Record<string, unknown> | undefined,
): TableColumnConfig[] {
  if (configured.length > 0) return configured.filter((column) => !column.hidden);

  return Object.keys(firstRow ?? {}).map((key) => ({ key, source: 'data' as const }));
}

/** The raw value behind one cell, before any formatting. */
export function cellValue(
  row: Record<string, unknown>,
  column: TableColumnConfig,
): unknown {
  if (column.source === 'static') return column.defaultValue;

  const value = isRow(row) ? row[column.key] : undefined;
  return value === undefined || value === null || value === '' ? column.defaultValue ?? value : value;
}
