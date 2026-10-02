import { useRef, useState } from 'react';
import clsx from 'clsx';
import type { WidgetDsl } from '@swiftly/shared';

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
 * Every edge and corner is live so shrinking from the top or expanding from the
 * left is the same gesture as on the page canvas.
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

type Edges = { n?: boolean; s?: boolean; e?: boolean; w?: boolean };

type HandlePosition = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const HANDLES: { position: HandlePosition; edges: Edges }[] = [
  { position: 'n', edges: { n: true } },
  { position: 's', edges: { s: true } },
  { position: 'e', edges: { e: true } },
  { position: 'w', edges: { w: true } },
  { position: 'ne', edges: { n: true, e: true } },
  { position: 'nw', edges: { n: true, w: true } },
  { position: 'se', edges: { s: true, e: true } },
  { position: 'sw', edges: { s: true, w: true } },
];

export function GridChildResizer({
  child,
  selected = false,
  onCommit,
  children,
}: {
  child: WidgetDsl;
  selected?: boolean;
  onCommit: (patch: { colSpan?: number; rowSpan?: number }) => void;
  children: React.ReactNode;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [preview, setPreview] = useState<{ colSpan: number; rowSpan: number } | null>(null);

  const begin = (event: React.PointerEvent, edges: Edges): void => {
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

      if (edges.e && drag.columnUnit > 0) {
        next.colSpan = clamp(
          drag.startColSpan + Math.round((moveEvent.clientX - drag.startX) / drag.columnUnit),
          1,
          drag.maxColSpan,
        );
      }
      if (edges.w && drag.columnUnit > 0) {
        next.colSpan = clamp(
          drag.startColSpan + Math.round((drag.startX - moveEvent.clientX) / drag.columnUnit),
          1,
          drag.maxColSpan,
        );
      }
      if (edges.s && drag.rowUnit > 0) {
        next.rowSpan = Math.max(
          1,
          drag.startRowSpan + Math.round((moveEvent.clientY - drag.startY) / drag.rowUnit),
        );
      }
      if (edges.n && drag.rowUnit > 0) {
        next.rowSpan = Math.max(
          1,
          drag.startRowSpan + Math.round((drag.startY - moveEvent.clientY) / drag.rowUnit),
        );
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

      {HANDLES.map((handle) => (
        <Handle
          key={handle.position}
          position={handle.position}
          selected={selected}
          onPointerDown={(event) => begin(event, handle.edges)}
        />
      ))}

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
 * Edges stay faint until the cell is hovered or selected; corners keep a square
 * so the grip is obvious. The hit area is larger than the mark so shrinking
 * does not require pixel-accurate aiming.
 */
function Handle({
  position,
  selected,
  onPointerDown,
}: {
  position: HandlePosition;
  selected: boolean;
  onPointerDown: (event: React.PointerEvent) => void;
}) {
  const corner = position.length === 2;

  return (
    <span
      onPointerDown={onPointerDown}
      onClick={(event) => event.stopPropagation()}
      className={clsx(
        'absolute z-20',
        visibleClass(selected),
        HANDLE_BOX[position],
        HANDLE_CURSOR[position],
      )}
    >
      <span
        className={clsx(
          'block',
          corner
            ? 'h-2 w-2 rounded-sm border border-blue-600 bg-white'
            : 'rounded-full bg-blue-500/70',
          !corner && EDGE_MARK[position],
        )}
      />
    </span>
  );
}

function visibleClass(selected: boolean): string {
  return selected
    ? 'opacity-100'
    : 'opacity-0 transition-opacity group-hover/cell:opacity-100';
}

const HANDLE_BOX: Record<HandlePosition, string> = {
  n: 'top-[-4px] right-3 left-3 flex h-2.5 items-center justify-center',
  s: 'right-3 bottom-[-4px] left-3 flex h-2.5 items-center justify-center',
  e: 'top-3 right-[-4px] bottom-3 flex w-2.5 items-center justify-center',
  w: 'top-3 bottom-3 left-[-4px] flex w-2.5 items-center justify-center',
  ne: 'top-[-5px] right-[-5px] flex h-3.5 w-3.5 items-center justify-center',
  nw: 'top-[-5px] left-[-5px] flex h-3.5 w-3.5 items-center justify-center',
  se: 'right-[-5px] bottom-[-5px] flex h-3.5 w-3.5 items-center justify-center',
  sw: 'bottom-[-5px] left-[-5px] flex h-3.5 w-3.5 items-center justify-center',
};

const HANDLE_CURSOR: Record<HandlePosition, string> = {
  n: 'cursor-ns-resize',
  s: 'cursor-ns-resize',
  e: 'cursor-ew-resize',
  w: 'cursor-ew-resize',
  ne: 'cursor-nesw-resize',
  nw: 'cursor-nwse-resize',
  se: 'cursor-nwse-resize',
  sw: 'cursor-nesw-resize',
};

const EDGE_MARK: Record<'n' | 's' | 'e' | 'w', string> = {
  n: 'h-0.5 w-full',
  s: 'h-0.5 w-full',
  e: 'h-full w-0.5',
  w: 'h-full w-0.5',
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
