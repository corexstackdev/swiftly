import { useEffect } from 'react';

/**
 * Reconciles a widget's configured default with its live state, and returns the
 * value the widget should actually show.
 *
 * Two rules, because the canvas and the running app want opposite things.
 *
 * At runtime the default seeds state once and then gets out of the way. Without
 * the seeding a widget shows its default but does not expose it: a slider reads
 * "10" on screen while `{{ LimitSlider.value }}` is empty, and a query bound to
 * it silently runs with no value. Without the "once", clearing a field would be
 * fought by the default reappearing under the cursor.
 *
 * At design time the default always wins. The canvas is a picture of the
 * configuration, not a session — there is nobody typing into it whose input
 * could be lost, and a builder editing "Default value" expects to watch the
 * widget change. Seeding-once there meant the first value ever typed stuck: set
 * a default of "1", change it to a name, and the canvas still showed "1"
 * forever, because state was no longer absent and the default was never
 * consulted again.
 */
export function useSeededValue(
  state: Record<string, unknown>,
  setState: (patch: Record<string, unknown>) => void,
  defaultValue: unknown,
  { isDesignMode = false, key = 'value' }: { isDesignMode?: boolean; key?: string } = {},
): unknown {
  const current = state[key];

  useEffect(() => {
    if (isDesignMode) {
      // Kept in step so bindings against the widget read what the canvas shows.
      // The comparison is what stops this from looping: once state matches the
      // default, the next run has nothing to write.
      if (current !== defaultValue) setState({ [key]: defaultValue });
      return;
    }

    if (current === undefined && defaultValue !== undefined && defaultValue !== '') {
      setState({ [key]: defaultValue });
    }
    // `setState` is recreated per render by the host; depending on it would re-run
    // this on every render rather than only when the value or default changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, defaultValue, key, isDesignMode]);

  /*
   * Returned rather than left for the caller to recompute, so the value on screen
   * cannot disagree with the value in state. In design mode it is the default
   * immediately, which also avoids a frame of the stale value on every keystroke
   * in the property panel while the effect above catches up.
   */
  return isDesignMode ? defaultValue : (current ?? defaultValue);
}
