import type { ApplicationDsl, NavItemDsl, NavTarget } from '@swiftly/shared';
import { IconPicker } from '@/icons/IconPicker';

/**
 * Edits the app's navigation items — the sidebar or top bar the runtime renders
 * around every page. Adding a page already appends a link; this is how you
 * reorder, group, retarget, or hide them.
 */

export function NavItemsEditor({
  dsl,
  onChange,
}: {
  dsl: ApplicationDsl;
  onChange: (mutate: (dsl: ApplicationDsl) => void, label?: string) => void;
}) {
  const items = dsl.navigation.items;

  const updateItems = (next: NavItemDsl[], label: string): void => {
    onChange((draft) => {
      draft.navigation.items = next;
    }, label);
  };

  const patch = (index: number, next: Partial<NavItemDsl>): void => {
    updateItems(
      items.map((item, i) => (i === index ? { ...item, ...next } : item)),
      'nav-item',
    );
  };

  const patchTarget = (index: number, target: NavTarget): void => {
    patch(index, { target });
  };

  const move = (from: number, to: number): void => {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [item] = next.splice(from, 1);
    if (!item) return;
    next.splice(to, 0, item);
    updateItems(next, 'nav-reorder');
  };

  return (
    <div className="flex flex-col gap-2">
      {items.length === 0 ? (
        <p className="text-[11px] text-slate-400">
          No links yet. Add a page, or add a link below.
        </p>
      ) : null}

      {items.map((item, index) => (
        <div key={item.id} className="rounded border border-slate-200 bg-slate-50 p-2">
          <div className="flex items-center gap-1">
            <input
              value={item.label}
              onChange={(event) => patch(index, { label: event.target.value })}
              className={inputClass}
              aria-label="Label"
            />
            <button
              type="button"
              title="Move up"
              disabled={index === 0}
              onClick={() => move(index, index - 1)}
              className={iconButton}
            >
              ↑
            </button>
            <button
              type="button"
              title="Move down"
              disabled={index === items.length - 1}
              onClick={() => move(index, index + 1)}
              className={iconButton}
            >
              ↓
            </button>
            <button
              type="button"
              title="Remove"
              onClick={() =>
                updateItems(
                  items.filter((_, i) => i !== index),
                  'nav-remove',
                )
              }
              className={`${iconButton} hover:text-red-600`}
            >
              ×
            </button>
          </div>

          <div className="mt-1.5 grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-1.5">
            <span className="text-[11px] text-slate-500">Icon</span>
            <IconPicker
              compact
              value={item.icon ?? ''}
              onChange={(next) => patch(index, { icon: next || undefined })}
            />
            <span className="text-[11px] text-slate-500">Opens</span>
            <select
              value={item.target.kind}
              onChange={(event) => {
                const kind = event.target.value as NavTarget['kind'];
                if (kind === 'page') {
                  patchTarget(index, {
                    kind: 'page',
                    pageId: dsl.pages[0]?.id ?? '',
                  });
                } else if (kind === 'url') {
                  patchTarget(index, { kind: 'url', href: '' });
                } else {
                  patchTarget(index, { kind: 'group' });
                }
              }}
              className={inputClass}
            >
              <option value="page">A page</option>
              <option value="url">A URL</option>
              <option value="group">A group</option>
            </select>

            {item.target.kind === 'page' ? (
              <>
                <span className="text-[11px] text-slate-500">Page</span>
                <select
                  value={item.target.pageId}
                  onChange={(event) =>
                    patchTarget(index, { kind: 'page', pageId: event.target.value })
                  }
                  className={inputClass}
                >
                  {dsl.pages.map((page) => (
                    <option key={page.id} value={page.id}>
                      {page.name}
                    </option>
                  ))}
                </select>
              </>
            ) : null}

            {item.target.kind === 'url' ? (
              <>
                <span className="text-[11px] text-slate-500">URL</span>
                <input
                  value={item.target.href}
                  placeholder="https://"
                  onChange={(event) =>
                    patchTarget(index, { kind: 'url', href: event.target.value })
                  }
                  className={inputClass}
                />
              </>
            ) : null}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => {
          const page = dsl.pages[0];
          updateItems(
            [
              ...items,
              {
                id: `nav_${Math.random().toString(36).slice(2, 8)}`,
                label: page?.name ?? 'Link',
                target: page
                  ? { kind: 'page', pageId: page.id }
                  : { kind: 'url', href: '' },
              },
            ],
            'nav-add',
          );
        }}
        className="rounded border border-dashed border-slate-300 px-2 py-1.5 text-xs text-slate-600 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
      >
        + Add link
      </button>
    </div>
  );
}

const inputClass =
  'w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-800 outline-none focus:border-blue-500';

const iconButton =
  'rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-30';
