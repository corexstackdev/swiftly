import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { PropertySection, WidgetDsl } from '@swiftly/shared';
import type { RegisteredWidget, WidgetHost, WidgetProps } from './types';
import { spacingToCss } from '@/editor/SpacingEditor';
import { IconGlyph } from '@/icons/IconGlyph';

/**
 * Canvas-designed navigation: a Navbar you drop onto the page, then fill with
 * Link and Menu widgets. The app-level sidebar/topbar in App Settings is a
 * different thing — this is layout you place, style, and nest yourself.
 */

const JUSTIFY: Record<string, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
};

function asString(value: unknown, fallback = ''): string {
  return value == null ? fallback : String(value);
}

function isVisible(properties: Record<string, unknown>): boolean {
  return properties.visible !== false;
}

function slotOf(child: WidgetDsl, host: WidgetHost): 'start' | 'end' {
  const properties = host.propertiesOf?.(child.name) ?? child.properties;
  return asString(properties.align, 'start') === 'end' ? 'end' : 'start';
}

function activateLink(
  properties: Record<string, unknown>,
  host: WidgetHost,
  isDesignMode: boolean,
  fireEvent: WidgetProps['fireEvent'],
): void {
  if (isDesignMode || Boolean(properties.disabled)) return;
  const toKind = asString(properties.toKind, 'page');
  const pageId = asString(properties.pageId);
  const href = asString(properties.href);
  fireEvent('onClick', { label: asString(properties.label), toKind, pageId, href });
  if (toKind === 'page' && pageId) host.navigateToPage?.(pageId);
  else if (toKind === 'url' && href) host.openUrl?.(href, Boolean(properties.newTab));
}

function NavFace({ label, icon, caret }: { label: string; icon: string; caret?: boolean }) {
  return (
    <>
      {icon ? <IconGlyph name={icon} size={16} className="shrink-0" /> : null}
      <span className="truncate">{label}</span>
      {caret ? (
        <span aria-hidden="true" className="ml-0.5 text-[10px] opacity-70">
          ▾
        </span>
      ) : null}
    </>
  );
}

function AddChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="no-drag shrink-0 rounded border border-dashed border-slate-400 px-1.5 py-0.5 text-[10px] font-medium opacity-70 hover:bg-black/5 hover:opacity-100"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {label}
    </button>
  );
}

function NavbarWidget({
  widget,
  properties,
  renderChild,
  children = [],
  host,
  isDesignMode,
}: WidgetProps) {
  const childList = children.length > 0 ? children : (widget.children ?? []);
  const visibleChildren = childList.filter((child) => {
    const childProperties = host.propertiesOf?.(child.name) ?? child.properties;
    return isDesignMode || isVisible(childProperties);
  });
  const start = visibleChildren.filter((child) => slotOf(child, host) === 'start');
  const end = visibleChildren.filter((child) => slotOf(child, host) === 'end');
  const brand = asString(properties.brand);
  const brandLogo = asString(properties.brandLogo);
  const showBrand = properties.showBrand !== false && (Boolean(brand) || Boolean(brandLogo));
  const textColor = asString(properties.textColor, '#0f172a');
  const split = end.length > 0;
  const justify = split ? 'between' : asString(properties.justify, 'start');

  const goBrand = (): void => {
    if (isDesignMode) return;
    const pageId = asString(properties.brandPageId);
    if (pageId) host.navigateToPage?.(pageId);
  };

  return (
    <nav
      className={clsx(
        'relative box-border flex h-full w-full items-center gap-3 overflow-visible',
        !isDesignMode && properties.sticky === true && 'sticky top-0 z-20',
      )}
      style={{
        background: asString(properties.background, '#ffffff'),
        color: textColor,
        padding: spacingToCss(properties.padding, 8),
        borderBottom:
          properties.bordered !== false
            ? `${Number(properties.borderWidth ?? 1)}px solid ${asString(properties.borderColor, '#e2e8f0')}`
            : undefined,
      }}
    >
      {showBrand ? (
        <button
          type="button"
          className="no-drag flex max-w-[12rem] shrink-0 items-center gap-2 text-left"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            goBrand();
          }}
        >
          {brandLogo ? (
            <img src={brandLogo} alt="" className="h-6 w-auto max-w-[7rem] object-contain" />
          ) : null}
          {brand ? <span className="truncate text-sm font-semibold">{brand}</span> : null}
        </button>
      ) : null}

      <div
        className={clsx(
          'flex min-h-0 min-w-0 flex-1 items-center overflow-x-auto',
          JUSTIFY[justify] ?? JUSTIFY.start,
        )}
        style={{ gap: Number(properties.gap ?? 4) }}
      >
        <div className="flex h-full min-w-0 items-center" style={{ gap: Number(properties.gap ?? 4) }}>
          {start.map((child) => (
            <div key={child.id} className="relative h-full w-max shrink-0">
              {renderChild?.(child)}
            </div>
          ))}
        </div>
        {split ? (
          <div className="flex h-full shrink-0 items-center" style={{ gap: Number(properties.gap ?? 4) }}>
            {end.map((child) => (
              <div key={child.id} className="relative h-full w-max shrink-0">
                {renderChild?.(child)}
              </div>
            ))}
          </div>
        ) : null}

        {isDesignMode && childList.length === 0 ? (
          <p className="pointer-events-none px-2 text-[11px] text-slate-400">
            Drop Link or Menu here
          </p>
        ) : null}
      </div>

      {isDesignMode && host.dropIntoContainer ? (
        <div className="flex shrink-0 items-center gap-1">
          <AddChip label="+ Link" onClick={() => host.dropIntoContainer?.(widget.id, 'nav_link')} />
          <AddChip label="+ Menu" onClick={() => host.dropIntoContainer?.(widget.id, 'nav_menu')} />
        </div>
      ) : null}
    </nav>
  );
}

function NavLinkWidget({
  properties,
  state,
  setState,
  fireEvent,
  host,
  isDesignMode,
}: WidgetProps) {
  const label = asString(properties.label, 'Link');
  const icon = asString(properties.icon).trim();
  const toKind = asString(properties.toKind, 'page');
  const pageId = asString(properties.pageId);
  const active = toKind === 'page' && Boolean(pageId) && pageId === host.currentPageId;
  const hidden = !isVisible(properties);
  const disabled = Boolean(properties.disabled);

  useEffect(() => {
    if (state.active !== active) setState({ active });
  }, [active, setState, state.active]);

  if (hidden && !isDesignMode) return null;

  return (
    <button
      type="button"
      disabled={disabled}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'no-drag flex h-full w-full max-w-[16rem] items-center justify-start gap-1.5 rounded px-3 text-sm transition-colors',
        active ? 'bg-black/10 font-medium' : 'hover:bg-black/5',
        disabled && 'cursor-not-allowed opacity-50',
        hidden && isDesignMode && 'opacity-40',
        !disabled && !isDesignMode && 'cursor-pointer',
      )}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        activateLink(properties, host, isDesignMode, fireEvent);
      }}
    >
      <NavFace label={label} icon={icon} />
    </button>
  );
}

function NavMenuWidget({
  widget,
  properties,
  state,
  setState,
  renderChild,
  children = [],
  host,
  isDesignMode,
}: WidgetProps) {
  const childList = children.length > 0 ? children : (widget.children ?? []);
  const label = asString(properties.label, 'Menu');
  const icon = asString(properties.icon).trim();
  const hidden = !isVisible(properties);
  const disabled = Boolean(properties.disabled);
  const menuAlign = asString(properties.menuAlign, 'left');
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(isDesignMode);

  useEffect(() => {
    if (isDesignMode) setOpen(true);
  }, [isDesignMode]);

  useEffect(() => {
    if (state.open !== open) setState({ open });
  }, [open, setState, state.open]);

  useEffect(() => {
    if (isDesignMode || !open) return;
    const onPointer = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer, true);
    return () => document.removeEventListener('pointerdown', onPointer, true);
  }, [isDesignMode, open]);

  if (hidden && !isDesignMode) return null;

  const visibleChildren = childList.filter((child) => {
    const childProperties = host.propertiesOf?.(child.name) ?? child.properties;
    return isDesignMode || isVisible(childProperties);
  });

  return (
    <div
      ref={rootRef}
      className={clsx('relative h-full w-max', hidden && isDesignMode && 'opacity-40')}
    >
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        className={clsx(
          'no-drag inline-flex h-full items-center gap-1.5 rounded px-3 text-sm transition-colors',
          open ? 'bg-black/10 font-medium' : 'hover:bg-black/5',
          disabled && 'cursor-not-allowed opacity-50',
          !disabled && !isDesignMode && 'cursor-pointer',
        )}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (isDesignMode || disabled) return;
          setOpen((previous) => !previous);
        }}
      >
        <NavFace label={label} icon={icon} caret />
      </button>

      {open ? (
        <div
          role={isDesignMode ? undefined : 'menu'}
          className={clsx(
            'absolute top-[calc(100%+4px)] z-30 min-w-[11rem] rounded-md border border-slate-200 bg-white py-1 text-slate-800 shadow-lg',
            menuAlign === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {visibleChildren.map((child) => (
            <div key={child.id} className="min-h-8 w-full min-w-[11rem]">
              {renderChild?.(child)}
            </div>
          ))}

          {isDesignMode && childList.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-slate-400">Drop links here</p>
          ) : null}

          {isDesignMode && host.dropIntoContainer ? (
            <div className="px-2 pt-1 pb-1">
              <AddChip
                label="+ Link"
                onClick={() => host.dropIntoContainer?.(widget.id, 'nav_link')}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const CONTENT_PROPERTIES: PropertySection = {
  name: 'Content',
  properties: [
    {
      key: 'label',
      label: 'Label',
      control: 'text',
      expectedType: 'string',
      bindable: true,
      defaultValue: 'Link',
    },
    {
      key: 'icon',
      label: 'Icon',
      control: 'icon',
      expectedType: 'string',
      bindable: true,
      helpText: 'A React icon or an emoji shown before the label.',
    },
  ],
};

const DESTINATION_PROPERTIES: PropertySection = {
  name: 'Destination',
  properties: [
    {
      key: 'toKind',
      label: 'Opens',
      control: 'select',
      expectedType: 'string',
      bindable: false,
      defaultValue: 'page',
      options: [
        { value: 'page', label: 'A page in this app' },
        { value: 'url', label: 'A URL' },
        { value: 'none', label: 'Nothing — run actions only' },
      ],
      helpText: 'The click also runs On click actions. Pick “Nothing” when the link should only run those.',
    },
    {
      key: 'pageId',
      label: 'Page',
      control: 'page_picker',
      expectedType: 'string',
      bindable: false,
      visibleWhen: { key: 'toKind', equals: 'page' },
    },
    {
      key: 'href',
      label: 'URL',
      control: 'text',
      expectedType: 'string',
      bindable: true,
      placeholder: 'https://',
      visibleWhen: { key: 'toKind', equals: 'url' },
    },
    {
      key: 'newTab',
      label: 'Open in new tab',
      control: 'toggle',
      expectedType: 'boolean',
      bindable: false,
      defaultValue: false,
      visibleWhen: { key: 'toKind', equals: 'url' },
    },
  ],
};

const ITEM_LAYOUT_PROPERTIES: PropertySection = {
  name: 'Layout',
  properties: [
    {
      key: 'align',
      label: 'Navbar side',
      control: 'select',
      expectedType: 'string',
      bindable: false,
      defaultValue: 'start',
      options: [
        { value: 'start', label: 'Left group' },
        { value: 'end', label: 'Right group' },
      ],
      helpText: 'Right-group items sit at the far end of the navbar, after the brand and left links.',
    },
    {
      key: 'visible',
      label: 'Visible',
      control: 'toggle',
      expectedType: 'boolean',
      bindable: true,
      defaultValue: true,
    },
    {
      key: 'disabled',
      label: 'Disabled',
      control: 'toggle',
      expectedType: 'boolean',
      bindable: true,
      defaultValue: false,
    },
  ],
};

export const navbarWidget: RegisteredWidget = {
  component: NavbarWidget,
  definition: {
    type: 'navbar',
    displayName: 'Navbar',
    category: 'layout',
    icon: 'navbar',
    isContainer: true,
    childLayout: 'flow',
    defaultLayout: { x: 0, y: 0, w: 24, h: 3 },
    minSize: { w: 6, h: 2 },
    events: [],
    exposedState: [],
    properties: [
      {
        name: 'Brand',
        properties: [
          {
            key: 'brand',
            label: 'Brand',
            control: 'text',
            expectedType: 'string',
            bindable: true,
            defaultValue: 'App',
          },
          {
            key: 'brandLogo',
            label: 'Logo URL',
            control: 'text',
            expectedType: 'string',
            bindable: true,
            placeholder: 'https://',
          },
          {
            key: 'showBrand',
            label: 'Show brand',
            control: 'toggle',
            expectedType: 'boolean',
            bindable: false,
            defaultValue: true,
          },
          {
            key: 'brandPageId',
            label: 'Brand goes to',
            control: 'page_picker',
            expectedType: 'string',
            bindable: false,
            helpText: 'Page opened when someone clicks the brand. Leave empty for no navigation.',
          },
        ],
      },
      {
        name: 'Layout',
        properties: [
          {
            key: 'justify',
            label: 'Align items',
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
            helpText:
              'Ignored when any child is set to the right group — those items always sit at the far end.',
          },
          {
            key: 'gap',
            label: 'Item gap',
            control: 'number',
            expectedType: 'number',
            bindable: false,
            defaultValue: 4,
          },
          {
            key: 'padding',
            label: 'Padding',
            control: 'spacing',
            expectedType: 'any',
            bindable: false,
            defaultValue: 8,
          },
          {
            key: 'sticky',
            label: 'Stick to top',
            control: 'toggle',
            expectedType: 'boolean',
            bindable: false,
            defaultValue: false,
            helpText: 'Keeps the bar visible while the page scrolls. Preview and published apps only.',
          },
        ],
      },
      {
        name: 'Style',
        properties: [
          {
            key: 'background',
            label: 'Background',
            control: 'color',
            expectedType: 'string',
            bindable: true,
            defaultValue: '#ffffff',
          },
          {
            key: 'textColor',
            label: 'Text colour',
            control: 'color',
            expectedType: 'string',
            bindable: true,
            defaultValue: '#0f172a',
          },
          {
            key: 'bordered',
            label: 'Bottom border',
            control: 'toggle',
            expectedType: 'boolean',
            bindable: false,
            defaultValue: true,
          },
          {
            key: 'borderColor',
            label: 'Border colour',
            control: 'color',
            expectedType: 'string',
            bindable: false,
            defaultValue: '#e2e8f0',
            visibleWhen: { key: 'bordered', equals: true },
          },
          {
            key: 'borderWidth',
            label: 'Border width',
            control: 'number',
            expectedType: 'number',
            bindable: false,
            defaultValue: 1,
            visibleWhen: { key: 'bordered', equals: true },
          },
        ],
      },
    ],
  },
};

export const navLinkWidget: RegisteredWidget = {
  component: NavLinkWidget,
  definition: {
    type: 'nav_link',
    displayName: 'Link',
    category: 'layout',
    icon: 'link',
    defaultLayout: { x: 0, y: 0, w: 3, h: 2 },
    minSize: { w: 2, h: 1 },
    events: [{ key: 'onClick', label: 'On click', payloadKeys: ['label', 'toKind', 'pageId', 'href'] }],
    exposedState: [
      { key: 'active', type: 'boolean', description: 'Whether this link points at the current page' },
    ],
    properties: [
      CONTENT_PROPERTIES,
      DESTINATION_PROPERTIES,
      ITEM_LAYOUT_PROPERTIES,
      {
        name: 'Events',
        properties: [
          {
            key: 'onClick',
            label: 'On click',
            control: 'action_list',
            expectedType: 'array',
            bindable: false,
            helpText: 'Runs before the built-in page or URL navigation.',
          },
        ],
      },
    ],
  },
};

export const navMenuWidget: RegisteredWidget = {
  component: NavMenuWidget,
  definition: {
    type: 'nav_menu',
    displayName: 'Menu',
    category: 'layout',
    icon: 'menu',
    isContainer: true,
    childLayout: 'flow',
    defaultLayout: { x: 0, y: 0, w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    events: [],
    exposedState: [
      { key: 'open', type: 'boolean', description: 'Whether the dropdown is showing' },
    ],
    properties: [
      {
        name: 'Content',
        properties: [
          {
            key: 'label',
            label: 'Label',
            control: 'text',
            expectedType: 'string',
            bindable: true,
            defaultValue: 'Menu',
          },
          {
            key: 'icon',
            label: 'Icon',
            control: 'icon',
            expectedType: 'string',
            bindable: true,
            helpText: 'A React icon or an emoji shown before the label.',
          },
        ],
      },
      {
        name: 'Layout',
        properties: [
          {
            key: 'align',
            label: 'Navbar side',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'start',
            options: [
              { value: 'start', label: 'Left group' },
              { value: 'end', label: 'Right group' },
            ],
          },
          {
            key: 'menuAlign',
            label: 'Dropdown aligns',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'left',
            options: [
              { value: 'left', label: 'Left edge' },
              { value: 'right', label: 'Right edge' },
            ],
          },
          {
            key: 'visible',
            label: 'Visible',
            control: 'toggle',
            expectedType: 'boolean',
            bindable: true,
            defaultValue: true,
          },
          {
            key: 'disabled',
            label: 'Disabled',
            control: 'toggle',
            expectedType: 'boolean',
            bindable: true,
            defaultValue: false,
          },
        ],
      },
    ],
  },
};
