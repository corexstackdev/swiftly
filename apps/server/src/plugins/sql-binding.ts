import type { IdentifierAllowlistEntry } from '@vinodapp/shared';

/**
 * Extracts `{{ expression }}` bindings from user-authored SQL and replaces them
 * with the dialect's parameter placeholder. This is the boundary that keeps user
 * input out of the SQL string, so it scans rather than regex-replaces: a `{{` that
 * appears inside a string literal, a comment, or a quoted identifier is left alone.
 *
 * Bindings that land where a parameter is not legal (a table or column name) are
 * rejected unless the query declares an explicit allowlist for them.
 */

export interface ExtractionResult {
  /** SQL with every binding replaced by a placeholder. Safe to send to the driver. */
  sql: string;
  /** Binding expressions in placeholder order. */
  expressions: string[];
  /** Bindings in identifier position, resolved against the allowlist. */
  identifierBindings: IdentifierBinding[];
}

export interface IdentifierBinding {
  expression: string;
  allowedValues: string[];
}

export class SqlBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlBindingError';
  }
}

/** Keywords after which the next token names an object, not a value. */
const IDENTIFIER_KEYWORDS = new Set([
  'from',
  'join',
  'into',
  'update',
  'table',
  'schema',
  'database',
  'by', // GROUP BY / ORDER BY
]);

interface Dialect {
  /** MySQL uses backticks for identifiers; Postgres/SQL Server do not. */
  backtickIdentifiers: boolean;
  /** Postgres supports $tag$ ... $tag$ string literals. */
  dollarQuotedStrings: boolean;
  placeholder(index: number): string;
}

export const DIALECTS: Record<string, Dialect> = {
  postgres: {
    backtickIdentifiers: false,
    dollarQuotedStrings: true,
    placeholder: (i) => `$${i + 1}`,
  },
  mysql: {
    backtickIdentifiers: true,
    dollarQuotedStrings: false,
    placeholder: () => '?',
  },
  mssql: {
    backtickIdentifiers: false,
    dollarQuotedStrings: false,
    placeholder: (i) => `@p${i + 1}`,
  },
  oracle: {
    backtickIdentifiers: false,
    dollarQuotedStrings: false,
    placeholder: (i) => `:${i + 1}`,
  },
};

export function extractBindings(
  sql: string,
  dialectName: keyof typeof DIALECTS,
  allowlist: IdentifierAllowlistEntry[] = [],
): ExtractionResult {
  const dialect = DIALECTS[dialectName];
  if (!dialect) throw new SqlBindingError(`Unknown SQL dialect: ${dialectName}`);

  let out = '';
  const expressions: string[] = [];
  const identifierBindings: IdentifierBinding[] = [];
  let i = 0;

  while (i < sql.length) {
    const char = sql[i]!;
    const next = sql[i + 1];

    // -- line comment
    if (char === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // /* block comment */ — not nested, which matches every dialect we target
    if (char === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // 'string literal' with '' escaping
    if (char === "'") {
      const stop = scanQuoted(sql, i, "'");
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // "quoted identifier"
    if (char === '"') {
      const stop = scanQuoted(sql, i, '"');
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // `backtick identifier` (MySQL)
    if (char === '`' && dialect.backtickIdentifiers) {
      const stop = scanQuoted(sql, i, '`');
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // $tag$ dollar-quoted string $tag$ (Postgres) — also how function bodies are written
    if (char === '$' && dialect.dollarQuotedStrings) {
      const tagMatch = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? sql.length : end + tag.length;
        out += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }

    // {{ binding }}
    if (char === '{' && next === '{') {
      const end = sql.indexOf('}}', i + 2);
      if (end === -1) {
        throw new SqlBindingError('Unterminated binding: missing closing }}');
      }
      const expression = sql.slice(i + 2, end).trim();
      if (expression.length === 0) {
        throw new SqlBindingError('Empty binding {{ }} in query');
      }

      if (isIdentifierPosition(out)) {
        const entry = allowlist.find((a) => normalise(a.binding) === normalise(expression));
        if (!entry) {
          throw new SqlBindingError(
            `Binding {{ ${expression} }} appears where a table or column name is expected. ` +
              'Values there cannot be sent as parameters, so it must declare an allowlist ' +
              'of permitted identifiers on the query.',
          );
        }
        // The value is substituted at execution time, checked against allowedValues.
        identifierBindings.push({ expression, allowedValues: entry.allowedValues });
        out += `{{IDENT:${identifierBindings.length - 1}}}`;
      } else {
        out += dialect.placeholder(expressions.length);
        expressions.push(expression);
      }

      i = end + 2;
      continue;
    }

    out += char;
    i += 1;
  }

  return { sql: out, expressions, identifierBindings };
}

/**
 * Substitutes allowlisted identifiers into the extracted SQL. Called at execution
 * time, after the identifier expressions have been evaluated.
 */
export function applyIdentifierBindings(
  sql: string,
  bindings: IdentifierBinding[],
  values: string[],
): string {
  return sql.replace(/\{\{IDENT:(\d+)\}\}/g, (_match, indexText: string) => {
    const index = Number(indexText);
    const binding = bindings[index];
    const value = values[index];
    if (!binding || value === undefined) {
      throw new SqlBindingError('Identifier binding could not be resolved');
    }
    if (!binding.allowedValues.includes(value)) {
      throw new SqlBindingError(
        `Identifier "${value}" is not in the allowlist for {{ ${binding.expression} }}`,
      );
    }
    return value;
  });
}

/** Scans a quoted region starting at `start`, handling doubled-quote escapes. */
function scanQuoted(sql: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === quote) {
      if (sql[i + 1] === quote) {
        i += 2; // escaped quote
        continue;
      }
      return i + 1;
    }
    // Backslash escapes apply inside MySQL string literals.
    if (sql[i] === '\\' && quote === "'") {
      i += 2;
      continue;
    }
    i += 1;
  }
  return sql.length; // unterminated; the driver will reject it
}

/**
 * Decides whether the binding about to be emitted sits where an object name is
 * expected. Looks back at the last significant token in the SQL produced so far.
 */
function isIdentifierPosition(emittedSoFar: string): boolean {
  const trimmed = emittedSoFar.replace(/\s+$/, '');
  if (trimmed.length === 0) return false;

  // Directly glued to an identifier or a dot, e.g. `schema.{{ table }}`.
  const lastChar = trimmed[trimmed.length - 1]!;
  if (lastChar === '.') return true;

  const lastToken = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed)?.[1];
  if (!lastToken) return false;
  return IDENTIFIER_KEYWORDS.has(lastToken.toLowerCase());
}

function normalise(expression: string): string {
  return expression.trim().replace(/\s+/g, ' ');
}

/* ------------------------------------------------------------------ *
 * Statement classification — decides read vs write routing and whether
 * the caller needs the `query:write` permission
 * ------------------------------------------------------------------ */

export type StatementType = 'read' | 'write' | 'ddl' | 'call' | 'unknown';

const WRITE_KEYWORDS = new Set(['insert', 'update', 'delete', 'merge', 'upsert', 'truncate']);
const DDL_KEYWORDS = new Set(['create', 'alter', 'drop', 'grant', 'revoke', 'comment']);

export function classifyStatement(sql: string): StatementType {
  const stripped = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim()
    .toLowerCase();

  // A CTE still ends in the statement that matters.
  const body = stripped.startsWith('with ') ? stripped.replace(/^with[\s\S]*?\)\s*/, '') : stripped;
  const first = /^[a-z]+/.exec(body)?.[0] ?? '';

  if (first === 'select' || first === 'show' || first === 'explain' || first === 'describe') {
    // `SELECT ... INTO` and `SELECT ... FOR UPDATE` write.
    if (/\binto\b/.test(body) || /\bfor\s+update\b/.test(body)) return 'write';
    return 'read';
  }
  if (WRITE_KEYWORDS.has(first)) return 'write';
  if (DDL_KEYWORDS.has(first)) return 'ddl';
  if (first === 'call' || first === 'exec' || first === 'execute' || first === 'begin') {
    return 'call';
  }
  return 'unknown';
}
