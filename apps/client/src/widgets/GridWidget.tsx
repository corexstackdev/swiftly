import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { WidgetDsl } from '@swiftly/shared';
import type { RegisteredWidget, WidgetProps } from './types';
import { spacingToCss } from '@/editor/SpacingEditor';
import { acceptPaletteDrag, peekPaletteType, takePaletteDrop } from '@/editor/paletteDrag';

/**
 * Grid — a container whose children occupy cells rather than coordinates.
 *
 * The Container gives each child a free position on its own canvas, which is
 * precise but frozen: the layout means the same thing at every width, so it
 * cannot reflow. A Grid instead owns the arrangement — the builder says how many
 * columns there should be and how narrow a column may get, and the children fall
 * into place.
 *
 * Responsiveness is measured, not declared in media queries. The grid observes
 * its own width and drops columns as the space shrinks, so it behaves the same
 * whether it is the full page, half of a split, or nested three deep inside
 * other containers — none of which a viewport media query can see.
 */

const SHADOWS: Record<string, string> = {
  none: 'none',
  sm: '0 1px 2px rgb(15 23 42 / 0.06)',
  md: '0 2px 8px rgb(15 23 42 / 0.10)',
  lg: '0 8px 24px rgb(15 23 42 / 0.14)',
};

function useElementWidth(): [(node: HTMLDivElement | null) => void, number | null] {
  const [width, setWidth] = useState<number | null>(null);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const apply = useCallback((next: number) => {
    // Only on a real change, or this loops: setting state re-renders, which
    // measures again.
    setWidth((current) => (current === next ? current : next));
  }, []);

  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      nodeRef.current = node;
      if (!node) return;

      apply(node.clientWidth);

      // Attach and detach live in the ref callback rather than an effect
      // cleanup: StrictMode runs effects mount-cleanup-mount, and a cleanup
      // would tear the observer down without the ref callback — whose identity
      // never changes — ever being called again to rebuild it.
      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(() => apply(node.clientWidth));
        observer.observe(node);
        observerRef.current = observer;
      }
    },
    [apply],
  );

  /*
   * Measured again after every render, not only when the observer reports.
   *
   * Most size changes here arrive with a render anyway — the widget was resized,
   * a panel folded, a parent reflowed — and measuring then costs one layout read.
   * It also means the layout still adapts where ResizeObserver is unavailable or
   * silent, instead of freezing at whatever width it happened to mount with.
   */
  useLayoutEffect(() => {
    if (nodeRef.current) apply(nodeRef.current.clientWidth);
  });

  return [ref, width];
}

/**
 * How many columns actually fit.
 *
 * `columns` is a ceiling rather than a promise: a three-column grid squeezed into
 * a narrow container becomes two, then one, instead of producing three unusably
 * thin cells. `minColumnWidth` is the knob that decides when that happens.
 */
export function fitColumns(
  available: number | null,
  columns: number,
  minColumnWidth: number,
  gap: number,
): number {
  if (available === null || available <= 0) return columns;
  if (minColumnWidth <= 0) return columns;

  const fits = Math.floor((available + gap) / (minColumnWidth + gap));
  return Math.max(1, Math.min(columns, fits));
}

function GridWidget({ properties, children = [], renderChild, isDesignMode, host, widget }: WidgetProps) {
  const [ref, width] = useElementWidth();
  const [isDropTarget, setIsDropTarget] = useState(false);

  const columns = Math.max(1, Number(properties.columns ?? 3));
  const minColumnWidth = Math.max(0, Number(properties.minColumnWidth ?? 200));
  const columnGap = Number(properties.columnGap ?? 12);
  const rowGap = Number(properties.rowGap ?? 12);

  const effectiveColumns = fitColumns(width, columns, minColumnWidth, columnGap);
  const collapsed = effectiveColumns < columns;

  const rowMode = String(properties.rowMode ?? 'auto');
  const rows = Math.max(1, Number(properties.rows ?? 2));
  const minRowHeight = Number(properties.minRowHeight ?? 36);

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${effectiveColumns}, minmax(0, 1fr))`,
    // 'auto' lets a row be as tall as its tallest child; 'fixed' divides the
    // height evenly, which is what makes a tile wall line up.
    gridTemplateRows:
      rowMode === 'fixed'
        ? `repeat(${rows}, minmax(${minRowHeight}px, 1fr))`
        : `repeat(auto-fit, minmax(${minRowHeight}px, auto))`,
    gridAutoRows: rowMode === 'fixed' ? undefined : `minmax(${minRowHeight}px, auto)`,
    columnGap,
    rowGap,
    alignItems: String(properties.alignItems ?? 'stretch') as React.CSSProperties['alignItems'],
    justifyItems: String(properties.justifyItems ?? 'stretch') as React.CSSProperties['justifyItems'],
    height: rowMode === 'fixed' ? '100%' : undefined,
  };

  const containerStyle: React.CSSProperties = {
    background: String(properties.background ?? 'transparent'),
    padding: spacingToCss(properties.padding, 12),
    borderRadius: Number(properties.borderRadius ?? 6),
    borderWidth: Number(properties.borderWidth ?? 1),
    borderStyle: Number(properties.borderWidth ?? 1) > 0 ? 'solid' : 'none',
    borderColor: String(properties.borderColor ?? '#e2e8f0'),
    boxShadow: SHADOWS[String(properties.shadow ?? 'none')] ?? 'none',
  };

  const canDrop = isDesignMode && Boolean(host.dropIntoContainer);

  /*
   * Cell guides are an editing aid, so they are design-only: preview and the
   * published app render the same grid without them. `showGuides` turns them off
   * for a builder who would rather see the layout clean.
   */
  const showGuides = isDesignMode && properties.showGuides !== false;

  // Slots the children take up, spans included and clamped the same way the cells
  // are, so the count cannot drift from what is actually rendered.
  const occupiedSlots = children.reduce((total, child) => {
    const colSpan = Math.max(1, Math.min(Number(child.properties.colSpan ?? 1), effectiveColumns));
    const rowSpan = Math.max(1, Number(child.properties.rowSpan ?? 1));
    return total + colSpan * rowSpan;
  }, 0);

  const totalSlots =
    rowMode === 'fixed'
      ? rows * effectiveColumns
      : // An empty auto-row grid still shows one row of guides, so its shape is
        // visible before anything has been dropped into it.
        Math.max(Math.ceil(occupiedSlots / effectiveColumns), 1) * effectiveColumns;

  const fillerCount = showGuides ? Math.max(0, totalSlots - occupiedSlots) : 0;

  return (
    <div
      ref={ref}
      style={containerStyle}
      className={clsx(
        'h-full w-full',
        isDesignMode ? 'overflow-visible' : 'overflow-auto',
        isDropTarget && 'outline-2 outline-offset-[-2px] outline-blue-500',
      )}
      onDragOver={
        canDrop
          ? (event) => {
              if (!acceptPaletteDrag(event)) return;
              event.stopPropagation();
              setIsDropTarget(true);
            }
          : undefined
      }
      onDragLeave={canDrop ? () => setIsDropTarget(false) : undefined}
      onDrop={
        canDrop
          ? (event) => {
              const type = takePaletteDrop(event) ?? peekPaletteType();
              setIsDropTarget(false);
              if (type) host.dropIntoContainer?.(widget.id, type, { colSpan: 1, rowSpan: 1 });
            }
          : undefined
      }
    >
      <div style={gridStyle}>
        {children.map((child) => (
          <div
            key={child.id}
            style={cellStyle(child, effectiveColumns)}
            className={clsx(
              'min-w-0 h-full min-h-0',
              showGuides && 'rounded-sm outline-1 outline-dashed outline-slate-300',
            )}
          >
            {renderChild?.(child)}
          </div>
        ))}

        {/* Fillers complete the last row, and every empty slot when the row count
            is fixed. They flow through the same grid as the children, so the
            guides line up by construction rather than by a second calculation
            that could disagree with the first. */}
        {showGuides &&
          Array.from({ length: fillerCount }, (_, index) => (
            <div
              key={`guide-${index}`}
              aria-hidden="true"
              className="pointer-events-none rounded-sm outline-1 outline-dashed outline-slate-300"
            />
          ))}
      </div>

      {children.length === 0 && isDesignMode && (
        <p className="pointer-events-none mt-2 text-center text-[11px] text-slate-400">
          Drop widgets here
        </p>
      )}

      {isDesignMode && collapsed && children.length > 0 && (
        // Says why the layout looks different from the configuration, so a
        // collapsed grid does not read as a bug.
        <p className="mt-1 text-[10px] text-amber-600">
          Showing {effectiveColumns} of {columns} columns — the container is too narrow for
          {' '}
          {columns} × {minColumnWidth}px
        </p>
      )}
    </div>
  );
}

/** A child's footprint, clamped so a span can never exceed the columns on offer. */
function cellStyle(child: WidgetDsl, effectiveColumns: number): React.CSSProperties {
  const colSpan = Math.max(1, Math.min(Number(child.properties.colSpan ?? 1), effectiveColumns));
  const rowSpan = Math.max(1, Number(child.properties.rowSpan ?? 1));
  const order = child.properties.order === undefined ? undefined : Number(child.properties.order);

  return {
    gridColumn: `span ${colSpan} / span ${colSpan}`,
    gridRow: `span ${rowSpan} / span ${rowSpan}`,
    order,
    minWidth: 0,
  };
}

export const gridWidget: RegisteredWidget = {
  component: GridWidget,
  definition: {
    type: 'grid',
    displayName: 'Grid',
    category: 'layout',
    icon: 'grid',
    isContainer: true,
    childLayout: 'cells',
    defaultLayout: { x: 0, y: 0, w: 12, h: 10 },
    minSize: { w: 3, h: 3 },
    events: [],
    exposedState: [],
    properties: [
      {
        name: 'Layout',
        properties: [
          {
            key: 'columns',
            label: 'Columns',
            control: 'number',
            expectedType: 'number',
            bindable: true,
            defaultValue: 3,
            helpText: 'The most columns to show. Fewer are used when space is tight.',
          },
          {
            key: 'minColumnWidth',
            label: 'Min column width',
            control: 'number',
            expectedType: 'number',
            bindable: false,
            defaultValue: 200,
            helpText: 'A column never goes below this, so the grid drops columns instead.',
          },
          {
            key: 'rowMode',
            label: 'Row height',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'auto',
          },
          {
            key: 'rows',
            label: 'Rows',
            control: 'number',
            expectedType: 'number',
            bindable: true,
            defaultValue: 2,
            visibleWhen: { key: 'rowMode', equals: 'fixed' },
          },
          {
            key: 'minRowHeight',
            label: 'Min row height',
            control: 'number',
            expectedType: 'number',
            bindable: false,
            defaultValue: 36,
            helpText: 'Floor for each row in pixels. Lower this to shrink fields by dragging.',
          },
          {
            key: 'showGuides',
            label: 'Show cell guides',
            control: 'toggle',
            expectedType: 'boolean',
            bindable: false,
            defaultValue: true,
            helpText: 'Dotted cell outlines while designing. Never shown in preview or a published app.',
          },
        ],
      },
      {
        name: 'Spacing',
        properties: [
          { key: 'columnGap', label: 'Column gap', control: 'number', expectedType: 'number', bindable: false, defaultValue: 12 },
          { key: 'rowGap', label: 'Row gap', control: 'number', expectedType: 'number', bindable: false, defaultValue: 12 },
          { key: 'padding', label: 'Padding', control: 'spacing', expectedType: 'any', bindable: false, defaultValue: 12 },
        ],
      },
      {
        name: 'Alignment',
        properties: [
          { key: 'alignItems', label: 'Vertical', control: 'select', expectedType: 'string', bindable: false, defaultValue: 'stretch' },
          { key: 'justifyItems', label: 'Horizontal', control: 'select', expectedType: 'string', bindable: false, defaultValue: 'stretch' },
        ],
      },
      {
        name: 'Style',
        properties: [
          { key: 'background', label: 'Background', control: 'color', expectedType: 'string', bindable: true, defaultValue: '#ffffff' },
          { key: 'borderWidth', label: 'Border width', control: 'number', expectedType: 'number', bindable: false, defaultValue: 1 },
          { key: 'borderColor', label: 'Border colour', control: 'color', expectedType: 'string', bindable: false, defaultValue: '#e2e8f0' },
          { key: 'borderRadius', label: 'Corner radius', control: 'number', expectedType: 'number', bindable: false, defaultValue: 6 },
          { key: 'shadow', label: 'Shadow', control: 'select', expectedType: 'string', bindable: false, defaultValue: 'none' },
        ],
      },
    ],
  },
  // Padding plus a row of breathing room; the grid sizes its own rows from there.
  chromeRows: () => 2,
};
