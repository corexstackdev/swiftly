import type { WidgetDsl } from '@swiftly/shared';

/**
 * Cell placement for a Grid child.
 *
 * A Grid is a CSS grid, not the page coordinate canvas. Each child occupies a
 * rectangle of cells: a start column/row and a span. Resize snaps to those
 * tracks so a control grows by whole columns and rows.
 */

export interface CellRect {
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

/** 1× / 2× / 3× from the Size panel, or inferred from the page-grid box. */
export function gridCanvasScale(
  properties: Record<string, unknown>,
  layout?: { w: number; h: number },
): number {
  const stored = Number(properties.canvasSize);
  if (stored === 1 || stored === 2 || stored === 3) return stored;
  if (layout) {
    if (layout.h >= 26) return 3;
    if (layout.w >= 18 || layout.h >= 16) return 2;
  }
  return 1;
}

/** Row track height, scaled so 2× / 3× actually grows the cells, not just the card. */
export function gridMinRowHeight(properties: Record<string, unknown>): number {
  const base = Math.max(24, Number(properties.minRowHeight ?? 72));
  return base * gridCanvasScale(properties);
}

export function cellRect(child: WidgetDsl, columns: number): CellRect {
  const colSpan = Math.max(1, Math.min(Number(child.properties.colSpan ?? 1), columns));
  const rowSpan = Math.max(1, Number(child.properties.rowSpan ?? 1));
  const col = child.properties.col === undefined ? 0 : Math.max(0, Number(child.properties.col));
  const row = child.properties.row === undefined ? 0 : Math.max(0, Number(child.properties.row));
  return {
    col: Math.min(col, Math.max(0, columns - colSpan)),
    row,
    colSpan,
    rowSpan,
  };
}

export function cellsOverlap(a: CellRect, b: CellRect): boolean {
  return a.col < b.col + b.colSpan && a.col + a.colSpan > b.col && a.row < b.row + b.rowSpan && a.row + a.rowSpan > b.row;
}

export function firstFreeCell(
  occupants: CellRect[],
  columns: number,
  colSpan: number,
  rowSpan: number,
): { col: number; row: number } {
  const span = Math.max(1, Math.min(colSpan, columns));
  const tall = Math.max(1, rowSpan);

  for (let row = 0; row < 48; row += 1) {
    for (let col = 0; col <= columns - span; col += 1) {
      const candidate = { col, row, colSpan: span, rowSpan: tall };
      if (!occupants.some((other) => cellsOverlap(other, candidate))) {
        return { col, row };
      }
    }
  }

  return { col: 0, row: occupants.reduce((max, item) => Math.max(max, item.row + item.rowSpan), 0) };
}

export function usedRowCount(children: WidgetDsl[], columns: number): number {
  if (children.length === 0) return 1;
  return Math.max(
    1,
    ...children.map((child) => {
      const rect = cellRect(child, columns);
      return rect.row + rect.rowSpan;
    }),
  );
}

/** Shortest a field may be dragged. Enough for a compact label + input. */
export const MIN_CELL_HEIGHT = 48;

export function childTrackHeight(child: WidgetDsl, minRowHeight: number): number {
  const span = Math.max(1, Number(child.properties.rowSpan ?? 1));
  const explicit = Number(child.properties.heightPx);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.max(MIN_CELL_HEIGHT, explicit);
  }
  return minRowHeight * span;
}

/**
 * Pixel height of each CSS row.
 *
 * A child can be shorter than the default track (`heightPx` from a shrink
 * drag). Each row is as tall as the tallest occupant, so a shared row stays
 * aligned and a lone field can shrink.
 */
export function rowTrackHeights(
  children: WidgetDsl[],
  columns: number,
  minRowHeight: number,
): number[] {
  const rows = usedRowCount(children, columns);
  const heights = Array.from({ length: rows }, () => 0);

  for (const child of children) {
    const rect = cellRect(child, columns);
    const perRow = childTrackHeight(child, minRowHeight) / rect.rowSpan;
    for (let row = rect.row; row < rect.row + rect.rowSpan; row += 1) {
      if (row >= 0 && row < rows) heights[row] = Math.max(heights[row] ?? 0, perRow);
    }
  }

  return heights.map((height) => (height > 0 ? height : minRowHeight));
}

export function childNeedsCellPlacement(child: WidgetDsl): boolean {
  return child.properties.col === undefined || child.properties.row === undefined;
}

/** Column/row/span to stamp on a widget dropped into a Grid. */
export function seedCellProperties(
  siblings: WidgetDsl[],
  columns: number,
  seed: Record<string, unknown> = {},
): Record<string, unknown> {
  const colSpan = Math.max(1, Math.min(Number(seed.colSpan ?? 1), columns));
  const rowSpan = Math.max(1, Number(seed.rowSpan ?? 1));
  const occupants = siblings.map((child) => cellRect(child, columns));
  const spot =
    seed.col !== undefined && seed.row !== undefined
      ? { col: Number(seed.col), row: Number(seed.row) }
      : firstFreeCell(occupants, columns, colSpan, rowSpan);

  return { ...seed, col: spot.col, row: spot.row, colSpan, rowSpan };
}

/** Assigns a free cell to any Grid child that was dropped before placement existed. */
export function placeUnpositionedGridChildren(grid: WidgetDsl): boolean {
  const children = grid.children ?? [];
  if (children.length === 0) return false;

  const columns = Math.max(1, Number(grid.properties.columns ?? 3));
  const placed: CellRect[] = [];
  let changed = false;

  for (const child of children) {
    const colSpan = Math.max(1, Math.min(Number(child.properties.colSpan ?? 1), columns));
    const rowSpan = Math.max(1, Number(child.properties.rowSpan ?? 1));

    if (!childNeedsCellPlacement(child)) {
      placed.push(cellRect(child, columns));
      continue;
    }

    const spot = firstFreeCell(placed, columns, colSpan, rowSpan);
    child.properties = { ...child.properties, col: spot.col, row: spot.row, colSpan, rowSpan };
    placed.push({ col: spot.col, row: spot.row, colSpan, rowSpan });
    changed = true;
  }

  return changed;
}

/**
 * Packs Grid children left-to-right, top-to-bottom for a new column count.
 *
 * Changing "items per row" only updates `columns`. Without this, a third field
 * stays in column 2 and either overlaps or sits outside the new track list.
 */
export function reflowGridChildren(grid: WidgetDsl, columns: number): void {
  const children = grid.children ?? [];
  const count = Math.max(1, columns);
  const placed: CellRect[] = [];

  for (const child of children) {
    const colSpan = Math.max(1, Math.min(Number(child.properties.colSpan ?? 1), count));
    const rowSpan = Math.max(1, Number(child.properties.rowSpan ?? 1));
    const spot = firstFreeCell(placed, count, colSpan, rowSpan);
    child.properties = { ...child.properties, col: spot.col, row: spot.row, colSpan, rowSpan };
    placed.push({ col: spot.col, row: spot.row, colSpan, rowSpan });
  }
}
