import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActionDsl, ApplicationDsl, EvaluationMap, PageDsl, WidgetDsl } from '@swiftly/shared';
import { api } from '@/lib/api';
import { useEvaluation } from '@/evaluation/useEvaluation';
import {
  buildDataTree,
  collectQueryExpressions,
  emptyQueryState,
  resolveProperties,
  toQueryState,
  type QueryRuntimeState,
} from '@/evaluation/dataTree';
import { evaluateExpression, writePath } from '@/evaluation/evaluateSync';
import type { SessionUser } from '@/lib/api';

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
  fireEvent: (widgetName: string, event: string, payload?: Record<string, unknown>) => void;
  queryState: Record<string, QueryRuntimeState>;
  runQuery: (queryName: string) => Promise<void>;
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
  initialPageId?: string;
  pageParams?: Record<string, string>;
}

export function useAppRuntime(options: RuntimeOptions): AppRuntime {
  const { dsl, applicationId, environmentId, source, currentUser, isDesignMode } = options;

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
  const [queryState, setQueryState] = useState<Record<string, QueryRuntimeState>>({});
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [openModals, setOpenModals] = useState<string[]>([]);

  const { state: evaluation, evaluate } = useEvaluation();
  const notificationId = useRef(0);
  const loadedPages = useRef(new Set<string>());

  /**
   * `widgetStateRef` is written synchronously by `setWidgetState`, not on render.
   * A widget calls `setState` and fires its events in the same tick, so a ref that
   * only catches up at render time would hand the event handler the previous value.
   */
  const widgetStateRef = useRef(widgetState);
  const queryStateRef = useRef(queryState);
  const evaluatedRef = useRef(evaluation.evaluated);
  queryStateRef.current = queryState;
  evaluatedRef.current = evaluation.evaluated;

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
      return resolveProperties(widget, evaluation.evaluated);
    },
    [page, evaluation.evaluated],
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
  const queryBindings = useCallback(
    (queryName: string): Record<string, unknown> => {
      const query = dsl.queries.find((candidate) => candidate.name === queryName);
      if (!query) return {};

      const currentPage = pageRef.current;
      if (!currentPage) return {};

      const { dataTree: scope } = buildDataTree({
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

      // Overlay the worker's evaluated bindings so an expression reading another
      // widget's *computed* property still resolves.
      for (const [path, result] of Object.entries(evaluatedRef.current)) {
        if (!path.startsWith('__query.')) writePath(scope, path, result.value);
      }

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
    [dsl, pageParams, currentUser],
  );

  const runQuery = useCallback(
    async (queryName: string): Promise<void> => {
      const query = dsl.queries.find((candidate) => candidate.name === queryName);
      if (!query) return;

      const token = (queryToken.current[queryName] = (queryToken.current[queryName] ?? 0) + 1);
      const isStale = (): boolean => queryToken.current[queryName] !== token;

      setQueryState((previous) => ({
        ...previous,
        [queryName]: { ...(previous[queryName] ?? emptyQueryState()), isLoading: true, error: null },
      }));

      try {
        const result = await api.queries.execute(applicationId, queryName, {
          source,
          environmentId,
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
    [dsl.queries, applicationId, environmentId, source, queryBindings],
  );

  // Page-load queries run once per page visit, not on every re-render.
  useEffect(() => {
    if (isDesignMode || !page) return;
    if (loadedPages.current.has(page.id)) return;
    loadedPages.current.add(page.id);

    for (const query of dsl.queries) {
      if (query.runOnPageLoad) void runQuery(query.name);
    }
  }, [page, dsl.queries, isDesignMode, runQuery]);

  /* --- actions ----------------------------------------------------- */

  const notify = useCallback((message: string, variant: Notification['variant']): void => {
    const id = ++notificationId.current;
    setNotifications((previous) => [...previous, { id, message, variant }]);
    setTimeout(() => setNotifications((previous) => previous.filter((n) => n.id !== id)), 5000);
  }, []);

  const runActions = useCallback(
    async (actions: ActionDsl[], payload?: Record<string, unknown>): Promise<void> => {
      for (const action of actions) {
        switch (action.type) {
          case 'runQuery':
            try {
              await runQuery(action.queryName);
              if (action.onSuccess) await runActions(action.onSuccess, payload);
            } catch {
              if (action.onError) await runActions(action.onError, payload);
            }
            break;

          case 'navigate':
            if (action.to.kind === 'page') {
              setCurrentPageId(action.to.pageId);
              setPageParams(action.to.params ?? {});
            } else if (action.newTab) {
              window.open(action.to.href, '_blank', 'noopener,noreferrer');
            } else {
              window.location.href = action.to.href;
            }
            break;

          case 'navigateBack':
            window.history.back();
            break;

          case 'showNotification':
            notify(action.message, action.variant);
            break;

          case 'openModal':
            setOpenModals((previous) => [...new Set([...previous, action.widgetName])]);
            break;

          case 'closeModal':
            setOpenModals((previous) => previous.filter((name) => name !== action.widgetName));
            break;

          case 'setState':
            // App state is part of the DSL object; mutating it here keeps the
            // binding scope consistent without a second state container.
            dsl.appState[action.key] = action.value;
            break;

          case 'runJs':
            try {
              // eslint-disable-next-line no-new-func
              new Function('event', action.code)(payload ?? {});
            } catch (error) {
              notify(error instanceof Error ? error.message : String(error), 'error');
            }
            break;

          case 'download': {
            const blob = new Blob([String(action.data)], { type: action.mimeType });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = action.fileName;
            anchor.click();
            URL.revokeObjectURL(url);
            break;
          }
        }
      }
    },
    [runQuery, notify, dsl.appState],
  );

  const fireEvent = useCallback(
    (widgetName: string, event: string, payload?: Record<string, unknown>): void => {
      if (isDesignMode) return;
      const widget = findWidgetByName(page?.widgets ?? [], widgetName);

      /*
       * Two homes, because the DSL declares `events` while the property panel
       * writes an `action_list` wherever its property key says — which for every
       * widget shipped so far is `properties.onClick`. Reading only `events`
       * meant no configured action had ever run, on any widget.
       *
       * `events` still wins, so a document that uses the declared shape keeps
       * working and an import or a generator can write it.
       */
      const configured = widget?.events?.[event] ?? widget?.properties?.[event];
      const actions = Array.isArray(configured) ? (configured as ActionDsl[]) : [];
      if (actions.length > 0) void runActions(actions, payload);
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

function findWidgetByName(widgets: WidgetDsl[], name: string): WidgetDsl | undefined {
  for (const widget of widgets) {
    if (widget.name === name) return widget;
    const found = findWidgetByName(widget.children ?? [], name);
    if (found) return found;
  }
  return undefined;
}
