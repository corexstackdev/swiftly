import { useState } from 'react';
import clsx from 'clsx';
import type { NavItemDsl, NavigationDsl, ThemeDsl } from '@swiftly/shared';
import type { AppRuntime, Notification } from './useAppRuntime';
import { IconGlyph, hasIcon } from '@/icons/IconGlyph';
import {
  currentSidebarWidth,
  navAppearanceOf,
  sidebarCollapseClass,
  sidebarItemClass,
  sidebarShellClass,
  sidebarShellStyle,
  sidebarSideOf,
  sidebarTitleClass,
  topbarShellClass,
  topbarShellStyle,
} from './navChrome';

/**
 * App chrome: navigation and notifications, rendered around every page.
 *
 * Nav items can hide themselves with `visibleWhen`, but hiding is cosmetic — the
 * server enforces each page's `requiredPermissions` on the runtime route, so a
 * hidden page is not a reachable one.
 */

export function AppShell({
  navigation,
  runtime,
  children,
  header,
  theme,
}: {
  navigation: NavigationDsl;
  runtime: AppRuntime;
  children: React.ReactNode;
  header?: React.ReactNode;
  theme?: ThemeDsl;
}) {
  const [collapsed, setCollapsed] = useState(navigation.collapsedByDefault ?? false);
  const accent = theme?.primaryColor || '#2563eb';
  const appearance = navAppearanceOf(navigation);
  const side = sidebarSideOf(navigation);
  const width = currentSidebarWidth(navigation, collapsed);

  const sidebar =
    navigation.style === 'sidebar' ? (
      <nav
        className={clsx(
          'flex h-full min-h-0 shrink-0 flex-col self-stretch transition-[width]',
          sidebarShellClass(appearance, side),
        )}
        style={sidebarShellStyle(appearance, accent, width)}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-3">
          {!collapsed && (
            <span className={clsx('truncate text-sm font-semibold tracking-tight', sidebarTitleClass(appearance))}>
              {navigation.title ?? 'Menu'}
            </span>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((previous) => !previous)}
            className={clsx('rounded p-1', sidebarCollapseClass(appearance))}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          >
            {collapsed ? (side === 'right' ? '«' : '»') : side === 'right' ? '»' : '«'}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
          <NavList
            items={navigation.items}
            runtime={runtime}
            collapsed={collapsed}
            depth={0}
            accent={accent}
            appearance={appearance}
          />
        </div>
      </nav>
    ) : null;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white">
      {header}

      <div
        className={clsx(
          'flex min-h-0 flex-1 items-stretch',
          side === 'right' && navigation.style === 'sidebar' && 'flex-row-reverse',
        )}
      >
        {sidebar}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {navigation.style === 'topbar' && (
            <nav
              className={clsx(
                'flex shrink-0 items-center gap-1 overflow-x-auto px-4 py-2',
                topbarShellClass(appearance),
              )}
              style={topbarShellStyle(appearance, accent)}
            >
              <span className={clsx('mr-3 text-sm font-semibold', sidebarTitleClass(appearance))}>
                {navigation.title ?? ''}
              </span>
              <NavList
                items={navigation.items}
                runtime={runtime}
                collapsed={false}
                depth={0}
                horizontal
                accent={accent}
                appearance={appearance}
              />
            </nav>
          )}
          <main className="min-h-0 flex-1 overflow-auto bg-white">{children}</main>
        </div>
      </div>

      <NotificationStack
        notifications={runtime.notifications}
        onDismiss={runtime.dismissNotification}
      />
    </div>
  );
}

function NavList({
  items,
  runtime,
  collapsed,
  depth,
  horizontal = false,
  accent,
  appearance,
}: {
  items: NavItemDsl[];
  runtime: AppRuntime;
  collapsed: boolean;
  depth: number;
  horizontal?: boolean;
  accent: string;
  appearance: ReturnType<typeof navAppearanceOf>;
}) {
  return (
    <ul className={clsx(horizontal ? 'flex items-center gap-1' : 'flex flex-col gap-0.5')}>
      {items.map((item) => (
        <NavEntry
          key={item.id}
          item={item}
          runtime={runtime}
          collapsed={collapsed}
          depth={depth}
          horizontal={horizontal}
          accent={accent}
          appearance={appearance}
        />
      ))}
    </ul>
  );
}

function NavEntry({
  item,
  runtime,
  collapsed,
  depth,
  horizontal,
  accent,
  appearance,
}: {
  item: NavItemDsl;
  runtime: AppRuntime;
  collapsed: boolean;
  depth: number;
  horizontal: boolean;
  accent: string;
  appearance: ReturnType<typeof navAppearanceOf>;
}) {
  const [expanded, setExpanded] = useState(true);
  const isActive = item.target.kind === 'page' && item.target.pageId === runtime.currentPageId;
  const hasChildren = Boolean(item.children && item.children.length > 0);

  const activate = () => {
    if (item.target.kind === 'page') {
      runtime.navigateToPage(item.target.pageId, item.target.params);
    } else if (item.target.kind === 'url') {
      if (item.target.newTab) window.open(item.target.href, '_blank', 'noopener,noreferrer');
      else window.location.href = item.target.href;
    } else {
      setExpanded((previous) => !previous);
    }
  };

  return (
    <li>
      <button
        type="button"
        onClick={activate}
        title={collapsed ? item.label : undefined}
        style={{
          paddingLeft: horizontal ? undefined : 8 + depth * 12,
          ...(isActive
            ? {
                background: `${accent}33`,
                color: appearance === 'light' ? accent : '#ffffff',
              }
            : undefined),
        }}
        className={clsx(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
          isActive ? 'font-medium' : sidebarItemClass(appearance, horizontal),
        )}
      >
        {hasIcon(item.icon) && !collapsed ? (
          <IconGlyph name={item.icon} size={16} className="w-4 shrink-0" />
        ) : null}
        {!collapsed && <span className="truncate">{item.label}</span>}
        {collapsed &&
          (hasIcon(item.icon) ? (
            <IconGlyph name={item.icon} size={16} className="mx-auto" />
          ) : (
            <span className="mx-auto text-xs font-semibold">
              {item.label.charAt(0).toUpperCase()}
            </span>
          ))}
        {hasChildren && !collapsed && (
          <span className="ml-auto text-xs opacity-60">{expanded ? '▾' : '▸'}</span>
        )}
      </button>

      {hasChildren && expanded && !collapsed && (
        <NavList
          items={item.children!}
          runtime={runtime}
          collapsed={collapsed}
          depth={depth + 1}
          horizontal={false}
          accent={accent}
          appearance={appearance}
        />
      )}
    </li>
  );
}

function NotificationStack({
  notifications,
  onDismiss,
}: {
  notifications: Notification[];
  onDismiss: (id: number) => void;
}) {
  if (notifications.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2">
      {notifications.map((notification) => (
        <button
          key={notification.id}
          type="button"
          onClick={() => onDismiss(notification.id)}
          className={clsx(
            'pointer-events-auto max-w-sm rounded border px-3 py-2 text-left text-sm shadow-lg',
            notification.variant === 'error' && 'border-red-200 bg-red-50 text-red-800',
            notification.variant === 'success' && 'border-green-200 bg-green-50 text-green-800',
            notification.variant === 'warning' && 'border-amber-200 bg-amber-50 text-amber-800',
            notification.variant === 'info' && 'border-slate-200 bg-white text-slate-800',
          )}
        >
          {notification.message}
        </button>
      ))}
    </div>
  );
}
