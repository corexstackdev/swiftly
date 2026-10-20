import { useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import clsx from 'clsx';
import { useSession } from '@/lib/session';

/**
 * The header every full-page screen outside the editor sits under.
 *
 * It is fixed, because it is the only thing on these screens that never changes:
 * where you are, where else you can go, and who you are signed in as. A list of
 * applications can run to several screens, and having to scroll back up to reach
 * the account menu is the kind of small friction that makes an internal tool
 * feel unfinished.
 *
 * The editor keeps its own header — it needs the room for page, undo, save state
 * and publish — so this is deliberately not shared with it.
 */

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="flex h-14 items-center gap-4 px-6">
        <Link to="/apps" className="flex items-center gap-2.5" title="All applications">
          {/* The same mark the editor rail carries, so the product reads as one
              thing rather than two screens that happen to share a login. */}
          <span className="flex h-8 w-8 items-center justify-center rounded border-2 border-orange-500 font-mono text-sm font-bold text-slate-900">
            S
          </span>
          <span className="text-sm font-semibold tracking-tight text-slate-900">
            Swiftly
          </span>
        </Link>

        <nav className="ml-4 flex items-center gap-1">
          <HeaderLink to="/apps">Applications</HeaderLink>
        </nav>

        <div className="ml-auto">
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}

function HeaderLink({
  to,
  badge,
  children,
}: {
  to: string;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors',
          isActive ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800',
        )
      }
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold text-white tabular-nums">
          {badge}
        </span>
      )}
    </NavLink>
  );
}

/**
 * Who you are, and the way out.
 *
 * The capability chips are derived from the permission list rather than named as
 * a role: the server never sends a role name, and inventing one here would be a
 * label that could quietly stop matching what the account can actually do.
 */
function AccountMenu() {
  const { user, logout, can } = useSession();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const capabilities = [
    user.isSuperAdmin && 'Administrator',
    can('app:edit') && 'Build apps',
    can('app:publish') && 'Publish',
    can('datasource:create') && 'Manage data',
  ].filter((entry): entry is string => typeof entry === 'string');

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={clsx(
          'flex items-center gap-2 rounded-full py-1 pr-2 pl-1 transition-colors',
          open ? 'bg-slate-100' : 'hover:bg-slate-100',
        )}
      >
        <Avatar name={user.name} seed={user.id} />
        <span className="hidden text-xs font-medium text-slate-700 sm:block">{user.name}</span>
        <span className="text-[10px] text-slate-400">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 z-50 mt-1.5 w-64 rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          <div className="flex items-start gap-2.5 px-3 pt-2 pb-3">
            <Avatar name={user.name} seed={user.id} size="lg" />
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-slate-900">{user.name}</span>
              <span className="block truncate text-[11px] text-slate-500">{user.email}</span>
            </span>
          </div>

          {capabilities.length > 0 && (
            <div className="flex flex-wrap gap-1 px-3 pb-2.5">
              {capabilities.map((capability) => (
                <span
                  key={capability}
                  className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                >
                  {capability}
                </span>
              ))}
            </div>
          )}

          <div className="border-t border-slate-100 pt-1">
            <p className="px-3 py-1.5 text-[10px] text-slate-400">
              Signed in with email and password. The session ends when you sign out or the
              token expires.
            </p>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void logout();
              }}
              className="w-full px-3 py-2 text-left text-xs font-medium text-red-600 hover:bg-red-50"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Initials on a colour picked from the account id.
 *
 * Derived rather than stored: the same person is the same colour on every screen
 * and in every browser, without a field on the user for it.
 */
export function Avatar({
  name,
  seed,
  size = 'sm',
}: {
  name: string;
  seed: string;
  size?: 'sm' | 'lg';
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <span
      aria-hidden="true"
      className={clsx(
        'flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        AVATAR_COLOURS[hash(seed) % AVATAR_COLOURS.length],
        size === 'lg' ? 'h-9 w-9 text-xs' : 'h-7 w-7 text-[11px]',
      )}
    >
      {initials || '?'}
    </span>
  );
}

const AVATAR_COLOURS = [
  'bg-blue-600',
  'bg-emerald-600',
  'bg-violet-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-cyan-700',
  'bg-indigo-600',
  'bg-teal-600',
];

/** Small, stable, and not a security boundary — only used to pick a colour. */
function hash(value: string): number {
  let total = 0;
  for (let index = 0; index < value.length; index += 1) {
    total = (total * 31 + value.charCodeAt(index)) >>> 0;
  }
  return total;
}
