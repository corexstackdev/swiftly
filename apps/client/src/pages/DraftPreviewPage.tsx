import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { ApplicationDsl } from '@swiftly/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { draftPreviewPath, editorPath } from '@/lib/paths';
import { RuntimeApp } from '@/runtime/RuntimeApp';

/**
 * Public hosted preview of the current draft — no Swiftly login.
 *
 * Same chrome as a deployed app. Copy this address into another browser and
 * the draft runs as the tool, not the editor.
 */

export function DraftPreviewPage() {
  const { applicationId = '', workspaceSlug = '', appSlug = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, can } = useSession();
  const requestedEnvironmentId = searchParams.get('environmentId') ?? '';

  const [loaded, setLoaded] = useState<{
    applicationId: string;
    name: string;
    workspaceSlug: string;
    appSlug: string;
    environmentId: string;
    dsl: ApplicationDsl;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = searchParams.toString();

  useEffect(() => {
    let cancelled = false;
    const load =
      workspaceSlug && appSlug
        ? api.runtime.preview(workspaceSlug, appSlug, requestedEnvironmentId || undefined)
        : applicationId
          ? api.runtime.previewById(applicationId, requestedEnvironmentId || undefined)
          : Promise.reject(new Error('Missing application'));

    load
      .then((application) => {
        if (cancelled) return;
        setLoaded(application);
        if (applicationId && (!workspaceSlug || !appSlug)) {
          const pretty = draftPreviewPath(application.workspaceSlug, application.appSlug);
          navigate(query ? `${pretty}?${query}` : pretty, { replace: true });
        }
      })
      .catch(
        (caught) =>
          !cancelled && setError(caught instanceof Error ? caught.message : String(caught)),
      );
    return () => {
      cancelled = true;
    };
  }, [applicationId, workspaceSlug, appSlug, navigate, query, requestedEnvironmentId]);

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-1">
        <p className="text-sm font-medium text-slate-700">This application is not available</p>
        <p className="max-w-md text-center text-xs text-slate-400">{error}</p>
      </div>
    );
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
      applicationId={loaded.applicationId}
      name={loaded.name}
      dsl={loaded.dsl}
      environmentId={loaded.environmentId}
      currentUser={user}
      source="draft"
      workspaceSlug={loaded.workspaceSlug}
      appSlug={loaded.appSlug}
      trailing={
        can('app:edit') ? (
          <Link
            to={editorPath(loaded.applicationId)}
            className="rounded px-1.5 py-0.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            Edit
          </Link>
        ) : null
      }
    />
  );
}
