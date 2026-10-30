import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { SearchField, control, controlCompact } from '@/editor/controls';
import { ICON_PACKS, searchIcons, type IconEntry } from './catalog';
import { IconGlyph, hasIcon } from './IconGlyph';

/**
 * Searchable react-icons picker.
 *
 * The value is the export name (`FiHome`). Bindings still type into the same
 * field, so `{{ appState.icon }}` keeps working on a property marked bindable.
 */

export function IconPicker({
  value,
  onChange,
  compact = false,
}: {
  value: unknown;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pack, setPack] = useState<'all' | IconEntry['pack']>('all');
  const current = String(value ?? '');
  const { matches, total } = useMemo(
    () => searchIcons(query, pack),
    [query, pack],
  );

  return (
    <div className="no-drag flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 shadow-sm">
          {hasIcon(current) ? <IconGlyph name={current} size={16} /> : (
            <span className="text-[10px] text-slate-300">—</span>
          )}
        </span>
        <input
          value={current}
          onChange={(event) => onChange(event.target.value)}
          placeholder="FiHome or 🏠"
          className={compact ? controlCompact : control}
        />
        {current ? (
          <button
            type="button"
            title="Clear icon"
            onClick={() => onChange('')}
            className="rounded px-1.5 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ×
          </button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        className="self-start rounded-md px-1.5 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
      >
        {open ? 'Hide icons' : 'Browse React Icons'}
      </button>

      {open && (
        <div className="rounded-lg border border-slate-200 bg-white p-1.5 shadow-sm">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search home, table, cart…"
            compact
            autoFocus
            className="mb-1.5"
          />
          <div className="mb-1.5 flex flex-wrap gap-1">
            <PackChip label="All" current={pack === 'all'} onClick={() => setPack('all')} />
            {ICON_PACKS.map((name) => (
              <PackChip
                key={name}
                label={name}
                current={pack === name}
                onClick={() => setPack(name)}
              />
            ))}
          </div>
          <div className="grid max-h-48 grid-cols-6 gap-0.5 overflow-auto">
            {matches.map((entry) => {
              const selected = current === entry.name;
              return (
                <button
                  key={entry.name}
                  type="button"
                  title={`${entry.name} · ${entry.pack}`}
                  onClick={() => {
                    onChange(entry.name);
                    setOpen(false);
                  }}
                  className={clsx(
                    'flex h-8 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100',
                    selected && 'bg-blue-50 text-blue-700 ring-1 ring-blue-400',
                  )}
                >
                  <entry.Component size={16} />
                </button>
              );
            })}
          </div>
          {total > matches.length ? (
            <p className="mt-1 text-center text-[10px] text-slate-400">
              {total - matches.length} more — refine the search
            </p>
          ) : matches.length === 0 ? (
            <p className="py-3 text-center text-[11px] text-slate-400">No icons match</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function PackChip({
  label,
  current,
  onClick,
}: {
  label: string;
  current: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'rounded-md px-1.5 py-0.5 text-[10px] font-medium',
        current ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
      )}
    >
      {label}
    </button>
  );
}
