import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { api, type PublishedAppPayload } from '@/lib/api';
import { useSession } from '@/lib/session';
import { editorPath, publishedAppPath } from '@/lib/paths';
import { RuntimeApp } from '@/runtime/RuntimeApp';

const RESERVED_ENV_SEGMENTS = new Set(['preview', 'queries']);

/**
 * A published application, as end users see it — no Swiftly login.
 *
 * Environments are selected by path (`/app/workspace/slug/dev`), not a query string.
 * The bare URL is the production release when one exists.
 */

export function PublishedAppPage() {
  const { workspaceSlug = '', appSlug = '', environmentName } = useParams();
  const { user, can } = useSession();

  const [loaded, setLoaded] = useState<PublishedAppPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (environmentName && RESERVED_ENV_SEGMENTS.has(environmentName)) return;
    let cancelled = false;
    setLoaded(null);
    setError(null);
    api.runtime
      .load(workspaceSlug, appSlug, environmentName ? { name: environmentName } : undefined)
      .then((application) => {
        if (!cancelled) setLoaded(application);
      })
      .catch(
        (caught) =>
          !cancelled && setError(caught instanceof Error ? caught.message : String(caught)),
      );
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, appSlug, environmentName]);

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-1">
        <p className="text-sm font-medium text-slate-700">This application is not available</p>
        <p className="max-w-md text-center text-xs text-slate-400">{error}</p>
      </div>
    );
  }
  if (environmentName && RESERVED_ENV_SEGMENTS.has(environmentName)) {
    return <Navigate to={`/app/${workspaceSlug}/${appSlug}`} replace />;
  }

  if (!loaded) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-slate-400">
        Loading…
      </div>
    );
  }

  const canSwitch =
    (can('app:edit') || can('app:publish')) && (loaded.releases?.length ?? 0) > 0;

  return (
    <RuntimeApp
      key={loaded.environmentId}
      applicationId={loaded.applicationId}
      name={loaded.name}
      dsl={loaded.dsl}
      environmentId={loaded.environmentId}
      currentUser={user}
      source="published"
      workspaceSlug={loaded.workspaceSlug}
      appSlug={loaded.appSlug}
      subtitle={`v${loaded.versionNumber} · ${loaded.environmentName}`}
      trailing={
        <>
          {canSwitch &&
            loaded.releases.map((release) => (
              <Link
                key={release.environmentId}
                to={publishedAppPath(
                  loaded.workspaceSlug,
                  loaded.appSlug,
                  release.environmentName,
                )}
                className={clsx(
                  'rounded px-1.5 py-0.5 text-[11px] font-medium',
                  release.environmentId === loaded.environmentId
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800',
                )}
              >
                {release.environmentName}
              </Link>
            ))}
          {can('app:edit') ? (
            <Link
              to={editorPath(loaded.applicationId)}
              className="rounded px-1.5 py-0.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              Edit
            </Link>
          ) : null}
        </>
      }
    />
  );
}
