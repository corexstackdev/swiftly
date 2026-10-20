/**
 * In-app paths. Preview is a public hosted-app URL (no Swiftly login) so the
 * address can be copied and opened as the running tool in another browser.
 */

export function publishedAppPath(
  workspaceSlug: string,
  appSlug: string,
  environmentName?: string,
): string {
  const path = `/app/${workspaceSlug}/${appSlug}`;
  if (!environmentName) return path;
  return `${path}/${encodeURIComponent(environmentName)}`;
}

export function draftPreviewPath(workspaceSlug: string, appSlug: string): string {
  return `/app/${workspaceSlug}/${appSlug}/preview`;
}

export function draftPreviewByIdPath(applicationId: string): string {
  return `/apps/${applicationId}/preview`;
}

export function editorPath(applicationId: string): string {
  return `/apps/${applicationId}/edit`;
}

/** Rejects open redirects: only same-origin relative paths. */
export function safeInternalPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  if (value.includes('://')) return null;
  return value;
}
