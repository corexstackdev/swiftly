import clsx from 'clsx';
import type { WidgetDsl } from '@swiftly/shared';
import { getWidget } from '@/widgets/registry';
import type { AppRuntime } from './useAppRuntime';

/**
 * Renders a widget tree onto the grid.
 *
 * The published runtime positions widgets with plain CSS rather than dragging
 * machinery — react-grid-layout is an editing tool, and end users pay nothing for it.
 * Both modes read the same layout units, so what is designed is what is served.
 */

/** Builds the capability object handed to every widget. */
export function runtimeHost(runtime: AppRuntime) {
  return {
    openModals: runtime.openModals,
    openModal: runtime.openModal,
    closeModal: runtime.closeModal,
    widgetState: runtime.widgetState,
    setWidgetState: runtime.setWidgetState,
    propertiesOf: runtime.properties,
  };
}

export const GRID_COLUMNS = 24;
export const GRID_ROW_HEIGHT = 20;
export const GRID_GAP = 8;

export function PageRenderer({
  widgets,
  runtime,
  isDesignMode = false,
}: {
  widgets: WidgetDsl[];
  runtime: AppRuntime;
  isDesignMode?: boolean;
}) {
  // A modal is positioned by its own overlay, not by the grid, so it renders
  // outside the grid flow; leaving it in would reserve a hole where it sits.
  const modals = widgets.filter((widget) => widget.type === 'modal');
  const positioned = widgets.filter((widget) => widget.type !== 'modal');

  return (
    <div
      className="relative grid w-full"
      style={{
        gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`,
        gridAutoRows: `${GRID_ROW_HEIGHT}px`,
        gap: GRID_GAP,
      }}
    >
      {positioned.map((widget) => (
        <div
          key={widget.id}
          style={{
            gridColumn: `${widget.layout.x + 1} / span ${widget.layout.w}`,
            gridRow: `${widget.layout.y + 1} / span ${widget.layout.h}`,
          }}
          className="min-w-0"
        >
          <WidgetHost widget={widget} runtime={runtime} isDesignMode={isDesignMode} />
        </div>
      ))}

      {modals.map((widget) => (
        <WidgetHost
          key={widget.id}
          widget={widget}
          runtime={runtime}
          isDesignMode={isDesignMode}
        />
      ))}
    </div>
  );
}

export function WidgetHost({
  widget,
  runtime,
  isDesignMode,
}: {
  widget: WidgetDsl;
  runtime: AppRuntime;
  isDesignMode: boolean;
}) {
  const registered = getWidget(widget.type);

  if (!registered) {
    return (
      <div className="flex h-full items-center justify-center rounded border border-dashed border-amber-300 bg-amber-50 p-2 text-xs text-amber-700">
        Unknown widget type “{widget.type}”
      </div>
    );
  }

  const Component = registered.component;

  const className = String(runtime.properties(widget.name).className ?? '');

  return (
    <ErrorBoundary widgetName={widget.name}>
      <div id={widget.id} data-widget-name={widget.name} className={clsx('h-full w-full', className)}>
        <Component
          widget={widget}
          properties={runtime.properties(widget.name)}
          state={runtime.widgetState[widget.name] ?? {}}
          setState={(patch) => runtime.setWidgetState(widget.name, patch)}
          fireEvent={(event, payload) => runtime.fireEvent(widget.name, event, payload)}
          isDesignMode={isDesignMode}
          host={runtimeHost(runtime)}
          children={widget.children}
          renderChild={(child) => (
            <WidgetHost widget={child} runtime={runtime} isDesignMode={isDesignMode} />
          )}
          renderChildren={
            widget.children
              ? (filter) => (
                  <PageRenderer
                    widgets={filter ? widget.children!.filter(filter) : widget.children!}
                    runtime={runtime}
                    isDesignMode={isDesignMode}
                  />
                )
              : undefined
          }
        />
      </div>
    </ErrorBoundary>
  );
}

/**
 * One widget throwing must not blank the page. Tenant-authored custom components
 * make this non-negotiable, but a built-in fed an unexpected shape can throw too.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

class ErrorBoundary extends Component<
  { widgetName: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`Widget "${this.props.widgetName}" failed to render`, error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col justify-center gap-1 rounded border border-red-200 bg-red-50 p-2">
          <span className="text-xs font-medium text-red-700">{this.props.widgetName} failed</span>
          <span className="truncate text-xs text-red-600">{this.state.error.message}</span>
        </div>
      );
    }
    return this.props.children;
  }
}
