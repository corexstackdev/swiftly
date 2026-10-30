import type { ReactNode } from 'react';
import clsx from 'clsx';
import type { NavigationDsl, PageDsl, ThemeDsl } from '@swiftly/shared';
import { IconGlyph, hasIcon } from '@/icons/IconGlyph';
import {
  expandedSidebarWidth,
  navAppearanceOf,
  sidebarHintClass,
  sidebarItemClass,
  sidebarShellClass,
  sidebarShellStyle,
  sidebarSideOf,
  sidebarTitleClass,
  topbarShellClass,
  topbarShellStyle,
} from '@/runtime/navChrome';

/**
 * App chrome around the design canvas.
 *
 * Preview and published apps already wrap every page in a sidebar or top bar.
 * The canvas used to be a bare grid, so builders could not see or use the
 * navigation they were configuring. This frame is that chrome, clickable so a
 * page can be opened without leaving the canvas.
 */

export function DesignAppFrame({
  navigation,
  pages,
  currentPageId,
  theme,
  children,
  onNavigate,
}: {
  navigation: NavigationDsl;
  pages: PageDsl[];
  currentPageId: string;
  theme: ThemeDsl;
  children: ReactNode;
  onNavigate: (pageId: string) => void;
}) {
  const style = navigation.style ?? 'sidebar';
  const accent = theme.primaryColor || '#2563eb';
  const appearance = navAppearanceOf(navigation);
  const side = sidebarSideOf(navigation);
  const sidebarWidth = expandedSidebarWidth(navigation);

  const sidebar =
    style === 'sidebar' ? (
      <DesignSidebar
        navigation={navigation}
        pages={pages}
        currentPageId={currentPageId}
        accent={accent}
        width={sidebarWidth}
        side={side}
        appearance={appearance}
        onNavigate={onNavigate}
      />
    ) : null;

  return (
    <div
      className={clsx(
        'flex h-full min-h-0 items-stretch overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm',
        side === 'right' && style === 'sidebar' && 'flex-row-reverse',
      )}
    >
      {sidebar}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {style === 'topbar' && (
          <DesignTopbar
            navigation={navigation}
            pages={pages}
            currentPageId={currentPageId}
            accent={accent}
            appearance={appearance}
            onNavigate={onNavigate}
          />
        )}
        {style === 'none' && (
          <DesignPageStrip
            pages={pages}
            currentPageId={currentPageId}
            accent={accent}
            onNavigate={onNavigate}
          />
        )}
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function DesignSidebar({
  navigation,
  pages,
  currentPageId,
  accent,
  width,
  side,
  appearance,
  onNavigate,
}: {
  navigation: NavigationDsl;
  pages: PageDsl[];
  currentPageId: string;
  accent: string;
  width: number;
  side: 'left' | 'right';
  appearance: ReturnType<typeof navAppearanceOf>;
  onNavigate: (pageId: string) => void;
}) {
  const items = navigation.items.length > 0 ? navigation.items : fallbackItems(pages);

  return (
    <nav
      className={clsx(
        'flex h-full min-h-0 shrink-0 flex-col self-stretch',
        sidebarShellClass(appearance, side),
      )}
      style={sidebarShellStyle(appearance, accent, width)}
    >
      <div className={clsx('border-b px-3 py-3', appearance === 'light' ? 'border-slate-200' : 'border-white/10')}>
        <div className={clsx('truncate text-sm font-semibold', sidebarTitleClass(appearance))}>
          {navigation.title || 'Menu'}
        </div>
        <div className={clsx('mt-0.5 text-[10px] tracking-wide uppercase', sidebarHintClass(appearance))}>
          App navigation
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto p-2">
        {items.map((item) => (
          <NavButton
            key={item.id}
            label={item.label}
            icon={item.icon}
            appearance={appearance}
            active={item.target.kind === 'page' && item.target.pageId === currentPageId}
            accent={accent}
            onClick={() => {
              if (item.target.kind === 'page') onNavigate(item.target.pageId);
            }}
            disabled={item.target.kind !== 'page'}
          />
        ))}
        {items.map((item) =>
          item.children?.map((child) => (
            <NavButton
              key={child.id}
              label={child.label}
              icon={child.icon}
              nested
              appearance={appearance}
              active={child.target.kind === 'page' && child.target.pageId === currentPageId}
              accent={accent}
              onClick={() => {
                if (child.target.kind === 'page') onNavigate(child.target.pageId);
              }}
              disabled={child.target.kind !== 'page'}
            />
          )),
        )}
      </div>
    </nav>
  );
}

function DesignTopbar({
  navigation,
  pages,
  currentPageId,
  accent,
  appearance,
  onNavigate,
}: {
  navigation: NavigationDsl;
  pages: PageDsl[];
  currentPageId: string;
  accent: string;
  appearance: ReturnType<typeof navAppearanceOf>;
  onNavigate: (pageId: string) => void;
}) {
  const items = navigation.items.length > 0 ? navigation.items : fallbackItems(pages);

  return (
    <nav
      className={clsx(
        'flex shrink-0 items-center gap-1 overflow-x-auto px-3 py-2',
        topbarShellClass(appearance),
      )}
      style={topbarShellStyle(appearance, accent)}
    >
      <span className={clsx('mr-2 shrink-0 text-sm font-semibold', sidebarTitleClass(appearance))}>
        {navigation.title || ''}
      </span>
      {items.flatMap((item) => [item, ...(item.children ?? [])]).map((item) => (
        <NavButton
          key={item.id}
          label={item.label}
          icon={item.icon}
          compact
          appearance={appearance}
          active={item.target.kind === 'page' && item.target.pageId === currentPageId}
          accent={accent}
          onClick={() => {
            if (item.target.kind === 'page') onNavigate(item.target.pageId);
          }}
          disabled={item.target.kind !== 'page'}
        />
      ))}
    </nav>
  );
}

function DesignPageStrip({
  pages,
  currentPageId,
  accent,
  onNavigate,
}: {
  pages: PageDsl[];
  currentPageId: string;
  accent: string;
  onNavigate: (pageId: string) => void;
}) {
  if (pages.length < 2) return null;

  return (
    <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-3 py-2">
      <span className="mr-1 shrink-0 text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
        Pages
      </span>
      {pages.map((page) => (
        <NavButton
          key={page.id}
          label={page.name}
          compact
          appearance="light"
          active={page.id === currentPageId}
          accent={accent}
          onClick={() => onNavigate(page.id)}
        />
      ))}
    </nav>
  );
}

function NavButton({
  label,
  icon,
  active,
  accent,
  onClick,
  disabled,
  compact,
  nested,
  appearance,
}: {
  label: string;
  icon?: string;
  active: boolean;
  accent: string;
  onClick: () => void;
  disabled?: boolean;
  compact?: boolean;
  nested?: boolean;
  appearance: ReturnType<typeof navAppearanceOf>;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'flex items-center gap-2 rounded-md text-left text-sm transition-colors',
        compact ? 'px-2.5 py-1' : 'w-full px-2.5 py-1.5',
        nested && 'pl-7',
        disabled && 'cursor-default opacity-50',
        active ? 'font-medium' : sidebarItemClass(appearance, Boolean(compact)),
      )}
      style={
        active
          ? {
              background: `${accent}33`,
              color: appearance === 'light' ? accent : '#ffffff',
            }
          : undefined
      }
    >
      {hasIcon(icon) ? <IconGlyph name={icon} size={16} className="w-4 shrink-0" /> : null}
      <span className="truncate">{label}</span>
    </button>
  );
}

function fallbackItems(pages: PageDsl[]): NavigationDsl['items'] {
  return pages.map((page) => ({
    id: `page_${page.id}`,
    label: page.name,
    target: { kind: 'page' as const, pageId: page.id },
  }));
}
