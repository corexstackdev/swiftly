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
