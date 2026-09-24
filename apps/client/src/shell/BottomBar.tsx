import clsx from 'clsx';
import type { Environment } from '@/lib/api';

/**
 * The status bar.
 *
 * The environment selector lives here rather than in the toolbar because it applies
 * to everything on screen — the queries the editor runs, the connection the Data
 * section tests — and a control with that reach should not sit among per-page
 * actions where it reads as one.
 */

export function BottomBar({
  environments,
  environmentId,
  onEnvironmentChange,
  errorCount = 0,
  onShowErrors,
  status,
}: {
  environments: Environment[];
  environmentId: string;
  onEnvironmentChange: (id: string) => void;
  errorCount?: number;
  onShowErrors?: () => void;
  status?: React.ReactNode;
}) {
  const current = environments.find((environment) => environment.id === environmentId);

  return (
    <footer className="flex h-8 shrink-0 items-center gap-3 border-t border-slate-200 bg-white px-3 text-xs">
      <label className="flex items-center gap-1.5">
        <span className="sr-only">Environment</span>
        <select
          value={environmentId}
          onChange={(event) => onEnvironmentChange(event.target.value)}
          className={clsx(
            'rounded border px-1.5 py-0.5 text-xs font-medium',
            // Production is visually distinct: the cost of running the wrong query
            // against it is much higher than anywhere else.
            current?.isProduction
              ? 'border-amber-300 bg-amber-50 text-amber-900'
              : 'border-slate-300 bg-white text-slate-700',
          )}
        >
          {environments.map((environment) => (
            <option key={environment.id} value={environment.id}>
              {environment.name}
            </option>
          ))}
        </select>
      </label>

      {status}

      <div className="ml-auto flex items-center gap-3">
        {onShowErrors && (
          <button
            type="button"
            onClick={onShowErrors}
            className={clsx(
              'flex items-center gap-1 rounded px-1.5 py-0.5',
              errorCount > 0
                ? 'text-red-600 hover:bg-red-50'
                : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600',
            )}
          >
            Errors
            {errorCount > 0 && (
              <span className="rounded-full bg-red-100 px-1.5 text-[10px] font-medium text-red-700">
                {errorCount}
              </span>
            )}
          </button>
        )}
      </div>
    </footer>
  );
}
