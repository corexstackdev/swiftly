import type {
  ApplicationDsl,
  AppLayoutId,
  ColumnPatch,
  ColumnSpec,
  CreateTableInput,
  DbSchema,
  PageLayoutId,
  QueryResult,
  TableRowsPage,
  TestResult,
} from '@swiftly/shared';

/**
 * API client.
 *
 * Auth rides on httpOnly cookies, so nothing here touches a token. A 401 triggers a
 * single refresh attempt and one retry; if that fails the caller is sent to login.
 */

const BASE = '/api';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let refreshInFlight: Promise<boolean> | null = null;

/** Login and refresh mint cookies; retrying them against themselves would loop. */
function canRefresh(path: string): boolean {
  return path !== '/auth/login' && path !== '/auth/refresh' && path !== '/auth/logout';
}

async function refreshSession(): Promise<boolean> {
  // Collapse concurrent refreshes: a page load fires many requests at once and
  // they must not each mint a new token pair.
  refreshInFlight ??= fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
  })
    .then((response) => response.ok)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (response.status === 401 && retry && canRefresh(path)) {
    if (await refreshSession()) return request<T>(path, init, false);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      (body as { message?: string }).message ?? response.statusText,
      response.status,
      body,
    );
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const put = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(body) });

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
  organizationId: string;
  permissions: string[];
}

export interface ApplicationReleaseSummary {
  environmentId: string;
  environmentName: string;
  isProduction: boolean;
  versionNumber: number;
  publishedAt: string;
}

export interface ApplicationSummary {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  description: string | null;
  status: string;
  updatedAt: string;
  workspaceId: string;
  publishedVersionId: string | null;
  createdBy: { id: string; name: string };
  releases?: ApplicationReleaseSummary[];
}

export interface ApplicationDetail extends ApplicationSummary {
  draftDsl: ApplicationDsl;
  draftRevision: number;
  publishedVersion: { id: string; versionNumber: number; publishedAt: string | null } | null;
  workspace: { slug: string };
}

export interface RuntimeAppPayload {
  applicationId: string;
  name: string;
  workspaceSlug: string;
  appSlug: string;
  environmentId: string;
  dsl: ApplicationDsl;
}

export interface PublishedAppPayload extends RuntimeAppPayload {
  versionNumber: number;
  publishedAt: string | null;
  environmentName: string;
  releases: ApplicationReleaseSummary[];
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  _count: { applications: number };
}

export interface Environment {
  id: string;
  name: string;
  isDefault: boolean;
  isProduction: boolean;
}

export interface DatasourceUsage {
  queryCount: number;
  applications: { id: string; name: string; queryCount: number }[];
}

export interface DatasourceSummary {
  id: string;
  name: string;
  pluginId: string;
  workspaceId: string | null;
  readOnly: boolean;
  environments: { environmentId: string; config: Record<string, unknown> }[];
  schemaCachedAt: string | null;
  usage: DatasourceUsage;
}

export interface ConfigFieldDefinition {
  key: string;
  label: string;
  control: 'text' | 'number' | 'password' | 'select' | 'toggle' | 'textarea';
  placeholder?: string;
  helpText?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: { label: string; value: string }[];
  visibleWhen?: { key: string; equals: unknown };
  secret?: boolean;
  section?: string;
}

export interface PluginInfo {
  id: string;
  name: string;
  category: string;
  capabilities: Record<string, boolean>;
  secretFields: string[];
  /** Drives the generated connection form. */
  configFields: ConfigFieldDefinition[];
}

/** Sent in place of a stored secret the user did not retype. */
export const SECRET_PLACEHOLDER = '__swiftly_unchanged__';

export interface VersionSummary {
  id: string;
  versionNumber: number;
  status: string;
  changeNote: string | null;
  submittedAt: string;
  publishedAt: string | null;
  reviewNotes: string | null;
  submittedBy: { id: string; name: string };
  reviewedBy: { id: string; name: string } | null;
}

export interface PendingReview {
  id: string;
  versionNumber: number;
  changeNote: string | null;
  submittedAt: string;
  submittedBy: { id: string; name: string; email: string };
  application: { id: string; name: string; workspaceId: string };
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      post<{ user: SessionUser; organization: { id: string; name: string }; permissions: string[] }>(
        '/auth/login',
        { email, password },
      ),
    me: () => request<SessionUser>('/auth/me'),
    refresh: () => refreshSession(),
    logout: () => post<{ ok: true }>('/auth/logout'),
  },

  workspaces: {
    list: () => request<Workspace[]>('/workspaces'),
    environments: () => request<Environment[]>('/environments'),
  },

  applications: {
    list: () => request<ApplicationSummary[]>('/applications'),
    get: (id: string) => request<ApplicationDetail>(`/applications/${id}`),
    create: (input: {
      workspaceId: string;
      name: string;
      slug: string;
      description?: string;
      navStyle?: AppLayoutId;
      pageLayout?: PageLayoutId;
    }) => post<ApplicationSummary>('/applications', input),
    saveDraft: (id: string, dsl: ApplicationDsl, expectedRevision: number) =>
      put<{ revision: number; updatedAt: string }>(`/applications/${id}/draft`, {
        dsl,
        expectedRevision,
      }),
    remove: (id: string) => request<{ ok: true }>(`/applications/${id}`, { method: 'DELETE' }),
  },

  datasources: {
    list: () => request<DatasourceSummary[]>('/datasources'),
    plugins: () => request<PluginInfo[]>('/datasources/plugins'),
    create: (input: {
      name: string;
      pluginId: string;
      environmentId: string;
      config: Record<string, unknown>;
      workspaceId?: string;
      readOnly?: boolean;
    }) => post<{ id: string; name: string; pluginId: string }>('/datasources', input),
    updateConfig: (id: string, environmentId: string, config: Record<string, unknown>) =>
      put<{ ok: true }>(`/datasources/${id}/config`, { environmentId, config }),
    test: (id: string, environmentId: string) =>
      post<TestResult>(`/datasources/${id}/test`, { environmentId }),
    testConnection: (pluginId: string, config: Record<string, unknown>) =>
      post<TestResult>('/datasources/test-connection', { pluginId, config }),
    remove: (id: string) => request<{ ok: true }>(`/datasources/${id}`, { method: 'DELETE' }),
    schema: (id: string, environmentId: string, refresh = false) =>
      request<DbSchema>(
        `/datasources/${id}/schema?environmentId=${environmentId}&refresh=${refresh}`,
      ),
    createSchema: (id: string, environmentId: string, name: string) =>
      post<{ ok: true }>(`/datasources/${id}/manage/schemas`, { environmentId, name }),
    dropSchema: (id: string, environmentId: string, name: string, cascade?: boolean) =>
      post<{ ok: true }>(`/datasources/${id}/manage/schemas/drop`, {
        environmentId,
        name,
        cascade,
      }),
    createTable: (id: string, environmentId: string, input: CreateTableInput) =>
      post<{ ok: true }>(`/datasources/${id}/manage/tables`, { environmentId, ...input }),
    dropTable: (id: string, environmentId: string, schema: string, table: string) =>
      post<{ ok: true }>(`/datasources/${id}/manage/tables/drop`, {
        environmentId,
        schema,
        table,
      }),
    renameTable: (
      id: string,
      environmentId: string,
      schema: string,
      table: string,
      newName: string,
    ) =>
      post<{ ok: true }>(`/datasources/${id}/manage/tables/rename`, {
        environmentId,
        schema,
        table,
        newName,
      }),
    addColumn: (
      id: string,
      environmentId: string,
      schema: string,
      table: string,
      column: ColumnSpec,
    ) =>
      post<{ ok: true }>(`/datasources/${id}/manage/columns`, {
        environmentId,
        schema,
        table,
        column,
      }),
    alterColumn: (
      id: string,
      environmentId: string,
      schema: string,
      table: string,
      name: string,
      patch: ColumnPatch,
    ) =>
      post<{ ok: true }>(`/datasources/${id}/manage/columns/alter`, {
        environmentId,
        schema,
        table,
        name,
        patch,
      }),
    dropColumn: (
      id: string,
      environmentId: string,
      schema: string,
      table: string,
      name: string,
    ) =>
      post<{ ok: true }>(`/datasources/${id}/manage/columns/drop`, {
        environmentId,
        schema,
        table,
        name,
      }),
    renameColumn: (
      id: string,
      environmentId: string,
      schema: string,
      table: string,
      name: string,
      newName: string,
    ) =>
      post<{ ok: true }>(`/datasources/${id}/manage/columns/rename`, {
        environmentId,
        schema,
        table,
        name,
        newName,
      }),
    tableRows: (
      id: string,
      environmentId: string,
      schema: string,
      table: string,
      limit = 50,
      offset = 0,
    ) =>
      request<TableRowsPage>(
        `/datasources/${id}/manage/rows?environmentId=${environmentId}&schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(table)}&limit=${limit}&offset=${offset}`,
      ),
    insertRow: (
      id: string,
      environmentId: string,
      schema: string,
      table: string,
      values: Record<string, unknown>,
    ) =>
      post<{ ok: true }>(`/datasources/${id}/manage/rows`, {
        environmentId,
        schema,
        table,
        values,
      }),
    updateRow: (
      id: string,
      environmentId: string,
      schema: string,
      table: string,
      key: Record<string, unknown>,
      values: Record<string, unknown>,
    ) =>
      post<{ ok: true }>(`/datasources/${id}/manage/rows/update`, {
        environmentId,
        schema,
        table,
        key,
        values,
      }),
    deleteRows: (
      id: string,
      environmentId: string,
      schema: string,
      table: string,
      keys: Record<string, unknown>[],
    ) =>
      post<{ ok: true }>(`/datasources/${id}/manage/rows/delete`, {
        environmentId,
        schema,
        table,
        keys,
      }),
  },

  queries: {
    /** Runs a saved query from the stored DSL. */
    execute: (
      applicationId: string,
      queryName: string,
      input: {
        source: 'draft' | 'published';
        environmentId: string;
        pageId?: string;
        bindings: Record<string, unknown>;
      },
    ) => post<QueryResult>(`/applications/${applicationId}/queries/${queryName}/execute`, input),

    /** Runs an unsaved definition, for the query editor's Run button. */
    run: (
      applicationId: string,
      input: {
        datasourceId: string;
        environmentId: string;
        definition: unknown;
        bindings: Record<string, unknown>;
      },
    ) => post<QueryResult>(`/applications/${applicationId}/queries/run`, input),
  },

  publish: {
    publish: (applicationId: string, environmentIds: string[]) =>
      post<{
        id: string;
        versionNumber: number;
        releases: ApplicationReleaseSummary[];
      }>(`/applications/${applicationId}/publish`, { environmentIds }),
    submit: (applicationId: string, changeNote?: string) =>
      post<{ id: string; versionNumber: number; status: string }>(
        `/applications/${applicationId}/submit`,
        { changeNote },
      ),
    versions: (applicationId: string) =>
      request<VersionSummary[]>(`/applications/${applicationId}/versions`),
    pending: () => request<PendingReview[]>('/reviews'),
    diff: (versionId: string) => request<Record<string, unknown>>(`/reviews/${versionId}/diff`),
    approve: (versionId: string, notes?: string) =>
      post<{ status: string }>(`/reviews/${versionId}/approve`, { notes }),
    reject: (versionId: string, reason: string) =>
      post<{ status: string }>(`/reviews/${versionId}/reject`, { reason }),
    deploy: (versionId: string) => post<{ id: string }>(`/reviews/${versionId}/deploy`),
    rollback: (applicationId: string, targetVersionId: string) =>
      post<{ ok: true }>(`/applications/${applicationId}/rollback`, { targetVersionId }),
  },

  runtime: {
    load: (
      workspaceSlug: string,
      appSlug: string,
      environment?: { name?: string; id?: string },
    ) =>
      request<PublishedAppPayload>(
        environment?.name
          ? `/runtime/apps/${workspaceSlug}/${appSlug}/${encodeURIComponent(environment.name)}`
          : `/runtime/apps/${workspaceSlug}/${appSlug}${
              environment?.id ? `?environmentId=${encodeURIComponent(environment.id)}` : ''
            }`,
      ),
    preview: (workspaceSlug: string, appSlug: string, environmentId?: string) =>
      request<RuntimeAppPayload>(
        `/runtime/apps/${workspaceSlug}/${appSlug}/preview${
          environmentId ? `?environmentId=${encodeURIComponent(environmentId)}` : ''
        }`,
      ),
    previewById: (applicationId: string, environmentId?: string) =>
      request<RuntimeAppPayload>(
        `/runtime/applications/${applicationId}/preview${
          environmentId ? `?environmentId=${encodeURIComponent(environmentId)}` : ''
        }`,
      ),
    executeQuery: (
      workspaceSlug: string,
      appSlug: string,
      queryName: string,
      input: { pageId?: string; bindings: Record<string, unknown>; environmentId?: string },
    ) =>
      post<QueryResult>(
        `/runtime/apps/${workspaceSlug}/${appSlug}/queries/${queryName}/execute`,
        input,
      ),
    executePreviewQuery: (
      workspaceSlug: string,
      appSlug: string,
      queryName: string,
      input: { pageId?: string; bindings: Record<string, unknown>; environmentId?: string },
    ) =>
      post<QueryResult>(
        `/runtime/apps/${workspaceSlug}/${appSlug}/preview/queries/${queryName}/execute`,
        input,
      ),
  },
};
