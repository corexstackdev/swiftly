import clsx from 'clsx';
import { stateStyleToCss } from './stateStyle';
import { textStyleToCss } from './textStyle';

/**
 * Numbered page buttons with a sliding window, so a ten-page table is a row of
 * buttons rather than "3 / 10", and a hundred-page one still fits: first, last,
 * the current page and its neighbours, with an ellipsis for the gap.
 */

type PageItem = { kind: 'page'; index: number } | { kind: 'ellipsis'; id: string };

const ALL_PAGES_UP_TO = 7;

export function pageItems(page: number, pageCount: number, totalKnown: boolean): PageItem[] {
  const count = Math.max(1, pageCount);
  const current = Math.min(Math.max(page, 0), count - 1);

  if (!totalKnown) {
    const lastVisible = Math.min(count - 1, current + 1);
    const items: PageItem[] = [];
    for (let i = 0; i <= lastVisible; i += 1) items.push({ kind: 'page', index: i });
    return items;
  }

  if (count <= ALL_PAGES_UP_TO) {
    return Array.from({ length: count }, (_, index) => ({ kind: 'page' as const, index }));
  }

  const selected = new Set<number>([0, count - 1, current]);
  for (let i = current - 1; i <= current + 1; i += 1) {
    if (i > 0 && i < count - 1) selected.add(i);
  }
  if (current <= 2) {
    for (let i = 1; i <= Math.min(3, count - 2); i += 1) selected.add(i);
  }
  if (current >= count - 3) {
    for (let i = Math.max(1, count - 4); i < count - 1; i += 1) selected.add(i);
  }

  const ordered = [...selected].sort((a, b) => a - b);
  const items: PageItem[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const index = ordered[i]!;
    const previous = ordered[i - 1];
    if (previous !== undefined && index - previous > 1) {
      items.push({ kind: 'ellipsis', id: `${previous}-${index}` });
    }
    items.push({ kind: 'page', index });
  }
  return items;
}

export function PagerBar({
  page,
  pageCount,
  pageLength,
  pageSize,
  totalRows,
  totalKnown,
  properties,
  onGo,
  align = 'right',
  emptyRange = 'No rows',
}: {
  page: number;
  pageCount: number;
  pageLength: number;
  pageSize: number;
  totalRows: number;
  totalKnown: boolean;
  properties: Record<string, unknown>;
  onGo: (page: number) => void;
  align?: string;
  emptyRange?: string;
}) {
  const first = pageLength === 0 ? page * pageSize : page * pageSize + 1;
  const last = page * pageSize + pageLength;
  const range = totalKnown
    ? `${first.toLocaleString()}–${last.toLocaleString()} of ${totalRows.toLocaleString()}`
    : pageLength === 0
      ? emptyRange
      : `${first.toLocaleString()}–${last.toLocaleString()}`;

  const buttonStyle = stateStyleToCss(properties, 'pagerButton');
  const items = pageItems(page, pageCount, totalKnown);
  const atStart = page <= 0;
  const atEnd = page >= pageCount - 1;

  return (
    <nav
      aria-label="Pagination"
      style={{
        ...textStyleToCss(properties, 'pager'),
        ...(readColour(properties, 'pagerBackground')
          ? { background: readColour(properties, 'pagerBackground') }
          : {}),
      }}
      className={clsx(
        'no-drag flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-slate-200 px-2 py-1.5 text-xs text-slate-500',
        align === 'left' && 'justify-start',
        align === 'center' && 'justify-center',
        align === 'right' && 'justify-end',
      )}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {properties.pagerShowRange !== false && (
        <span
          className="mr-auto tabular-nums text-slate-500"
          style={{ order: align === 'left' ? 1 : 0 }}
        >
          {range}
        </span>
      )}

      <div className="flex items-center gap-0.5">
        <PagerButton
          style={buttonStyle}
          disabled={atStart}
          onClick={() => onGo(page - 1)}
          label="Previous page"
        >
          <Chevron dir="left" />
        </PagerButton>

        {items.map((item) =>
          item.kind === 'ellipsis' ? (
            <span
              key={item.id}
              aria-hidden="true"
              className="inline-flex h-7 min-w-5 items-center justify-center px-0.5 text-slate-400"
            >
              …
            </span>
          ) : (
            <PagerButton
              key={item.index}
              style={buttonStyle}
              current={item.index === page}
              onClick={() => onGo(item.index)}
              label={`Page ${item.index + 1}`}
            >
              {item.index + 1}
            </PagerButton>
          ),
        )}

        <PagerButton
          style={buttonStyle}
          disabled={atEnd}
          onClick={() => onGo(page + 1)}
          label="Next page"
        >
          <Chevron dir="right" />
        </PagerButton>
      </div>
    </nav>
  );
}

function PagerButton({
  style,
  disabled,
  current,
  onClick,
  label,
  children,
}: {
  style: React.CSSProperties;
  disabled?: boolean;
  current?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      draggable={false}
      aria-current={current ? 'page' : undefined}
      aria-label={label}
      title={label}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if (!disabled) onClick();
      }}
      style={current || disabled ? undefined : style}
      className={clsx(
        'no-drag inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md px-1.5 text-xs tabular-nums transition-colors',
        current && 'bg-blue-600 font-semibold text-white shadow-sm',
        disabled && 'cursor-not-allowed border border-slate-200 text-slate-300',
        !current &&
          !disabled &&
          'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
      )}
    >
      {children}
    </button>
  );
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
      <path
        d={dir === 'left' ? 'M10 3.5 5.5 8 10 12.5' : 'M6 3.5 10.5 8 6 12.5'}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function readColour(properties: Record<string, unknown>, key: string): string | undefined {
  const value = properties[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}
