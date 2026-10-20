import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { isAppLevelEntity, type PageDsl } from '@swiftly/shared';
import { control } from './controls';
import { isJsIdentifier, type JsBindingRef } from './jsObjectOps';

type MenuView = 'menu' | 'rename' | 'copy' | 'move' | 'bindings' | 'delete';

export function EntityScopeMenuButton({
  name,
  pageId,
  pages,
  currentPageId,
  bindings,
  onRename,
  onCopyToPage,
  onMoveToPage,
  onMakeGlobal,
  onCopyToThisPage,
  onDelete,
}: {
  name: string;
  pageId?: string;
  pages: PageDsl[];
  currentPageId: string;
  bindings: () => JsBindingRef[];
  onRename: (name: string) => void;
  onCopyToPage: (pageId: string) => void;
  onMoveToPage: (pageId: string) => void;
  onMakeGlobal: () => void;
  onCopyToThisPage: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<MenuView>('menu');
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const appLevel = isAppLevelEntity({ pageId });

  const close = () => {
    setOpen(false);
    setView('menu');
  };

  const openMenu = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    if (open) {
      close();
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.top, left: rect.right + 4 });
    setView('menu');
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const anchor = buttonRef.current;
      const menu = menuRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const menuWidth = menu?.offsetWidth ?? 220;
      const menuHeight = menu?.offsetHeight ?? 160;
      const gap = 4;
      let left = rect.right + gap;
      let top = rect.top;

      if (left + menuWidth > window.innerWidth - 8) {
        left = rect.left - menuWidth - gap;
      }
      if (left < 8) left = 8;
      if (top + menuHeight > window.innerHeight - 8) {
        top = Math.max(8, window.innerHeight - menuHeight - 8);
      }
      if (top < 8) top = 8;

      setPos({ top, left });
    };

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, view]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const otherPages = pages.filter((page) => page.id !== currentPageId);
  const hasOtherPages = otherPages.length > 0;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={openMenu}
        aria-label={`Actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-200 hover:text-slate-800"
      >
        <KebabIcon />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={`${name} actions`}
            style={{ top: pos.top, left: pos.left }}
            className="fixed z-[80] w-56 rounded-md border border-slate-200 bg-white shadow-lg"
          >
            {view !== 'menu' && (
              <div className="border-b border-slate-100 px-3 py-1.5 text-[11px] font-semibold text-slate-600">
                {view === 'rename' && `Rename ${name}`}
                {view === 'copy' && 'Copy to other page'}
                {view === 'move' && 'Move to other page'}
                {view === 'bindings' && `Bindings for ${name}`}
                {view === 'delete' && `Delete ${name}`}
              </div>
            )}

            {view === 'menu' && (
              <div className="py-1">
                <MenuItem onClick={() => setView('rename')}>Rename</MenuItem>
                {appLevel ? (
                  <MenuItem
                    onClick={() => {
                      onCopyToThisPage();
                      close();
                    }}
                  >
                    Copy to this page
                  </MenuItem>
                ) : (
                  <MenuItem
                    onClick={() => {
                      onMakeGlobal();
                      close();
                    }}
                  >
                    Make global
                  </MenuItem>
                )}
                <MenuItem
                  disabled={!hasOtherPages}
                  title={hasOtherPages ? undefined : 'Add another page first'}
                  onClick={() => setView('copy')}
                >
                  Copy to other page
                </MenuItem>
                <MenuItem
                  disabled={!hasOtherPages}
                  title={hasOtherPages ? undefined : 'Add another page first'}
                  onClick={() => setView('move')}
                >
                  Move to other page
                </MenuItem>
                <MenuItem onClick={() => setView('bindings')}>Show bindings</MenuItem>
                <div className="my-1 border-t border-slate-100" />
                <MenuItem danger onClick={() => setView('delete')}>
                  Delete
                </MenuItem>
              </div>
            )}

            {view === 'rename' && (
              <RenameForm
                initial={name}
                onCancel={() => setView('menu')}
                onCommit={(next) => {
                  onRename(next);
                  close();
                }}
              />
            )}

            {(view === 'copy' || view === 'move') && (
              <PagePicker
                pages={otherPages}
                emptyLabel="This app has no other pages."
                onPick={(targetPageId) => {
                  if (view === 'copy') onCopyToPage(targetPageId);
                  else onMoveToPage(targetPageId);
                  close();
                }}
                onBack={() => setView('menu')}
              />
            )}

            {view === 'bindings' && (
              <BindingsList refs={bindings()} onBack={() => setView('menu')} />
            )}

            {view === 'delete' && (
              <DeleteConfirm
                name={name}
                bindingCount={bindings().length}
                onCancel={() => setView('menu')}
                onConfirm={() => {
                  onDelete();
                  close();
                }}
              />
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

function MenuItem({
  children,
  onClick,
  disabled,
  title,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={
        danger
          ? 'flex w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent'
          : 'flex w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent'
      }
    >
      {children}
    </button>
  );
}

function DeleteConfirm({
  name,
  bindingCount,
  onConfirm,
  onCancel,
}: {
  name: string;
  bindingCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="px-3 py-2.5">
      <p className="text-xs font-medium text-slate-900">Delete “{name}”?</p>
      <p className="mt-1 text-[11px] text-slate-500">
        {bindingCount > 0
          ? `${bindingCount} binding${bindingCount === 1 ? '' : 's'} still call this and will break.`
          : 'Bindings that call this will stop resolving. This can be undone.'}
      </p>
      <div className="mt-2.5 flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function RenameForm({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const trimmed = value.trim();
  const valid = isJsIdentifier(trimmed) && trimmed !== initial;

  return (
    <form
      className="flex flex-col gap-2 p-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onCommit(trimmed);
      }}
    >
      <input
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value.replace(/[^\w]/g, ''))}
        aria-label="New name"
        className={control}
      />
      {!trimmed || isJsIdentifier(trimmed) ? null : (
        <p className="text-[11px] text-red-600">Use a letter or underscore, then letters, digits, or underscores.</p>
      )}
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={!valid}
          className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400"
        >
          Rename
        </button>
      </div>
    </form>
  );
}

function PagePicker({
  pages,
  emptyLabel,
  onPick,
  onBack,
}: {
  pages: PageDsl[];
  emptyLabel: string;
  onPick: (pageId: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="py-1">
      {pages.length === 0 && (
        <p className="px-3 py-2 text-xs text-slate-400">{emptyLabel}</p>
      )}
      {pages.map((page) => (
        <button
          key={page.id}
          type="button"
          role="menuitem"
          onClick={() => onPick(page.id)}
          className="flex w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
        >
          {page.name}
        </button>
      ))}
      <div className="border-t border-slate-100 px-3 py-1.5">
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          Back
        </button>
      </div>
    </div>
  );
}

function BindingsList({ refs, onBack }: { refs: JsBindingRef[]; onBack: () => void }) {
  return (
    <div className="max-h-64 overflow-auto">
      {refs.length === 0 ? (
        <p className="px-3 py-3 text-xs text-slate-400">No bindings reference this.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {refs.map((ref, index) => (
            <li key={`${ref.location}-${index}`} className="px-3 py-2">
              <div className="text-[11px] font-medium text-slate-700">{ref.location}</div>
              <code className="mt-0.5 block truncate text-[11px] text-slate-500">{ref.snippet}</code>
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-slate-100 px-3 py-1.5">
        <button type="button" onClick={onBack} className="text-xs text-slate-500 hover:text-slate-700">
          Back
        </button>
      </div>
    </div>
  );
}

function KebabIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <circle cx="8" cy="3" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="8" cy="13" r="1.5" />
    </svg>
  );
}
