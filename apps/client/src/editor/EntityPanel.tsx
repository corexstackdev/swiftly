import { useState } from 'react';
import clsx from 'clsx';
import type { ApplicationDsl, PageDsl } from '@swiftly/shared';
import type { DatasourceSummary } from '@/lib/api';
import { WidgetPalette } from './WidgetPalette';
import { WidgetTree } from './WidgetTree';

/**
 * The entity panel: the one place things get added.
 *
 * Queries, JS objects and widgets are the three kinds of entity an app is made of,
 * so they share a panel rather than being scattered around the editor. Selecting a
 * query here opens it in the bottom pane, next to the widgets that consume it.
 */

type EntityTab = 'queries' | 'js' | 'ui';

export function EntityPanel({
  dsl,
  page,
  datasources,
  selectedQueryName,
  selectedWidgetId,
  onSelectQuery,
  onCreateQuery,
  onDeleteQuery,
  onSelectWidget,
  onDeleteWidget,
  onCreateJsObject,
  onSelectJsObject,
  onAddWidget,
}: {
  dsl: ApplicationDsl;
  page: PageDsl | undefined;
  datasources: DatasourceSummary[];
  selectedQueryName: string | null;
  selectedWidgetId: string | null;
  onSelectQuery: (name: string | null) => void;
  onCreateQuery: (datasourceId: string) => void;
  onDeleteQuery: (name: string) => void;
  onSelectWidget: (widgetId: string) => void;
  /** Adds a widget from the palette without a drag. */
  onAddWidget: (widgetType: string) => void;
  onDeleteWidget: (widgetId: string) => void;
  onCreateJsObject: () => void;
  onSelectJsObject: (name: string) => void;
}) {
  const [tab, setTab] = useState<EntityTab>('ui');
  // The UI tab is the page's structure by default; the palette is what you open
  // to add to it. Once a page has widgets, finding one matters more than adding.
  const [showPalette, setShowPalette] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 border-b border-slate-200">
        <Tab active={tab === 'queries'} onClick={() => setTab('queries')}>
          Queries
          {dsl.queries.length > 0 && (
            <span className="ml-1 text-[10px] text-slate-400">{dsl.queries.length}</span>
          )}
        </Tab>
        <Tab active={tab === 'js'} onClick={() => setTab('js')}>
          {'{ } JS'}
        </Tab>
        <Tab active={tab === 'ui'} onClick={() => setTab('ui')}>
          UI
        </Tab>
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'ui' && (
          <div className="flex h-full flex-col">
            <div className="shrink-0 p-2">
              <button
                type="button"
                onClick={() => setShowPalette((previous) => !previous)}
                className={clsx(
                  'flex w-full items-center justify-center gap-1.5 rounded border py-1.5 text-xs font-medium transition-colors',
                  showPalette
                    ? 'border-slate-300 bg-slate-100 text-slate-700'
                    : 'border-slate-300 text-slate-600 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700',
                )}
              >
                {showPalette ? '\u00d7  Close' : '+  New UI element'}
              </button>
            </div>

            {/* The palette scrolls its own list so its search box and its
                sticky category headings stay put; the tree has no chrome of its
                own, so it gets the scrolling instead. */}
            <div className="min-h-0 flex-1 overflow-hidden">
              {showPalette ? (
                <WidgetPalette onAdd={onAddWidget} />
              ) : (
                <div className="h-full overflow-auto">
                  <WidgetTree
                    page={page}
                    selectedWidgetId={selectedWidgetId}
                    onSelect={onSelectWidget}
                    onDelete={onDeleteWidget}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'queries' && (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 px-2 py-1.5">
              <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                Queries
              </span>
              <select
                value=""
                onChange={(event) => event.target.value && onCreateQuery(event.target.value)}
                className="rounded border border-slate-300 px-1 py-0.5 text-xs"
                disabled={datasources.length === 0}
              >
                <option value="">+ New</option>
                {datasources.map((datasource) => (
                  <option key={datasource.id} value={datasource.id}>
                    {datasource.name}
                  </option>
                ))}
              </select>
            </div>

            <ul className="flex-1 overflow-auto p-1">
              {dsl.queries.map((query) => {
                const datasource = datasources.find(
                  (candidate) => candidate.id === query.datasourceId,
                );
                return (
                  <li key={query.id} className="group/query">
                    <div
                      className={clsx(
                        'flex items-center gap-1 rounded px-2 py-1',
                        query.name === selectedQueryName
                          ? 'bg-blue-50'
                          : 'hover:bg-slate-100',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectQuery(query.name)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span
                          className={clsx(
                            'block truncate text-xs',
                            query.name === selectedQueryName
                              ? 'font-medium text-blue-700'
                              : 'text-slate-700',
                          )}
                        >
                          {query.name}
                        </span>
                        <span className="block truncate text-[10px] text-slate-400">
                          {datasource?.name ?? 'Missing datasource'} · {query.mode}
                          {query.runOnPageLoad && ' · on load'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteQuery(query.name)}
                        className="rounded px-1 text-xs text-slate-400 opacity-0 group-hover/query:opacity-100 hover:bg-red-100 hover:text-red-600"
                        aria-label={`Delete ${query.name}`}
                      >
                        ×
                      </button>
                    </div>
                  </li>
                );
              })}

              {dsl.queries.length === 0 && (
                <li className="px-2 py-3 text-xs text-slate-400">
                  {datasources.length === 0
                    ? 'Connect a datasource in the Data section first.'
                    : 'No queries yet — pick a datasource from + New.'}
                </li>
              )}
            </ul>
          </div>
        )}

        {tab === 'js' && (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 px-2 py-1.5">
              <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                JS objects
              </span>
              <button
                type="button"
                onClick={onCreateJsObject}
                className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                + New
              </button>
            </div>

            <ul className="flex-1 overflow-auto p-1">
              {(dsl.jsObjects ?? []).map((jsObject) => (
                <li key={jsObject.id}>
                  <button
                    type="button"
                    onClick={() => onSelectJsObject(jsObject.name)}
                    className="w-full rounded px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-100"
                  >
                    {jsObject.name}
                  </button>
                </li>
              ))}

              {(dsl.jsObjects ?? []).length === 0 && (
                <li className="px-2 py-3 text-xs text-slate-400">
                  Shared helper functions, callable from any binding as{' '}
                  <code className="text-slate-500">Utils.format(x)</code>.
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex-1 border-b-2 px-2 py-2 text-xs transition-colors',
        active
          ? 'border-blue-600 font-medium text-slate-900'
          : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700',
      )}
    >
      {children}
    </button>
  );
}
