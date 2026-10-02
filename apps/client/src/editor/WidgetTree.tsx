import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { PageDsl, WidgetDsl } from '@swiftly/shared';
import { getWidgetDefinition } from '@/widgets/registry';

/**
 * The widget tree for the current page.
 *
 * Once containers nest, the canvas stops being a reliable way to select things: a
 * widget can be behind another, clipped by its container's scroll, or simply too
 * small to hit. The tree is the authoritative view of structure, and selection is
 * shared with the canvas in both directions.
 */

export function WidgetTree({
  page,
  selectedWidgetId,
  onSelect,
  onDelete,
}: {
  page: PageDsl | undefined;
  selectedWidgetId: string | null;
  onSelect: (widgetId: string) => void;
  onDelete: (widgetId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Reveal the selected widget when it is picked on the canvas inside a collapsed
  // container, so the tree never hides the thing the editor is pointing at.
  useEffect(() => {
    if (!selectedWidgetId || !page) return;
    const ancestors = ancestorsOf(page.widgets, selectedWidgetId);
    if (ancestors.length === 0) return;

    setCollapsed((previous) => {
      if (!ancestors.some((id) => previous.has(id))) return previous;
      const next = new Set(previous);
      for (const id of ancestors) next.delete(id);
      return next;
    });
  }, [selectedWidgetId, page]);

  if (!page || page.widgets.length === 0) {
    return (
      <p className="px-3 py-4 text-xs text-slate-400">
        No widgets on this page yet. Use <strong>New UI element</strong> to add one.
      </p>
    );
  }

  return (
    <ul className="py-1">
      <TreeLevel
        widgets={page.widgets}
        depth={0}
        collapsed={collapsed}
        onToggle={(id) =>
          setCollapsed((previous) => {
            const next = new Set(previous);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        selectedWidgetId={selectedWidgetId}
        onSelect={onSelect}
        onDelete={onDelete}
      />
    </ul>
  );
}

function TreeLevel({
  widgets,
  depth,
  collapsed,
  onToggle,
  selectedWidgetId,
  onSelect,
  onDelete,
}: {
  widgets: WidgetDsl[];
  depth: number;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  selectedWidgetId: string | null;
  onSelect: (widgetId: string) => void;
  onDelete: (widgetId: string) => void;
}) {
  return (
    <>
      {widgets.map((widget) => {
        const definition = getWidgetDefinition(widget.type);
        const children = widget.children ?? [];
        const hasChildren = children.length > 0;
        const isCollapsed = collapsed.has(widget.id);
        const isSelected = widget.id === selectedWidgetId;

        return (
          <li key={widget.id}>
            <div
              className={clsx(
                'group/node flex items-center gap-1 pr-1',
                isSelected ? 'bg-blue-50' : 'hover:bg-slate-100',
              )}
              style={{ paddingLeft: 6 + depth * 14 }}
            >
              {definition?.isContainer ? (
                <button
                  type="button"
                  onClick={() => onToggle(widget.id)}
                  aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                  className="w-3 shrink-0 text-[9px] text-slate-400 hover:text-slate-700"
                >
                  {hasChildren ? (isCollapsed ? '▸' : '▾') : ''}
                </button>
              ) : (
                <span className="w-3 shrink-0" />
              )}

              <button
                type="button"
                onClick={() => onSelect(widget.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
              >
                <TypeGlyph type={widget.type} isContainer={definition?.isContainer ?? false} />
                <span
                  className={clsx(
                    'truncate text-xs',
                    isSelected ? 'font-medium text-blue-700' : 'text-slate-700',
                  )}
                >
                  {widget.name}
                </span>
              </button>

              <button
                type="button"
                onClick={() => onDelete(widget.id)}
                aria-label={`Delete ${widget.name}`}
                className={clsx(
                  'rounded px-1 text-xs text-slate-400 hover:bg-red-100 hover:text-red-600',
                  isSelected ? 'opacity-100' : 'opacity-0 group-hover/node:opacity-100',
                )}
              >
                ×
              </button>
            </div>

            {hasChildren && !isCollapsed && (
              <ul>
                <TreeLevel
                  widgets={children}
                  depth={depth + 1}
                  collapsed={collapsed}
                  onToggle={onToggle}
                  selectedWidgetId={selectedWidgetId}
                  onSelect={onSelect}
                  onDelete={onDelete}
                />
              </ul>
            )}
          </li>
        );
      })}
    </>
  );
}

/**
 * A dashed outline marks a container, matching the palette: you can tell what
 * accepts children without reading the name.
 */
function TypeGlyph({ type, isContainer }: { type: string; isContainer: boolean }) {
  if (isContainer) {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0 text-slate-400">
        <rect
          x="1.5"
          y="2"
          width="11"
          height="10"
          rx="1.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeDasharray="2.5 1.8"
        />
      </svg>
    );
  }

  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0 text-slate-400">
      <rect
        x="1.5"
        y="2"
        width="11"
        height="10"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      {type === 'table' && (
        <>
          <path d="M1.5 5h11M5.5 5v7" stroke="currentColor" strokeWidth="1.2" />
        </>
      )}
      {type === 'text' && (
        <path d="M4.5 5h5M7 5v5" stroke="currentColor" strokeWidth="1.2" fill="none" />
      )}
      {type === 'button' && <rect x="3.5" y="5" width="7" height="4" rx="1" fill="currentColor" />}
      {type === 'input' && <path d="M3.5 7h4" stroke="currentColor" strokeWidth="1.2" />}
      {type === 'select' && (
        <path d="M5 6l2 2 2-2" stroke="currentColor" strokeWidth="1.2" fill="none" />
      )}
    </svg>
  );
}

/** Ids of every container between the page root and `widgetId`. */
function ancestorsOf(widgets: WidgetDsl[], widgetId: string, trail: string[] = []): string[] {
  for (const widget of widgets) {
    if (widget.id === widgetId) return trail;
    const found = ancestorsOf(widget.children ?? [], widgetId, [...trail, widget.id]);
    if (found.length > 0 || (widget.children ?? []).some((child) => child.id === widgetId)) {
      return found.length > 0 ? found : [...trail, widget.id];
    }
  }
  return [];
}
