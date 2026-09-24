/**
 * Reading a list out of a property that may not be one yet.
 *
 * The `code` control stores exactly what was typed, as a string. A binding like
 * `{{ GetOrders.data }}` is evaluated before it reaches the widget and arrives as
 * a real array — but a static list pasted straight in stays a string, and every
 * widget that checked `Array.isArray` simply saw nothing.
 *
 * The failure was silent and looked like a data problem: paste a perfectly good
 * array of rows, get "No rows", with nothing on screen to say the value never
 * became an array. Parsing it here is the difference between a property that
 * accepts what its help text implies and one that quietly requires braces.
 */
export function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;

  if (typeof value === 'string') {
    const text = value.trim();
    // Only something that looks like a list is worth parsing. Anything else is a
    // string the widget genuinely was given, and guessing at it would turn a
    // typo into a confusing success.
    if (!text.startsWith('[')) return [];

    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // Half-typed JSON while someone is still editing. An empty list is the
      // honest answer until it parses.
      return [];
    }
  }

  return [];
}

/**
 * The same, for a list of rows.
 *
 * An array that is already an array is handed straight back rather than filtered.
 * A `filter` would allocate a second array the size of the first, on every change,
 * and a table's whole reason for virtualizing is to not do work proportional to a
 * hundred thousand rows. Reading a property off a non-object row yields undefined,
 * which renders as an empty cell — the same thing dropping it would have achieved,
 * without the copy.
 */
export function asRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  return asArray(value) as Record<string, unknown>[];
}

/** One row, when a caller needs to be sure it really is an object. */
export function isRow(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
