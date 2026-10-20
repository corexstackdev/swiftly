import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { api, type ApplicationReleaseSummary, type ApplicationSummary, type Workspace } from '@/lib/api';
import { useSession } from '@/lib/session';
import { AppHeader } from '@/shell/AppHeader';
import { formatAbsolute, formatRelative } from '@/lib/relativeTime';
import { publishedAppPath } from '@/lib/paths';

/**
 * The application home screen.
 *
 * This is the first thing anyone sees after signing in, and for most people it is
 * the only navigation they will use all day — so it is built to be scanned, not
 * read. Everything that helps someone find the app they want is at the top in one
 * row, the cards carry the four facts that distinguish one app from another, and
 * nothing here needs a page reload.
 *
 * Search, filter and sort are all client-side on purpose. The list endpoint
 * returns an organisation's applications in one response and an organisation has
 * tens of them, not thousands; a round trip per keystroke would be slower and
 * would make the filters feel laggy for no benefit. If a tenant ever outgrows
 * that, the toolbar state maps one-to-one onto query parameters.
 */

type ViewMode = 'grid' | 'list';
type SortKey = 'updated' | 'name' | 'name-desc';
type StatusFilter = 'all' | 'published' | 'draft' | 'archived';

const VIEW_STORAGE_KEY = 'swiftly.apps.view';

/*
 * Shared by the cards and by the placeholders that stand in for them, so the two
 * cannot drift and make the page jump as it loads.
 *
 * The column count keeps climbing past the usual breakpoints because this page
 * is full-bleed: on a wide monitor, stopping at four would leave a card the
 * width of a paragraph and half the screen empty.
 */
const GRID_CLASSES =
  'grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 min-[1900px]:grid-cols-6';

const LIST_CLASSES =
  'divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white';

export function AppListPage() {
  const { can } = useSession();
  const navigate = useNavigate();

  const [apps, setApps] = useState<ApplicationSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [workspaceId, setWorkspaceId] = useState<string>('all');
  const [sort, setSort] = useState<SortKey>('updated');
  const [view, setView] = useState<ViewMode>(readStoredView);

  const [showCreate, setShowCreate] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback((): void => {
    setError(null);
    Promise.all([api.applications.list(), api.workspaces.list()])
      .then(([list, spaces]) => {
        setApps(list);
        setWorkspaces(spaces);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // A browser with site data blocked still gets a working page, just not a
      // remembered one.
    }
  }, [view]);

  /* `/` jumps to search, the way it does in every tool people already use. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const workspaceById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace])),
    [workspaces],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const filtered = apps.filter((app) => {
      if (workspaceId !== 'all' && app.workspaceId !== workspaceId) return false;

      if (status === 'published' && (app.releases?.length ?? 0) === 0 && !app.publishedVersionId) {
        return false;
      }
      if (
        status === 'draft' &&
        ((app.releases?.length ?? 0) > 0 || app.publishedVersionId || app.status === 'ARCHIVED')
      ) {
        return false;
      }
      if (status === 'archived' && app.status !== 'ARCHIVED') return false;

      if (!needle) return true;
      return (
        app.name.toLowerCase().includes(needle) ||
        app.slug.toLowerCase().includes(needle) ||
        (app.description ?? '').toLowerCase().includes(needle)
      );
    });

    // Sorted on a copy: `apps` is the response, and re-sorting it in place would
    // make the order depend on which filters had been used before.
    return [...filtered].sort((left, right) => {
      if (sort === 'name') return left.name.localeCompare(right.name);
      if (sort === 'name-desc') return right.name.localeCompare(left.name);
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }, [apps, query, status, workspaceId, sort]);

  const hasArchived = apps.some((app) => app.status === 'ARCHIVED');
  const filtering = query.trim() !== '' || status !== 'all' || workspaceId !== 'all';

  const remove = async (app: ApplicationSummary): Promise<void> => {
    // Removed from the list first: the request has already succeeded by the time
    // this runs, and waiting for a reload to redraw makes it feel like it failed.
    try {
      await api.applications.remove(app.id);
      setApps((previous) => previous.filter((candidate) => candidate.id !== app.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader />

      <main className="px-6 pb-16">
        <div className="flex flex-wrap items-end justify-between gap-3 pt-8 pb-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Applications</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              {loading
                ? 'Loading…'
                : `${apps.length} application${apps.length === 1 ? '' : 's'} in this organisation`}
            </p>
          </div>

          {can('app:create') && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              disabled={workspaces.length === 0}
              className="rounded-md bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              New application
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2.5">
            <p className="flex-1 text-xs text-red-700">{error}</p>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                load();
              }}
              className="rounded border border-red-300 bg-white px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100"
            >
              Try again
            </button>
          </div>
        )}

        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400">
              <SearchIcon />
            </span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search applications"
              aria-label="Search applications"
              className="w-full rounded border border-transparent bg-slate-50 py-1.5 pr-8 pl-8 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:bg-white"
            />
            {query === '' && (
              <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-slate-200 bg-white px-1 text-[10px] text-slate-400">
                /
              </kbd>
            )}
          </div>

          <Select value={status} onChange={(value) => setStatus(value as StatusFilter)} label="Status">
            <option value="all">All statuses</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
            {hasArchived && <option value="archived">Archived</option>}
          </Select>

          {workspaces.length > 1 && (
            <Select value={workspaceId} onChange={setWorkspaceId} label="Workspace">
              <option value="all">All workspaces</option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </Select>
          )}

          <Select value={sort} onChange={(value) => setSort(value as SortKey)} label="Sort by">
            <option value="updated">Recently updated</option>
            <option value="name">Name A–Z</option>
            <option value="name-desc">Name Z–A</option>
          </Select>

          <div className="flex items-center gap-0.5 rounded border border-slate-200 p-0.5">
            <ViewToggle current={view} value="grid" onSelect={setView} label="Grid view">
              <GridIcon />
            </ViewToggle>
            <ViewToggle current={view} value="list" onSelect={setView} label="List view">
              <ListIcon />
            </ViewToggle>
          </div>
        </div>

        {loading ? (
          <Skeletons view={view} />
        ) : visible.length === 0 ? (
          <EmptyState
            filtering={filtering}
            canCreate={can('app:create')}
            onClear={() => {
              setQuery('');
              setStatus('all');
              setWorkspaceId('all');
            }}
            onCreate={() => setShowCreate(true)}
          />
        ) : (
          <>
            {filtering && (
              <p className="mb-2.5 text-[11px] text-slate-400">
                Showing {visible.length} of {apps.length}
              </p>
            )}

            <div
              className={clsx(
                view === 'grid'
                  ? GRID_CLASSES
                  : LIST_CLASSES,
              )}
            >
              {visible.map((app) => (
                <AppEntry
                  key={app.id}
                  app={app}
                  view={view}
                  workspace={workspaceById.get(app.workspaceId)}
                  onDelete={() => void remove(app)}
                />
              ))}
            </div>
          </>
        )}
      </main>

      {showCreate && (
        <CreateDialog
          workspaces={workspaces}
          onClose={() => setShowCreate(false)}
          onCreated={(app) => navigate(`/apps/${app.id}/edit`)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * One application
 * ------------------------------------------------------------------ */

/**
 * The card, and the row — one component, because they carry the same facts and
 * the same actions and only differ in how they are laid out.
 *
 * The whole card is clickable through a stretched link on the name rather than by
 * wrapping everything in an anchor: a menu button inside a link is invalid markup
 * and unusable with a keyboard, and this keeps one real link per card for anyone
 * navigating by them.
 */
function AppEntry({
  app,
  view,
  workspace,
  onDelete,
}: {
  app: ApplicationSummary;
  view: ViewMode;
  workspace: Workspace | undefined;
  onDelete: () => void;
}) {
  const { can } = useSession();

  const editorPath = `/apps/${app.id}/edit`;
  const releases = app.releases ?? [];
  const defaultRelease =
    releases.find((release) => release.isProduction) ?? releases[0];
  const publishedPath =
    defaultRelease && workspace
      ? publishedAppPath(workspace.slug, app.slug, defaultRelease.environmentName)
      : app.publishedVersionId && workspace
        ? publishedAppPath(workspace.slug, app.slug)
        : null;
  const target = can('app:edit') ? editorPath : publishedPath;

  const meta = (
    <>
      {workspace && (
        <>
          <span className="truncate">{workspace.name}</span>
          <Dot />
        </>
      )}
      <span title={formatAbsolute(app.updatedAt)}>{formatRelative(app.updatedAt)}</span>
      <Dot />
      <span className="truncate">{app.createdBy.name}</span>
    </>
  );

  if (view === 'list') {
    return (
      <div className="group relative flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-slate-50 focus-within:bg-slate-50">
        <AppMark app={app} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="min-w-0 truncate text-xs font-semibold text-slate-900">
              {target ? (
                <Link to={target} className="after:absolute after:inset-0 hover:text-blue-700">
                  {app.name}
                </Link>
              ) : (
                app.name
              )}
            </h2>
            <StatusBadge app={app} />
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-slate-400">
            {meta}
          </p>
        </div>

        {app.description && (
          <p className="hidden min-w-0 flex-1 truncate text-[11px] text-slate-500 lg:block">
            {app.description}
          </p>
        )}

        <div className="relative z-10 shrink-0">
          <EntryMenu
            app={app}
            editorPath={editorPath}
            publishedPath={publishedPath}
            publishedReleases={releases}
            workspaceSlug={workspace?.slug}
            onDelete={onDelete}
          />
        </div>
      </div>
    );
  }

  return (
    <article className="group relative flex flex-col rounded-lg border border-slate-200 bg-white p-4 transition-all hover:border-slate-300 hover:shadow-md focus-within:border-blue-400">
      <div className="flex items-start gap-3">
        <AppMark app={app} />

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-slate-900">
            {target ? (
              <Link to={target} className="after:absolute after:inset-0 hover:text-blue-700">
                {app.name}
              </Link>
            ) : (
              app.name
            )}
          </h2>
          <div className="mt-1">
            <StatusBadge app={app} />
          </div>
        </div>

        <div className="relative z-10 shrink-0">
          <EntryMenu
            app={app}
            editorPath={editorPath}
            publishedPath={publishedPath}
            publishedReleases={releases}
            workspaceSlug={workspace?.slug}
            onDelete={onDelete}
          />
        </div>
      </div>

      {/* A fixed two-line slot whether or not there is a description, so cards in
          a row line up instead of stepping up and down. */}
      <p className="mt-3 line-clamp-2 min-h-[2rem] text-xs text-slate-500">
        {app.description ?? <span className="text-slate-300">No description</span>}
      </p>

      <p className="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-2.5 text-[11px] text-slate-400">
        {meta}
      </p>
    </article>
  );
}

/** The app's own icon when it has one, otherwise its initial on a stable colour. */
function AppMark({ app }: { app: ApplicationSummary }) {
  if (app.icon) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-base">
        {app.icon}
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={clsx(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm font-semibold text-white',
        MARK_COLOURS[markHash(app.id) % MARK_COLOURS.length],
      )}
    >
      {app.name.trim()[0]?.toUpperCase() ?? '?'}
    </span>
  );
}

function StatusBadge({ app }: { app: ApplicationSummary }) {
  if (app.status === 'ARCHIVED') {
    return <Badge className="bg-slate-100 text-slate-500">Archived</Badge>;
  }
  const releases = app.releases ?? [];
  if (releases.length > 0 || app.publishedVersionId) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <Badge className="bg-emerald-100 text-emerald-700">Published</Badge>
        {releases.map((release) => (
          <Badge key={release.environmentId} className="bg-slate-100 text-slate-600">
            {release.environmentName}
          </Badge>
        ))}
      </span>
    );
  }
  return <Badge className="bg-amber-100 text-amber-700">Draft</Badge>;
}

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={clsx(
        'inline-block shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Everything you can do to an application that is not "open it".
 *
 * Delete confirms inside the menu rather than through `window.confirm`: the
 * native dialog gives no room to say what is about to be lost, and an
 * application is not something to remove on a single click.
 */
function EntryMenu({
  app,
  editorPath,
  publishedPath,
  publishedReleases,
  workspaceSlug,
  onDelete,
}: {
  app: ApplicationSummary;
  editorPath: string;
  publishedPath: string | null;
  publishedReleases: ApplicationReleaseSummary[];
  workspaceSlug: string | undefined;
  onDelete: () => void;
}) {
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = (): void => {
    setOpen(false);
    setConfirming(false);
    setCopied(false);
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

  const copyLink = async (): Promise<void> => {
    const url = new URL(publishedPath ?? editorPath, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard access can be refused outright; the menu simply stays as it was
      // rather than claiming a copy that did not happen.
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${app.name}`}
        className={clsx(
          'rounded p-1 text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-600',
          open && 'bg-slate-100 text-slate-600',
        )}
      >
        <MoreIcon />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 z-50 mt-1 w-56 rounded-md border border-slate-200 bg-white py-1 text-left shadow-lg"
        >
          {confirming ? (
            <div className="px-3 py-2">
              <p className="text-xs font-medium text-slate-900">Delete “{app.name}”?</p>
              <p className="mt-1 text-[11px] text-slate-500">
                Its pages, queries and published versions go with it. This cannot be undone.
              </p>
              <div className="mt-2.5 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    close();
                    onDelete();
                  }}
                  className="rounded bg-red-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-700"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {can('app:edit') && (
                <MenuLink to={editorPath} onNavigate={close}>
                  Open in editor
                </MenuLink>
              )}
              {publishedReleases.length > 0 && workspaceSlug ? (
                publishedReleases.map((release) => (
                  <MenuLink
                    key={release.environmentId}
                    to={publishedAppPath(workspaceSlug, app.slug, release.environmentName)}
                    onNavigate={close}
                  >
                    Open {release.environmentName}
                  </MenuLink>
                ))
              ) : publishedPath ? (
                <MenuLink to={publishedPath} onNavigate={close}>
                  Open published app
                </MenuLink>
              ) : (
                <p className="px-3 py-1.5 text-xs text-slate-300">Not published yet</p>
              )}

              <MenuButton onClick={() => void copyLink()}>
                {copied ? 'Link copied' : 'Copy link'}
              </MenuButton>

              {can('app:delete') && (
                <>
                  <div className="my-1 border-t border-slate-100" />
                  <MenuButton danger onClick={() => setConfirming(true)}>
                    Delete…
                  </MenuButton>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuLink({
  to,
  onNavigate,
  children,
}: {
  to: string;
  onNavigate: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      role="menuitem"
      onClick={onNavigate}
      className="block px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
    >
      {children}
    </Link>
  );
}

function MenuButton({
  danger,
  onClick,
  children,
}: {
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={clsx(
        'block w-full px-3 py-1.5 text-left text-xs',
        danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-100',
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Creating one
 * ------------------------------------------------------------------ */

/**
 * Replaces `window.prompt`, which could only ask one question and showed nothing
 * about what it was going to do with the answer. The route the application will
 * live at is derived from the name, so it is shown while the name is being typed
 * rather than discovered afterwards.
 */
function CreateDialog({
  workspaces,
  onClose,
  onCreated,
}: {
  workspaces: Workspace[];
  onClose: () => void;
  onCreated: (app: ApplicationSummary) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  const slug = slugify(name);
  const ready = name.trim() !== '' && slug !== '' && workspaceId !== '';

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!ready || busy) return;

    setBusy(true);
    setError(null);
    try {
      const app = await api.applications.create({
        workspaceId,
        name: name.trim(),
        slug,
        description: description.trim() || undefined,
      });
      onCreated(app);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-24"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label="New application"
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">New application</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            It starts as a draft. Nobody outside the builders sees it until IT publishes it.
          </p>
        </div>

        <div className="flex flex-col gap-3 px-4 py-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-700">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Application name"
              className="rounded border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:border-blue-500"
            />
            <span className="text-[11px] text-slate-400">
              {slug ? (
                <>
                  Address: <code className="text-slate-500">/app/…/{slug}</code>
                </>
              ) : (
                'Used for the published address.'
              )}
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-700">
              Description <span className="font-normal text-slate-400">(optional)</span>
            </span>
            <textarea
              value={description}
              rows={2}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this app is for, and who uses it"
              className="resize-none rounded border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:border-blue-500"
            />
          </label>

          {workspaces.length > 1 && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-700">Workspace</span>
              <select
                value={workspaceId}
                onChange={(event) => setWorkspaceId(event.target.value)}
                className="rounded border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-blue-500"
              >
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {error && (
            <p className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!ready || busy}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
          >
            {busy ? 'Creating…' : 'Create and open'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * States and small parts
 * ------------------------------------------------------------------ */

/**
 * Placeholders rather than a spinner: the page keeps the shape it is about to
 * have, so nothing jumps when the response lands.
 */
function Skeletons({ view }: { view: ViewMode }) {
  return (
    <div
      className={clsx(
        view === 'grid'
          ? GRID_CLASSES
          : LIST_CLASSES,
      )}
    >
      {Array.from({ length: view === 'grid' ? 8 : 6 }, (_, index) => (
        <div
          key={index}
          className={clsx(
            'animate-pulse',
            view === 'grid'
              ? 'rounded-lg border border-slate-200 bg-white p-4'
              : 'flex items-center gap-3 px-3.5 py-2.5',
          )}
        >
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 shrink-0 rounded-md bg-slate-200" />
            <div className="flex-1 space-y-1.5">
              <div className="h-2.5 w-2/3 rounded bg-slate-200" />
              <div className="h-2 w-1/3 rounded bg-slate-100" />
            </div>
          </div>
          {view === 'grid' && (
            <div className="mt-4 space-y-1.5">
              <div className="h-2 w-full rounded bg-slate-100" />
              <div className="h-2 w-4/5 rounded bg-slate-100" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Two different nothings.
 *
 * An organisation with no applications needs an invitation to make one; a search
 * with no matches needs its filters cleared. Telling someone to "create your
 * first application" when they have thirty and simply mistyped a name is the
 * kind of thing that makes a product feel like it is not paying attention.
 */
function EmptyState({
  filtering,
  canCreate,
  onClear,
  onCreate,
}: {
  filtering: boolean;
  canCreate: boolean;
  onClear: () => void;
  onCreate: () => void;
}) {
  if (filtering) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white py-16 text-center">
        <p className="text-sm font-medium text-slate-700">No application matches</p>
        <p className="mt-1 text-xs text-slate-500">Try a different search, or clear the filters.</p>
        <button
          type="button"
          onClick={onClear}
          className="mt-4 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Clear filters
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white py-16 text-center">
      <p className="text-sm font-medium text-slate-700">No applications yet</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">
        An application holds the pages you design, the queries behind them, and the versions IT
        reviews before anyone else sees them.
      </p>
      {canCreate && (
        <button
          type="button"
          onClick={onCreate}
          className="mt-4 rounded-md bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700"
        >
          Create the first one
        </button>
      )}
    </div>
  );
}

function Select({
  value,
  onChange,
  label,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
      className="shrink-0 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600 outline-none focus:border-blue-500"
    >
      {children}
    </select>
  );
}

function ViewToggle({
  current,
  value,
  onSelect,
  label,
  children,
}: {
  current: ViewMode;
  value: ViewMode;
  onSelect: (value: ViewMode) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={current === value}
      onClick={() => onSelect(value)}
      className={clsx(
        'rounded p-1 transition-colors',
        current === value ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:text-slate-600',
      )}
    >
      {children}
    </button>
  );
}

function Dot() {
  return <span className="text-slate-300">·</span>;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function readStoredView(): ViewMode {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const MARK_COLOURS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-600',
  'bg-indigo-500',
  'bg-teal-500',
];

function markHash(value: string): number {
  let total = 0;
  for (let index = 0; index < value.length; index += 1) {
    total = (total * 31 + value.charCodeAt(index)) >>> 0;
  }
  return total;
}

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="4.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M9.2 9.2 12.5 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <rect x="1.5" y="1.5" width="4.5" height="4.5" rx="1" />
      <rect x="8" y="1.5" width="4.5" height="4.5" rx="1" />
      <rect x="1.5" y="8" width="4.5" height="4.5" rx="1" />
      <rect x="8" y="8" width="4.5" height="4.5" rx="1" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <rect x="1.5" y="2.5" width="11" height="2" rx="1" />
      <rect x="1.5" y="6" width="11" height="2" rx="1" />
      <rect x="1.5" y="9.5" width="11" height="2" rx="1" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <circle cx="7" cy="3" r="1.3" />
      <circle cx="7" cy="7" r="1.3" />
      <circle cx="7" cy="11" r="1.3" />
    </svg>
  );
}
