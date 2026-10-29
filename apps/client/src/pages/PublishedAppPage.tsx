import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { api, type PublishedAppPayload } from '@/lib/api';
import { useSession } from '@/lib/session';
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
  const { user } = useSession();

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
    />
  );
}
