import { useState } from 'react';
import clsx from 'clsx';
import type { NavItemDsl, NavigationDsl } from '@vinodapp/shared';
import type { AppRuntime, Notification } from './useAppRuntime';

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
}: {
  navigation: NavigationDsl;
  runtime: AppRuntime;
  children: React.ReactNode;
  header?: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(navigation.collapsedByDefault ?? false);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-slate-50">
      {header}

      <div className="flex min-h-0 flex-1">
        {navigation.style === 'sidebar' && (
          <nav
            className={clsx(
              'flex shrink-0 flex-col border-r border-slate-200 bg-white transition-all',
              collapsed ? 'w-12' : 'w-56',
            )}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5">
              {!collapsed && (
                <span className="truncate text-sm font-semibold text-slate-800">
                  {navigation.title ?? 'Menu'}
                </span>
              )}
              <button
                type="button"
                onClick={() => setCollapsed((previous) => !previous)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              >
                {collapsed ? '»' : '«'}
              </button>
            </div>
            <div className="flex-1 overflow-auto p-2">
              <NavList items={navigation.items} runtime={runtime} collapsed={collapsed} depth={0} />
            </div>
          </nav>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {navigation.style === 'topbar' && (
            <nav className="flex shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-3 py-2">
              <span className="mr-3 text-sm font-semibold text-slate-800">
                {navigation.title ?? ''}
              </span>
              <NavList items={navigation.items} runtime={runtime} collapsed={false} depth={0} horizontal />
            </nav>
          )}
          <main className="min-h-0 flex-1 overflow-auto p-4">{children}</main>
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
}: {
  items: NavItemDsl[];
  runtime: AppRuntime;
  collapsed: boolean;
  depth: number;
  horizontal?: boolean;
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
}: {
  item: NavItemDsl;
  runtime: AppRuntime;
  collapsed: boolean;
  depth: number;
  horizontal: boolean;
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
        style={{ paddingLeft: horizontal ? undefined : 8 + depth * 12 }}
        className={clsx(
          'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors',
          isActive
            ? 'bg-blue-50 font-medium text-blue-700'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        )}
      >
        {!collapsed && <span className="truncate">{item.label}</span>}
        {collapsed && <span className="mx-auto">{item.label.charAt(0).toUpperCase()}</span>}
        {hasChildren && !collapsed && (
          <span className="ml-auto text-xs text-slate-400">{expanded ? '▾' : '▸'}</span>
        )}
      </button>

      {hasChildren && expanded && !collapsed && (
        <NavList
          items={item.children!}
          runtime={runtime}
          collapsed={collapsed}
          depth={depth + 1}
          horizontal={false}
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
