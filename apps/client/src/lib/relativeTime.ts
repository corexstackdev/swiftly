/**
 * Timestamps people can read at a glance.
 *
 * "Updated 20/9/2026" tells you almost nothing when you are scanning a list for
 * the thing you were working on this morning. "2 hours ago" tells you exactly
 * that, and the exact date stays available in a tooltip for the cases where it
 * actually matters.
 *
 * `Intl` does the wording, so this follows the browser's locale rather than
 * hard-coding English.
 */

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

const absolute = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** "just now", "2 hours ago", "last week". Empty string for an unparseable date. */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';

  const seconds = Math.round((now - then) / 1000);
  // Anything inside the last minute reads as "now"; a clock skew of a few
  // seconds should not produce "in 4 seconds".
  if (Math.abs(seconds) < 45) return 'just now';

  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) {
      return relative.format(-Math.round(seconds / size), unit);
    }
  }

  return relative.format(-Math.round(seconds), 'second');
}

/** The full date and time, for a tooltip beside the relative one. */
export function formatAbsolute(iso: string): string {
  const then = new Date(iso);
  return Number.isFinite(then.getTime()) ? absolute.format(then) : '';
}
