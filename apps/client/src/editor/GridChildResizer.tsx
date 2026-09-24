import { useRef, useState } from 'react';
import clsx from 'clsx';
import type { WidgetDsl } from '@vinodapp/shared';

/**
 * Resize handles for a widget sitting in a Grid cell.
 *
 * A Grid child has no coordinates to drag — it occupies cells — so the ordinary
 * canvas handles do not apply to it. Without something here the only way to make
 * a child taller is to find `Row span` in the property panel, which is a strange
 * thing to have to do to a box you are looking at.
 *
 * These handles drag in pixels and commit in cells: the pointer moves freely, the
 * span snaps to whole cells, and the preview shows which span it will land on.
 */

interface DragState {
  startX: number;
  startY: number;
  startColSpan: number;
  startRowSpan: number;
  columnUnit: number;
  rowUnit: number;
  maxColSpan: number;
}

export function GridChildResizer({
  child,
  onCommit,
  children,
}: {
  child: WidgetDsl;
  onCommit: (patch: { colSpan?: number; rowSpan?: number }) => void;
  children: React.ReactNode;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [preview, setPreview] = useState<{ colSpan: number; rowSpan: number } | null>(null);

  const begin = (event: React.PointerEvent, axis: 'x' | 'y' | 'both'): void => {
    event.preventDefault();
    event.stopPropagation();

    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    // The handles sit a couple of elements inside the cell, so walk up to the
    // grid itself rather than assuming how deep the selection chrome nests.
    let cell: HTMLElement = wrapper;
    let grid: HTMLElement | null = null;
    for (let node = wrapper.parentElement; node; node = node.parentElement) {
      if (getComputedStyle(node).display === 'grid') {
        grid = node;
        break;
      }
      cell = node;
    }
    if (!grid) return;

    const gridStyle = getComputedStyle(grid);
    const tracks = gridStyle.gridTemplateColumns.split(' ').filter(Boolean);
    const columnGap = parseFloat(gridStyle.columnGap) || 0;
    const rowGap = parseFloat(gridStyle.rowGap) || 0;

    const startColSpan = Math.max(1, Number(child.properties.colSpan ?? 1));
    const startRowSpan = Math.max(1, Number(child.properties.rowSpan ?? 1));
    const rect = cell.getBoundingClientRect();

    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startColSpan,
      startRowSpan,
      // One column plus its gap, derived from the track list rather than assumed,
      // so an uneven or collapsed grid still measures correctly.
      columnUnit: (parseFloat(tracks[0] ?? '0') || rect.width) + columnGap,
      // Rows can be content-sized, so a row's height is inferred from what this
      // child currently occupies rather than from a fixed setting.
      rowUnit: (rect.height + rowGap) / startRowSpan,
      maxColSpan: tracks.length,
    };

    setPreview({ colSpan: startColSpan, rowSpan: startRowSpan });
    (event.target as Element).setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
      const drag = dragRef.current;
      if (!drag) return;

      const next = { colSpan: drag.startColSpan, rowSpan: drag.startRowSpan };

      if (axis !== 'y' && drag.columnUnit > 0) {
        const delta = Math.round((moveEvent.clientX - drag.startX) / drag.columnUnit);
        next.colSpan = clamp(drag.startColSpan + delta, 1, drag.maxColSpan);
      }
      if (axis !== 'x' && drag.rowUnit > 0) {
        const delta = Math.round((moveEvent.clientY - drag.startY) / drag.rowUnit);
        next.rowSpan = Math.max(1, drag.startRowSpan + delta);
      }

      setPreview(next);
    };

    const finish = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);

      const drag = dragRef.current;
      dragRef.current = null;

      setPreview((current) => {
        if (current && drag) {
          const patch: { colSpan?: number; rowSpan?: number } = {};
          if (current.colSpan !== drag.startColSpan) patch.colSpan = current.colSpan;
          if (current.rowSpan !== drag.startRowSpan) patch.rowSpan = current.rowSpan;
          // Only commit a real change, so a click that happens to land on a handle
          // does not write a no-op into the document history.
          if (patch.colSpan !== undefined || patch.rowSpan !== undefined) onCommit(patch);
        }
        return null;
      });
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
  };

  return (
    <div ref={wrapperRef} className="relative h-full w-full">
      {children}

      {/* The dotted cell guide is the border; these stay out of its way. */}
      <Handle position="e" onPointerDown={(event) => begin(event, 'x')} />
      <Handle position="s" onPointerDown={(event) => begin(event, 'y')} />
      <Handle position="se" onPointerDown={(event) => begin(event, 'both')} />

      {preview && (
        <span className="pointer-events-none absolute right-1 bottom-1 z-30 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums">
          {preview.colSpan} × {preview.rowSpan}
        </span>
      )}
    </div>
  );
}

/**
 * A handle is a hit area first and a mark second.
 *
 * The grip is what the cell guide already draws, so an edge shows nothing until
 * the pointer is actually on it, and then only a hairline. The corner is the one
 * affordance worth advertising, and only for the cell being hovered.
 */
function Handle({
  position,
  onPointerDown,
}: {
  position: 'e' | 's' | 'se';
  onPointerDown: (event: React.PointerEvent) => void;
}) {
  if (position === 'se') {
    return (
      <span
        onPointerDown={onPointerDown}
        onClick={(event) => event.stopPropagation()}
        className="absolute right-[-3px] bottom-[-3px] z-20 h-2 w-2 cursor-nwse-resize rounded-full border border-blue-600 bg-white opacity-0 transition-opacity group-hover/cell:opacity-100"
      />
    );
  }

  return (
    <span
      onPointerDown={onPointerDown}
      onClick={(event) => event.stopPropagation()}
      className={clsx(
        'group/handle absolute z-20 flex items-center justify-center',
        position === 'e'
          ? 'top-2 right-[-3px] bottom-2 w-1.5 cursor-ew-resize'
          : 'right-2 bottom-[-3px] left-2 h-1.5 cursor-ns-resize',
      )}
    >
      <span
        className={clsx(
          'block rounded-full bg-blue-500 opacity-0 transition-opacity group-hover/handle:opacity-100',
          position === 'e' ? 'h-full w-0.5' : 'h-0.5 w-full',
        )}
      />
    </span>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
