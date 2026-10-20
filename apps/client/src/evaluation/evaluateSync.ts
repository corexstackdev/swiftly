import { isBinding, parseBinding } from './parser';

/**
 * Synchronous expression evaluation, for the bindings a query needs at the moment
 * it runs.
 *
 * The worker is the right place for page-wide evaluation: it is off the main thread
 * and interruptible. But it is also asynchronous, and a query triggered from an
 * event must use the state as it is *now* — a select's `onChange` fires in the same
 * tick as its `setState`, before React has re-rendered and long before the worker
 * has reported back. Reading the worker's last result there sends the previous
 * value to the server, which is a silently wrong query rather than a visible error.
 *
 * So query bindings are evaluated here, synchronously, against a scope built from
 * current state. They are a handful of short expressions, not a whole page, so the
 * cost is negligible and the ordering is correct by construction.
 */

const compiled = new Map<string, (scope: Record<string, unknown>) => unknown>();

export function evaluateExpression(
  expression: string,
  scope: Record<string, unknown>,
): { value: unknown; error?: string } {
  try {
    let fn = compiled.get(expression);
    if (!fn) {
      // eslint-disable-next-line no-new-func
      fn = new Function('scope', `with (scope) { return (${expression}); }`) as (
        scope: Record<string, unknown>,
      ) => unknown;
      compiled.set(expression, fn);
      if (compiled.size > 1000) compiled.clear();
    }
    return { value: fn(scope) };
  } catch (error) {
    return {
      value: undefined,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Writes an `Entity.property` path into a scope object, creating containers as needed. */
export function writePath(
  scope: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const [entity, ...rest] = path.split('.');
  if (!entity) return;

  if (rest.length === 0) {
    scope[entity] = value;
    return;
  }

  const container = (scope[entity] ??= {}) as Record<string, unknown>;
  let cursor = container;
  for (const segment of rest.slice(0, -1)) {
    cursor = (cursor[segment] ??= {}) as Record<string, unknown>;
  }
  cursor[rest[rest.length - 1]!] = value;
}

/**
 * Resolve a stored action field: a fully-wrapped `{{ expr }}` becomes the
 * expression's value (an object stays an object); mixed text interpolates to a
 * string; anything else is returned as stored.
 */
export function resolveValue(value: unknown, scope: Record<string, unknown>): unknown {
  if (typeof value !== 'string' || !isBinding(value)) return value;

  const parsed = parseBinding(value);
  const fullyWrapped =
    parsed.expressions.length === 1 && parsed.parts.every((part) => part === '');
  if (fullyWrapped) {
    return evaluateExpression(parsed.expressions[0]!, scope).value;
  }

  let result = parsed.parts[0] ?? '';
  for (let index = 0; index < parsed.expressions.length; index += 1) {
    const outcome = evaluateExpression(parsed.expressions[index]!, scope).value;
    result += (outcome == null ? '' : String(outcome)) + (parsed.parts[index + 1] ?? '');
  }
  return result;
}

/** True when `enabledWhen` is empty or the expression is truthy. */
export function isActionEnabled(enabledWhen: string | undefined, scope: Record<string, unknown>): boolean {
  const when = enabledWhen?.trim();
  if (!when) return true;

  if (isBinding(when)) {
    return Boolean(resolveValue(when, scope));
  }

  const outcome = evaluateExpression(when, scope);
  return outcome.error ? false : Boolean(outcome.value);
}
