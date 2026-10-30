import type { CSSProperties } from 'react';
import clsx from 'clsx';
import type { NavAppearance, NavigationDsl } from '@swiftly/shared';
import {
  COLLAPSED_SIDEBAR_WIDTH,
  resolveSidebarWidth,
} from '@swiftly/shared';

export function navAppearanceOf(navigation: NavigationDsl): NavAppearance {
  return navigation.appearance === 'light' || navigation.appearance === 'brand'
    ? navigation.appearance
    : 'dark';
}

export function sidebarSideOf(navigation: NavigationDsl): 'left' | 'right' {
  return navigation.sidebarPosition === 'right' ? 'right' : 'left';
}

export function expandedSidebarWidth(navigation: NavigationDsl): number {
  return resolveSidebarWidth(navigation.sidebarWidth);
}

export function currentSidebarWidth(navigation: NavigationDsl, collapsed: boolean): number {
  return collapsed ? COLLAPSED_SIDEBAR_WIDTH : expandedSidebarWidth(navigation);
}

export function sidebarShellClass(
  appearance: NavAppearance,
  side: 'left' | 'right',
): string {
  const edge = side === 'right' ? 'border-l' : 'border-r';
  if (appearance === 'light') {
    return clsx(edge, 'border-slate-200 bg-slate-50 text-slate-700');
  }
  if (appearance === 'brand') {
    return clsx(edge, 'border-black/10 text-white');
  }
  return clsx(edge, 'border-white/10 bg-slate-950 text-slate-200');
}

export function sidebarShellStyle(
  appearance: NavAppearance,
  accent: string,
  width: number,
): CSSProperties {
  return {
    width,
    ...(appearance === 'brand' ? { background: accent } : {}),
  };
}

export function sidebarTitleClass(appearance: NavAppearance): string {
  return appearance === 'light' ? 'text-slate-900' : 'text-white';
}

export function sidebarHintClass(appearance: NavAppearance): string {
  return appearance === 'light' ? 'text-slate-400' : 'text-white/50';
}

export function sidebarCollapseClass(appearance: NavAppearance): string {
  if (appearance === 'light') {
    return 'text-slate-400 hover:bg-slate-200 hover:text-slate-700';
  }
  return 'text-white/60 hover:bg-white/10 hover:text-white';
}

export function sidebarItemClass(appearance: NavAppearance, horizontal: boolean): string {
  if (horizontal) {
    return appearance === 'dark'
      ? 'text-slate-300 hover:bg-white/10 hover:text-white'
      : appearance === 'brand'
        ? 'text-white/80 hover:bg-white/15 hover:text-white'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900';
  }
  if (appearance === 'light') {
    return 'text-slate-600 hover:bg-white hover:text-slate-900';
  }
  return 'text-slate-300 hover:bg-white/10 hover:text-white';
}

export function topbarShellClass(appearance: NavAppearance): string {
  if (appearance === 'light') {
    return 'border-b border-slate-200 bg-white text-slate-800';
  }
  if (appearance === 'brand') {
    return 'border-b border-black/10 text-white';
  }
  return 'border-b border-white/10 bg-slate-950 text-slate-100';
}

export function topbarShellStyle(appearance: NavAppearance, accent: string): CSSProperties {
  return appearance === 'brand' ? { background: accent } : {};
}
