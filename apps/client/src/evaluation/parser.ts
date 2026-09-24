import { parse } from 'acorn';
import { simple } from 'acorn-walk';
import type { Node } from 'acorn';

/**
 * Binding parsing.
 *
 * A property value is a binding when it contains `{{ ... }}`. Each segment is parsed
 * into an AST so the entity paths it reads can be collected exactly — a regex would
 * find `Table1.data` inside a string literal or a comment and wire up a dependency
 * that does not exist.
 */

export interface ParsedBinding {
  /** Original text, e.g. `Hello {{ user.name }}`. */
  raw: string;
  /** Literal chunks between expressions. */
  parts: string[];
  /** Expression source for each gap between parts. */
  expressions: string[];
  /** Entity paths read, e.g. ['OrdersTable.selectedRow', 'GetOrders.data']. */
  dependencies: string[];
  /** Set when an expression could not be parsed. */
  syntaxError?: string;
}

const BINDING_PATTERN = /\{\{([\s\S]*?)\}\}/g;

export function isBinding(value: unknown): value is string {
  return typeof value === 'string' && value.includes('{{') && value.includes('}}');
}

export function parseBinding(raw: string): ParsedBinding {
  const parts: string[] = [];
  const expressions: string[] = [];
  let cursor = 0;

  BINDING_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BINDING_PATTERN.exec(raw)) !== null) {
    parts.push(raw.slice(cursor, match.index));
    expressions.push(match[1]!.trim());
    cursor = match.index + match[0].length;
  }
  parts.push(raw.slice(cursor));

  const dependencies = new Set<string>();
  let syntaxError: string | undefined;

  for (const expression of expressions) {
    try {
      // Wrapped in parentheses so an object literal parses as an expression rather
      // than a block statement — `{{ {a: 1} }}` is valid in a binding.
      const ast = parse(`(${expression})`, { ecmaVersion: 2022 });
      for (const path of collectMemberPaths(ast)) dependencies.add(path);
    } catch (error) {
      syntaxError = error instanceof Error ? error.message : String(error);
    }
  }

  return { raw, parts, expressions, dependencies: [...dependencies], syntaxError };
}

/**
 * Walks member expressions and records the dotted path of each one rooted at a bare
 * identifier. `Orders.data[0].name` records `Orders.data`, which is the granularity
 * the dependency graph works at: an entity and the property of it being read.
 */
function collectMemberPaths(ast: Node): string[] {
  const paths: string[] = [];
  const seenRoots = new Set<Node>();

  simple(ast, {
    MemberExpression(node) {
      // Only handle the outermost member expression of a chain.
      if (seenRoots.has(node)) return;

      const segments: string[] = [];
      let current: Node | undefined = node;

      while (current && current.type === 'MemberExpression') {
        const member = current as unknown as {
          object: Node;
          property: Node & { name?: string; value?: unknown };
          computed: boolean;
        };
        seenRoots.add(current);

        if (!member.computed && member.property.type === 'Identifier') {
          segments.unshift(member.property.name!);
        } else {
          // A computed access ends the static path: `rows[i].x` depends on `rows`.
          segments.length = 0;
        }
        current = member.object;
      }

      if (current && current.type === 'Identifier') {
        const root = (current as unknown as { name: string }).name;
        // Two segments is the useful depth: `Entity.property`.
        paths.push(segments.length > 0 ? `${root}.${segments[0]}` : root);
      }
    },
    Identifier(node) {
      const name = (node as unknown as { name: string }).name;
      if (!GLOBALS.has(name)) paths.push(name);
    },
  });

  return paths;
}

/** Names that are ambient, not entity references. */
const GLOBALS = new Set([
  'undefined', 'null', 'true', 'false', 'NaN', 'Infinity',
  'Math', 'JSON', 'Date', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'parseInt', 'parseFloat', 'isNaN', 'console', 'RegExp', 'Promise', 'Set', 'Map',
  'page', 'appState', 'currentUser', 'event',
]);
