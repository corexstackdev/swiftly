import { useEffect, useRef } from 'react';

/**
 * Reconciles a widget's configured default with its live state, and returns the
 * value the widget should actually show.
 *
 * At runtime the default seeds state once and then gets out of the way. Without
 * the seeding a widget shows its default but does not expose it: a slider reads
 * "10" on screen while `{{ LimitSlider.value }}` is empty. Without the "once",
 * clearing a field would be fought by the default reappearing under the cursor.
 *
 * At design time the field is live so a builder can type into it and see how it
 * behaves. Changing the default in the property panel still wins: that is a
 * configuration change, not a session, and the canvas must follow it.
 */
export function useSeededValue(
  state: Record<string, unknown>,
  setState: (patch: Record<string, unknown>) => void,
  defaultValue: unknown,
  { isDesignMode = false, key = 'value' }: { isDesignMode?: boolean; key?: string } = {},
): unknown {
  const current = state[key];
  const previousDefault = useRef(defaultValue);

  useEffect(() => {
    if (isDesignMode) {
      const defaultChanged = previousDefault.current !== defaultValue;
      previousDefault.current = defaultValue;

      if (defaultChanged && current !== defaultValue) {
        setState({ [key]: defaultValue });
        return;
      }

      if (current === undefined && defaultValue !== undefined) {
        setState({ [key]: defaultValue });
      }
      return;
    }

    if (current === undefined && defaultValue !== undefined && defaultValue !== '') {
      setState({ [key]: defaultValue });
    }
    // `setState` is recreated per render by the host; depending on it would re-run
    // this on every render rather than only when the value or default changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, defaultValue, key, isDesignMode]);

  return current ?? defaultValue;
}
