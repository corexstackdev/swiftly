import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import GridLayout, { type Layout } from 'react-grid-layout';
import clsx from 'clsx';
import type { ActionDsl, PageDsl, PageLayoutId, WidgetDsl } from '@swiftly/shared';
import { getWidget, getWidgetDefinition } from '@/widgets/registry';
import { placesOwnChildren, requiredContainerHeight } from './widgetOps';
import { GRID_COLUMNS, GRID_ROW_HEIGHT, GRID_GAP, runtimeHost } from '@/runtime/PageRenderer';
import { GridChildResizer } from './GridChildResizer';
import { PageLayoutPicker } from './LayoutOptions';
import { acceptPaletteDrag, dropParentId, dropSeed, takePaletteDrop } from './paletteDrag';
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
 * drag the parent. A container's child area is therefore marked `.nested-canvas`.
 * Every grid cancels that class (react-draggable only walks up to the item, so a
 * grid's own wrapping canvas is not in the walk) and the nested canvas stops
 * mousedown from reaching ancestor grids. The container is moved by its name
 * label instead.
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
  onDelete: (widgetId: string) => void;
  /** Generate form fields from a database table. */
  onImportFormFromTable?: (formWidgetId: string) => void;
  /** Applies a starting layout to an empty page. */
  onApplyPageLayout?: (layout: PageLayoutId) => void;
}

/**
 * Every edge and corner, not just the bottom-right. A builder reaching for the top
 * edge to shrink a widget should not find a dead zone there.
 */
/**
 * Extra top/bottom inset on the page grid only.
 * Widget name badges sit 20px above the item; without this they collide with
 * the editor header when a container is dragged to the first row.
 */
const PAGE_GRID_PADDING_Y = 28;

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

/** Keep a nested drag from also moving the Container / Modal that wraps this grid. */
function stopNestedCanvasPointer(event: React.MouseEvent): void {
  event.stopPropagation();
}

/** Clicking empty canvas must drop both the blue selection and the caret in a field. */
function deselectCanvas(handlers: CanvasHandlers): void {
  handlers.onSelect(null);
  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    active.closest('.react-grid-layout, .nested-canvas')
  ) {
    active.blur();
  }
}

function layoutDiffered(current: Layout[], next: Layout[]): boolean {
  const incoming = new Map(
    next.filter((item) => item.i !== '__dropping__').map((item) => [item.i, item]),
  );
  if (incoming.size !== current.length) return true;
  return current.some((item) => {
    const other = incoming.get(item.i);
    if (!other) return true;
    return other.x !== item.x || other.y !== item.y || other.w !== item.w || other.h !== item.h;
  });
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
      onClick={() => deselectCanvas(handlers)}
      onDragOver={(event) => acceptPaletteDrag(event)}
      onDrop={(event) => {
        const type = takePaletteDrop(event);
        if (!type) return;
        handlers.onDropWidget(dropParentId(event), type, { x: 0, y: 0 });
      }}
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
        <div
          className="pointer-events-none flex min-h-96 flex-col items-center justify-center px-6 py-10 text-center"
          onClick={(event) => event.stopPropagation()}
        >
          <p className="text-sm font-medium text-slate-700">Choose a page layout</p>
          <p className="mt-1 max-w-md text-xs text-slate-400">
            Or drag a widget from the left panel onto the page.
          </p>
          {handlers.onApplyPageLayout && (
            <div className="pointer-events-auto mt-5 w-full max-w-xl text-left">
              <PageLayoutPicker includeBlank={false} onSelect={handlers.onApplyPageLayout} />
            </div>
          )}
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

  const draggingRef = useRef(false);
  const skipLayoutEchoRef = useRef(false);
  const lastFitVersion = useRef(fitVersion);
  if (lastFitVersion.current !== fitVersion) {
    lastFitVersion.current = fitVersion;
    skipLayoutEchoRef.current = true;
  }

  const commitLayout = useCallback(
    (next: Layout[]) => {
      handlers.onLayoutChange(
        parentId,
        next.filter((item) => item.i !== '__dropping__'),
      );
    },
    [handlers, parentId],
  );

  const clearIfBackground = (event: React.MouseEvent): void => {
    const item = (event.target as HTMLElement).closest('.react-grid-item');
    if (item && event.currentTarget.contains(item)) return;
    deselectCanvas(handlers);
  };

  return (
    <div
      className={depth === 0 ? 'min-h-[600px]' : 'h-full min-h-full'}
      onMouseDown={clearIfBackground}
    >
    <GridLayout
      key={`grid-${fitVersion}`}
      className="h-full min-h-full"
      layout={layout}
      cols={GRID_COLUMNS}
      rowHeight={GRID_ROW_HEIGHT}
      width={Math.max(width, 120)}
      margin={[GRID_GAP, GRID_GAP]}
      containerPadding={
        depth === 0 ? [GRID_GAP, PAGE_GRID_PADDING_Y] : [GRID_GAP, PAGE_GRID_PADDING_Y]
      }
      /*
       * Free placement. Vertical compaction packed every widget to the top of
       * the page or its container as soon as one moved, so containers and the
       * controls inside them rode over each other. Gaps stay where the builder
       * left them; a collision still pushes the neighbour aside.
       */
      compactType={null}
      preventCollision={false}
      allowOverlap={false}
      isDroppable={false}
      onDragStart={() => {
        draggingRef.current = true;
        skipLayoutEchoRef.current = false;
      }}
      onResizeStart={() => {
        draggingRef.current = true;
        skipLayoutEchoRef.current = false;
      }}
      onDragStop={(next) => {
        draggingRef.current = false;
        commitLayout(next);
      }}
      onResizeStop={(next) => {
        draggingRef.current = false;
        commitLayout(next);
      }}
      onLayoutChange={(next) => {
        // During a gesture the grid already owns the pixels. Writing those
        // in-flight positions back into the document re-renders this grid with a
        // new `layout` prop, which snaps the item to the origin and stacks it
        // on its siblings.
        if (draggingRef.current) return;
        // A remount after a property-panel size change echoes the previous
        // internal layout once. Taking that echo would undo 2× / 3×.
        if (skipLayoutEchoRef.current) {
          // Keep ignoring until RGL reports the size we just authored. Clearing
          // on the first callback lets a second stale echo undo 2× / 3×.
          if (!layoutDiffered(layout, next)) skipLayoutEchoRef.current = false;
          return;
        }
        if (!layoutDiffered(layout, next)) return;
        commitLayout(next);
      }}
      // Inputs are `.no-drag` so they can be typed into; grab the label, the
      // left grip, or any chrome that is not the field itself.
      //
      // `.nested-canvas` must be cancelled at every depth, not only the page.
      // react-draggable stops the cancel walk at this grid item, so an inner
      // grid can still drag its children. Without it, a Container that holds a
      // Modal (or a Modal that holds a Form) steals the drag and moves the
      // wrapper instead of the field.
      draggableCancel=".no-drag, .nested-canvas, input, textarea, select"
      resizeHandles={RESIZE_HANDLES}
      resizeHandle={(axis, handleRef) => (
        <span
          ref={handleRef}
          aria-hidden="true"
          className={`react-resizable-handle react-resizable-handle-${axis}`}
        />
      )}
    >
      {widgets.map((widget) => (
        <div
          key={widget.id}
          data-canvas-widget={widget.id}
          onClick={(event) => {
            event.stopPropagation();
            handlers.onSelect(widget.id);
          }}
          id={widget.id}
          data-widget-name={widget.name}
          className={clsx(
            'group relative rounded outline-offset-2 transition-shadow',
            handlers.selectedWidgetId === widget.id
              ? 'is-selected outline-2 outline-blue-500'
              : 'hover:outline hover:outline-1 hover:outline-blue-300',
            (widget.type === 'navbar' || widget.type === 'nav_menu') && 'z-[5] overflow-visible',
            String(runtime.properties(widget.name).className ?? ''),
          )}
        >
          <WidgetDragGrip />
          <WidgetLabel
            widget={widget}
            selected={handlers.selectedWidgetId === widget.id}
            isContainer={getWidgetDefinition(widget.type)?.isContainer ?? false}
          />
          {handlers.selectedWidgetId === widget.id && (
            <WidgetDeleteButton name={widget.name} onDelete={() => handlers.onDelete(widget.id)} />
          )}
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
    </div>
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
    fireEvent: (
      event: string,
      payload?: Record<string, unknown>,
      extraActions?: ActionDsl[],
    ) => runtime.fireEvent(widget.name, event, payload, extraActions),
    isDesignMode: true as const,
    host: {
      ...runtimeHost(runtime),
      dropIntoContainer: handlers.onDropIntoContainer,
      openFormTableImport: handlers.onImportFormFromTable,
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
  if (placesOwnChildren(registered.definition.childLayout)) {
    const resizeCells = registered.definition.childLayout === 'cells';
    const fitContent = widget.type === 'navbar';
    return (
      <div
        className="nested-canvas h-full w-full overflow-visible"
        data-drop-parent={widget.id}
        onMouseDown={stopNestedCanvasPointer}
        onDragOver={(event) => acceptPaletteDrag(event)}
        onDrop={(event) => {
          const type = takePaletteDrop(event);
          if (!type) return;
          handlers.onDropIntoContainer(widget.id, type, dropSeed(event));
        }}
        onClick={(event) => {
          event.stopPropagation();
          const hit = (event.target as HTMLElement).closest('[data-canvas-widget]');
          if (!hit || !event.currentTarget.contains(hit)) deselectCanvas(handlers);
        }}
      >
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
              resizeCells={resizeCells}
              fitContent={fitContent}
            />
          )}
        />
      </div>
    );
  }

  return (
    <div className="h-full w-full" data-drop-parent={widget.id}>
      <div className="h-full w-full">
        <Component
          {...shared}
          children={widget.children ?? []}
          renderChildren={(filter) => (
            <div
              ref={innerRef}
              className="nested-canvas h-full min-h-20 w-full overflow-visible"
              data-drop-parent={widget.id}
              onMouseDown={stopNestedCanvasPointer}
              onClick={(event) => {
                event.stopPropagation();
                const hit = (event.target as HTMLElement).closest('[data-canvas-widget]');
                if (!hit || !event.currentTarget.contains(hit)) deselectCanvas(handlers);
              }}
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

              {(widget.children ?? []).length === 0 &&
                (widget.type === 'form' && handlers.onImportFormFromTable ? (
                  <FormImportEmptyState
                    onImport={() => handlers.onImportFormFromTable?.(widget.id)}
                  />
                ) : (
                  <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-slate-300">
                    Drop widgets here
                  </p>
                ))}
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
  resizeCells = true,
  fitContent = false,
}: {
  child: WidgetDsl;
  runtime: AppRuntime;
  handlers: CanvasHandlers;
  depth: number;
  fitVersion: number;
  resizeCells?: boolean;
  fitContent?: boolean;
}) {
  const isSelected = handlers.selectedWidgetId === child.id;

  const body = (
    <DesignWidget
      widget={child}
      runtime={runtime}
      handlers={handlers}
      depth={depth + 1}
      fitVersion={fitVersion}
    />
  );

  return (
    <div
      data-canvas-widget={child.id}
      id={child.id}
      data-widget-name={child.name}
      onClick={(event) => {
        event.stopPropagation();
        handlers.onSelect(child.id);
      }}
      className={clsx(
        'group/cell group relative rounded outline-offset-2',
        fitContent ? 'h-full w-max' : 'h-full w-full',
        isSelected
          ? 'is-selected outline-2 outline-blue-500'
          : 'hover:outline hover:outline-1 hover:outline-blue-300',
        String(runtime.properties(child.name).className ?? ''),
      )}
    >
      <WidgetLabel
        widget={child}
        selected={isSelected}
        isContainer={getWidgetDefinition(child.type)?.isContainer ?? false}
      />
      {isSelected && (
        <WidgetDeleteButton name={child.name} onDelete={() => handlers.onDelete(child.id)} />
      )}
      {resizeCells ? (
        <GridChildResizer
          child={child}
          selected={isSelected}
          onCommit={(patch) => handlers.onUpdateProperties(child.id, { ...patch })}
        >
          {body}
        </GridChildResizer>
      ) : (
        <div className={fitContent ? 'h-full w-max' : 'h-full w-full'}>{body}</div>
      )}
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
      role="button"
      aria-label={`Move ${widget.name}`}
      className={clsx(
        'widget-drag-handle absolute -top-5 left-0 z-20 flex items-center gap-1 rounded-t px-1.5 py-0.5 text-[10px] font-medium text-white',
        'cursor-grab active:cursor-grabbing',
        selected ? 'bg-blue-500 opacity-100' : 'bg-blue-400 opacity-80 group-hover:opacity-100',
      )}
    >
      {isContainer && <span className="text-[9px] opacity-70">⠿</span>}
      {widget.name}
    </span>
  );
}

/** Left-edge grip so a control whose field is `.no-drag` can still be moved. */
function WidgetDragGrip() {
  return (
    <span
      className="widget-drag-handle absolute inset-y-0 left-0 z-30 w-2 cursor-grab rounded-l bg-blue-500/0 hover:bg-blue-500/25 active:cursor-grabbing"
      title="Drag to move"
      aria-hidden="true"
    />
  );
}

/** Sits inside the selected widget so overflow on the grid cannot clip it. */
function WidgetDeleteButton({ name, onDelete }: { name: string; onDelete: () => void }) {
  return (
    <button
      type="button"
      title={`Delete ${name}`}
      aria-label={`Delete ${name}`}
      className="no-drag absolute -top-5 right-0 z-40 flex items-center gap-1 rounded-t border border-red-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-red-600 shadow-sm hover:bg-red-50"
      onClick={(event) => {
        event.stopPropagation();
        onDelete();
      }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <TrashIcon />
      Delete
    </button>
  );
}

function FormImportEmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-[11px] text-slate-400">Drop widgets here, or generate them from a table</p>
      <button
        type="button"
        className="pointer-events-auto no-drag rounded border border-dashed border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onImport();
        }}
      >
        Import from table
      </button>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 4.5h10M6 4.5V3h4v1.5M5 6.5v6m3-6v6m3-6v6M4.5 4.5l.5 9h6l.5-9"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export { GRID_COLUMNS, GRID_ROW_HEIGHT, GRID_GAP };
