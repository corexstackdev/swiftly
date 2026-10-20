import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  jsObjectsOnPage,
  queriesOnPage,
  type ActionDsl,
  type ApplicationDsl,
  type EvaluationMap,
  type PageDsl,
  type QueryEntity,
  type QueryResult,
  type SetWidgetMethod,
  type WidgetDsl,
} from '@swiftly/shared';
import { api } from '@/lib/api';
import { useEvaluation } from '@/evaluation/useEvaluation';
import {
  applyQuerySource,
  boundQueryNames,
  buildDataTree,
  collectQueryExpressions,
  emptyQueryState,
  resolveProperties,
  toQueryState,
  type QueryRuntimeState,
} from '@/evaluation/dataTree';
import { evaluateExpression, isActionEnabled, resolveValue, writePath } from '@/evaluation/evaluateSync';
import { hydrateJsObjects } from '@/evaluation/jsObjects';
import {
  attachJsObjects,
  callJsFunction,
  runJsFunction,
  runJsSource,
  splitJsFunctionPath,
} from '@/evaluation/runEventJs';
import { buildWidgetScope, type WidgetRuntimeApi } from './widgetApi';
import type { SessionUser } from '@/lib/api';

/** Click/submit in the editor selects the widget; those must not run app actions. */
const DESIGN_SILENT_EVENTS = new Set(['onClick', 'onSubmit']);

/**
 * The application runtime.
 *
 * Design, preview and published mode all run this same hook — the only differences
 * are which DSL is passed in and which `source` queries execute against. That is
 * what makes preview a trustworthy rehearsal rather than an approximation.
 */

export interface Notification {
  id: number;
  message: string;
  variant: 'info' | 'success' | 'warning' | 'error';
}

export interface AppRuntime {
  page: PageDsl | undefined;
  properties: (widgetName: string) => Record<string, unknown>;
  widgetState: Record<string, Record<string, unknown>>;
  setWidgetState: (widgetName: string, patch: Record<string, unknown>) => void;
  fireEvent: (
    widgetName: string,
    event: string,
    payload?: Record<string, unknown>,
    extraActions?: ActionDsl[],
  ) => void;
  queryState: Record<string, QueryRuntimeState>;
  runQuery: (queryName: string) => Promise<void>;
  /** Applies a result from the query editor's Run button onto the canvas. */
  ingestQueryResult: (queryName: string, result: QueryResult) => void;
  /** Evaluated values for a query's own bindings, keyed by expression text. */
  queryBindings: (queryName: string) => Record<string, unknown>;
  notifications: Notification[];
  dismissNotification: (id: number) => void;
  openModals: string[];
  openModal: (widgetName: string) => void;
  closeModal: (widgetName: string) => void;
  navigateToPage: (pageId: string, params?: Record<string, string>) => void;
  currentPageId: string;
  /** Full evaluation map, so the property panel can show what a binding resolves to. */
  evaluated: EvaluationMap;
  /** Editor status bar: how long the last evaluation took and how much it touched. */
  evaluationStats: { durationMs: number; recomputed: number; timedOut: boolean };
  evaluationErrors: { path: string; message: string }[];
}

export interface RuntimeOptions {
  dsl: ApplicationDsl;
  applicationId: string;
  environmentId: string;
  source: 'draft' | 'published';
  currentUser: SessionUser | null;
  isDesignMode: boolean;
  /** Used to run published queries on the public runtime route (no Swiftly login). */
  workspaceSlug?: string;
  appSlug?: string;
  initialPageId?: string;
  pageParams?: Record<string, string>;
}

export function useAppRuntime(options: RuntimeOptions): AppRuntime {
  const {
    dsl,
    applicationId,
    environmentId,
    source,
    currentUser,
    isDesignMode,
    workspaceSlug,
    appSlug,
  } = options;

  const defaultPageId =
    options.initialPageId ?? dsl.pages.find((page) => page.isDefault)?.id ?? dsl.pages[0]?.id ?? '';

  const [currentPageId, setCurrentPageId] = useState(defaultPageId);

  /**
   * The editor owns page selection while designing, so when it switches pages the
   * runtime must follow. Without this the runtime stays on the landing page, and
   * every binding on any other page evaluates against the wrong widget tree —
   * silently, because the canvas reads the editor's page and the bindings read
   * this one.
   */
  const requestedPageId = options.initialPageId;
  useEffect(() => {
    if (requestedPageId && requestedPageId !== currentPageId) setCurrentPageId(requestedPageId);
    // Intentionally not depending on currentPageId: in-app navigation moves away
    // from the requested page and must not be yanked back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedPageId]);
  const [pageParams, setPageParams] = useState<Record<string, string>>(options.pageParams ?? {});
  const [widgetState, setWidgetStateMap] = useState<Record<string, Record<string, unknown>>>({});
  const [propertyOverrides, setPropertyOverrides] = useState<Record<string, Record<string, unknown>>>({});
  const [queryState, setQueryState] = useState<Record<string, QueryRuntimeState>>({});
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [openModals, setOpenModals] = useState<string[]>([]);

  const { state: evaluation, evaluate } = useEvaluation();
  const notificationId = useRef(0);
  /** Page+query keys already kicked off, so a remount of this effect does not double-fetch. */
  const autoStartedQueries = useRef(new Set<string>());

  /**
   * `widgetStateRef` is written synchronously by `setWidgetState`, not on render.
   * A widget calls `setState` and fires its events in the same tick, so a ref that
   * only catches up at render time would hand the event handler the previous value.
   */
  const widgetStateRef = useRef(widgetState);
  const propertyOverridesRef = useRef(propertyOverrides);
  const queryStateRef = useRef(queryState);
  const evaluatedRef = useRef(evaluation.evaluated);
  queryStateRef.current = queryState;
  evaluatedRef.current = evaluation.evaluated;
  propertyOverridesRef.current = propertyOverrides;

  /** Per-query request token, so a slow earlier response cannot overwrite a newer one. */
  const queryToken = useRef<Record<string, number>>({});

  const page = useMemo(
    () => dsl.pages.find((candidate) => candidate.id === currentPageId) ?? dsl.pages[0],
    [dsl.pages, currentPageId],
  );

  const pageRef = useRef(page);
  pageRef.current = page;

  /* --- evaluation ------------------------------------------------- */

  const { dataTree, bindings } = useMemo(() => {
    if (!page) return { dataTree: {}, bindings: {} };
    return buildDataTree({
      dsl,
      page,
      queryState,
      widgetState,
      pageParams,
      pageQuery: {},
      currentUser: currentUser
        ? { id: currentUser.id, name: currentUser.name, email: currentUser.email }
        : null,
    });
  }, [dsl, page, queryState, widgetState, pageParams, currentUser]);

  useEffect(() => {
    evaluate(dataTree, bindings);
  }, [dataTree, bindings, evaluate]);

  /**
   * A widget's properties are its static values with the bound ones overlaid. Both
   * halves matter: a select's hard-coded option list is as real as a table's
   * `{{ Query.data }}`, and returning only the evaluated half silently drops it.
   */
  const properties = useCallback(
    (widgetName: string): Record<string, unknown> => {
      const widget = findWidgetByName(page?.widgets ?? [], widgetName);
      if (!widget) return {};
      const resolved = resolveProperties(widget, evaluation.evaluated);
      const extra = propertyOverrides[widgetName];
      const merged = extra ? { ...resolved, ...extra } : resolved;
      return applyQuerySource(merged, queryState);
    },
    [page, evaluation.evaluated, propertyOverrides, queryState],
  );

  /* --- queries ----------------------------------------------------- */

  /**
   * The server asks for a query's bindings by expression text, because it prepares
   * the query from its own stored DSL and knows only the expressions that statement
   * contains.
   *
   * These are evaluated synchronously from refs rather than read off the worker's
   * last result: an event handler calls `setState` and fires its actions in the same
   * tick, so the worker's result is one step behind and would send the previous
   * value — a wrong query with no error to show for it.
   */
  /**
   * The same tree SQL bindings evaluate against: widget state (`Table1.selectedRow`),
   * query results, appState. Event “Only run when” must use this rather than the
   * widget control API, which has `setValue` but not `selectedRow`.
   */
  const liveExpressionScope = useCallback((): Record<string, unknown> => {
    const currentPage = pageRef.current;
    if (!currentPage) return {};
    const { dataTree: rawTree } = buildDataTree({
      dsl,
      page: currentPage,
      queryState: queryStateRef.current,
      widgetState: widgetStateRef.current,
      pageParams,
      pageQuery: {},
      currentUser: currentUser
        ? { id: currentUser.id, name: currentUser.name, email: currentUser.email }
        : null,
    });
    const scope = hydrateJsObjects(rawTree);
    for (const [path, result] of Object.entries(evaluatedRef.current)) {
      if (!path.startsWith('__query.')) writePath(scope, path, result.value);
    }
    return scope;
  }, [dsl, pageParams, currentUser]);

  const queryBindings = useCallback(
    (queryName: string): Record<string, unknown> => {
      const currentPage = pageRef.current;
      if (!currentPage) return {};
      const query = queriesOnPage(dsl.queries, currentPage.id).find(
        (candidate) => candidate.name === queryName,
      );
      if (!query) return {};

      const scope = liveExpressionScope();
      const values: Record<string, unknown> = {};
      for (const expression of collectQueryExpressions(query)) {
        const outcome = evaluateExpression(expression, scope);
        // `undefined` disappears from the request body when it is serialised, and
        // the server then reports the binding as missing rather than as null —
        // which happens whenever a query references a widget on another page.
        // Sending null keeps the parameter present and the message honest.
        values[expression] = outcome.error || outcome.value === undefined ? null : outcome.value;
      }

      // Widget state is included too, so a binding the server resolves by name
      // (rather than by expression) still finds a value.
      for (const [entity, state] of Object.entries(widgetStateRef.current)) {
        for (const [key, value] of Object.entries(state)) {
          values[`${entity}.${key}`] = value === undefined ? null : value;
        }
      }

      return values;
    },
    [liveExpressionScope],
  );

  const runQuery = useCallback(
    async (queryName: string): Promise<void> => {
      const query = queriesOnPage(dsl.queries, pageRef.current?.id ?? '').find(
        (candidate) => candidate.name === queryName,
      );
      if (!query) return;

      const token = (queryToken.current[queryName] = (queryToken.current[queryName] ?? 0) + 1);
      const isStale = (): boolean => queryToken.current[queryName] !== token;

      setQueryState((previous) => ({
        ...previous,
        [queryName]: { ...(previous[queryName] ?? emptyQueryState()), isLoading: true, error: null },
      }));

      try {
        const result =
          !isDesignMode && workspaceSlug && appSlug
            ? source === 'published'
              ? await api.runtime.executeQuery(workspaceSlug, appSlug, queryName, {
                  pageId: pageRef.current?.id,
                  environmentId,
                  bindings: queryBindings(queryName),
                })
              : await api.runtime.executePreviewQuery(workspaceSlug, appSlug, queryName, {
                  pageId: pageRef.current?.id,
                  environmentId,
                  bindings: queryBindings(queryName),
                })
            : await api.queries.execute(applicationId, queryName, {
                source,
                environmentId,
                pageId: pageRef.current?.id,
                bindings: queryBindings(queryName),
              });
        // A filter changed twice in quick succession sends two requests; without this
        // the slower first one lands last and the table shows the wrong rows.
        if (isStale()) return;
        setQueryState((previous) => ({ ...previous, [queryName]: toQueryState(result) }));
      } catch (error) {
        if (isStale()) return;
        const message = error instanceof Error ? error.message : String(error);
        setQueryState((previous) => ({
          ...previous,
          [queryName]: {
            ...(previous[queryName] ?? emptyQueryState()),
            isLoading: false,
            error: message,
          },
        }));
        notify(message, 'error');
      }
    },
    [
      dsl.queries,
      applicationId,
      environmentId,
      source,
      isDesignMode,
      workspaceSlug,
      appSlug,
      queryBindings,
    ],
  );

  const ingestQueryResult = useCallback((queryName: string, result: QueryResult): void => {
    setQueryState((previous) => ({
      ...previous,
      [queryName]: toQueryState(result),
    }));
  }, []);

  /*
   * Fetch queries this page needs: those marked run-on-page-load, and those a
   * widget is mapped to. Mapping a table to a query is itself the instruction
   * to load rows — waiting for a separate Run click left every bound table empty.
   */
  const mappedQueryNames = useMemo(
    () => (page ? boundQueryNames(page.widgets) : []),
    [page],
  );

  useEffect(() => {
    if (!page) return;
    const visible = queriesOnPage(dsl.queries, page.id);
    const wanted = new Set<string>(mappedQueryNames);
    for (const query of visible) {
      if (query.runOnPageLoad) wanted.add(query.name);
    }

    for (const name of wanted) {
      const key = `${page.id}:${name}`;
      if (autoStartedQueries.current.has(key)) continue;
      const query = visible.find((candidate) => candidate.name === name);
      if (!query || !isRunnableQuery(query)) continue;
      if (query.confirmBeforeRun) continue;
      autoStartedQueries.current.add(key);
      void runQuery(name);
    }
  }, [page, mappedQueryNames, dsl.queries, runQuery]);

  /* --- actions ----------------------------------------------------- */

  const notify = useCallback((message: string, variant: Notification['variant']): void => {
    const id = ++notificationId.current;
    setNotifications((previous) => [...previous, { id, message, variant }]);
    setTimeout(() => setNotifications((previous) => previous.filter((n) => n.id !== id)), 5000);
  }, []);

  const setOverride = useCallback((widgetName: string, patch: Record<string, unknown>): void => {
    setPropertyOverrides((current) => {
      const next = {
        ...current,
        [widgetName]: { ...(current[widgetName] ?? {}), ...patch },
      };
      propertyOverridesRef.current = next;
      return next;
    });
  }, []);

  const eventScope = useCallback((): Record<string, unknown> => {
    const currentPage = pageRef.current;
    const scope = buildWidgetScope({
      widgets: currentPage?.widgets ?? [],
      getState: (name) => widgetStateRef.current[name] ?? {},
      getProperties: (name) => {
        const widget = findWidgetByName(currentPage?.widgets ?? [], name);
        if (!widget) return {};
        const resolved = resolveProperties(widget, evaluatedRef.current);
        const extra = propertyOverridesRef.current[name];
        return extra ? { ...resolved, ...extra } : resolved;
      },
      setState: (name, patch) => {
        const next = {
          ...widgetStateRef.current,
          [name]: { ...(widgetStateRef.current[name] ?? {}), ...patch },
        };
        widgetStateRef.current = next;
        setWidgetStateMap(next);
      },
      setOverride,
    });

    for (const query of queriesOnPage(dsl.queries, currentPage?.id ?? '')) {
      if (scope[query.name] === undefined) {
        scope[query.name] = queryStateRef.current[query.name] ?? emptyQueryState();
      }
    }
    scope.page = {
      params: pageParams,
      name: currentPage?.name,
      id: currentPage?.id,
    };
    scope.appState = dsl.appState ?? {};
    attachJsObjects(scope, jsObjectsOnPage(dsl.jsObjects, currentPage?.id ?? ''));
    return scope;
  }, [dsl.appState, dsl.jsObjects, dsl.queries, pageParams, setOverride]);

  const runActions = useCallback(
    async (actions: ActionDsl[], payload?: Record<string, unknown>): Promise<void> => {
      for (const action of actions) {
        const bindingScope = actionBindingScope(liveExpressionScope, payload);
        if (!isActionEnabled(action.enabledWhen, bindingScope)) continue;

        switch (action.type) {
          case 'runQuery':
            if (!action.queryName) break;
            try {
              await runQuery(action.queryName);
              if (action.onSuccess) await runActions(action.onSuccess, payload);
            } catch {
              if (action.onError) await runActions(action.onError, payload);
            }
            break;

          case 'navigate':
            if (action.to.kind === 'page') {
              if (!action.to.pageId) break;
              setCurrentPageId(action.to.pageId);
              setPageParams(action.to.params ?? {});
            } else {
              const href = String(resolveValue(action.to.href, bindingScope) ?? '');
              if (!href) break;
              if (action.newTab) {
                window.open(href, '_blank', 'noopener,noreferrer');
              } else {
                window.location.href = href;
              }
            }
            break;

          case 'navigateBack':
            window.history.back();
            break;

          case 'showNotification':
            notify(String(resolveValue(action.message, bindingScope) ?? ''), action.variant);
            break;

          case 'openModal': {
            const name = String(resolveValue(action.widgetName, bindingScope) ?? '');
            if (name) setOpenModals((previous) => [...new Set([...previous, name])]);
            break;
          }

          case 'closeModal': {
            const name = String(resolveValue(action.widgetName, bindingScope) ?? '');
            if (name) {
              setOpenModals((previous) => previous.filter((entry) => entry !== name));
            }
            break;
          }

          case 'setState':
            // App state is part of the DSL object; mutating it here keeps the
            // binding scope consistent without a second state container.
            if (action.key) dsl.appState[action.key] = resolveValue(action.value, bindingScope);
            break;

          case 'runJs':
            try {
              await Promise.resolve(runJsSource(action.code, eventScope(), payload ?? {}));
            } catch (error) {
              notify(error instanceof Error ? error.message : String(error), 'error');
            }
            break;

          case 'runJsFunction': {
            const split = splitJsFunctionPath(action.path ?? '');
            const currentPage = pageRef.current;
            const source = split
              ? jsObjectsOnPage(dsl.jsObjects, currentPage?.id ?? '').find(
                  (object) => object.name === split.objectName,
                )
              : undefined;
            if (!split || !source) {
              notify(`Unknown JS function “${action.path}”`, 'error');
              break;
            }
            try {
              const liveScope = eventScope();
              const fromScope = liveScope[split.objectName];
              const live =
                fromScope &&
                typeof fromScope === 'object' &&
                typeof (fromScope as Record<string, unknown>)[split.functionName] === 'function';
              const result = await Promise.resolve(
                live
                  ? callJsFunction(liveScope, split.objectName, split.functionName, payload ?? {})
                  : runJsFunction(source.code, split.functionName, liveScope, payload ?? {}),
              );
              if (payload && result !== undefined) payload.result = result;
              const targetName = String(resolveValue(action.widgetName, bindingScope) ?? '').trim();
              if (targetName && result !== undefined) {
                const api = asWidgetApi(eventScope()[targetName]);
                if (!api) {
                  notify(`Unknown component “${targetName}”`, 'error');
                  break;
                }
                applyWidgetMethod(
                  api,
                  action.method ?? (Array.isArray(result) ? 'setOptions' : 'setValue'),
                  result,
                  action.property,
                );
              }
            } catch (error) {
              notify(error instanceof Error ? error.message : String(error), 'error');
            }
            break;
          }

          case 'download': {
            const data = resolveValue(action.data, bindingScope);
            const fileName = String(resolveValue(action.fileName, bindingScope) ?? 'download');
            triggerDownload(data, fileName, action.mimeType);
            break;
          }

          case 'copyToClipboard': {
            const text = String(resolveValue(action.value, bindingScope) ?? '');
            try {
              await copyText(text);
            } catch (error) {
              notify(error instanceof Error ? error.message : String(error), 'error');
            }
            break;
          }

          case 'setWidget': {
            const name = String(resolveValue(action.widgetName, bindingScope) ?? '');
            const api = asWidgetApi(eventScope()[name]);
            if (!name || !api) {
              notify(`Unknown component “${name || action.widgetName}”`, 'error');
              break;
            }
            const value = resolveValue(action.value, bindingScope);
            applyWidgetMethod(api, action.method, value, action.property);
            break;
          }
        }
      }
    },
    [runQuery, notify, dsl.appState, dsl.jsObjects, eventScope, liveExpressionScope],
  );

  const fireEvent = useCallback(
    (
      widgetName: string,
      event: string,
      payload?: Record<string, unknown>,
      extraActions?: ActionDsl[],
    ): void => {
      if (isDesignMode && DESIGN_SILENT_EVENTS.has(event)) return;
      const widget = findWidgetByName(page?.widgets ?? [], widgetName);

      /*
       * Two homes, because the DSL declares `events` while the property panel
       * writes an `action_list` wherever its property key says — which for every
       * widget shipped so far is `properties.onClick`. Reading only `events`
       * meant no configured action had ever run, on any widget.
       *
       * `events` still wins, so a document that uses the declared shape keeps
       * working and an import or a generator can write it.
       *
       * `extraActions` are handlers stored on the thing that fired — a table
       * row button's own list — and run before the widget-level ones.
       */
      const configured = widget?.events?.[event] ?? widget?.properties?.[event];
      const fromWidget = Array.isArray(configured) ? (configured as ActionDsl[]) : [];
      const extra = extraActions ?? [];
      const actions = [...extra, ...fromWidget];
      if (actions.length === 0) return;

      const properties = widget ? resolveProperties(widget, evaluatedRef.current) : {};
      const state = widgetStateRef.current[widgetName] ?? {};
      const enriched = {
        ...payload,
        widgetId: widget?.id,
        widgetName,
        source: {
          id: widget?.id,
          name: widgetName,
          type: widget?.type,
          className: String(properties.className ?? properties.class ?? ''),
          value: payload?.value ?? state.value ?? state.text,
        },
      };
      void runActions(actions, enriched);
    },
    [page, runActions, isDesignMode],
  );

  const setWidgetState = useCallback(
    (widgetName: string, patch: Record<string, unknown>): void => {
      const next = {
        ...widgetStateRef.current,
        [widgetName]: { ...(widgetStateRef.current[widgetName] ?? {}), ...patch },
      };
      widgetStateRef.current = next;
      setWidgetStateMap(next);
    },
    [],
  );

  const evaluationErrors = useMemo(
    () =>
      Object.entries(evaluation.evaluated)
        .filter(([, result]) => result.error)
        .map(([path, result]) => ({ path, message: result.error!.message })),
    [evaluation.evaluated],
  );

  return {
    page,
    properties,
    widgetState,
    setWidgetState,
    fireEvent,
    queryState,
    runQuery,
    ingestQueryResult,
    queryBindings,
    notifications,
    dismissNotification: (id) => setNotifications((p) => p.filter((n) => n.id !== id)),
    openModals,
    openModal: (widgetName) =>
      setOpenModals((previous) => [...new Set([...previous, widgetName])]),
    closeModal: (widgetName) =>
      setOpenModals((previous) => previous.filter((name) => name !== widgetName)),
    navigateToPage: (pageId, params) => {
      setCurrentPageId(pageId);
      setPageParams(params ?? {});
    },
    currentPageId,
    evaluated: evaluation.evaluated,
    evaluationStats: {
      durationMs: evaluation.durationMs,
      recomputed: evaluation.recomputed,
      timedOut: evaluation.timedOut,
    },
    evaluationErrors,
  };
}

function isRunnableQuery(query: QueryEntity): boolean {
  const definition = query.definition as {
    kind?: string;
    sql?: string;
    table?: string;
    procedureName?: string;
    functionName?: string;
    path?: string;
  };
  switch (definition.kind) {
    case 'raw_sql':
      return Boolean(definition.sql?.trim());
    case 'builder':
      return Boolean(definition.table?.trim());
    case 'stored_procedure':
      return Boolean(definition.procedureName?.trim());
    case 'function':
      return Boolean(definition.functionName?.trim());
    case 'api':
      return Boolean(definition.path?.trim());
    default:
      return false;
  }
}

function findWidgetByName(widgets: WidgetDsl[], name: string): WidgetDsl | undefined {
  for (const widget of widgets) {
    if (widget.name === name) return widget;
    const found = findWidgetByName(widget.children ?? [], name);
    if (found) return found;
  }
  return undefined;
}

/** Read-side event scope: widget state like `Table1.selectedRow`, plus `event`. */
function actionBindingScope(
  liveExpressionScope: () => Record<string, unknown>,
  payload?: Record<string, unknown>,
): Record<string, unknown> {
  const scope = liveExpressionScope();
  if (!payload) return scope;
  scope.event = payload;
  for (const [key, value] of Object.entries(payload)) {
    if (scope[key] === undefined) scope[key] = value;
  }
  return scope;
}

function applyWidgetMethod(
  api: WidgetRuntimeApi,
  method: SetWidgetMethod | undefined,
  value: unknown,
  property?: string,
): void {
  switch (method) {
    case 'clearValue':
      api.setValue('');
      return;
    case 'setDisabled':
      api.setDisabled(Boolean(value));
      return;
    case 'setProperty':
      api.setProperty(String(property ?? ''), value);
      return;
    case 'setOptions':
      api.setOptions(value);
      return;
    default:
      api.setValue(value);
  }
}

function asWidgetApi(value: unknown): WidgetRuntimeApi | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<WidgetRuntimeApi>;
  if (typeof candidate.setValue !== 'function' || typeof candidate.setProperty !== 'function') {
    return undefined;
  }
  return candidate as WidgetRuntimeApi;
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function triggerDownload(data: unknown, fileName: string, mimeType: string): void {
  if (typeof data === 'string' && /^(https?:|blob:|data:)/i.test(data.trim())) {
    const anchor = document.createElement('a');
    anchor.href = data.trim();
    anchor.download = fileName || 'download';
    anchor.target = '_blank';
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return;
  }

  const body = typeof data === 'string' ? data : JSON.stringify(data ?? '', null, 2);
  const blob = new Blob([body], { type: mimeType || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName || 'download';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
