import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Layout } from 'react-grid-layout';
import clsx from 'clsx';
import { jsObjectsOnPage, type ApplicationDsl, type PageDsl, type QueryEntity, type WidgetDefinition, type WidgetDsl } from '@swiftly/shared';
import { api, type DatasourceSummary, type Environment, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAppRuntime } from '@/runtime/useAppRuntime';
import { AppShell } from '@/runtime/AppShell';
import { PageRenderer } from '@/runtime/PageRenderer';
import { ModeRail } from '@/shell/ModeRail';
import { BottomBar } from '@/shell/BottomBar';
import { defaultProperties, getWidgetDefinition } from '@/widgets/registry';
import { useDslHistory } from './useDslHistory';
import { Canvas } from './Canvas';
import { acceptPaletteDrag, dropParentId, takePaletteDrop } from './paletteDrag';
import { EntityPanel } from './EntityPanel';
import { PagesDropdown } from './PagesDropdown';
import { PropertyPanel } from './PropertyPanel';
import { PagePropertiesPanel, CANVAS_PRESETS, type CanvasPresetId } from './PagePropertiesPanel';
import {
  ENTITY_PANEL_SIZE,
  PROPERTY_PANEL_SIZE,
  PanelResizeHandle,
  usePersistentPanelWidth,
} from './PanelResizeHandle';
import { QueryPanel, blankDefinition } from './QueryPanel';
import { JsObjectPanel } from './JsObjectPanel';
import {
  childListOf,
  findParent,
  findWidget,
  firstFreeRow,
  fitAllContainers,
  needsContainerFit,
  newWidgetId,
  removeWidget,
  uniqueName,
  uniqueSlug,
  uniqueWidgetName,
} from './widgetOps';
import { copyJsName, nextAvailableName, takenJsNames } from './jsObjectOps';
import { reflowGridChildren, seedCellProperties } from './gridCells';

/** Guards against a collapsed pane; not a design width. */
const MIN_CANVAS_WIDTH = 320;

/** Breathing room between the canvas and the panels on either side. */
const CANVAS_GUTTER = 10;

/** Keeps the page off the editor chrome so a widget at y=0 is not under the header. */
const CANVAS_TOP_GUTTER = 28;

/** Reads the server's draft revision out of a 409 body, nested or flat. */
function revisionFromConflict(error: ApiError): number | undefined {
  const body = error.details;
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record.currentRevision === 'number') return record.currentRevision;
  const nested = record.message;
  if (nested && typeof nested === 'object') {
    const current = (nested as Record<string, unknown>).currentRevision;
    if (typeof current === 'number') return current;
  }
  return undefined;
}

/**
 * The application editor.
 *
 * Design and preview are the same component tree with `isDesignMode` flipped, so
 * there is no class of bug where the preview and the published app disagree.
 */

export function EditorPage() {
  const { applicationId = '' } = useParams();

  const [loaded, setLoaded] = useState<ApplicationDsl | null>(null);
  const [revision, setRevision] = useState(0);
  const [appName, setAppName] = useState('');
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [environmentId, setEnvironmentId] = useState('');
  const [datasources, setDatasources] = useState<DatasourceSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.applications.get(applicationId),
      api.workspaces.environments(),
      api.datasources.list(),
    ])
      .then(([application, envs, sources]) => {
        if (cancelled) return;
        setLoaded(application.draftDsl);
        setRevision(application.draftRevision);
        setAppName(application.name);
        setEnvironments(envs);
        setEnvironmentId(envs.find((env) => env.isDefault)?.id ?? envs[0]?.id ?? '');
        setDatasources(sources);
      })
      .catch(
        (error) =>
          !cancelled && setLoadError(error instanceof Error ? error.message : String(error)),
      );
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  if (loadError) {
    return <CenteredMessage title="Could not open this application" detail={loadError} />;
  }
  if (!loaded) return <CenteredMessage title="Loading…" />;

  return (
    <EditorBody
      key={applicationId}
      applicationId={applicationId}
      appName={appName}
      initialDsl={loaded}
      initialRevision={revision}
      environments={environments}
      initialEnvironmentId={environmentId}
      datasources={datasources}
    />
  );
}

function EditorBody({
  applicationId,
  appName,
  initialDsl,
  initialRevision,
  environments,
  initialEnvironmentId,
  datasources,
}: {
  applicationId: string;
  appName: string;
  initialDsl: ApplicationDsl;
  initialRevision: number;
  environments: Environment[];
  initialEnvironmentId: string;
  datasources: DatasourceSummary[];
}) {
  const { user } = useSession();
  const history = useDslHistory(initialDsl);
  const revisionRef = useRef(initialRevision);
  const dslRef = useRef(history.dsl);
  dslRef.current = history.dsl;
  const markSavedRef = useRef(history.markSaved);
  markSavedRef.current = history.markSaved;
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);
  const queuedSaveRef = useRef(false);
  const conflictRef = useRef(false);
  const conflictRetriesRef = useRef(0);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const [environmentId, setEnvironmentId] = useState(initialEnvironmentId);
  const [currentPageId, setCurrentPageId] = useState(
    initialDsl.pages.find((page) => page.isDefault)?.id ?? initialDsl.pages[0]?.id ?? '',
  );
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [selectedQueryName, setSelectedQueryName] = useState<string | null>(null);
  const [selectedJsId, setSelectedJsId] = useState<string | null>(null);
  const [bottomTab, setBottomTab] = useState<'query' | 'errors' | 'js' | null>(null);
  const [canvasPreset, setCanvasPreset] = useState<CanvasPresetId>('fluid');
  const [availableWidth, setAvailableWidth] = useState(960);
  const [isPreview, setIsPreview] = useState(false);
  /** Bumped whenever the fit pass corrects a height; see the effect below. */
  const [fitVersion, setFitVersion] = useState(0);
  // Both side panels can be folded away. On a laptop they account for well over a
  // third of the window, and the canvas is the part being worked on.
  const [entityPanelOpen, setEntityPanelOpen] = useState(true);
  const [propertyPanelOpen, setPropertyPanelOpen] = useState(true);
  const [entityPanelWidth, setEntityPanelWidth] = usePersistentPanelWidth(
    'entity',
    ENTITY_PANEL_SIZE,
  );
  const [propertyPanelWidth, setPropertyPanelWidth] = usePersistentPanelWidth(
    'property',
    PROPERTY_PANEL_SIZE,
  );
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  /*
   * A conflict stops the autosave rather than joining it.
   *
   * The draft is saved against the revision it was loaded at, so once someone
   * else has written to it the revision can never match again: retrying is a
   * request that is guaranteed to fail, every 1.2 seconds, for as long as the
   * tab is open. Saving anyway is worse — it would overwrite whoever actually
   * did change it. So the loop stops and says what happened.
   */
  const [conflict, setConflict] = useState(false);
  /** Consecutive failures, for backing off the ones that might still succeed. */
  const failuresRef = useRef(0);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const canSubmit = user?.permissions.includes('app:submit') ?? false;
  const canPublish = user?.permissions.includes('app:publish') ?? false;

  const runtime = useAppRuntime({
    dsl: history.dsl,
    applicationId,
    environmentId,
    source: 'draft',
    currentUser: user,
    isDesignMode: !isPreview,
    initialPageId: currentPageId,
  });

  const page = history.dsl.pages.find((candidate) => candidate.id === currentPageId);
  const selectedWidget = page ? (findWidget(page.widgets, selectedWidgetId ?? '') ?? null) : null;
  const selectedParent = page ? findParent(page.widgets, selectedWidgetId ?? '') : null;
  const selectedQuery =
    history.dsl.queries.find((query) => query.name === selectedQueryName) ?? null;
  const selectedJsObject =
    (history.dsl.jsObjects ?? []).find((object) => object.id === selectedJsId) ?? null;

  const renameJsObject = (id: string, name: string) => {
    history.update((draft) => {
      const target = (draft.jsObjects ?? []).find((object) => object.id === id);
      if (!target) return;
      const pageId = target.pageId ?? currentPageId;
      const taken = takenJsNames(draft, pageId, id);
      target.name = taken.has(name) ? nextAvailableName(name, taken) : name;
    }, 'rename-js');
  };

  const copyJsObject = (id: string, pageId: string) => {
    const source = (history.dsl.jsObjects ?? []).find((object) => object.id === id);
    if (!source) return;
    const name = copyJsName(source.name, takenJsNames(history.dsl, pageId));
    const copyId = `js_${Math.random().toString(36).slice(2, 8)}`;
    const code = source.code;
    history.update((draft) => {
      draft.jsObjects ??= [];
      draft.jsObjects.push({ id: copyId, name, pageId, code });
    }, 'copy-js');
  };

  const moveJsObject = (id: string, pageId: string) => {
    history.update((draft) => {
      const target = (draft.jsObjects ?? []).find((object) => object.id === id);
      if (!target) return;
      const taken = takenJsNames(draft, pageId, id);
      if (taken.has(target.name)) target.name = nextAvailableName(target.name, taken);
      target.pageId = pageId;
    }, 'move-js');
    setCurrentPageId(pageId);
    setSelectedJsId(id);
    setBottomTab('js');
  };

  const deleteJsObject = (id: string) => {
    history.update((draft) => {
      draft.jsObjects = (draft.jsObjects ?? []).filter((object) => object.id !== id);
    }, 'delete-js');
    if (selectedJsId === id) {
      setSelectedJsId(null);
      setBottomTab(null);
    }
  };

  const presetWidth = CANVAS_PRESETS.find((preset) => preset.id === canvasPreset)?.width ?? null;

  /*
   * Fluid means exactly the space available — the canvas fills the editor edge to
   * edge, with no minimum and nothing to scroll sideways.
   *
   * Widget positions are stored in grid columns, so they are proportional and the
   * layout stays correct at any width; what changes is how much room each widget
   * has to render in. When that matters — checking whether a caption still fits
   * at a real desktop size — the canvas-size presets pin the canvas to a device
   * width and the pane scrolls, which is the deliberate choice rather than the
   * default.
   */
  const canvasWidth =
    presetWidth ?? Math.max(availableWidth - CANVAS_GUTTER * 2, MIN_CANVAS_WIDTH);

  useLayoutEffect(() => {
    const element = canvasHostRef.current;
    if (!element) return;

    // Measured directly as well as observed. A ResizeObserver reports its first
    // entry asynchronously and can be missed entirely if the element is laid out
    // before the observer attaches, which leaves the canvas stuck on its initial
    // guess — and a canvas that never learns how wide it is renders every widget
    // at the wrong size.
    // `clientWidth`, not the border box: the vertical scrollbar occupies real
    // space, and counting it makes the canvas ~15px too wide, which is enough to
    // produce a permanent horizontal scrollbar nobody asked for. It does include
    // the gutter padding, which is subtracted where the canvas width is derived.
    // A detached or hidden host measures zero, and taking that collapses the
    // canvas to its minimum width. Keeping the last real measurement instead
    // means a transient zero costs nothing.
    const measure = () => {
      const next = element.clientWidth;
      if (next > 0) setAvailableWidth(next);
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
    // Re-measured when a panel folds away, since that changes the space available
    // without the window changing size.
    //
    // `isPreview` matters for a different reason: preview returns early, so the
    // host unmounts entirely and comes back as a new element. Without it here the
    // observer stays bound to the old, detached node and nothing ever measures
    // the new one, which is how returning from preview left the canvas stuck at
    // its minimum width.
  }, [entityPanelOpen, propertyPanelOpen, isPreview]);

  /* --- persistence ------------------------------------------------ */

  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(`swiftly-draft:${applicationId}`);
      channel.onmessage = (event: MessageEvent) => {
        const revision = event.data?.revision;
        if (event.data?.type !== 'draft-saved' || typeof revision !== 'number') return;
        // Another tab of this browser wrote. Adopt its revision so our next
        // PUT matches the server instead of 409-ing on a stale number.
        if (revision > revisionRef.current) revisionRef.current = revision;
      };
    } catch {
      channel = null;
    }
    channelRef.current = channel;
    return () => {
      channel?.close();
      channelRef.current = null;
    };
  }, [applicationId]);

  const save = useCallback(async (): Promise<void> => {
    if (conflictRef.current) return;
    if (savingRef.current) {
      queuedSaveRef.current = true;
      return;
    }

    savingRef.current = true;
    queuedSaveRef.current = false;
    setSaveState('saving');

    const payload = dslRef.current;
    const expected = revisionRef.current;

    try {
      const result = await api.applications.saveDraft(applicationId, payload, expected);
      revisionRef.current = result.revision;
      failuresRef.current = 0;
      conflictRetriesRef.current = 0;
      markSavedRef.current(payload);
      try {
        channelRef.current?.postMessage({ type: 'draft-saved', revision: result.revision });
      } catch {
        /* BroadcastChannel is best-effort; a missing peer must not fail the save. */
      }
      setSaveState('saved');
      setSaveMessage(null);
      setTimeout(() => setSaveState((state) => (state === 'saved' ? 'idle' : state)), 1500);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        conflictRef.current = true;
        setConflict(true);
        setSaveState('error');
        setSaveMessage(
          'Your session expired. Sign in again to keep saving — this page still has your latest edits until you leave.',
        );
        return;
      }

      if (error instanceof ApiError && error.status === 409) {
        const remote = revisionFromConflict(error);
        // One retry after adopting the server's revision recovers a stale
        // number from an overlapping save or another tab of the same builder.
        // A second 409 is a real conflict — stop rather than overwrite in a loop.
        if (typeof remote === 'number' && conflictRetriesRef.current < 1) {
          conflictRetriesRef.current += 1;
          revisionRef.current = remote;
          queuedSaveRef.current = true;
        } else {
          conflictRef.current = true;
          setConflict(true);
          setSaveState('error');
          setSaveMessage(
            typeof error.message === 'string' && error.message !== '[object Object]'
              ? error.message
              : 'This application was changed in another tab. Reload before saving.',
          );
        }
      } else {
        // A dropped connection or a server restart might work on the next try.
        failuresRef.current += 1;
        setSaveState('error');
        setSaveMessage(
          error instanceof Error ? error.message : 'Could not save. Your changes are still here.',
        );
      }
    } finally {
      savingRef.current = false;
      if (queuedSaveRef.current && !conflictRef.current) {
        queuedSaveRef.current = false;
        void save();
      }
    }
  }, [applicationId]);

  useEffect(() => {
    if (!history.isDirty || conflict) return;

    const delay = Math.min(1200 * 2 ** failuresRef.current, 30_000);
    const timer = setTimeout(() => void save(), delay);
    return () => clearTimeout(timer);
  }, [history.dsl, history.isDirty, save, conflict]);

  /**
   * Containers are sized to their contents as a pass over the settled document,
   * not inside the layout handler.
   *
   * During a drag or resize react-grid-layout owns the layout and echoes its own
   * copy back afterwards, so a correction applied mid-gesture is simply
   * overwritten — which is why a child could grow past its parent and the parent
   * would sit there clipped. Running after the change has landed means the grid
   * receives the corrected height as a prop and adopts it.
   *
   * The guard is what stops this looping: the pass only ever grows a container
   * that is too short, so once every container fits, `needsContainerFit` is false
   * and nothing further is written.
   */
  useEffect(() => {
    const target = history.dsl.pages.find((candidate) => candidate.id === currentPageId);
    if (!target || !needsContainerFit(target)) return;

    history.update((draft) => {
      const page = draft.pages.find((candidate) => candidate.id === currentPageId);
      if (page) fitAllContainers(page);
    }, 'fit-containers');

    // react-grid-layout keeps its own copy of the layout and will not take a
    // corrected height from props once it believes it owns the item, so the grid
    // is remounted to re-read. This runs after the gesture has committed, never
    // during one, and only when a correction actually happened — so it converges
    // in a single step instead of remounting on every render.
    setFitVersion((version) => version + 1);
  }, [history, currentPageId]);

  /* --- DSL mutations ---------------------------------------------- */

  const updatePage = useCallback(
    (mutate: (page: PageDsl) => void, label?: string) => {
      history.update((draft) => {
        const target = draft.pages.find((candidate) => candidate.id === currentPageId);
        if (target) mutate(target);
      }, label);
    },
    [history, currentPageId],
  );

  const deleteWidget = useCallback(
    (widgetId: string) => {
      updatePage((target) => {
        removeWidget(target.widgets, widgetId);
      }, `delete-widget:${widgetId}`);

      // Deleting a container also deletes its descendants. Clear the selection
      // when it points at either the removed widget or anything nested inside it.
      setSelectedWidgetId((selectedId) => {
        if (!selectedId) return null;
        const removed = page ? findWidget(page.widgets, widgetId) : undefined;
        const selectedWasRemoved =
          selectedId === widgetId ||
          Boolean(removed && findWidget(removed.children ?? [], selectedId));
        return selectedWasRemoved ? null : selectedId;
      });
    },
    [page, updatePage],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      const isEditing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (
        !isPreview &&
        !isEditing &&
        selectedWidgetId &&
        (event.key === 'Delete' || event.key === 'Backspace')
      ) {
        event.preventDefault();
        deleteWidget(selectedWidgetId);
        return;
      }

      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        history.undo();
      } else if (event.key === 'z' || event.key === 'y') {
        event.preventDefault();
        history.redo();
      } else if (event.key === 's') {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteWidget, history, isPreview, save, selectedWidgetId]);

  const addWidget = useCallback(
    (parentId: string | null, type: string, position: { x: number; y: number }) => {
      const definition = getWidgetDefinition(type);
      if (!definition) return;

      /*
       * Minted out here rather than inside the producer. React re-invokes a state
       * updater to surface impurity, so a random id generated inside it differs
       * between the two runs: the document keeps one and whatever was told to
       * select it was given the other.
       */
      const id = newWidgetId();

      updatePage((target) => {
        const siblings = childListOf(target, parentId);
        if (!siblings) return;

        const widget: WidgetDsl = {
          id,
          // Names are unique across the page, not per container: bindings address
          // widgets by bare name, so two `Table1`s would be ambiguous.
          name: uniqueWidgetName(definition.displayName.replace(/\s+/g, ''), target),
          type,
          layout: {
            ...definition.defaultLayout,
            x: position.x,
            y: firstFreeRow(
              siblings,
              position.x,
              position.y,
              definition.defaultLayout.w,
              definition.defaultLayout.h,
            ),
          },
          properties: cellAwareProperties(target, parentId, siblings, definition, undefined),
          ...(definition.isContainer ? { children: [] } : {}),
        };
        siblings.push(widget);
      }, 'add-widget');

      setSelectedWidgetId(id);
    },
    [updatePage],
  );

  /**
   * Adds a widget to a container that positions children itself. There is no
   * coordinate to give it — the container decides where it lands — so only the
   * seed properties it needs travel with it.
   */
  const addWidgetToContainer = useCallback(
    (parentId: string, type: string, seedProperties?: Record<string, unknown>) => {
      const definition = getWidgetDefinition(type);
      if (!definition) return;

      const id = newWidgetId();

      updatePage((target) => {
        const siblings = childListOf(target, parentId);
        if (!siblings) return;

        const widget: WidgetDsl = {
          id,
          name: uniqueWidgetName(definition.displayName.replace(/\s+/g, ''), target),
          type,
          layout: { ...definition.defaultLayout },
          properties: cellAwareProperties(target, parentId, siblings, definition, seedProperties),
          ...(definition.isContainer ? { children: [] } : {}),
        };
        siblings.push(widget);
      }, 'add-widget');

      setSelectedWidgetId(id);
    },
    [updatePage],
  );

  /** Writes properties onto any widget on the page, at any depth. */
  const updateWidgetProperties = useCallback(
    (widgetId: string, patch: Record<string, unknown>) => {
      updatePage((target) => {
        const widget = findWidget(target.widgets, widgetId);
        if (widget) {
          const next = { ...widget.properties, ...patch };
          for (const [key, value] of Object.entries(patch)) {
            if (value == null) delete next[key];
          }
          widget.properties = next;
        }
      }, `properties:${widgetId}`);
    },
    [updatePage],
  );

  const applyLayout = useCallback(
    (parentId: string | null, layouts: Layout[]) => {
      const siblings = page ? childListOf(page, parentId) : undefined;
      if (!siblings) return;

      const changed = layouts.some((entry) => {
        if (entry.i === '__dropping__') return false;
        const widget = siblings.find((candidate) => candidate.id === entry.i);
        if (!widget) return false;
        return (
          widget.layout.x !== entry.x ||
          widget.layout.y !== entry.y ||
          widget.layout.w !== entry.w ||
          widget.layout.h !== entry.h
        );
      });
      if (!changed) return;

      updatePage((target) => {
        const nextSiblings = childListOf(target, parentId);
        if (!nextSiblings) return;
        for (const entry of layouts) {
          if (entry.i === '__dropping__') continue;
          const widget = nextSiblings.find((candidate) => candidate.id === entry.i);
          if (widget) {
            widget.layout = { ...widget.layout, x: entry.x, y: entry.y, w: entry.w, h: entry.h };
            if (widget.type === 'grid') {
              widget.properties = {
                ...widget.properties,
                canvasSize: entry.h >= 26 ? 3 : entry.w >= 18 ? 2 : 1,
              };
            }
          }
        }
      }, `layout:${parentId ?? 'root'}`);
    },
    [page, updatePage],
  );

  const changeQuery = useCallback(
    (name: string, mutate: (query: QueryEntity) => void) => {
      history.update((draft) => {
        const query = draft.queries.find((candidate) => candidate.name === name);
        if (query) {
          mutate(query);
          if (query.name !== name) setSelectedQueryName(query.name);
        }
      }, `query:${name}`);
    },
    [history],
  );

  const createQuery = useCallback(
    (datasourceId: string) => {
      const datasource = datasources.find((candidate) => candidate.id === datasourceId);
      const mode = datasource?.pluginId === 'rest' ? 'api' : 'raw_sql';

      const id = `q_${Math.random().toString(36).slice(2, 10)}`;
      const name = uniqueName('Query', history.dsl.queries);

      history.update((draft) => {
        draft.queries.push({
          id,
          name,
          datasourceId,
          mode,
          definition: blankDefinition(mode),
          settings: { timeoutMs: 30_000, maxRows: 10_000 },
          runOnPageLoad: false,
          confirmBeforeRun: false,
        });
      }, 'add-query');

      setSelectedQueryName(name);
      setBottomTab('query');
    },
    [history, datasources],
  );

  /* --- preview ----------------------------------------------------- */

  if (isPreview) {
    return (
      <div className="flex h-screen flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2">
          <span className="text-sm font-medium text-amber-900">Preview</span>
          <span className="text-xs text-amber-700">
            Running the draft against{' '}
            <strong>{environments.find((e) => e.id === environmentId)?.name}</strong> — queries,
            navigation and validation all behave as they will once published.
          </span>
          <button
            type="button"
            onClick={() => setIsPreview(false)}
            className="ml-auto rounded border border-amber-400 bg-white px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
          >
            Back to editing
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <AppShell navigation={history.dsl.navigation} runtime={runtime}>
            {runtime.page && <PageRenderer widgets={runtime.page.widgets} runtime={runtime} />}
          </AppShell>
        </div>
      </div>
    );
  }

  /* --- editor ------------------------------------------------------ */

  return (
    <div className="flex h-screen bg-slate-100">
      <ModeRail applicationId={applicationId} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
          <Link
            to="/apps"
            className="shrink-0 rounded px-1.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800"
          >
            ← Back to projects
          </Link>
          <span className="text-xs text-slate-200">|</span>
          <PagesDropdown
            dsl={history.dsl}
            currentPageId={currentPageId}
            onSelect={setCurrentPageId}
            onAdd={(requested) => {
              const id = `page_${Math.random().toString(36).slice(2, 8)}`;
              const name = requested.trim() || uniqueName('Page', history.dsl.pages);
              const slug = uniqueSlug(name, history.dsl.pages);

              history.update((draft) => {
                draft.pages.push({ id, name, slug, isDefault: false, widgets: [] });
                draft.navigation.items.push({
                  id: `nav_${id}`,
                  label: name,
                  target: { kind: 'page', pageId: id },
                });
              }, 'add-page');

              // Opening the new page is the point of making one.
              setCurrentPageId(id);
            }}
            onSetDefault={(pageId) =>
              history.update((draft) => {
                for (const candidate of draft.pages) candidate.isDefault = candidate.id === pageId;
              }, 'default-page')
            }
            onRename={(pageId, name) =>
              history.update((draft) => {
                const target = draft.pages.find((candidate) => candidate.id === pageId);
                if (target) target.name = name;
                const navItem = draft.navigation.items.find(
                  (item) => item.target.kind === 'page' && item.target.pageId === pageId,
                );
                if (navItem) navItem.label = name;
              }, 'rename-page')
            }
            onDelete={(pageId) => {
              const remaining = history.dsl.pages.filter((candidate) => candidate.id !== pageId);

              history.update((draft) => {
                draft.pages = draft.pages.filter((candidate) => candidate.id !== pageId);
                draft.navigation.items = draft.navigation.items.filter(
                  (item) => !(item.target.kind === 'page' && item.target.pageId === pageId),
                );
                // The app has to land somewhere, so deleting the landing page
                // promotes whatever is left at the top.
                if (!draft.pages.some((candidate) => candidate.isDefault) && draft.pages[0]) {
                  draft.pages[0].isDefault = true;
                }
              }, 'delete-page');

              if (currentPageId === pageId) setCurrentPageId(remaining[0]?.id ?? '');
            }}
          />

          <span className="mx-1 text-xs text-slate-200">|</span>
          <span className="text-xs text-slate-500">{appName}</span>

          <div className="ml-2 flex items-center gap-0.5">
            <IconButton label="Undo" disabled={!history.canUndo} onClick={history.undo}>
              ↶
            </IconButton>
            <IconButton label="Redo" disabled={!history.canRedo} onClick={history.redo}>
              ↷
            </IconButton>
          </div>

          {conflict ? (
            <span className="flex items-center gap-1.5 rounded border border-red-200 bg-red-50 px-2 py-0.5">
              <span className="text-xs text-red-700">Changed in another tab — not saving</span>
              <button
                type="button"
                onClick={() => window.location.reload()}
                title={saveMessage ?? undefined}
                className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-medium text-white hover:bg-red-700"
              >
                Reload
              </button>
            </span>
          ) : (
            <span
              className={clsx('text-xs', saveState === 'error' ? 'text-red-600' : 'text-slate-400')}
              title={saveMessage ?? undefined}
            >
              {saveState === 'saving' && 'Saving…'}
              {saveState === 'saved' && 'Saved'}
              {saveState === 'error' && (saveMessage ?? 'Save failed')}
              {saveState === 'idle' && (history.isDirty ? 'Unsaved changes' : 'All changes saved')}
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <IconButton
              label={entityPanelOpen ? 'Hide left panel' : 'Show left panel'}
              onClick={() => setEntityPanelOpen((open) => !open)}
            >
              {entityPanelOpen ? '⊣' : '⊢'}
            </IconButton>
            <IconButton
              label={propertyPanelOpen ? 'Hide right panel' : 'Show right panel'}
              onClick={() => setPropertyPanelOpen((open) => !open)}
            >
              {propertyPanelOpen ? '⊢' : '⊣'}
            </IconButton>

            <button
              type="button"
              onClick={() => setIsPreview(true)}
              className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Preview
            </button>
            {canSubmit && <SubmitButton applicationId={applicationId} onBeforeSubmit={save} />}
            {canPublish && (
              <Link
                to="/reviews"
                className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Reviews
              </Link>
            )}
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          {!entityPanelOpen && (
            <button
              type="button"
              onClick={() => setEntityPanelOpen(true)}
              title="Show queries, JS and UI"
              className="w-6 shrink-0 border-r border-slate-200 bg-white text-xs text-slate-400 hover:bg-slate-50 hover:text-slate-600"
            >
              ›
            </button>
          )}

          <aside
            className={clsx(
              'relative shrink-0 border-r border-slate-200 bg-white',
              entityPanelOpen ? '' : 'hidden',
            )}
            style={entityPanelOpen ? { width: entityPanelWidth } : undefined}
          >
            <PanelResizeHandle
              size={entityPanelWidth}
              onSizeChange={setEntityPanelWidth}
              side="end"
              min={ENTITY_PANEL_SIZE.min}
              max={ENTITY_PANEL_SIZE.max}
              label="Resize left panel"
            />
            <EntityPanel
              dsl={history.dsl}
              page={page}
              datasources={datasources}
              selectedQueryName={selectedQueryName}
              selectedWidgetId={selectedWidgetId}
              selectedJsId={selectedJsId}
              onSelectWidget={setSelectedWidgetId}
              onAddWidget={(type) => {
                /*
                 * Into the selected container when that is a drop target — so a
                 * Form (or Container) can be filled by clicking the palette,
                 * not only by dragging onto its inner grid. Otherwise at the
                 * foot of the page, which cannot displace anything already
                 * placed.
                 */
                const selected = selectedWidgetId
                  ? findWidget(page?.widgets ?? [], selectedWidgetId)
                  : undefined;
                const selectedDef = selected ? getWidgetDefinition(selected.type) : undefined;
                if (selected && selectedDef?.isContainer) {
                  if (selectedDef.childLayout === 'cells') {
                    addWidgetToContainer(selected.id, type);
                    return;
                  }
                  const bottom = (selected.children ?? []).reduce(
                    (lowest, widget) => Math.max(lowest, widget.layout.y + widget.layout.h),
                    0,
                  );
                  addWidget(selected.id, type, { x: 0, y: bottom });
                  return;
                }

                const bottom = (page?.widgets ?? []).reduce(
                  (lowest, widget) => Math.max(lowest, widget.layout.y + widget.layout.h),
                  0,
                );
                addWidget(null, type, { x: 0, y: bottom });
              }}
              onDeleteWidget={deleteWidget}
              onSelectQuery={(name) => {
                setSelectedQueryName(name);
                setBottomTab(name ? 'query' : null);
              }}
              onCreateQuery={createQuery}
              onDeleteQuery={(name) =>
                history.update((draft) => {
                  draft.queries = draft.queries.filter((query) => query.name !== name);
                  if (selectedQueryName === name) {
                    setSelectedQueryName(null);
                    setBottomTab(null);
                  }
                }, 'delete-query')
              }
              onCreateJsObject={() => {
                if (!currentPageId) return;
                const id = `js_${Math.random().toString(36).slice(2, 8)}`;
                const name = uniqueName(
                  'Utils',
                  jsObjectsOnPage(history.dsl.jsObjects, currentPageId),
                );

                history.update((draft) => {
                  draft.jsObjects ??= [];
                  draft.jsObjects.push({
                    id,
                    name,
                    pageId: currentPageId,
                    code: `module.exports = {
  format(value) {
    return String(value);
  },

  // Behaviour → On change / On click → Run JS function.
  // Find a control by its Id or Class, then assign value or other properties.
  onChange(event) {
    const source = document.byId(event.source.id);
    // document.byId('w_input').value = source.value;
    // document.querySelector('#w_select').options = [{ label: 'A', value: 'a' }];
    // document.byClass('totals').forEach((el) => { el.disabled = false; });
  },
};`,
                  });
                }, 'add-js');
                setSelectedJsId(id);
                setBottomTab('js');
              }}
              onSelectJsObject={(id) => {
                setSelectedJsId(id);
                setBottomTab('js');
              }}
              onRenameJsObject={renameJsObject}
              onCopyJsObject={copyJsObject}
              onMoveJsObject={moveJsObject}
              onDeleteJsObject={deleteJsObject}
            />
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <div
              ref={canvasHostRef}
              /*
               * The canvas scrolls vertically only. Its width is the design
               * boundary — the grid is 24 columns wide and a widget cannot exceed
               * them, so anything appearing to the right is an error rather than
               * content, and letting it scroll would hide that.
               *
               * `scrollbar-gutter: stable` reserves the vertical scrollbar's space
               * whether or not it is showing. Without it, growing a container makes
               * the scrollbar appear, which narrows the element, which makes the
               * canvas wider than its container — so a widget expanded to the full
               * 24 columns produced a horizontal scrollbar, and correcting the width
               * removed the vertical one again, and the two flickered against each
               * other.
               */
              className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-slate-100"
              style={{
                scrollbarGutter: 'stable',
                paddingInline: CANVAS_GUTTER,
                paddingTop: CANVAS_TOP_GUTTER,
                paddingBottom: CANVAS_GUTTER,
              }}
              onClick={(event) => {
                if (event.target === event.currentTarget) setSelectedWidgetId(null);
              }}
              onDragOver={(event) => acceptPaletteDrag(event)}
              onDrop={(event) => {
                const type = takePaletteDrop(event);
                if (!type) return;
                addWidget(dropParentId(event), type, { x: 0, y: 0 });
              }}
            >
              {/* Left-aligned, not centred: the canvas starts where the panel ends
                  so the widget you are editing stays next to its properties, and
                  a wider window adds room on the right rather than shifting
                  everything sideways.

                  The frame is exactly as wide as the grid inside it — clamping the
                  frame while the grid rendered at the target width left widgets
                  spilling past the edge of the page they are supposedly on. */}
              <div
                className="min-h-full border-slate-200 bg-white"
                style={{ width: canvasWidth }}
              >
                {page && (
                  <Canvas
                    page={page}
                    runtime={runtime}
                    width={canvasWidth}
                    fitVersion={fitVersion}
                    handlers={{
                      selectedWidgetId,
                      onSelect: setSelectedWidgetId,
                      onLayoutChange: applyLayout,
                      onDropWidget: addWidget,
                      onDropIntoContainer: addWidgetToContainer,
                      onUpdateProperties: updateWidgetProperties,
                      onDelete: deleteWidget,
                    }}
                  />
                )}
              </div>
            </div>

            {bottomTab && (
              <div className="h-72 shrink-0 border-t border-slate-200 bg-white">
                {bottomTab === 'query' ? (
                  <QueryPanel
                    query={selectedQuery}
                    applicationId={applicationId}
                    environmentId={environmentId}
                    datasources={datasources}
                    bindings={runtime.queryBindings(selectedQueryName ?? '')}
                    onChange={(mutate) =>
                      selectedQueryName && changeQuery(selectedQueryName, mutate)
                    }
                    onClose={() => setBottomTab(null)}
                  />
                ) : bottomTab === 'js' ? (
                  <JsObjectPanel
                    jsObject={selectedJsObject}
                    dsl={history.dsl}
                    pages={history.dsl.pages}
                    currentPageId={currentPageId}
                    onChange={(mutate) => {
                      if (!selectedJsId) return;
                      history.update((draft) => {
                        const target = (draft.jsObjects ?? []).find(
                          (object) => object.id === selectedJsId,
                        );
                        if (target) mutate(target);
                      }, 'edit-js');
                    }}
                    onClose={() => setBottomTab(null)}
                    onDelete={() => {
                      if (selectedJsId) deleteJsObject(selectedJsId);
                    }}
                    onRename={(name) => {
                      if (selectedJsId) renameJsObject(selectedJsId, name);
                    }}
                    onCopyToPage={(pageId) => {
                      if (selectedJsId) copyJsObject(selectedJsId, pageId);
                    }}
                    onMoveToPage={(pageId) => {
                      if (selectedJsId) moveJsObject(selectedJsId, pageId);
                    }}
                  />
                ) : (
                  <ErrorList
                    errors={runtime.evaluationErrors}
                    timedOut={runtime.evaluationStats.timedOut}
                    onClose={() => setBottomTab(null)}
                  />
                )}
              </div>
            )}
          </div>

          {!propertyPanelOpen && (
            <button
              type="button"
              onClick={() => setPropertyPanelOpen(true)}
              title="Show properties"
              className="w-6 shrink-0 border-l border-slate-200 bg-white text-xs text-slate-400 hover:bg-slate-50 hover:text-slate-600"
            >
              ‹
            </button>
          )}

          <aside
            className={clsx(
              'relative shrink-0 overflow-hidden border-l border-slate-200 bg-white',
              propertyPanelOpen ? '' : 'hidden',
            )}
            style={propertyPanelOpen ? { width: propertyPanelWidth } : undefined}
          >
            <PanelResizeHandle
              size={propertyPanelWidth}
              onSizeChange={setPropertyPanelWidth}
              side="start"
              min={PROPERTY_PANEL_SIZE.min}
              max={PROPERTY_PANEL_SIZE.max}
              label="Resize right panel"
            />
            {selectedWidget ? (
              <PropertyPanel
                widget={selectedWidget}
                parent={selectedParent}
                dsl={history.dsl}
                pageId={currentPageId}
                evaluated={runtime.evaluated}
                onChange={(key, value) =>
                  updatePage((target) => {
                    const widget = findWidget(target.widgets, selectedWidgetId ?? '');
                    if (!widget) return;
                    widget.properties =
                      value == null
                        ? Object.fromEntries(
                            Object.entries({ ...widget.properties }).filter(([name]) => name !== key),
                          )
                        : { ...widget.properties, [key]: value };
                    if (widget.type === 'grid' && key === 'columns') {
                      reflowGridChildren(widget, Number(value));
                    }
                  }, `property:${key}`)
                }
                onLayout={(patch) => {
                  updatePage((target) => {
                    const widget = findWidget(target.widgets, selectedWidgetId ?? '');
                    if (!widget) return;
                    const { canvasSize, ...layoutPatch } = patch;
                    widget.layout = { ...widget.layout, ...layoutPatch };
                    widget.properties = {
                      ...widget.properties,
                      canvasSize:
                        canvasSize ??
                        (widget.layout.h >= 26 ? 3 : widget.layout.w >= 18 ? 2 : 1),
                    };
                  }, 'layout');
                  // react-grid-layout keeps its own copy of w/h and will not
                  // adopt a size written from the property panel unless remounted.
                  setFitVersion((version) => version + 1);
                }}
                onRename={(name) =>
                  updatePage((target) => {
                    const widget = findWidget(target.widgets, selectedWidgetId ?? '');
                    if (widget) widget.name = name;
                  }, 'rename')
                }
                onDelete={() => selectedWidgetId && deleteWidget(selectedWidgetId)}
              />
            ) : (
              <PagePropertiesPanel
                dsl={history.dsl}
                page={page}
                canvasPreset={canvasPreset}
                onCanvasPresetChange={setCanvasPreset}
                onPageChange={updatePage}
                onAppChange={history.update}
              />
            )}
          </aside>
        </div>

        <BottomBar
          environments={environments}
          environmentId={environmentId}
          onEnvironmentChange={setEnvironmentId}
          errorCount={runtime.evaluationErrors.length}
          onShowErrors={() => setBottomTab(bottomTab === 'errors' ? null : 'errors')}
          status={
            <span className="tabular-nums text-slate-400">
              {runtime.evaluationStats.timedOut
                ? 'Evaluation timed out — check for an infinite loop'
                : `eval ${runtime.evaluationStats.durationMs.toFixed(1)}ms · ${
                    runtime.evaluationStats.recomputed
                  } bindings`}
            </span>
          }
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Chrome
 * ------------------------------------------------------------------ */

function SubmitButton({
  applicationId,
  onBeforeSubmit,
}: {
  applicationId: string;
  onBeforeSubmit: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setResult(null);
    try {
      await onBeforeSubmit();
      const note = window.prompt('What changed in this version?') ?? undefined;
      const version = await api.publish.submit(applicationId, note);
      setResult(`Version ${version.versionNumber} submitted for review`);
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setTimeout(() => setResult(null), 6000);
    }
  };

  return (
    <>
      {result && <span className="max-w-xs truncate text-xs text-slate-600">{result}</span>}
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? 'Submitting…' : 'Submit for review'}
      </button>
    </>
  );
}

function IconButton({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function ErrorList({
  errors,
  timedOut,
  onClose,
}: {
  errors: { path: string; message: string }[];
  timedOut: boolean;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-1.5">
        <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
          Errors
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-1.5 text-sm text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {timedOut ? (
          <p className="p-4 text-sm text-red-700">
            Evaluation was stopped after 15 seconds. One of the bindings on this page is likely
            looping — the worker has been restarted, so the editor is still usable.
          </p>
        ) : errors.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">No binding errors on this page</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {errors.map((error) => (
              <li key={error.path} className="px-3 py-2">
                <code className="text-xs font-medium text-blue-600">{error.path}</code>
                <p className="text-xs text-red-600">{error.message}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function cellAwareProperties(
  page: PageDsl,
  parentId: string | null,
  siblings: WidgetDsl[],
  definition: WidgetDefinition,
  seed?: Record<string, unknown>,
): Record<string, unknown> {
  const properties = { ...defaultProperties(definition), ...seed };
  if (!parentId) return properties;
  const parent = findWidget(page.widgets, parentId);
  if (!parent || getWidgetDefinition(parent.type)?.childLayout !== 'cells') return properties;
  const columns = Math.max(1, Number(parent.properties.columns ?? 3));
  return seedCellProperties(siblings, columns, properties);
}

function CenteredMessage({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-1">
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {detail && <p className="max-w-md text-center text-xs text-slate-400">{detail}</p>}
    </div>
  );
}
