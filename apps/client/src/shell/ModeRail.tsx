import { NavLink } from 'react-router-dom';
import clsx from 'clsx';

/**
 * The persistent mode rail.
 *
 * Editor, Data and Settings are peers, not panels inside one another. Managing
 * datasources needs a full screen — a schema tree and a row preview do not fit in a
 * strip under the canvas — while editing a query needs to stay next to the widget
 * it feeds. So connections are managed here and queries are still written in the
 * editor; the split follows what each task needs on screen.
 */

export function ModeRail({ applicationId }: { applicationId: string }) {
  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-slate-200 bg-white py-2">
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded border-2 border-orange-500 font-mono text-sm font-bold text-slate-900">
        a
      </div>

      <RailLink to={`/apps/${applicationId}/edit`} label="Editor">
        <EditorIcon />
      </RailLink>
      <RailLink to={`/apps/${applicationId}/data`} label="Data">
        <DataIcon />
      </RailLink>

      <div className="mt-auto flex flex-col items-center gap-1">
        <RailLink to={`/apps/${applicationId}/settings`} label="Settings">
          <SettingsIcon />
        </RailLink>
      </div>
    </nav>
  );
}

function RailLink({
  to,
  label,
  children,
}: {
  to: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      title={label}
      className={({ isActive }) =>
        clsx(
          'flex w-12 flex-col items-center gap-0.5 rounded py-1.5 text-[10px] transition-colors',
          isActive
            ? 'bg-slate-100 text-slate-900'
            : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600',
        )
      }
    >
      {children}
      <span>{label}</span>
    </NavLink>
  );
}

/* Inline SVGs rather than an icon package: five icons do not justify a dependency,
   and these inherit currentColor so the active state needs no extra rules. */

function EditorIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2.5" y="3" width="15" height="14" rx="1.5" />
      <path d="M2.5 7.5h15M7 7.5V17" />
    </svg>
  );
}

function DataIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <ellipse cx="10" cy="5" rx="6.5" ry="2.5" />
      <path d="M3.5 5v10c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V5" />
      <path d="M3.5 10c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2v2m0 12v2M2 10h2m12 0h2M4.3 4.3l1.4 1.4m8.6 8.6l1.4 1.4M4.3 15.7l1.4-1.4m8.6-8.6l1.4-1.4" />
    </svg>
  );
}
