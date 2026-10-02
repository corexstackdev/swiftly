import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { ApplicationDsl } from '@swiftly/shared';
import { api, type Environment } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAppRuntime } from '@/runtime/useAppRuntime';
import { AppShell } from '@/runtime/AppShell';
import { PageRenderer } from '@/runtime/PageRenderer';

/**
 * A published application, as end users see it.
 *
 * The DSL comes from the frozen version the server serves — never the draft — and
 * pages the caller may not open have already been stripped server-side.
 */

export function PublishedAppPage() {
  const { workspaceSlug = '', appSlug = '' } = useParams();
  const { user } = useSession();

  const [loaded, setLoaded] = useState<{
    applicationId: string;
    name: string;
    versionNumber: number;
    dsl: ApplicationDsl;
  } | null>(null);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.runtime.load(workspaceSlug, appSlug), api.workspaces.environments()])
      .then(([application, envs]) => {
        if (cancelled) return;
        setLoaded(application);
        setEnvironments(envs);
      })
      .catch((caught) =>
        !cancelled && setError(caught instanceof Error ? caught.message : String(caught)),
      );
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, appSlug]);

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
    <PublishedAppBody
      applicationId={loaded.applicationId}
      name={loaded.name}
      versionNumber={loaded.versionNumber}
      dsl={loaded.dsl}
      // Published apps run against the production environment's credentials.
      environmentId={
        environments.find((environment) => environment.isProduction)?.id ??
        environments[0]?.id ??
        ''
      }
      currentUser={user}
    />
  );
}

function PublishedAppBody({
  applicationId,
  name,
  versionNumber,
  dsl,
  environmentId,
  currentUser,
}: {
  applicationId: string;
  name: string;
  versionNumber: number;
  dsl: ApplicationDsl;
  environmentId: string;
  currentUser: ReturnType<typeof useSession>['user'];
}) {
  const runtime = useAppRuntime({
    dsl,
    applicationId,
    environmentId,
    source: 'published',
    currentUser,
    isDesignMode: false,
  });

  return (
    <div className="h-screen">
      <AppShell
        navigation={dsl.navigation}
        runtime={runtime}
        header={
          <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
            <span className="text-sm font-semibold text-slate-800">{name}</span>
            <span className="text-[11px] text-slate-400">v{versionNumber}</span>
            <span className="ml-auto text-xs text-slate-500">{currentUser?.name}</span>
          </div>
        }
      >
        {runtime.page && <PageRenderer widgets={runtime.page.widgets} runtime={runtime} />}
      </AppShell>
    </div>
  );
}
