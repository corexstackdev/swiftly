import { useMemo } from 'react';
import clsx from 'clsx';
import type { TabDefinition, WidgetDsl } from '@vinodapp/shared';
import type { RegisteredWidget, WidgetProps } from './types';
import { normaliseTabs } from '@/editor/TabListEditor';
import { spacingChromeRows, spacingToCss } from '@/editor/SpacingEditor';

/**
 * Container widgets that do more than hold a grid.
 *
 * Both render their children through `renderChildren`, which takes an optional
 * filter — that is how Tabs shows only the current tab's children while the DSL
 * keeps one flat child list per container.
 */

/* ------------------------------------------------------------------ *
 * Modal
 * ------------------------------------------------------------------ */

function ModalWidget({ widget, properties, host, isDesignMode, renderChildren }: WidgetProps) {
  const isOpen = host.openModals.includes(widget.name);

  // On the canvas a modal is edited in place: an overlay that only appears when an
  // action opens it would be uneditable, since the builder has no way to trigger
  // the action while designing.
  if (isDesignMode) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden rounded border border-slate-300 bg-white shadow-sm">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-1.5">
          <span className="truncate text-xs font-medium text-slate-600">
            {String(properties.title ?? 'Modal')}
          </span>
          <span className="text-[10px] text-slate-400">
            opens via {'{'}openModal: {widget.name}
            {'}'}
          </span>
        </div>
        <div
          className="relative min-h-0 flex-1"
          style={{ padding: spacingToCss(properties.padding, 16) }}
        >
          {renderChildren?.()}
        </div>
      </div>
    );
  }

  if (!isOpen) return null;

  const width = String(properties.size ?? 'medium');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={String(properties.title ?? 'Dialog')}
      onClick={() => properties.closeOnBackdrop !== false && host.closeModal(widget.name)}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className={clsx(
          'flex max-h-[85vh] w-full flex-col overflow-hidden rounded-lg bg-white shadow-xl',
          width === 'small' && 'max-w-sm',
          width === 'medium' && 'max-w-lg',
          width === 'large' && 'max-w-3xl',
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            {String(properties.title ?? '')}
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

export const modalWidget: RegisteredWidget = {
  component: ModalWidget,
  // Title bar plus the inner grid's padding, and the body padding on top.
  chromeRows: (properties) => 3 + spacingChromeRows(properties.padding, 16),
  definition: {
    type: 'modal',
    displayName: 'Modal',
    category: 'layout',
    icon: 'modal',
    isContainer: true,
    defaultLayout: { x: 0, y: 0, w: 12, h: 10 },
    minSize: { w: 4, h: 4 },
    events: [],
    exposedState: [{ key: 'isOpen', type: 'boolean', description: 'Whether the modal is showing' }],
    properties: [
      {
        name: 'Content',
        properties: [
          { key: 'title', label: 'Title', control: 'text', expectedType: 'string', bindable: true, defaultValue: 'Details' },
          { key: 'size', label: 'Size', control: 'select', expectedType: 'string', bindable: false, defaultValue: 'medium' },
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
            helpText: 'Turn off for forms where a stray click would lose work',
          },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * Tabs
 * ------------------------------------------------------------------ */

function styleFor(tab: TabDefinition, isActive: boolean): React.CSSProperties {
  const state = isActive ? tab.selected : tab.normal;
  if (!state) return {};

  const weights = { normal: 400, medium: 500, semibold: 600, bold: 700 } as const;

  return {
    color: state.foreground,
    background: state.background,
    fontWeight: state.fontWeight ? weights[state.fontWeight] : undefined,
    fontSize: state.fontSize ? state.fontSize + 'px' : undefined,
    fontStyle: state.italic ? 'italic' : undefined,
    textDecoration: state.underline ? 'underline' : undefined,
  };
}

/** What the tab shows: its icon, its label, or both. */
function TabContent({ tab }: { tab: TabDefinition }) {
  const mode = tab.display ?? 'text';
  const icon = tab.icon?.trim();

  return (
    <span className="flex items-center gap-1.5">
      {mode !== 'text' && icon ? <span aria-hidden="true">{icon}</span> : null}
      {/* An icon-only tab still needs an accessible name, so the label stays in
          the DOM for screen readers rather than being dropped. */}
      {mode === 'icon' && icon ? (
        <span className="sr-only">{tab.label}</span>
      ) : (
        <span className="truncate">{tab.label}</span>
      )}
    </span>
  );
}

function TabsWidget({
  properties,
  state,
  setState,
  fireEvent,
  isDesignMode,
  renderChildren,
}: WidgetProps) {
  const tabs = useMemo(() => normaliseTabs(properties.tabs), [properties.tabs]);

  const fallbackId = String(properties.defaultTab ?? '') || tabs[0]?.id || '';
  const activeId = String(state.activeTab ?? fallbackId);
  const showTabs = properties.showTabs !== false;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded border border-slate-200 bg-white">
      {showTabs ? (
        <div className="flex shrink-0 gap-1 border-b border-slate-200 px-2">
          {tabs.map((tab) => {
            const isActive = tab.id === activeId;
            const custom = styleFor(tab, isActive);

            return (
              <button
                key={tab.id}
                type="button"
                title={tab.label}
                onClick={() => {
                  // Switching tabs works on the canvas too: it is the only way to
                  // reach the widgets living on the other tabs.
                  setState({ activeTab: tab.id });
                  if (!isDesignMode) {
                    fireEvent('onTabSelected', { tabId: tab.id, label: tab.label });
                  }
                }}
                style={custom}
                className={clsx(
                  '-mb-px border-b-2 px-3 py-1.5 text-xs transition-colors',
                  isActive ? 'border-blue-600' : 'border-transparent',
                  // The widget's own colours apply only where the tab has not set
                  // its own, so a customised tab is not fighting them.
                  custom.color === undefined &&
                    (isActive
                      ? 'font-medium text-slate-900'
                      : 'text-slate-500 hover:text-slate-700'),
                )}
              >
                <TabContent tab={tab} />
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Children carry a `tabId` property; anything without one shows on the
          first tab, so a widget dropped before tabs were configured is not lost. */}
      <div
        className="relative min-h-0 flex-1"
        style={{ padding: spacingToCss(properties.padding) }}
      >
        {renderChildren?.((child: WidgetDsl) => {
          const assigned = child.properties.tabId;
          if (typeof assigned !== 'string' || assigned === '') return activeId === tabs[0]?.id;
          return assigned === activeId;
        })}
      </div>
    </div>
  );
}

export const tabsWidget: RegisteredWidget = {
  component: TabsWidget,
  // The tab strip plus the inner grid's padding, and the body padding on top.
  chromeRows: (properties) => 3 + spacingChromeRows(properties.padding),
  definition: {
    type: 'tabs',
    displayName: 'Tabs',
    category: 'layout',
    icon: 'tabs',
    isContainer: true,
    defaultLayout: { x: 0, y: 0, w: 12, h: 10 },
    minSize: { w: 4, h: 4 },
    events: [
      { key: 'onTabSelected', label: 'On tab selected', payloadKeys: ['tabId', 'label'] },
    ],
    exposedState: [{ key: 'activeTab', type: 'string', description: 'Id of the visible tab' }],
    properties: [
      {
        name: 'Data',
        properties: [
          {
            key: 'tabs',
            label: 'Tabs',
            control: 'tab_list',
            expectedType: 'array',
            bindable: false,
            defaultValue: [
              { id: 'tab1', label: 'Tab 1', display: 'text' },
              { id: 'tab2', label: 'Tab 2', display: 'text' },
            ],
            helpText: 'Assign a widget to a tab with its Tab property.',
          },
          {
            key: 'defaultTab',
            label: 'Default tab',
            control: 'text',
            expectedType: 'string',
            bindable: true,
            helpText: 'Tab id shown first. Blank uses the first tab.',
          },
        ],
      },
      {
        name: 'General',
        properties: [
          {
            key: 'showTabs',
            label: 'Show tabs',
            control: 'toggle',
            expectedType: 'boolean',
            bindable: true,
            defaultValue: true,
            helpText: 'Hide the strip to drive the visible tab entirely from an action.',
          },
          { key: 'padding', label: 'Padding', control: 'spacing', expectedType: 'any', bindable: false, defaultValue: 0 },
        ],
      },
      {
        name: 'Events',
        properties: [
          {
            key: 'onTabSelected',
            label: 'On tab selected',
            control: 'action_list',
            expectedType: 'any',
            bindable: false,
          },
        ],
      },
    ],
  },
};
