import { useMemo, useState } from 'react';
import clsx from 'clsx';
import type { WidgetDefinition } from '@swiftly/shared';
import { listWidgets } from '@/widgets/registry';
import { THUMBNAILS, fallbackThumbnail } from '@/widgets/thumbnails';
import { beginPaletteDrag, endPaletteDrag, notePaletteDrag, paletteDragMoved } from './paletteDrag';

/**
 * The widget palette.
 *
 * Items are native HTML5 drag sources because react-grid-layout's droppable canvas
 * listens for exactly those events — the drop lands on the grid cell under the
 * cursor with no coordinate maths of our own, and it works into a nested container
 * grid the same way it works on the page.
 *
 * Dragging is not the only way in. A palette that can only be dragged from makes
 * "put a button on the page" a gesture you can miss, and the list rows here are
 * deliberately short — so a click adds the widget at the foot of the page, which
 * is where a dragged one usually ends up anyway.
 *
 * Two densities, because a palette is asked for two different things. A list is
 * how you find something you can already name, and is what twenty-five widgets
 * and a growing set of custom components need. The thumbnails are how you find
 * something you cannot name yet, which is most of the first week.
 */

const CATEGORY_ORDER: WidgetDefinition['category'][] = [
  'layout',
  'input',
  'display',
  'data',
  'chart',
  'media',
  'custom',
];

const CATEGORY_LABELS: Record<string, string> = {
  layout: 'Layout',
  input: 'Inputs',
  display: 'Display',
  data: 'Data',
  chart: 'Charts',
  media: 'Media',
  custom: 'Custom components',
};

const DENSITY_KEY = 'swiftly.palette.density';

type Density = 'list' | 'grid';

export function WidgetPalette({ onAdd }: { onAdd?: (widgetType: string) => void }) {
  const [search, setSearch] = useState('');
  const [density, setDensity] = useState<Density>(readStoredDensity);
  const widgets = useMemo(() => listWidgets(), []);

  const setAndStore = (next: Density): void => {
    setDensity(next);
    try {
      window.localStorage.setItem(DENSITY_KEY, next);
    } catch {
      // Site data can be blocked; the palette still works, it just forgets.
    }
  };

  const { grouped, matchCount } = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matching = needle
      ? widgets.filter(
          (widget) =>
            widget.displayName.toLowerCase().includes(needle) ||
            widget.type.toLowerCase().includes(needle),
        )
      : widgets;

    return {
      matchCount: matching.length,
      grouped: CATEGORY_ORDER.map((category) => ({
        category,
        items: matching.filter((widget) => widget.category === category),
      })).filter((group) => group.items.length > 0),
    };
  }, [widgets, search]);

  const dragProps = (widget: WidgetDefinition) => ({
    draggable: true,
    unselectable: 'on' as const,
    onDragStart: (event: React.DragEvent) => {
      event.stopPropagation();
      beginPaletteDrag(widget.type, event);
    },
    onDrag: () => notePaletteDrag(),
    onDragEnd: () => endPaletteDrag(),
    onClick: () => {
      if (paletteDragMoved()) return;
      onAdd?.(widget.type);
    },
    title: onAdd ? `Drag onto the page, or click to add ${widget.displayName}` : widget.displayName,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1.5 px-2 pb-2">
        <div className="relative min-w-0 flex-1">
          <input
            autoFocus
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search"
            aria-label="Search UI elements"
            className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 outline-none transition-colors hover:border-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
          />
        </div>

        <div className="flex shrink-0 items-center gap-0.5 rounded border border-slate-200 p-0.5">
          <DensityButton current={density} value="list" onSelect={setAndStore} label="Compact list">
            <ListIcon />
          </DensityButton>
          <DensityButton current={density} value="grid" onSelect={setAndStore} label="Thumbnails">
            <GridIcon />
          </DensityButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto pb-3">
        {search.trim() !== '' && (
          <p className="px-3 pb-1 text-[10px] text-slate-400">
            {matchCount} of {widgets.length}
          </p>
        )}

        {grouped.map((group) => (
          <div key={group.category}>
            {/* Sticky, so a long category still says what you are looking at once
                its first rows have scrolled past. */}
            <h3 className="sticky top-0 z-10 bg-white/95 px-3 py-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase backdrop-blur">
              {CATEGORY_LABELS[group.category] ?? group.category}
            </h3>

            {density === 'list' ? (
              <ul>
                {group.items.map((widget) => (
                  <li
                    key={widget.type}
                    {...dragProps(widget)}
                    className="group/item cursor-grab list-none active:cursor-grabbing"
                  >
                    <div className="flex items-center gap-2 py-1 pr-2 pl-2.5 transition-colors group-hover/item:bg-blue-50">
                      <span className="flex h-4 w-6 shrink-0 items-center justify-center text-slate-400 [&>svg]:h-full [&>svg]:w-full">
                        {THUMBNAILS[widget.type] ?? fallbackThumbnail()}
                      </span>
                      <span className="truncate text-xs text-slate-700">{widget.displayName}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="grid grid-cols-3 gap-1 px-2 pt-0.5 pb-2">
                {group.items.map((widget) => (
                  <div
                    key={widget.type}
                    {...dragProps(widget)}
                    className="flex cursor-grab flex-col items-center gap-0.5 rounded border border-transparent px-0.5 py-1.5 text-center transition-colors hover:border-blue-300 hover:bg-blue-50 active:cursor-grabbing"
                  >
                    <span className="flex h-6 w-9 items-center justify-center text-slate-400 [&>svg]:h-full [&>svg]:w-full">
                      {THUMBNAILS[widget.type] ?? fallbackThumbnail()}
                    </span>
                    <span className="w-full truncate text-[10px] leading-tight text-slate-600">
                      {widget.displayName}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {grouped.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-slate-400">
            Nothing matches “{search}”.
          </p>
        )}
      </div>
    </div>
  );
}

function DensityButton({
  current,
  value,
  onSelect,
  label,
  children,
}: {
  current: Density;
  value: Density;
  onSelect: (value: Density) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={current === value}
      onClick={() => onSelect(value)}
      className={clsx(
        'rounded p-1 transition-colors',
        current === value ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:text-slate-600',
      )}
    >
      {children}
    </button>
  );
}

function readStoredDensity(): Density {
  try {
    return window.localStorage.getItem(DENSITY_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

function ListIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <rect x="1.5" y="2.5" width="11" height="2" rx="1" />
      <rect x="1.5" y="6" width="11" height="2" rx="1" />
      <rect x="1.5" y="9.5" width="11" height="2" rx="1" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <rect x="1.5" y="1.5" width="4.5" height="4.5" rx="1" />
      <rect x="8" y="1.5" width="4.5" height="4.5" rx="1" />
      <rect x="1.5" y="8" width="4.5" height="4.5" rx="1" />
      <rect x="8" y="8" width="4.5" height="4.5" rx="1" />
    </svg>
  );
}
