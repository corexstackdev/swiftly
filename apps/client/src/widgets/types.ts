import type { ActionDsl, WidgetDefinition, WidgetDsl } from '@vinodapp/shared';
import type { ComponentType } from 'react';

/** Props every widget receives. Identical in the editor and the published runtime. */
export interface WidgetProps {
  widget: WidgetDsl;
  /** Properties with bindings already evaluated. */
  properties: Record<string, unknown>;
  /** This widget's exposed state, e.g. an input's current value. */
  state: Record<string, unknown>;
  /** Writes exposed state, making it readable as `{{ Widget.key }}`. */
  setState: (patch: Record<string, unknown>) => void;
  /** Fires a declared event; the host runs the configured actions. */
  fireEvent: (event: string, payload?: Record<string, unknown>) => void;
  /** True in the editor canvas: widgets suppress side effects while being designed. */
  isDesignMode: boolean;
  /**
   * Renders child widgets, for containers. The optional filter lets a container
   * show a subset — Tabs uses it to render only the active tab's children while
   * the DSL keeps one flat child list.
   */
  renderChildren?: (filter?: (child: WidgetDsl) => boolean) => React.ReactNode;
  /**
   * Renders one child, for containers that place children themselves. The host
   * supplies the widget and its editing chrome; the container decides where it
   * goes. This is what lets a Grid own its own layout instead of delegating to a
   * coordinate grid it cannot reflow.
   */
  renderChild?: (child: WidgetDsl) => React.ReactNode;
  /** The children this container holds, for one that lays them out itself. */
  children?: WidgetDsl[];
  /** Host capabilities a widget needs beyond its own props. */
  host: WidgetHost;
}

/** The slice of runtime a widget is allowed to reach. */
export interface WidgetHost {
  /** Names of the modals currently showing. */
  openModals: string[];
  openModal: (widgetName: string) => void;
  closeModal: (widgetName: string) => void;
  /**
   * Adds a dropped widget to a container that positions children itself, with
   * any properties the container wants to seed (a span, an order). Only present
   * in the editor; undefined in a published app.
   */
  dropIntoContainer?: (
    parentId: string,
    widgetType: string,
    seedProperties?: Record<string, unknown>,
  ) => void;
}

export interface RegisteredWidget {
  definition: WidgetDefinition;
  component: ComponentType<WidgetProps>;
  /**
   * Grid rows this container spends on its own chrome — a title bar, a tab strip —
   * before any child can be placed. The editor needs it to size a container to its
   * contents; without it a container is always short by the height of its header
   * and the last row of children disappears behind a scrollbar.
   */
  chromeRows?: (properties: Record<string, unknown>) => number;
}

export type { ActionDsl, WidgetDefinition, WidgetDsl };
