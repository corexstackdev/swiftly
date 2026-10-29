import type { ReactNode } from 'react';
import clsx from 'clsx';
import type { NavigationDsl, PageDsl, ThemeDsl } from '@swiftly/shared';
import { IconGlyph, hasIcon } from '@/icons/IconGlyph';

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
  sidebarWidth,
  children,
  onNavigate,
}: {
  navigation: NavigationDsl;
  pages: PageDsl[];
  currentPageId: string;
  theme: ThemeDsl;
  sidebarWidth: number;
  children: ReactNode;
  onNavigate: (pageId: string) => void;
}) {
  const style = navigation.style ?? 'sidebar';
  const accent = theme.primaryColor || '#2563eb';

  return (
    <div className="flex min-h-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      {style === 'sidebar' && (
        <DesignSidebar
          navigation={navigation}
          pages={pages}
          currentPageId={currentPageId}
          accent={accent}
          width={sidebarWidth}
          onNavigate={onNavigate}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {style === 'topbar' && (
          <DesignTopbar
            navigation={navigation}
            pages={pages}
            currentPageId={currentPageId}
            accent={accent}
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
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

export const DESIGN_SIDEBAR_WIDTH = 200;

function DesignSidebar({
  navigation,
  pages,
  currentPageId,
  accent,
  width,
  onNavigate,
}: {
  navigation: NavigationDsl;
  pages: PageDsl[];
  currentPageId: string;
  accent: string;
  width: number;
  onNavigate: (pageId: string) => void;
}) {
  const items = navigation.items.length > 0 ? navigation.items : fallbackItems(pages);

  return (
    <nav
      className="sticky top-0 flex shrink-0 flex-col self-start border-r border-slate-200 bg-slate-50"
      style={{ width, minHeight: '100%' }}
    >
      <div className="border-b border-slate-200 px-3 py-3">
        <div className="truncate text-sm font-semibold text-slate-900">
          {navigation.title || 'Menu'}
        </div>
        <div className="mt-0.5 text-[10px] tracking-wide text-slate-400 uppercase">
          App navigation
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-2">
        {items.map((item) => (
          <NavButton
            key={item.id}
            label={item.label}
            icon={item.icon}
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
  onNavigate,
}: {
  navigation: NavigationDsl;
  pages: PageDsl[];
  currentPageId: string;
  accent: string;
  onNavigate: (pageId: string) => void;
}) {
  const items = navigation.items.length > 0 ? navigation.items : fallbackItems(pages);

  return (
    <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2">
      <span className="mr-2 shrink-0 text-sm font-semibold text-slate-900">
        {navigation.title || ''}
      </span>
      {items.flatMap((item) => [item, ...(item.children ?? [])]).map((item) => (
        <NavButton
          key={item.id}
          label={item.label}
          icon={item.icon}
          compact
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
}: {
  label: string;
  icon?: string;
  active: boolean;
  accent: string;
  onClick: () => void;
  disabled?: boolean;
  compact?: boolean;
  nested?: boolean;
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
        active
          ? 'font-medium'
          : 'text-slate-600 hover:bg-white hover:text-slate-900',
      )}
      style={
        active
          ? { background: `${accent}18`, color: accent }
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
