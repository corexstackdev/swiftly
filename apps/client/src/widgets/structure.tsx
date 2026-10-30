import clsx from 'clsx';
import type { WidgetDsl } from '@swiftly/shared';
import type { RegisteredWidget, WidgetProps } from './types';
import { normaliseTabs } from '@/editor/TabListEditor';
import { spacingChromeRows, spacingToCss } from '@/editor/SpacingEditor';

/**
 * Structural layout widgets: card, stack, columns, accordion, drawer.
 *
 * These sit next to Container / Grid / Tabs / Modal / Navbar. The nested-grid
 * ones (Card, Accordion, Drawer) reuse `renderChildren`; Stack and Columns place
 * children themselves in document order (`childLayout: 'flow'`).
 */

function asString(value: unknown, fallback = ''): string {
  return value == null ? fallback : String(value);
}

function asNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function childProperties(
  child: WidgetDsl,
  host: WidgetProps['host'],
): Record<string, unknown> {
  return host.propertiesOf?.(child.name) ?? child.properties;
}

/* ------------------------------------------------------------------ *
 * Card
 * ------------------------------------------------------------------ */

function CardWidget({ properties, renderChildren, isDesignMode }: WidgetProps) {
  const shadow = properties.shadow !== false;
  const title = asString(properties.title);
  const subtitle = asString(properties.subtitle);

  return (
    <div
      className={clsx(
        'flex h-full w-full flex-col',
        isDesignMode ? 'overflow-visible' : 'overflow-hidden',
        properties.bordered !== false && 'border border-slate-200',
        shadow && 'shadow-sm',
      )}
      style={{
        background: asString(properties.background, '#ffffff'),
        borderRadius: asNumber(properties.radius, 12),
      }}
    >
      {title || subtitle ? (
        <div className="shrink-0 border-b border-slate-100 px-4 py-3">
          {title ? (
            <div className="truncate text-sm font-semibold text-slate-900">{title}</div>
          ) : null}
          {subtitle ? (
            <div className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</div>
          ) : null}
        </div>
      ) : null}
      <div
        className={clsx('relative min-h-0 flex-1', isDesignMode && 'overflow-visible')}
        style={{ padding: spacingToCss(properties.padding, 16) }}
      >
        {renderChildren?.()}
      </div>
    </div>
  );
}

export const cardWidget: RegisteredWidget = {
  component: CardWidget,
  chromeRows: (properties) =>
    (properties.title || properties.subtitle ? 3 : 1) + spacingChromeRows(properties.padding, 16),
  definition: {
    type: 'card',
    displayName: 'Card',
    category: 'layout',
    icon: 'card',
    isContainer: true,
    defaultLayout: { x: 0, y: 0, w: 8, h: 10 },
    minSize: { w: 4, h: 4 },
    events: [],
    exposedState: [],
    properties: [
      {
        name: 'Content',
        properties: [
          { key: 'title', label: 'Title', control: 'text', expectedType: 'string', bindable: true, defaultValue: 'Card' },
          { key: 'subtitle', label: 'Subtitle', control: 'text', expectedType: 'string', bindable: true },
        ],
      },
      {
        name: 'Appearance',
        properties: [
          { key: 'padding', label: 'Padding', control: 'spacing', expectedType: 'any', bindable: false, defaultValue: 16 },
          { key: 'background', label: 'Background', control: 'color', expectedType: 'string', bindable: false, defaultValue: '#ffffff' },
          { key: 'bordered', label: 'Border', control: 'toggle', expectedType: 'boolean', bindable: false, defaultValue: true },
          { key: 'shadow', label: 'Shadow', control: 'toggle', expectedType: 'boolean', bindable: false, defaultValue: true },
          { key: 'radius', label: 'Corner radius', control: 'number', expectedType: 'number', bindable: false, defaultValue: 12 },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * Stack
 * ------------------------------------------------------------------ */

const ALIGN: Record<string, string> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
};

const JUSTIFY: Record<string, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
};

function StackWidget({
  widget,
  properties,
  children = [],
  renderChild,
  isDesignMode,
}: WidgetProps) {
  const list = children.length > 0 ? children : (widget.children ?? []);
  const row = asString(properties.direction, 'column') === 'row';
  const gap = asNumber(properties.gap, 12);
  const rowPitch = 28;

  return (
    <div
      className={clsx(
        'flex h-full w-full',
        row ? 'flex-row' : 'flex-col',
        ALIGN[asString(properties.align, 'stretch')] ?? ALIGN.stretch,
        JUSTIFY[asString(properties.justify, 'start')] ?? JUSTIFY.start,
        isDesignMode ? 'overflow-visible' : 'overflow-hidden',
      )}
      style={{
        gap,
        padding: spacingToCss(properties.padding, 0),
        background: asString(properties.background, 'transparent'),
      }}
    >
      {list.map((child) => (
        <div
          key={child.id}
          className={clsx('min-w-0', row ? 'min-h-0 flex-1' : 'w-full')}
          style={
            row
              ? { minWidth: Math.max(48, child.layout.w * 12) }
              : { minHeight: Math.max(36, child.layout.h * rowPitch) }
          }
        >
          {renderChild?.(child)}
        </div>
      ))}

      {isDesignMode && list.length === 0 ? (
        <p className="pointer-events-none px-2 py-6 text-center text-[11px] text-slate-400">
          Drop widgets here — they stack {row ? 'left to right' : 'top to bottom'}
        </p>
      ) : null}
    </div>
  );
}

export const stackWidget: RegisteredWidget = {
  component: StackWidget,
  chromeRows: (properties) => 1 + spacingChromeRows(properties.padding),
  definition: {
    type: 'stack',
    displayName: 'Stack',
    category: 'layout',
    icon: 'stack',
    isContainer: true,
    childLayout: 'flow',
    defaultLayout: { x: 0, y: 0, w: 12, h: 8 },
    minSize: { w: 3, h: 3 },
    events: [],
    exposedState: [],
    properties: [
      {
        name: 'Layout',
        properties: [
          {
            key: 'direction',
            label: 'Direction',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'column',
            options: [
              { value: 'column', label: 'Vertical' },
              { value: 'row', label: 'Horizontal' },
            ],
          },
          {
            key: 'align',
            label: 'Align',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'stretch',
            options: [
              { value: 'stretch', label: 'Stretch' },
              { value: 'start', label: 'Start' },
              { value: 'center', label: 'Centre' },
              { value: 'end', label: 'End' },
            ],
          },
          {
            key: 'justify',
            label: 'Distribute',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'start',
            options: [
              { value: 'start', label: 'Start' },
              { value: 'center', label: 'Centre' },
              { value: 'end', label: 'End' },
              { value: 'between', label: 'Space between' },
            ],
          },
          { key: 'gap', label: 'Gap', control: 'number', expectedType: 'number', bindable: false, defaultValue: 12 },
          { key: 'padding', label: 'Padding', control: 'spacing', expectedType: 'any', bindable: false, defaultValue: 0 },
          { key: 'background', label: 'Background', control: 'color', expectedType: 'string', bindable: false, defaultValue: '#ffffff' },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * Columns
 * ------------------------------------------------------------------ */

function ColumnsWidget({
  widget,
  properties,
  children = [],
  renderChild,
  host,
  isDesignMode,
}: WidgetProps) {
  const list = children.length > 0 ? children : (widget.children ?? []);
  const count = Math.max(2, Math.min(4, Math.round(asNumber(properties.count, 2))));
  const gap = asNumber(properties.gap, 16);
  const rowPitch = 28;

  return (
    <div
      className={clsx(
        'flex h-full w-full',
        isDesignMode ? 'overflow-visible' : 'overflow-hidden',
      )}
      style={{ gap, padding: spacingToCss(properties.padding, 0) }}
    >
      {Array.from({ length: count }, (_, index) => {
        const items = list.filter(
          (child) => asNumber(childProperties(child, host).column, 0) === index,
        );
        return (
          <div
            key={index}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
            style={{ gap }}
            data-drop-parent={isDesignMode ? widget.id : undefined}
            data-drop-seed={isDesignMode ? JSON.stringify({ column: index }) : undefined}
          >
            {items.map((child) => (
              <div
                key={child.id}
                className="w-full min-w-0"
                style={{ minHeight: Math.max(36, child.layout.h * rowPitch) }}
              >
                {renderChild?.(child)}
              </div>
            ))}
            {isDesignMode && items.length === 0 ? (
              <p className="pointer-events-none flex flex-1 items-center justify-center rounded border border-dashed border-slate-200 text-[11px] text-slate-300">
                Column {index + 1}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export const columnsWidget: RegisteredWidget = {
  component: ColumnsWidget,
  chromeRows: (properties) => 1 + spacingChromeRows(properties.padding),
  definition: {
    type: 'columns',
    displayName: 'Columns',
    category: 'layout',
    icon: 'columns',
    isContainer: true,
    childLayout: 'flow',
    defaultLayout: { x: 0, y: 0, w: 24, h: 10 },
    minSize: { w: 6, h: 4 },
    events: [],
    exposedState: [],
    properties: [
      {
        name: 'Layout',
        properties: [
          {
            key: 'count',
            label: 'Columns',
            control: 'select',
            expectedType: 'number',
            bindable: false,
            defaultValue: 2,
            options: [
              { value: '2', label: '2' },
              { value: '3', label: '3' },
              { value: '4', label: '4' },
            ],
            helpText: 'Assign a widget to a column with its Column property.',
          },
          { key: 'gap', label: 'Gap', control: 'number', expectedType: 'number', bindable: false, defaultValue: 16 },
          { key: 'padding', label: 'Padding', control: 'spacing', expectedType: 'any', bindable: false, defaultValue: 0 },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * Accordion
 * ------------------------------------------------------------------ */

function AccordionWidget({
  properties,
  state,
  setState,
  fireEvent,
  isDesignMode,
  renderChildren,
}: WidgetProps) {
  const panels = useMemo(() => normaliseTabs(properties.panels), [properties.panels]);
  const fallbackId = asString(properties.defaultPanel) || panels[0]?.id || '';
  const activeId = asString(state.activePanel ?? fallbackId);

  return (
    <div
      className={clsx(
        'flex h-full w-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white',
      )}
    >
      {panels.map((panel) => {
        const open = panel.id === activeId;
        return (
          <div key={panel.id} className="flex min-h-0 flex-col border-b border-slate-100 last:border-b-0">
            <button
              type="button"
              className={clsx(
                'flex shrink-0 items-center justify-between px-3 py-2 text-left text-sm',
                open ? 'bg-slate-50 font-medium text-slate-900' : 'text-slate-600 hover:bg-slate-50',
              )}
              onClick={() => {
                // On the canvas the open panel is the only drop target, so it
                // cannot collapse — switching still works.
                if (isDesignMode && open) return;
                setState({ activePanel: open ? '' : panel.id });
                if (!isDesignMode) {
                  fireEvent('onPanelChange', { panelId: panel.id, label: panel.label, open: !open });
                }
              }}
            >
              <span className="truncate">{panel.label}</span>
              <span className="text-[10px] text-slate-400">{open ? '▾' : '▸'}</span>
            </button>
            {open ? (
              <div
                className="relative min-h-0 flex-1"
                style={{ padding: spacingToCss(properties.padding, 8) }}
              >
                {renderChildren?.((child: WidgetDsl) => {
                  const assigned = child.properties.panelId;
                  if (typeof assigned !== 'string' || assigned === '') {
                    return activeId === panels[0]?.id;
                  }
                  return assigned === activeId;
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export const accordionWidget: RegisteredWidget = {
  component: AccordionWidget,
  chromeRows: (properties) => {
    const panels = Array.isArray(properties.panels) ? properties.panels.length : 2;
    return Math.max(2, panels) * 2 + spacingChromeRows(properties.padding, 8);
  },
  definition: {
    type: 'accordion',
    displayName: 'Accordion',
    category: 'layout',
    icon: 'accordion',
    isContainer: true,
    defaultLayout: { x: 0, y: 0, w: 12, h: 12 },
    minSize: { w: 4, h: 6 },
    events: [
      { key: 'onPanelChange', label: 'On panel change', payloadKeys: ['panelId', 'label', 'open'] },
    ],
    exposedState: [{ key: 'activePanel', type: 'string', description: 'Id of the open panel' }],
    properties: [
      {
        name: 'Data',
        properties: [
          {
            key: 'panels',
            label: 'Panels',
            control: 'tab_list',
            expectedType: 'array',
            bindable: false,
            defaultValue: [
              { id: 'panel1', label: 'Section 1', display: 'text' },
              { id: 'panel2', label: 'Section 2', display: 'text' },
            ],
            helpText: 'Assign a widget to a panel with its Panel property.',
          },
          {
            key: 'defaultPanel',
            label: 'Default panel',
            control: 'text',
            expectedType: 'string',
            bindable: true,
            helpText: 'Panel id shown first. Blank uses the first panel.',
          },
        ],
      },
      {
        name: 'General',
        properties: [
          { key: 'padding', label: 'Padding', control: 'spacing', expectedType: 'any', bindable: false, defaultValue: 8 },
          {
            key: 'onPanelChange',
            label: 'On panel change',
            control: 'action_list',
            expectedType: 'any',
            bindable: false,
          },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * Drawer
 * ------------------------------------------------------------------ */

function DrawerWidget({
  widget,
  properties,
  host,
  isDesignMode,
  renderChildren,
}: WidgetProps) {
  const isOpen = host.openModals.includes(widget.name);
  const side = asString(properties.side, 'right');
  const width = asNumber(properties.widthPx, 360);

  if (isDesignMode) {
    return (
      <div className="flex h-full w-full flex-col overflow-visible rounded border border-slate-300 bg-white shadow-sm">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-1.5">
          <span className="truncate text-xs font-medium text-slate-600">
            {asString(properties.title, 'Drawer')}
          </span>
          <span className="text-[10px] text-slate-400">
            opens via {'{openModal: '}
            {widget.name}
            {'}'}
          </span>
        </div>
        <div
          className="relative min-h-0 flex-1 overflow-visible"
          style={{ padding: spacingToCss(properties.padding, 16) }}
        >
          {renderChildren?.()}
        </div>
      </div>
    );
  }

  if (!isOpen) return null;

  const fromLeft = side === 'left';
  const fromBottom = side === 'bottom';

  return (
    <div
      className="fixed inset-0 z-50 flex bg-slate-900/40"
      role="dialog"
      aria-modal="true"
      aria-label={asString(properties.title, 'Drawer')}
      onClick={() => properties.closeOnBackdrop !== false && host.closeModal(widget.name)}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className={clsx(
          'flex flex-col bg-white shadow-2xl',
          fromBottom ? 'mt-auto h-[70vh] w-full rounded-t-2xl' : 'h-full',
          fromLeft && 'mr-auto',
          !fromLeft && !fromBottom && 'ml-auto',
        )}
        style={fromBottom ? undefined : { width, maxWidth: '92vw' }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            {asString(properties.title, '')}
          </h2>
          <button
            type="button"
            onClick={() => host.closeModal(widget.name)}
            aria-label="Close"
            className="rounded px-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ×
          </button>
        </div>
        <div
          className="min-h-0 flex-1 overflow-auto"
          style={{ padding: spacingToCss(properties.padding, 16) }}
        >
          {renderChildren?.()}
        </div>
      </div>
    </div>
  );
}

export const drawerWidget: RegisteredWidget = {
  component: DrawerWidget,
  chromeRows: (properties) => 3 + spacingChromeRows(properties.padding, 16),
  definition: {
    type: 'drawer',
    displayName: 'Drawer',
    category: 'layout',
    icon: 'drawer',
    isContainer: true,
    defaultLayout: { x: 0, y: 0, w: 10, h: 12 },
    minSize: { w: 4, h: 4 },
    events: [],
    exposedState: [{ key: 'isOpen', type: 'boolean', description: 'Whether the drawer is showing' }],
    properties: [
      {
        name: 'Content',
        properties: [
          { key: 'title', label: 'Title', control: 'text', expectedType: 'string', bindable: true, defaultValue: 'Details' },
          {
            key: 'side',
            label: 'Opens from',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'right',
            options: [
              { value: 'right', label: 'Right' },
              { value: 'left', label: 'Left' },
              { value: 'bottom', label: 'Bottom' },
            ],
          },
          {
            key: 'widthPx',
            label: 'Width',
            control: 'number',
            expectedType: 'number',
            bindable: false,
            defaultValue: 360,
            visibleWhen: { key: 'side', oneOf: ['left', 'right'] },
          },
          { key: 'padding', label: 'Padding', control: 'spacing', expectedType: 'any', bindable: false, defaultValue: 16 },
        ],
      },
      {
        name: 'Behaviour',
        properties: [
          {
            key: 'closeOnBackdrop',
            label: 'Close on backdrop click',
            control: 'toggle',
            expectedType: 'boolean',
            bindable: false,
            defaultValue: true,
          },
        ],
      },
    ],
  },
};
