import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import GridLayout, { type Layout } from 'react-grid-layout';
import clsx from 'clsx';
import type { PageDsl, WidgetDsl } from '@vinodapp/shared';
import { getWidget, getWidgetDefinition } from '@/widgets/registry';
import { requiredContainerHeight } from './widgetOps';
import { GRID_COLUMNS, GRID_ROW_HEIGHT, GRID_GAP, runtimeHost } from '@/runtime/PageRenderer';
import { GridChildResizer } from './GridChildResizer';
import type { AppRuntime } from '@/runtime/useAppRuntime';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

/**
 * The design canvas.
 *
 * Containers are real drop targets, so the canvas is recursive: every container
 * renders its own grid and children are positioned within it, at any depth. The
 * alternative — a flat canvas where nesting only exists in the DSL — means the
 * layout a builder sees while designing is not the layout the runtime produces.
 *
 * Nesting react-grid-layout has one catch: a drag inside a child grid would also
 * drag the parent. A container's child area is therefore marked `.nested-canvas`,
 * which the parent grid lists in `draggableCancel`, and the container is moved by
 * its name label instead.
 */

export interface CanvasHandlers {
  selectedWidgetId: string | null;
  onSelect: (widgetId: string | null) => void;
  /** `parentId` is null for the page root, otherwise the container's widget id. */
  onLayoutChange: (parentId: string | null, layouts: Layout[]) => void;
  onDropWidget: (parentId: string | null, type: string, position: { x: number; y: number }) => void;
  /** Adds a child to a container that positions children itself, e.g. a Grid. */
  onDropIntoContainer: (
    parentId: string,
    type: string,
    seedProperties?: Record<string, unknown>,
  ) => void;
  /** Writes properties onto a widget, for direct manipulation such as a cell resize. */
  onUpdateProperties: (widgetId: string, patch: Record<string, unknown>) => void;
}

/**
 * Every edge and corner, not just the bottom-right. A builder reaching for the top
 * edge to shrink a widget should not find a dead zone there.
 */
const RESIZE_HANDLES: ('s' | 'w' | 'e' | 'n' | 'sw' | 'nw' | 'se' | 'ne')[] = [
  's',
  'w',
  'e',
  'n',
  'sw',
  'nw',
  'se',
  'ne',
];

/**
 * Measures an element's real content width.
 *
 * A nested grid's width cannot be derived from grid arithmetic: the container
 * widget draws its own border and padding, and the inner grid adds its own, so a
 * computed width is always a few pixels too generous. Those pixels put the
 * right-hand resize handles of child widgets outside the visible box, where they
 * cannot be grabbed at all.
 */
function useMeasuredWidth(): [(node: HTMLDivElement | null) => void, number | null] {
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

export function Canvas({
  page,
  runtime,
  width,
  handlers,
  fitVersion,
}: {
  page: PageDsl;
  runtime: AppRuntime;
  width: number;
  handlers: CanvasHandlers;
  /** Changes when a container height was corrected; forces the grids to re-read. */
  fitVersion: number;
}) {
  return (
    <div
      className="min-h-full bg-white"
      onClick={() => handlers.onSelect(null)}
      onDragOver={(event) => event.preventDefault()}
    >
      <CanvasGrid
        widgets={page.widgets}
        parentId={null}
        runtime={runtime}
        width={width}
        handlers={handlers}
        depth={0}
        fitVersion={fitVersion}
      />

      {page.widgets.length === 0 && (
        <div className="flex h-96 flex-col items-center justify-center gap-1 text-center">
          <p className="text-sm font-medium text-slate-500">This page is empty</p>
          <p className="text-xs text-slate-400">
            Drag a widget from the left panel to start building
          </p>
        </div>
      )}
    </div>
  );
}

function CanvasGrid({
  widgets,
  parentId,
  runtime,
  width,
  handlers,
  depth,
  fitVersion,
}: {
  widgets: WidgetDsl[];
  parentId: string | null;
  runtime: AppRuntime;
  width: number;
  handlers: CanvasHandlers;
  depth: number;
  fitVersion: number;
}) {
  const layout = useMemo<Layout[]>(
    () =>
      widgets.map((widget) => {
        const definition = getWidgetDefinition(widget.type);
        const floor = definition?.minSize.h ?? 1;

        /*
         * A container's floor is whatever its contents need.
         *
         * Correcting the height afterwards does not work: react-grid-layout owns
         * the layout during a gesture and echoes its own copy back, so a
         * correction is overwritten and the two oscillate. Expressing the limit
         * as `minH` puts it inside the gesture instead — the grid stops the drag
         * at the right place, which is both smooth and stable.
         */
        const minH = definition?.isContainer
          ? Math.max(floor, requiredContainerHeight(widget))
          : floor;

        return {
          i: widget.id,
          x: widget.layout.x,
          y: widget.layout.y,
          // A container that already holds more than its stored height can show
          // is corrected here too, so the grid never renders a clipped state.
          h: Math.max(widget.layout.h, minH),
          w: widget.layout.w,
          minW: definition?.minSize.w ?? 1,
          minH,
        };
      }),
    [widgets],
  );

  return (
    <GridLayout
      key={`grid-${fitVersion}`}
      className={depth === 0 ? 'min-h-[600px]' : 'min-h-full'}
      layout={layout}
      cols={GRID_COLUMNS}
      rowHeight={GRID_ROW_HEIGHT}
      width={Math.max(width, 120)}
      margin={[GRID_GAP, GRID_GAP]}
      containerPadding={[GRID_GAP, GRID_GAP]}
      /*
       * Widgets settle upwards.
       *
       * With free positioning a nudge that overlaps a neighbour pushes it down,
       * and because nothing ever floats back the gap it leaves is permanent —
       * two containers could be left with a screen of dead space between them
       * after a movement of a few pixels. Vertical compaction makes the push
       * reversible: move the widget away and the layout closes up behind it.
       *
       * The cost is that a deliberate vertical gap cannot be left by dragging a
       * widget down the page; whitespace comes from a widget's own height or a
       * spacer. That is the trade every grid builder of this kind makes, and it
       * is worth it for a layout that cannot be left in a broken state.
       */
      compactType="vertical"
      /*
       * Collisions push neighbours aside rather than cancelling the gesture.
       * With `preventCollision` on, react-grid-layout rejects any resize that
       * would overlap and snaps the widget back with no feedback — so growing a
       * widget worked in open space and silently failed anywhere crowded, which
       * reads as the handle being broken.
       */
      preventCollision={false}
      isDroppable
      droppingItem={{ i: '__dropping__', w: 4, h: 2 }}
      onDrop={(_layout, item, event) => {
        const type = (event as unknown as DragEvent).dataTransfer?.getData('widget/type');
        if (type) handlers.onDropWidget(parentId, type, { x: item.x, y: item.y });
      }}
      onLayoutChange={(next) => handlers.onLayoutChange(parentId, next)}
      // `.nested-canvas` is a child container's grid: without it, dragging a child
      // would drag its parent too.
      draggableCancel=".no-drag, .nested-canvas"
      resizeHandles={RESIZE_HANDLES}
    >
      {widgets.map((widget) => (
        <div
          key={widget.id}
          onClick={(event) => {
            event.stopPropagation();
            handlers.onSelect(widget.id);
          }}
          className={clsx(
            'group relative rounded outline-offset-2 transition-shadow',
            handlers.selectedWidgetId === widget.id
              ? 'is-selected outline-2 outline-blue-500'
              : 'hover:outline hover:outline-1 hover:outline-blue-300',
          )}
        >
          <WidgetLabel
            widget={widget}
            selected={handlers.selectedWidgetId === widget.id}
            isContainer={getWidgetDefinition(widget.type)?.isContainer ?? false}
          />
          <DesignWidget
            widget={widget}
            runtime={runtime}
            handlers={handlers}
            depth={depth}
            fitVersion={fitVersion}
          />
        </div>
      ))}
    </GridLayout>
  );
}

/**
 * Renders one widget on the canvas. Containers host a nested grid; everything else
 * renders through the same host the runtime uses.
 */
function DesignWidget({
  widget,
  runtime,
  handlers,
  depth,
  fitVersion,
}: {
  widget: WidgetDsl;
  runtime: AppRuntime;
  handlers: CanvasHandlers;
  depth: number;
  fitVersion: number;
}) {
  const registered = getWidget(widget.type);
  const isContainer = registered?.definition.isContainer ?? false;
  const [innerRef, innerWidth] = useMeasuredWidth();

  if (!registered) {
    return (
      <div className="flex h-full items-center justify-center rounded border border-dashed border-amber-300 bg-amber-50 p-2 text-xs text-amber-700">
        Unknown widget type “{widget.type}”
      </div>
    );
  }

  const Component = registered.component;
  const shared = {
    widget,
    properties: runtime.properties(widget.name),
    state: runtime.widgetState[widget.name] ?? {},
    setState: (patch: Record<string, unknown>) => runtime.setWidgetState(widget.name, patch),
    fireEvent: (event: string, payload?: Record<string, unknown>) =>
      runtime.fireEvent(widget.name, event, payload),
    isDesignMode: true as const,
    host: {
      ...runtimeHost(runtime),
      dropIntoContainer: handlers.onDropIntoContainer,
    },
  };

  if (!isContainer) {
    return (
      <div className="h-full w-full">
        <Component {...shared} />
      </div>
    );
  }

  /*
   * No drag strip inside the box. It used to sit in the flow above the container's
   * body, which meant the body was a row shorter than the grid thought it was —
   * so the last row of children fell below the fold and the container scrolled.
   * The name label above the widget is the grip instead; it is positioned outside
   * the item's flow, so the body gets the full height the grid allocated.
   */
  /*
   * A cell-positioned container lays its own children out, so the canvas hands it
   * one renderer per child instead of a nested coordinate grid. Selection and the
   * name badge still come from here — what changes is who decides the position.
   */
  if (registered.definition.childLayout === 'cells') {
    return (
      <div className="nested-canvas h-full w-full" onClick={(event) => event.stopPropagation()}>
        <Component
          {...shared}
          children={widget.children ?? []}
          renderChild={(child) => (
            <DesignChild
              child={child}
              runtime={runtime}
              handlers={handlers}
              depth={depth}
              fitVersion={fitVersion}
            />
          )}
        />
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <div className="h-full w-full">
        <Component
          {...shared}
          renderChildren={(filter) => (
            <div
              ref={innerRef}
              className="nested-canvas h-full min-h-20 w-full"
              onClick={(event) => event.stopPropagation()}
              onDragOver={(event) => event.preventDefault()}
            >
              {/* Held back until measured: rendering at a guessed width first would
                  lay children out, then shift them, which loses an in-flight drag. */}
              {innerWidth !== null && (
                <CanvasGrid
                  widgets={filter ? (widget.children ?? []).filter(filter) : (widget.children ?? [])}
                  parentId={widget.id}
                  runtime={runtime}
                  width={innerWidth}
                  handlers={handlers}
                  depth={depth + 1}
                  fitVersion={fitVersion}
                />
              )}

              {(widget.children ?? []).length === 0 && (
                <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-slate-300">
                  Drop widgets here
                </p>
              )}
            </div>
          )}
        />
      </div>
    </div>
  );
}

/**
 * One child of a cell-positioned container: the widget, plus the selection chrome
 * the canvas would otherwise add through the grid.
 */
function DesignChild({
  child,
  runtime,
  handlers,
  depth,
  fitVersion,
}: {
  child: WidgetDsl;
  runtime: AppRuntime;
  handlers: CanvasHandlers;
  depth: number;
  fitVersion: number;
}) {
  const isSelected = handlers.selectedWidgetId === child.id;

  return (
    <div
      onClick={(event) => {
        event.stopPropagation();
        handlers.onSelect(child.id);
      }}
      className={clsx(
        'group/cell group relative h-full w-full rounded outline-offset-2',
        isSelected ? 'outline-2 outline-blue-500' : 'hover:outline hover:outline-1 hover:outline-blue-300',
      )}
    >
      <WidgetLabel
        widget={child}
        selected={isSelected}
        isContainer={getWidgetDefinition(child.type)?.isContainer ?? false}
      />
      <GridChildResizer
        child={child}
        onCommit={(patch) => handlers.onUpdateProperties(child.id, patch)}
      >
        <DesignWidget
          widget={child}
          runtime={runtime}
          handlers={handlers}
          depth={depth + 1}
          fitVersion={fitVersion}
        />
      </GridChildResizer>
    </div>
  );
}

function WidgetLabel({
  widget,
  selected,
  isContainer,
}: {
  widget: WidgetDsl;
  selected: boolean;
  isContainer: boolean;
}) {
  return (
    <span
      className={clsx(
        'absolute -top-5 left-0 z-20 flex items-center gap-1 rounded-t px-1.5 py-0.5 text-[10px] font-medium text-white',
        selected ? 'bg-blue-500 opacity-100' : 'bg-blue-400 opacity-0 group-hover:opacity-80',
        // A container's body is a drop target, so this label is the only place
        // left to grab the container itself — it stays visible for that reason.
        isContainer && 'cursor-grab opacity-80 active:cursor-grabbing',
      )}
    >
      {isContainer && <span className="text-[9px] opacity-70">⠿</span>}
      {widget.name}
    </span>
  );
}

export { GRID_COLUMNS, GRID_ROW_HEIGHT, GRID_GAP };
