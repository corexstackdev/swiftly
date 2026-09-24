import { formatRelative } from '@/lib/relativeTime';

/**
 * Turning a bound value into something worth reading.
 *
 * A display widget almost always shows a value that came out of a query, and
 * a raw one is rarely what anyone wants on a screen: 1234.5 is a price,
 * "2026-09-21T18:06:56.209Z" is a date, 0.184 is a percentage. Doing that in
 * the binding means writing `{{ new Intl.NumberFormat(...).format(...) }}` in a
 * one-line expression editor, which is how bindings turn into code nobody wants
 * to maintain.
 *
 * Every formatter falls back to the plain string when the value will not
 * convert. Showing "NaN" or "Invalid Date" where a number was expected tells
 * the reader nothing and hides what the query actually returned.
 */

export type ValueFormat =
  | 'plain'
  | 'number'
  | 'currency'
  | 'percent'
  | 'date'
  | 'datetime'
  | 'time'
  | 'relative';

export interface FormatOptions {
  format?: ValueFormat;
  /** Decimal places for the numeric formats. Blank leaves it to the locale. */
  decimals?: number;
  /** ISO 4217 code, e.g. EUR. */
  currency?: string;
  dateStyle?: 'short' | 'medium' | 'long';
  /** Shown when the value is absent, so an empty cell can still say something. */
  emptyText?: string;
  prefix?: string;
  suffix?: string;
}

export function formatValue(raw: unknown, options: FormatOptions = {}): string {
  const { format = 'plain', emptyText = '', prefix = '', suffix = '' } = options;

  // Absent is its own case: an empty string is not a zero, and a missing date is
  // not 1970. Affixes are skipped too — "£" alone reads as a broken value.
  if (raw === undefined || raw === null || raw === '') return emptyText;

  const body = formatBody(raw, format, options);
  return `${prefix}${body}${suffix}`;
}

function formatBody(raw: unknown, format: ValueFormat, options: FormatOptions): string {
  const text = typeof raw === 'string' ? raw : String(raw);

  switch (format) {
    case 'number':
    case 'currency':
    case 'percent': {
      const value = typeof raw === 'number' ? raw : Number(text);
      if (!Number.isFinite(value)) return text;

      const digits =
        Number.isFinite(Number(options.decimals)) && Number(options.decimals) >= 0
          ? { minimumFractionDigits: Number(options.decimals), maximumFractionDigits: Number(options.decimals) }
          : {};

      const currency = (options.currency ?? '').trim().toUpperCase();

      try {
        return new Intl.NumberFormat(undefined, {
          ...digits,
          ...(format === 'currency' && currency.length === 3
            ? { style: 'currency', currency }
            : {}),
          // A percent format multiplies by 100, so 0.184 reads as 18.4% — which
          // is what a ratio out of a database actually means.
          ...(format === 'percent' ? { style: 'percent' } : {}),
        }).format(value);
      } catch {
        // An unrecognised currency code throws rather than degrading, and a
        // typo in one field should not blank the widget.
        return new Intl.NumberFormat(undefined, digits).format(value);
      }
    }

    case 'date':
    case 'datetime':
    case 'time': {
      const date = toDate(raw);
      if (!date) return text;

      const style = options.dateStyle ?? 'medium';
      return new Intl.DateTimeFormat(undefined, {
        ...(format !== 'time' ? { dateStyle: style } : {}),
        ...(format !== 'date' ? { timeStyle: style === 'long' ? 'medium' : 'short' } : {}),
      }).format(date);
    }

    case 'relative': {
      const date = toDate(raw);
      return date ? formatRelative(date.toISOString()) : text;
    }

    default:
      return text;
  }
}

/** Accepts an ISO string, a Date, or an epoch number. */
function toDate(raw: unknown): Date | null {
  if (raw instanceof Date) return Number.isFinite(raw.getTime()) ? raw : null;

  const date = typeof raw === 'number' ? new Date(raw) : new Date(String(raw));
  return Number.isFinite(date.getTime()) ? date : null;
}
