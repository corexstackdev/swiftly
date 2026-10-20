import type { ReactNode } from 'react';
import type { ApplicationDsl } from '@swiftly/shared';
import type { SessionUser } from '@/lib/api';
import { useAppRuntime } from './useAppRuntime';
import { AppShell } from './AppShell';
import { PageRenderer } from './PageRenderer';

/**
 * The running application chrome — published and public preview share this so
 * a copied URL is the hosted tool, not a second editor.
 */

export function RuntimeApp({
  applicationId,
  name,
  dsl,
  environmentId,
  currentUser,
  source,
  workspaceSlug,
  appSlug,
  subtitle,
  trailing,
}: {
  applicationId: string;
  name: string;
  dsl: ApplicationDsl;
  environmentId: string;
  currentUser: SessionUser | null;
  source: 'draft' | 'published';
  workspaceSlug?: string;
  appSlug?: string;
  subtitle?: string;
  trailing?: ReactNode;
}) {
  const runtime = useAppRuntime({
    dsl,
    applicationId,
    environmentId,
    source,
    currentUser,
    isDesignMode: false,
    workspaceSlug,
    appSlug,
  });

  return (
    <div className="h-screen">
      <AppShell
        navigation={dsl.navigation}
        runtime={runtime}
        header={
          <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
            <span className="text-sm font-semibold text-slate-800">{name}</span>
            {subtitle && <span className="text-[11px] text-slate-400">{subtitle}</span>}
            <span className="ml-auto flex items-center gap-3 text-xs text-slate-500">
              {trailing}
              {currentUser?.name}
            </span>
          </div>
        }
      >
        {runtime.page && <PageRenderer widgets={runtime.page.widgets} runtime={runtime} />}
      </AppShell>
    </div>
  );
}
