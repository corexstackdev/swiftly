import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { WidgetDsl } from '@swiftly/shared';
import { MIN_CELL_HEIGHT, cellRect } from './gridCells';

/**
 * Resize handles for a widget sitting in a Grid cell.
 *
 * Width snaps to column tracks. Height is this field's own pixel box — it must
 * not steal the next row (that used to stretch the inputs below and bury their
 * handles). Row span stays what the Cell panel set.
 */

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  startCol: number;
  startRow: number;
  startColSpan: number;
  startRowSpan: number;
  columnUnit: number;
  rowUnit: number;
  minRowHeight: number;
  rowGap: number;
  columns: number;
  startHeight: number;
  cell: HTMLElement;
  grid: HTMLElement;
  originColumn: string;
  originRow: string;
  originTemplate: string;
  originHeights: string;
  startTracks: number[];
  edges: Edges;
  latest: Placement;
  move: (event: PointerEvent) => void;
  up: (event: PointerEvent) => void;
}

interface Placement {
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  heightPx: number;
}

const HEIGHT_SNAP = 4;

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
  columns = 3,
  onCommit,
  children,
}: {
  child: WidgetDsl;
  selected?: boolean;
  columns?: number;
  onCommit: (patch: Omit<Placement, 'heightPx'> & { heightPx: number | null }) => void;
  children: React.ReactNode;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [preview, setPreview] = useState<Placement | null>(null);

  useEffect(() => {
    return () => {
      const drag = dragRef.current;
      if (!drag) return;
      document.removeEventListener('pointermove', drag.move, true);
      document.removeEventListener('pointerup', drag.up, true);
      document.removeEventListener('pointercancel', drag.up, true);
    };
  }, []);

  const applyPlacement = (drag: DragState, next: Placement): void => {
    drag.cell.style.gridColumn = `${next.col + 1} / span ${next.colSpan}`;
    drag.cell.style.height = `${next.heightPx}px`;
    drag.cell.dataset.gridHeight = String(next.heightPx);
    const tracks = rowTracksFromCells(drag.grid, drag.minRowHeight, {
      cell: drag.cell,
      heightPx: next.heightPx,
    });
    drag.grid.style.gridTemplateRows = tracks.map((height) => `${height}px`).join(' ');
    drag.grid.dataset.gridRowHeights = tracks.join(',');
  };

  const placementFromPointer = (clientX: number, clientY: number, drag: DragState): Placement => {
    const next: Placement = {
      col: drag.startCol,
      row: drag.startRow,
      colSpan: drag.startColSpan,
      rowSpan: drag.startRowSpan,
      heightPx: drag.startHeight,
    };

    if (drag.edges.e && drag.columnUnit > 0) {
      next.colSpan = clamp(
        drag.startColSpan + Math.round((clientX - drag.startX) / drag.columnUnit),
        1,
        drag.columns - drag.startCol,
      );
    }

    if (drag.edges.w && drag.columnUnit > 0) {
      const delta = Math.round((drag.startX - clientX) / drag.columnUnit);
      next.col = clamp(drag.startCol - delta, 0, drag.startCol + drag.startColSpan - 1);
      next.colSpan = drag.startColSpan + (drag.startCol - next.col);
    }

    if ((drag.edges.s || drag.edges.n) && drag.rowUnit > 0) {
      const signed = drag.edges.s ? clientY - drag.startY : drag.startY - clientY;
      next.heightPx = snapHeight(Math.max(MIN_CELL_HEIGHT, drag.startHeight + signed));
    }

    return next;
  };

  const finish = (): void => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;

    document.removeEventListener('pointermove', drag.move, true);
    document.removeEventListener('pointerup', drag.up, true);
    document.removeEventListener('pointercancel', drag.up, true);

    const current = drag.latest;
    const changed =
      current.col !== drag.startCol ||
      current.row !== drag.startRow ||
      current.colSpan !== drag.startColSpan ||
      current.rowSpan !== drag.startRowSpan ||
      Math.abs(current.heightPx - drag.startHeight) >= HEIGHT_SNAP;
    if (changed) {
      const heightPx =
        Math.abs(current.heightPx - current.rowSpan * drag.minRowHeight) <= HEIGHT_SNAP
          ? null
          : current.heightPx;
      onCommit({ ...current, heightPx });
    } else {
      drag.cell.style.gridColumn = drag.originColumn;
      drag.cell.style.gridRow = drag.originRow;
      drag.cell.style.height = `${drag.startHeight}px`;
      drag.cell.dataset.gridHeight = String(drag.startHeight);
      drag.grid.style.gridTemplateRows = drag.originTemplate;
      drag.grid.dataset.gridRowHeights = drag.originHeights;
    }
    setPreview(null);
  };

  const begin = (event: React.PointerEvent, edges: Edges): void => {
    event.preventDefault();
    event.stopPropagation();

    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    let cell: HTMLElement = wrapper;
    let grid: HTMLElement | null = null;
    for (let node = wrapper.parentElement; node; node = node.parentElement) {
      if (node.dataset.gridLayout === 'true') {
        grid = node;
        break;
      }
      cell = node;
    }
    if (!grid) return;

    const gridColumns = Math.max(1, Number(grid.dataset.gridColumns ?? columns));
    const columnGap = Number(grid.dataset.gridColumnGap ?? 0);
    const rowGap = Number(grid.dataset.gridRowGap ?? 0);
    const minRowHeight = Number(grid.dataset.gridMinRowHeight ?? 72);
    const start = cellRect(child, gridColumns);
    const gridWidth = grid.getBoundingClientRect().width;
    const columnTrack = Math.max(1, (gridWidth - columnGap * (gridColumns - 1)) / gridColumns);
    const startTracks = parseRowHeights(
      grid.dataset.gridRowHeights,
      minRowHeight,
      start.row + start.rowSpan,
    );
    const startHeight = Math.max(
      MIN_CELL_HEIGHT,
      Number(cell.dataset.gridHeight) ||
        cell.getBoundingClientRect().height ||
        startTracks.slice(start.row, start.row + start.rowSpan).reduce((total, height) => total + height, 0),
    );

    const move = (moveEvent: PointerEvent): void => {
      const drag = dragRef.current;
      if (!drag || moveEvent.pointerId !== drag.pointerId) return;
      const next = placementFromPointer(moveEvent.clientX, moveEvent.clientY, drag);
      drag.latest = next;
      applyPlacement(drag, next);
      setPreview(next);
    };

    const up = (upEvent: PointerEvent): void => {
      const drag = dragRef.current;
      if (!drag || upEvent.pointerId !== drag.pointerId) return;
      finish();
    };

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startCol: start.col,
      startRow: start.row,
      startColSpan: start.colSpan,
      startRowSpan: start.rowSpan,
      columnUnit: columnTrack + columnGap,
      rowUnit: minRowHeight + rowGap,
      minRowHeight,
      rowGap,
      columns: gridColumns,
      startHeight,
      cell,
      grid,
      originColumn: cell.style.gridColumn,
      originRow: cell.style.gridRow,
      originTemplate: grid.style.gridTemplateRows,
      originHeights: grid.dataset.gridRowHeights ?? startTracks.join(','),
      startTracks,
      edges,
      latest: { ...start, heightPx: startHeight },
      move,
      up,
    };

    setPreview({ ...start, heightPx: startHeight });
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // Synthetic tests and some browsers reject capture; document listeners still drive the drag.
    }
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
  };

  const onHandlePointerMove = (event: React.PointerEvent): void => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    const next = placementFromPointer(event.clientX, event.clientY, drag);
    drag.latest = next;
    applyPlacement(drag, next);
    setPreview(next);
  };

  const onHandlePointerUp = (event: React.PointerEvent): void => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    finish();
  };

  return (
    <div ref={wrapperRef} className="relative h-full w-full">
      <div className="h-full w-full overflow-hidden">{children}</div>

      {HANDLES.map((handle) => (
        <Handle
          key={handle.position}
          position={handle.position}
          selected={selected}
          onPointerDown={(event) => begin(event, handle.edges)}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
        />
      ))}

      {preview && (
        <span className="pointer-events-none absolute right-1 bottom-1 z-30 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums">
          {preview.colSpan} × {Math.round(preview.heightPx)}px
        </span>
      )}
    </div>
  );
}

function Handle({
  position,
  selected,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  position: HandlePosition;
  selected: boolean;
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
}) {
  const corner = position.length === 2;

  return (
    <span
      role={selected ? 'slider' : undefined}
      aria-label={selected ? `Resize ${position}` : undefined}
      aria-hidden={!selected}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(event) => event.stopPropagation()}
      className={clsx(
        'no-drag absolute z-50 touch-none',
        visibleClass(selected),
        HANDLE_BOX[position],
        HANDLE_CURSOR[position],
      )}
    >
      <span
        className={clsx(
          'block',
          corner
            ? 'h-2.5 w-2.5 rounded-sm border-2 border-blue-600 bg-white shadow-sm'
            : 'rounded-full bg-blue-500',
          !corner && EDGE_MARK[position as 'n' | 's' | 'e' | 'w'],
        )}
      />
    </span>
  );
}

function visibleClass(selected: boolean): string {
  return selected
    ? 'pointer-events-auto opacity-100'
    : 'pointer-events-none opacity-0 transition-opacity group-hover/cell:pointer-events-auto group-hover/cell:opacity-100';
}

const HANDLE_BOX: Record<HandlePosition, string> = {
  n: 'top-[-6px] right-4 left-4 flex h-3.5 items-center justify-center',
  s: 'right-4 bottom-[-6px] left-4 flex h-3.5 items-center justify-center',
  e: 'top-4 right-[-6px] bottom-4 flex w-3.5 items-center justify-center',
  w: 'top-4 bottom-4 left-[-6px] flex w-3.5 items-center justify-center',
  ne: 'top-[-7px] right-[-7px] flex h-4 w-4 items-center justify-center',
  nw: 'top-[-7px] left-[-7px] flex h-4 w-4 items-center justify-center',
  se: 'right-[-7px] bottom-[-7px] flex h-4 w-4 items-center justify-center',
  sw: 'bottom-[-7px] left-[-7px] flex h-4 w-4 items-center justify-center',
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
  n: 'h-1 w-full',
  s: 'h-1 w-full',
  e: 'h-full w-1',
  w: 'h-full w-1',
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function snapHeight(value: number): number {
  return Math.max(MIN_CELL_HEIGHT, Math.round(value / HEIGHT_SNAP) * HEIGHT_SNAP);
}

function rowTracksFromCells(
  grid: HTMLElement,
  minRowHeight: number,
  override: { cell: HTMLElement; heightPx: number },
): number[] {
  const rowCount = Math.max(1, Number(grid.dataset.gridRows ?? 1));
  const heights = Array.from({ length: rowCount }, () => 0);
  const cells = grid.querySelectorAll<HTMLElement>(':scope > [data-grid-row]');
  cells.forEach((element) => {
    const row = Number(element.dataset.gridRow);
    const span = Math.max(1, Number(element.dataset.gridRowSpan ?? 1));
    const total =
      element === override.cell
        ? override.heightPx
        : Math.max(MIN_CELL_HEIGHT, Number(element.dataset.gridHeight ?? minRowHeight));
    const perRow = total / span;
    for (let index = row; index < row + span; index += 1) {
      if (index >= 0 && index < rowCount) heights[index] = Math.max(heights[index] ?? 0, perRow);
    }
  });
  return heights.map((height) => (height > 0 ? height : minRowHeight));
}

function parseRowHeights(raw: string | undefined, fallback: number, minCount: number): number[] {
  const parsed = (raw ?? '')
    .split(',')
    .map((part) => Number(part))
    .filter((height) => Number.isFinite(height) && height > 0);
  const tracks = parsed.length > 0 ? parsed : [];
  while (tracks.length < Math.max(1, minCount)) tracks.push(fallback);
  return tracks;
}
