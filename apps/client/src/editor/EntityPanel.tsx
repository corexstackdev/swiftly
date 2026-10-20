import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  isAppLevelEntity,
  jsObjectsOnPage,
  queriesOnPage,
  type ApplicationDsl,
  type JsObjectDsl,
  type PageDsl,
  type QueryEntity,
} from '@swiftly/shared';
import type { DatasourceSummary } from '@/lib/api';
import { inspectJsObject } from '@/evaluation/jsObjects';
import { WidgetPalette } from './WidgetPalette';
import { WidgetTree } from './WidgetTree';
import { JsObjectMenuButton } from './JsObjectMenu';
import { QueryMenuButton } from './QueryMenu';

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
  selectedJsId,
  onSelectQuery,
  onCreateQuery,
  onSelectWidget,
  onDeleteWidget,
  onCreateJsObject,
  onSelectJsObject,
  onRenameJsObject,
  onCopyJsObject,
  onMoveJsObject,
  onMakeJsGlobal,
  onDeleteJsObject,
  onRenameQuery,
  onCopyQuery,
  onMoveQuery,
  onMakeQueryGlobal,
  onDeleteQuery,
  onAddWidget,
}: {
  dsl: ApplicationDsl;
  page: PageDsl | undefined;
  datasources: DatasourceSummary[];
  selectedQueryName: string | null;
  selectedWidgetId: string | null;
  selectedJsId: string | null;
  onSelectQuery: (name: string | null) => void;
  onCreateQuery: (datasourceId: string) => void;
  onSelectWidget: (widgetId: string) => void;
  /** Adds a widget from the palette without a drag. */
  onAddWidget: (widgetType: string) => void;
  onDeleteWidget: (widgetId: string) => void;
  onCreateJsObject: (scope: 'page' | 'app') => void;
  onSelectJsObject: (id: string) => void;
  onRenameJsObject: (id: string, name: string) => void;
  onCopyJsObject: (id: string, pageId: string) => void;
  onMoveJsObject: (id: string, pageId: string) => void;
  onMakeJsGlobal: (id: string) => void;
  onDeleteJsObject: (id: string) => void;
  onRenameQuery: (id: string, name: string) => void;
  onCopyQuery: (id: string, pageId: string) => void;
  onMoveQuery: (id: string, pageId: string) => void;
  onMakeQueryGlobal: (id: string) => void;
  onDeleteQuery: (id: string) => void;
}) {
  const [tab, setTab] = useState<EntityTab>('ui');
  // The UI tab is the page's structure by default; the palette is what you open
  // to add to it. Once a page has widgets, finding one matters more than adding.
  const [showPalette, setShowPalette] = useState(false);
  const visibleJsObjects = jsObjectsOnPage(dsl.jsObjects, page?.id ?? '');
  const visibleQueries = queriesOnPage(dsl.queries, page?.id ?? '');

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 border-b border-slate-200">
        <Tab active={tab === 'queries'} onClick={() => setTab('queries')}>
          Queries
          {visibleQueries.length > 0 && (
            <span className="ml-1 text-[10px] text-slate-400">{visibleQueries.length}</span>
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
              <EntityGroup
                items={visibleQueries}
                empty={
                  datasources.length === 0
                    ? 'Connect a datasource in the Data section first.'
                    : 'No queries yet — pick a datasource from + New.'
                }
                renderItem={(query) => {
                  const datasource = datasources.find(
                    (candidate) => candidate.id === query.datasourceId,
                  );
                  const selected = query.name === selectedQueryName;
                  return (
                    <div
                      className={clsx(
                        'flex items-center gap-1 rounded px-1 py-0.5',
                        selected ? 'bg-blue-50' : 'hover:bg-slate-100',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectQuery(query.name)}
                        className="min-w-0 flex-1 px-1 py-1 text-left"
                      >
                        <span className="flex items-center gap-1">
                          <span
                            className={clsx(
                              'truncate text-xs',
                              selected ? 'font-medium text-blue-700' : 'text-slate-700',
                            )}
                          >
                            {query.name}
                          </span>
                          {isAppLevelEntity(query) && <ScopeBadge />}
                        </span>
                        <span className="block truncate text-[10px] text-slate-400">
                          {datasource?.name ?? 'Missing datasource'} · {query.mode}
                          {query.runOnPageLoad && ' · on load'}
                        </span>
                      </button>
                      {selected && page && (
                        <QueryMenuButton
                          query={query}
                          dsl={dsl}
                          pages={dsl.pages}
                          currentPageId={page.id}
                          onRename={(name) => onRenameQuery(query.id, name)}
                          onCopyToPage={(pageId) => onCopyQuery(query.id, pageId)}
                          onMoveToPage={(pageId) => onMoveQuery(query.id, pageId)}
                          onMakeGlobal={() => onMakeQueryGlobal(query.id)}
                          onCopyToThisPage={() => onCopyQuery(query.id, page.id)}
                          onDelete={() => onDeleteQuery(query.id)}
                        />
                      )}
                    </div>
                  );
                }}
              />
            </ul>
          </div>
        )}

        {tab === 'js' && (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 px-2 py-1.5">
              <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                JS objects
              </span>
              <select
                value=""
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === 'page' || value === 'app') onCreateJsObject(value);
                }}
                className="rounded border border-slate-300 px-1 py-0.5 text-xs"
              >
                <option value="">+ New</option>
                <option value="page">On this page</option>
                <option value="app">Global (app)</option>
              </select>
            </div>

            <ul className="flex-1 overflow-auto p-1">
              <EntityGroup
                items={visibleJsObjects}
                empty={
                  <>
                    Helper functions on this page or globally, callable from a binding as{' '}
                    <code className="text-slate-500">Utils.format(x)</code>.
                  </>
                }
                renderItem={(jsObject) => {
                  const selected = selectedJsId === jsObject.id;
                  const broken = Boolean(inspectJsObject(jsObject.name, jsObject.code).error);
                  return (
                    <div
                      className={clsx(
                        'flex items-center gap-0.5 rounded px-1 py-0.5',
                        selected ? 'bg-blue-50' : 'hover:bg-slate-100',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => jsObject.id && onSelectJsObject(jsObject.id)}
                        className={clsx(
                          'min-w-0 flex-1 rounded px-1 py-1 text-left text-xs',
                          selected ? 'font-medium text-blue-700' : 'text-slate-700',
                        )}
                      >
                        <span className="flex items-center gap-1">
                          <span className="truncate">{jsObject.name}</span>
                          {broken && (
                            <span className="shrink-0 text-[9px] font-medium text-red-600">error</span>
                          )}
                          {isAppLevelEntity(jsObject) && <ScopeBadge />}
                        </span>
                      </button>
                      {selected && jsObject.id && page && (
                        <JsObjectMenuButton
                          jsObject={jsObject}
                          dsl={dsl}
                          pages={dsl.pages}
                          currentPageId={page.id}
                          onRename={(name) => onRenameJsObject(jsObject.id!, name)}
                          onCopyToPage={(pageId) => onCopyJsObject(jsObject.id!, pageId)}
                          onMoveToPage={(pageId) => onMoveJsObject(jsObject.id!, pageId)}
                          onMakeGlobal={() => onMakeJsGlobal(jsObject.id!)}
                          onCopyToThisPage={() => onCopyJsObject(jsObject.id!, page.id)}
                          onDelete={() => onDeleteJsObject(jsObject.id!)}
                        />
                      )}
                    </div>
                  );
                }}
              />
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function EntityGroup<T extends QueryEntity | JsObjectDsl>({
  items,
  empty,
  renderItem,
}: {
  items: T[];
  empty: ReactNode;
  renderItem: (item: T) => ReactNode;
}) {
  const globalItems = items.filter((item) => isAppLevelEntity(item));
  const pageItems = items.filter((item) => !isAppLevelEntity(item));

  if (items.length === 0) {
    return <li className="px-2 py-3 text-xs text-slate-400">{empty}</li>;
  }

  return (
    <>
      {globalItems.length > 0 && (
        <li className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
          Global
        </li>
      )}
      {globalItems.map((item) => (
        <li key={item.id ?? item.name}>{renderItem(item)}</li>
      ))}
      {pageItems.length > 0 && (
        <li className="px-2 pt-2 pb-0.5 text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
          This page
        </li>
      )}
      {pageItems.map((item) => (
        <li key={item.id ?? item.name}>{renderItem(item)}</li>
      ))}
    </>
  );
}

function ScopeBadge() {
  return (
    <span className="shrink-0 rounded bg-slate-100 px-1 py-px text-[9px] font-medium tracking-wide text-slate-500 uppercase">
      App
    </span>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
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
