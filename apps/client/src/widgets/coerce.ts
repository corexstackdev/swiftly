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
 * Options for a Select (and anything else that used to ask for a hand-built list).
 *
 * Source Data is typed JSON, a binding that already evaluated to a list, or an
 * object map. The shapes we accept are the ones people actually paste:
 * `["Red","Green"]`, `[{label,value}]`, `{ "us": "United States" }`, and the
 * `{ data: [...] }` wrapper most REST queries return.
 */
export function asSourceList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;

  let parsed = value;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text || text.startsWith('{{')) return [];
    try {
      parsed = JSON.parse(text);
    } catch {
      return [];
    }
  }

  if (Array.isArray(parsed)) return parsed;
  if (parsed === null || typeof parsed !== 'object') return [];

  const record = parsed as Record<string, unknown>;
  for (const key of ['data', 'options', 'items', 'rows']) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }

  return Object.entries(record).map(([key, entry]) => {
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      const row = entry as Record<string, unknown>;
      return { value: row.value ?? key, label: row.label ?? key, ...row };
    }
    return { value: key, label: String(entry) };
  });
}

/** Why Source Data produced no options, or null when the value is fine or empty. */
export function sourceDataError(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) return null;
  if (typeof value !== 'string') return null;

  const text = value.trim();
  if (!text || text.includes('{{')) return null;

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) || (parsed !== null && typeof parsed === 'object')) return null;
    return 'Source Data must be a JSON array or object';
  } catch {
    return 'Source Data must be valid JSON';
  }
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

  if (typeof value === 'string') {
    const text = value.trim();
    if (!text || text.startsWith('{{')) return [];
    try {
      return asRows(JSON.parse(text));
    } catch {
      return [];
    }
  }

  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['data', 'rows', 'items']) {
      if (Array.isArray(record[key])) return record[key] as Record<string, unknown>[];
    }
  }

  return [];
}

/** One row, when a caller needs to be sure it really is an object. */
export function isRow(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
