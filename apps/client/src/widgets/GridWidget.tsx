import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { WidgetDsl } from '@swiftly/shared';
import type { RegisteredWidget, WidgetProps } from './types';
import { spacingChromeRows, spacingToCss } from '@/editor/SpacingEditor';
import { cellRect, gridMinRowHeight, rowTrackHeights, usedRowCount } from '@/editor/gridCells';

/**
 * Grid — a CSS cell layout, not a nested page canvas.
 *
 * Children occupy column/row tracks. Resizing a control snaps to those tracks
 * (`col` / `row` / `colSpan` / `rowSpan`) instead of free-form coordinates.
 * That is what makes Grid different from Container and Form.
 */

const SHADOWS: Record<string, string> = {
  none: 'none',
  sm: '0 1px 2px rgb(15 23 42 / 0.06)',
  md: '0 2px 8px rgb(15 23 42 / 0.10)',
  lg: '0 8px 24px rgb(15 23 42 / 0.14)',
};

function useElementWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

function GridWidget({
  widget,
  properties,
  renderChild,
  children = [],
  isDesignMode,
}: WidgetProps) {
  const { ref, width } = useElementWidth();
  const columns = Math.max(1, Number(properties.columns ?? 3));
  const minColumnWidth = Math.max(1, Number(properties.minColumnWidth ?? 80));
  const columnGap = Number(properties.columnGap ?? 12);
  const rowGap = Number(properties.rowGap ?? 12);
  const minRowHeight = gridMinRowHeight(properties);
  const showGuides = isDesignMode && properties.showGuides !== false;
  const childList = children.length > 0 ? children : (widget.children ?? []);

  // Runtime can drop columns when the Grid is too narrow. Design mode always
  // keeps the authored count — otherwise span handles have nowhere to snap.
  let effectiveColumns = columns;
  if (!isDesignMode && properties.fitColumns !== false && width > 0) {
    const available = Math.max(0, width - columnGap * (columns - 1));
    effectiveColumns = Math.max(
      1,
      Math.min(columns, Math.floor((available + columnGap) / (minColumnWidth + columnGap))),
    );
  }

  const rows = usedRowCount(childList, effectiveColumns);
  const trackHeights = rowTrackHeights(childList, effectiveColumns, minRowHeight);

  const containerStyle: CSSProperties = {
    background: String(properties.background ?? '#ffffff'),
    padding: spacingToCss(properties.padding, 12),
    borderRadius: Number(properties.borderRadius ?? 6),
    borderWidth: Number(properties.borderWidth ?? 1),
    borderStyle: Number(properties.borderWidth ?? 1) > 0 ? 'solid' : 'none',
    borderColor: String(properties.borderColor ?? '#e2e8f0'),
    boxShadow: SHADOWS[String(properties.shadow ?? 'none')] ?? 'none',
  };

  return (
    <div
      ref={ref}
      style={containerStyle}
      className={clsx(
        'relative box-border flex h-full w-full flex-col',
        isDesignMode ? 'overflow-visible' : 'overflow-auto',
      )}
    >
      <div
        className="relative grid w-full"
        data-grid-layout="true"
        data-grid-columns={effectiveColumns}
        data-grid-rows={rows}
        data-grid-column-gap={columnGap}
        data-grid-row-gap={rowGap}
        data-grid-min-row-height={minRowHeight}
        data-grid-row-heights={trackHeights.join(',')}
        style={{
          gridTemplateColumns: `repeat(${effectiveColumns}, minmax(0, 1fr))`,
          // Pixel tracks so a field can be dragged shorter than the default row
          // and so spanning 2 rows still grows the control.
          gridTemplateRows: trackHeights.map((height) => `${height}px`).join(' '),
          columnGap,
          rowGap,
          alignContent: 'start',
        }}
      >
        {showGuides &&
          Array.from({ length: rows * effectiveColumns }, (_, index) => {
            const col = index % effectiveColumns;
            const row = Math.floor(index / effectiveColumns);
            return (
              <div
                key={`guide-${col}-${row}`}
                className="pointer-events-none rounded-sm"
                style={{
                  gridColumn: col + 1,
                  gridRow: row + 1,
                  zIndex: 0,
                  outline: '1px dashed color-mix(in srgb, var(--sw-color-primary, #3b82f6) 28%, transparent)',
                  outlineOffset: -1,
                }}
              />
            );
          })}

        {childList.map((child) => (
          <div
            key={child.id}
            className="relative z-[1] min-h-0 min-w-0"
            style={cellPlacementStyle(child, effectiveColumns)}
          >
            {renderChild?.(child)}
          </div>
        ))}

        {isDesignMode && childList.length === 0 && (
          <p
            className="pointer-events-none flex items-center justify-center text-[11px] text-slate-300"
            style={{ gridColumn: `1 / span ${effectiveColumns}`, gridRow: 1, zIndex: 1 }}
          >
            Drop widgets here
          </p>
        )}
      </div>
    </div>
  );
}

function cellPlacementStyle(child: WidgetDsl, columns: number): CSSProperties {
  const rect = cellRect(child, columns);
  return {
    gridColumn: `${rect.col + 1} / span ${rect.colSpan}`,
    gridRow: `${rect.row + 1} / span ${rect.rowSpan}`,
    minWidth: 0,
    minHeight: 0,
    alignSelf: 'stretch',
    justifySelf: 'stretch',
  };
}

export const gridWidget: RegisteredWidget = {
  component: GridWidget,
  chromeRows: (properties) => 1 + spacingChromeRows(properties.padding, 12),
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
            bindable: false,
            defaultValue: 3,
            helpText: 'Column tracks children snap to when resized.',
          },
          {
            key: 'minColumnWidth',
            label: 'Min column width',
            control: 'number',
            expectedType: 'number',
            bindable: false,
            defaultValue: 80,
            helpText: 'At runtime, columns drop when the Grid is narrower than this (px). Design mode always keeps the full column count.',
          },
          {
            key: 'fitColumns',
            label: 'Fit columns to width',
            control: 'toggle',
            expectedType: 'boolean',
            bindable: false,
            defaultValue: true,
          },
          {
            key: 'minRowHeight',
            label: 'Min row height',
            control: 'number',
            expectedType: 'number',
            bindable: false,
            defaultValue: 72,
            helpText: 'Each row is this tall, so spanning extra rows visibly grows the control.',
          },
          {
            key: 'columnGap',
            label: 'Column gap',
            control: 'number',
            expectedType: 'number',
            bindable: false,
            defaultValue: 12,
          },
          {
            key: 'rowGap',
            label: 'Row gap',
            control: 'number',
            expectedType: 'number',
            bindable: false,
            defaultValue: 12,
          },
          {
            key: 'showGuides',
            label: 'Show cell guides',
            control: 'toggle',
            expectedType: 'boolean',
            bindable: false,
            defaultValue: true,
            helpText: 'Dashed tracks on the canvas while designing. Hidden in preview and published apps.',
          },
        ],
      },
      {
        name: 'Spacing',
        properties: [
          { key: 'padding', label: 'Padding', control: 'spacing', expectedType: 'any', bindable: false, defaultValue: 12 },
        ],
      },
      {
        name: 'Style',
        properties: [
          { key: 'background', label: 'Background', control: 'color', expectedType: 'string', bindable: true, defaultValue: '#ffffff' },
          { key: 'borderWidth', label: 'Border width', control: 'number', expectedType: 'number', bindable: false, defaultValue: 1 },
          { key: 'borderColor', label: 'Border colour', control: 'color', expectedType: 'string', bindable: false, defaultValue: '#e2e8f0' },
          { key: 'borderRadius', label: 'Corner radius', control: 'number', expectedType: 'number', bindable: false, defaultValue: 6 },
          { key: 'shadow', label: 'Shadow', control: 'select', expectedType: 'string', bindable: false, defaultValue: 'none', options: [
            { value: 'none', label: 'None' },
            { value: 'sm', label: 'Small' },
            { value: 'md', label: 'Medium' },
            { value: 'lg', label: 'Large' },
          ] },
        ],
      },
    ],
  },
};
