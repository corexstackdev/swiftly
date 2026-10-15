import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

/**
 * A drag handle on the inner edge of a side panel.
 *
 * Width lives on the panel, not in the grid: the canvas already reflows from a
 * ResizeObserver, so changing the aside is enough. Pointer capture keeps the
 * drag alive if the cursor leaves the 6px strip.
 */

export function PanelResizeHandle({
  size,
  onSizeChange,
  side,
  min,
  max,
  label,
}: {
  size: number;
  onSizeChange: (size: number) => void;
  /** `end` is the right edge of the left panel; `start` is the left edge of the right panel. */
  side: 'start' | 'end';
  min: number;
  max: number;
  label: string;
}) {
  const origin = useRef({ x: 0, size: 0 });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const previous = document.body.style.cursor;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = previous;
      document.body.style.userSelect = '';
    };
  }, [dragging]);

  const clamp = useCallback(
    (value: number) => Math.round(Math.min(max, Math.max(min, value))),
    [min, max],
  );

  const applyDelta = (clientX: number) => {
    const delta = clientX - origin.current.x;
    const next = side === 'end' ? origin.current.size + delta : origin.current.size - delta;
    onSizeChange(clamp(next));
  };

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={Math.round(size)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        origin.current = { x: event.clientX, size };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        applyDelta(event.clientX);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        setDragging(false);
      }}
      onPointerCancel={() => setDragging(false)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 32 : 8;
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          onSizeChange(clamp(size + (side === 'end' ? -step : step)));
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          onSizeChange(clamp(size + (side === 'end' ? step : -step)));
        } else if (event.key === 'Home') {
          event.preventDefault();
          onSizeChange(min);
        } else if (event.key === 'End') {
          event.preventDefault();
          onSizeChange(max);
        }
      }}
      className={clsx(
        'no-drag absolute inset-y-0 z-20 w-1.5 cursor-col-resize touch-none',
        'hover:bg-blue-500/30 focus-visible:bg-blue-500/40',
        side === 'end' ? 'right-0' : 'left-0',
        dragging && 'bg-blue-500/50',
      )}
    />
  );
}

const WIDTH_KEYS = {
  entity: 'swiftly.editor.entityPanelWidth',
  property: 'swiftly.editor.propertyPanelWidth',
} as const;

export const ENTITY_PANEL_SIZE = { default: 240, min: 180, max: 480 };
export const PROPERTY_PANEL_SIZE = { default: 288, min: 220, max: 520 };

function readStoredWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key);
    const value = raw ? Number(raw) : NaN;
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
  } catch {
    return fallback;
  }
}

export function usePersistentPanelWidth(
  which: keyof typeof WIDTH_KEYS,
  bounds: { default: number; min: number; max: number },
) {
  const key = WIDTH_KEYS[which];
  const [width, setWidth] = useState(() =>
    readStoredWidth(key, bounds.default, bounds.min, bounds.max),
  );

  const set = useCallback(
    (next: number) => {
      const clamped = Math.min(bounds.max, Math.max(bounds.min, Math.round(next)));
      setWidth(clamped);
      try {
        localStorage.setItem(key, String(clamped));
      } catch {
        /* Private mode can refuse storage; the width still holds for the session. */
      }
    },
    [bounds.max, bounds.min, key],
  );

  return [width, set] as const;
}
