import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { ApplicationDsl } from '@swiftly/shared';

/**
 * Page switcher, and everything else a page needs doing.
 *
 * A dropdown rather than tabs: tabs stop working somewhere past half a dozen
 * pages, and an internal tool that is worth building usually has more than that.
 *
 * Making a page happens on a named row at the foot of the list rather than on a
 * bare `+` in a corner, and the name is typed before the page exists — a page
 * that arrives called "Page3" and has to be corrected afterwards is a page whose
 * route was wrong for the minute in between. Renaming reuses the same field in
 * place, and each page shows the route it answers on, because a page with no
 * visible URL is hard to reason about.
 *
 * Typography follows the widget tree deliberately: both are lists of the things
 * this app is made of, and they read as one language when they are set the same.
 */

/** Below this many pages a filter box is just another thing in the way. */
const SEARCH_THRESHOLD = 6;

export function PagesDropdown({
  dsl,
  currentPageId,
  onSelect,
  onAdd,
  onSetDefault,
  onRename,
  onDelete,
}: {
  dsl: ApplicationDsl;
  currentPageId: string;
  onSelect: (pageId: string) => void;
  onAdd: (name: string) => void;
  onSetDefault: (pageId: string) => void;
  onRename: (pageId: string, name: string) => void;
  onDelete: (pageId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const current = dsl.pages.find((page) => page.id === currentPageId);

  /*
   * Every transient state belongs to one opening of the menu. A half-typed page
   * name or a delete waiting to be confirmed should not still be sitting there
   * the next time the menu opens.
   */
  const close = (): void => {
    setOpen(false);
    setQuery('');
    setCreating(false);
    setRenamingId(null);
    setConfirmingId(null);
  };

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? dsl.pages.filter(
        (page) =>
          page.name.toLowerCase().includes(needle) || page.slug.toLowerCase().includes(needle),
      )
    : dsl.pages;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        title="Switch page, or add one"
        className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-slate-100"
      >
        <span className="text-slate-400">Pages /</span>
        <span className="font-medium text-slate-900">{current?.name ?? '—'}</span>
        <span className="text-[10px] text-slate-400">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-80 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          <div className="flex items-center justify-between px-3 pt-1 pb-1.5">
            <span className="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
              Pages
            </span>
            <span className="text-[10px] text-slate-400">{dsl.pages.length}</span>
          </div>

          {dsl.pages.length > SEARCH_THRESHOLD && (
            <div className="px-2 pb-1.5">
              <input
                type="search"
                value={query}
                autoFocus
                placeholder="Find a page"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
                className="w-full rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-blue-500"
              />
            </div>
          )}

          <ul className="max-h-80 overflow-auto border-t border-slate-100 py-1">
            {visible.map((page) => {
              const isCurrent = page.id === currentPageId;

              if (renamingId === page.id) {
                return (
                  <li key={page.id}>
                    <NameField
                      initial={page.name}
                      confirmLabel="Rename"
                      onCancel={() => setRenamingId(null)}
                      onCommit={(name) => {
                        onRename(page.id, name);
                        setRenamingId(null);
                      }}
                    />
                  </li>
                );
              }

              return (
                <li key={page.id}>
                  <div
                    className={clsx(
                      'group/page flex items-center gap-1 pr-1 pl-1.5',
                      isCurrent ? 'bg-blue-50' : 'hover:bg-slate-100',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(page.id);
                        close();
                      }}
                      className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
                    >
                      <PageGlyph isDefault={page.isDefault} />
                      <span className="flex min-w-0 flex-col">
                        <span className="flex items-center gap-1.5">
                          <span
                            className={clsx(
                              'truncate text-xs',
                              isCurrent ? 'font-medium text-blue-700' : 'text-slate-700',
                            )}
                          >
                            {page.name}
                          </span>
                          {page.isDefault && (
                            <span className="shrink-0 rounded bg-slate-100 px-1 text-[9px] font-medium tracking-wide text-slate-500 uppercase">
                              Landing
                            </span>
                          )}
                        </span>
                        <span className="truncate text-[10px] text-slate-400">/{page.slug}</span>
                      </span>
                    </button>

                    {/* Shown at low contrast rather than on hover only: a page is
                        renamed once and deleted once, and an action nobody can
                        see is an action nobody knows is there. */}
                    {confirmingId === page.id ? (
                      <span className="flex shrink-0 items-center gap-1 pr-0.5">
                        <span className="text-[10px] text-slate-500">Delete?</span>
                        <button
                          type="button"
                          onClick={() => {
                            onDelete(page.id);
                            setConfirmingId(null);
                          }}
                          className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-red-700"
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingId(null)}
                          className="rounded px-1 py-0.5 text-[10px] text-slate-500 hover:bg-slate-200"
                        >
                          No
                        </button>
                      </span>
                    ) : (
                      <span className="flex shrink-0 items-center gap-0.5">
                        {!page.isDefault && (
                          <RowAction
                            title={`Make “${page.name}” the landing page`}
                            onClick={() => onSetDefault(page.id)}
                          >
                            ⌂
                          </RowAction>
                        )}
                        <RowAction
                          title={`Rename “${page.name}”`}
                          onClick={() => {
                            setConfirmingId(null);
                            setRenamingId(page.id);
                          }}
                        >
                          ✎
                        </RowAction>
                        {dsl.pages.length > 1 && (
                          <RowAction
                            title={`Delete “${page.name}”`}
                            danger
                            onClick={() => {
                              setRenamingId(null);
                              setConfirmingId(page.id);
                            }}
                          >
                            ×
                          </RowAction>
                        )}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}

            {visible.length === 0 && (
              <li className="px-3 py-3 text-xs text-slate-400">No page matches “{query}”.</li>
            )}
          </ul>

          <div className="border-t border-slate-100 px-2 pt-1.5 pb-1">
            {creating ? (
              <NameField
                initial=""
                placeholder="Page name"
                confirmLabel="Add page"
                onCancel={() => setCreating(false)}
                onCommit={(name) => {
                  onAdd(name);
                  close();
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setRenamingId(null);
                  setConfirmingId(null);
                  setCreating(true);
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded border border-slate-300 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
              >
                +&nbsp; New page
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The one field that both creating and renaming use.
 *
 * Enter commits and Escape cancels, and Escape is stopped here so it cancels the
 * edit rather than travelling on and closing the whole menu underneath it.
 */
function NameField({
  initial,
  placeholder,
  confirmLabel,
  onCommit,
  onCancel,
}: {
  initial: string;
  placeholder?: string;
  confirmLabel: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const trimmed = value.trim();

  return (
    <div className="flex items-center gap-1 px-1.5 py-1">
      <input
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter' && trimmed) onCommit(trimmed);
          if (event.key === 'Escape') onCancel();
        }}
        className="min-w-0 flex-1 rounded border border-blue-500 px-2 py-1 text-xs outline-none"
      />
      <button
        type="button"
        disabled={!trimmed}
        onClick={() => onCommit(trimmed)}
        className="rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400"
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded px-1.5 py-1 text-[11px] text-slate-500 hover:bg-slate-100"
      >
        Cancel
      </button>
    </div>
  );
}

function RowAction({
  title,
  danger,
  onClick,
  children,
}: {
  title: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={clsx(
        'rounded px-1 text-xs text-slate-300 transition-colors',
        danger ? 'hover:bg-red-100 hover:text-red-600' : 'hover:bg-slate-200 hover:text-slate-700',
      )}
    >
      {children}
    </button>
  );
}

/** Drawn to match the widget tree's glyphs, at the same 14px. */
function PageGlyph({ isDefault }: { isDefault: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0 text-slate-400">
      <rect
        x="2"
        y="1.5"
        width="10"
        height="11"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      {isDefault ? (
        // A roof, for the page the app opens on.
        <path d="M4.3 7.6 7 5.4l2.7 2.2M5.4 7.4v3h3.2v-3" fill="none" stroke="currentColor" strokeWidth="1.1" />
      ) : (
        <path d="M4.2 4.6h5.6M4.2 7h5.6M4.2 9.4h3.4" stroke="currentColor" strokeWidth="1.1" />
      )}
    </svg>
  );
}
