import { useCallback, useRef, useState } from 'react';
import type { ApplicationDsl } from '@swiftly/shared';

/**
 * Undo/redo over the application DSL.
 *
 * Because the DSL is a plain serializable document and the editor's only job is to
 * mutate it, history is just a stack of snapshots — no command objects, no inverse
 * operations to keep correct. Snapshots are coalesced within a short window so
 * dragging a widget produces one undo step rather than sixty.
 */

const COALESCE_WINDOW_MS = 400;
const MAX_HISTORY = 100;

export interface DslHistory {
  dsl: ApplicationDsl;
  /** Applies a change. `label` groups rapid changes of the same kind into one step. */
  update: (mutate: (draft: ApplicationDsl) => void, label?: string) => void;
  /** Replaces the document without creating a history entry (e.g. after a reload). */
  reset: (dsl: ApplicationDsl) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  isDirty: boolean;
  /** Marks the given snapshot saved, or the current document if omitted. */
  markSaved: (snapshot?: ApplicationDsl) => void;
}

export function useDslHistory(initial: ApplicationDsl): DslHistory {
  const [dsl, setDsl] = useState<ApplicationDsl>(initial);
  const past = useRef<ApplicationDsl[]>([]);
  const future = useRef<ApplicationDsl[]>([]);
  const lastEntry = useRef<{ label: string; at: number } | null>(null);
  const savedSnapshot = useRef<string>(JSON.stringify(initial));
  const [, forceRender] = useState(0);

  const update = useCallback(
    (mutate: (draft: ApplicationDsl) => void, label = 'edit') => {
      setDsl((current) => {
        const draft = structuredClone(current);
        mutate(draft);

        const now = Date.now();
        const coalesce =
          lastEntry.current?.label === label &&
          now - lastEntry.current.at < COALESCE_WINDOW_MS &&
          past.current.length > 0;

        if (!coalesce) {
          past.current.push(current);
          if (past.current.length > MAX_HISTORY) past.current.shift();
        }
        lastEntry.current = { label, at: now };
        future.current = [];

        return draft;
      });
      forceRender((n) => n + 1);
    },
    [],
  );

  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (!previous) return;
    setDsl((current) => {
      future.current.push(current);
      return previous;
    });
    lastEntry.current = null;
    forceRender((n) => n + 1);
  }, []);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    setDsl((current) => {
      past.current.push(current);
      return next;
    });
    lastEntry.current = null;
    forceRender((n) => n + 1);
  }, []);

  const reset = useCallback((next: ApplicationDsl) => {
    past.current = [];
    future.current = [];
    lastEntry.current = null;
    savedSnapshot.current = JSON.stringify(next);
    setDsl(next);
    forceRender((n) => n + 1);
  }, []);

  const markSaved = useCallback((snapshot?: ApplicationDsl) => {
    savedSnapshot.current = JSON.stringify(snapshot ?? dsl);
    forceRender((n) => n + 1);
  }, [dsl]);

  return {
    dsl,
    update,
    reset,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    isDirty: JSON.stringify(dsl) !== savedSnapshot.current,
    markSaved,
  };
}
