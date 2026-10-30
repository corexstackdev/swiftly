import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import clsx from 'clsx';
import type { TestResult } from '@swiftly/shared';
import {
  api,
  type DatasourceSummary,
  type Environment,
  type PluginInfo,
} from '@/lib/api';
import { ModeRail } from '@/shell/ModeRail';
import { BottomBar } from '@/shell/BottomBar';
import { DatasourceForm, defaultConfig, withMaskedSecrets } from './DatasourceForm';
import { SchemaWorkbench } from './SchemaWorkbench';

/**
 * The Data section.
 *
 * Datasources get a full screen because the work needs one: reading a schema,
 * checking a connection, and seeing real rows are all things a strip under the
 * canvas cannot hold. Queries stay in the editor, where the widget consuming them
 * is visible.
 */

type Tab = 'data' | 'config';

export function DataSectionPage() {
  const { applicationId = '' } = useParams();

  const [datasources, setDatasources] = useState<DatasourceSummary[]>([]);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [environmentId, setEnvironmentId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creatingPluginId, setCreatingPluginId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('data');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<DatasourceSummary[]> => {
    const list = await api.datasources.list();
    setDatasources(list);
    return list;
  }, []);

  useEffect(() => {
    Promise.all([api.datasources.list(), api.datasources.plugins(), api.workspaces.environments()])
      .then(([list, pluginList, envs]) => {
        setDatasources(list);
        setPlugins(pluginList);
        setEnvironments(envs);
        setEnvironmentId(envs.find((environment) => environment.isDefault)?.id ?? envs[0]?.id ?? '');
        setSelectedId((current) => current ?? list[0]?.id ?? null);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, []);

  const selected = datasources.find((datasource) => datasource.id === selectedId) ?? null;
  const plugin = plugins.find((candidate) => candidate.id === selected?.pluginId) ?? null;

  return (
    <div className="flex h-screen bg-white">
      <ModeRail applicationId={applicationId} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center border-b border-slate-200 px-4">
          <span className="text-sm font-semibold text-slate-900">Data</span>
        </header>

        <div className="flex min-h-0 flex-1">
          <DatasourceList
            datasources={datasources}
            plugins={plugins}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setCreatingPluginId(null);
              setTab('data');
            }}
            onStartCreate={(pluginId) => {
              setCreatingPluginId(pluginId);
              setSelectedId(null);
            }}
          />

          <main className="flex min-w-0 flex-1 flex-col">
            {error && (
              <p className="m-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}

            {creatingPluginId ? (
              <CreateDatasource
                plugin={plugins.find((candidate) => candidate.id === creatingPluginId)!}
                environments={environments}
                environmentId={environmentId}
                onCancel={() => setCreatingPluginId(null)}
                onCreated={async (id) => {
                  await reload();
                  setCreatingPluginId(null);
                  setSelectedId(id);
                  setTab('data');
                }}
              />
            ) : selected && plugin ? (
              <DatasourceDetail
                key={selected.id}
                applicationId={applicationId}
                datasource={selected}
                plugin={plugin}
                environments={environments}
                environmentId={environmentId}
                tab={tab}
                onTabChange={setTab}
                onChanged={reload}
                onDeleted={async () => {
                  const list = await reload();
                  setSelectedId(list[0]?.id ?? null);
                }}
              />
            ) : (
              <EmptyState hasPlugins={plugins.length > 0} />
            )}
          </main>
        </div>

        <BottomBar
          environments={environments}
          environmentId={environmentId}
          onEnvironmentChange={setEnvironmentId}
          status={
            <span className="text-slate-400">
              Connections and credentials are per environment
            </span>
          }
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Left panel
 * ------------------------------------------------------------------ */

function DatasourceList({
  datasources,
  plugins,
  selectedId,
  onSelect,
  onStartCreate,
}: {
  datasources: DatasourceSummary[];
  plugins: PluginInfo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onStartCreate: (pluginId: string) => void;
}) {
  const [adding, setAdding] = useState(false);

  const groups = useMemo(() => {
    const categoryOf = (datasource: DatasourceSummary): string =>
      plugins.find((plugin) => plugin.id === datasource.pluginId)?.category ?? 'database';

    return [
      { label: 'Databases', items: datasources.filter((d) => categoryOf(d) === 'database') },
      { label: 'APIs', items: datasources.filter((d) => categoryOf(d) === 'api') },
      {
        label: 'Other',
        items: datasources.filter((d) => !['database', 'api'].includes(categoryOf(d))),
      },
    ].filter((group) => group.items.length > 0);
  }, [datasources, plugins]);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200">
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-sm font-medium text-slate-700">Datasources</span>
        <button
          type="button"
          onClick={() => setAdding((previous) => !previous)}
          className="rounded px-1.5 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Add datasource"
        >
          +
        </button>
      </div>

      {adding && (
        <div className="mx-2 mb-2 rounded border border-slate-200 bg-slate-50 p-1.5">
          <p className="mb-1 px-1 text-[11px] font-medium text-slate-500">New connection</p>
          {plugins.map((plugin) => (
            <button
              key={plugin.id}
              type="button"
              onClick={() => {
                onStartCreate(plugin.id);
                setAdding(false);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-white"
            >
              <PluginGlyph category={plugin.category} />
              {plugin.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto px-2 pb-2">
        {groups.map((group) => (
          <div key={group.label} className="mb-3">
            <h3 className="mb-1 px-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
              {group.label}
            </h3>
            {group.items.map((datasource) => (
              <button
                key={datasource.id}
                type="button"
                onClick={() => onSelect(datasource.id)}
                className={clsx(
                  'flex w-full items-start gap-2 rounded px-2 py-1.5 text-left',
                  datasource.id === selectedId ? 'bg-slate-100' : 'hover:bg-slate-50',
                )}
              >
                <PluginGlyph
                  category={
                    plugins.find((plugin) => plugin.id === datasource.pluginId)?.category ??
                    'database'
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-800">{datasource.name}</span>
                  {/* Answers "is anything using this?" before someone changes it. */}
                  <span className="block text-[11px] text-slate-400">
                    {datasource.usage.queryCount === 0
                      ? 'No queries yet'
                      : `${datasource.usage.queryCount} ${
                          datasource.usage.queryCount === 1 ? 'query' : 'queries'
                        } in ${datasource.usage.applications.length} app${
                          datasource.usage.applications.length === 1 ? '' : 's'
                        }`}
                  </span>
                </span>
                {datasource.readOnly && (
                  <span className="mt-0.5 rounded bg-slate-200 px-1 text-[9px] text-slate-600">
                    RO
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}

        {datasources.length === 0 && (
          <p className="px-2 py-4 text-xs text-slate-400">
            No datasources yet. Use + to connect a database or an API.
          </p>
        )}
      </div>
    </aside>
  );
}

function PluginGlyph({ category }: { category: string }) {
  return (
    <span
      className={clsx(
        'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold',
        category === 'database' && 'bg-blue-100 text-blue-700',
        category === 'api' && 'bg-purple-100 text-purple-700',
        !['database', 'api'].includes(category) && 'bg-slate-100 text-slate-600',
      )}
    >
      {category === 'database' ? 'DB' : category === 'api' ? 'API' : '•'}
    </span>
  );
}

function EmptyState({ hasPlugins }: { hasPlugins: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
      <p className="text-sm text-slate-500">No datasource selected</p>
      <p className="max-w-sm text-xs text-slate-400">
        {hasPlugins
          ? 'Pick one on the left, or use + to connect a database or an API.'
          : 'Loading available connection types…'}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Create
 * ------------------------------------------------------------------ */

function CreateDatasource({
  plugin,
  environments,
  environmentId,
  onCancel,
  onCreated,
}: {
  plugin: PluginInfo;
  environments: Environment[];
  environmentId: string;
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [config, setConfig] = useState<Record<string, unknown>>(() =>
    defaultConfig(plugin.configFields),
  );
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const test = async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      setTestResult(await api.datasources.testConnection(plugin.id, config));
    } catch (caught) {
      setTestResult({ ok: false, message: formatError(caught) });
    } finally {
      setTesting(false);
    }
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.datasources.create({
        name: name.trim(),
        pluginId: plugin.id,
        environmentId,
        config,
      });
      onCreated(created.id);
    } catch (caught) {
      setError(formatError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-4">
        <PluginGlyph category={plugin.category} />
        <h2 className="text-base font-semibold text-slate-900">New {plugin.name} connection</h2>
        <span className="ml-auto text-xs text-slate-400">
          Saved for the <strong>{environments.find((e) => e.id === environmentId)?.name}</strong>{' '}
          environment
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        <label className="mb-5 block max-w-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Name<span className="text-red-500"> *</span>
          </span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Orders warehouse"
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          />
        </label>

        <DatasourceForm
          fields={plugin.configFields}
          value={config}
          onChange={setConfig}
          isExisting={false}
        />

        {testResult && (
          <p
            className={`mt-4 rounded px-3 py-2 text-sm ${
              testResult.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'
            }`}
          >
            {testResult.ok ? '✓ ' : '✕ '}
            {testResult.message}
            {testResult.serverVersion ? ` — ${testResult.serverVersion}` : ''}
          </p>
        )}
        {error && (
          <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-slate-200 px-6 py-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void test()}
          disabled={testing || busy}
          className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || name.trim() === ''}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Create connection'}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Detail
 * ------------------------------------------------------------------ */

function DatasourceDetail({
  applicationId,
  datasource,
  plugin,
  environments,
  environmentId,
  tab,
  onTabChange,
  onChanged,
  onDeleted,
}: {
  applicationId: string;
  datasource: DatasourceSummary;
  plugin: PluginInfo;
  environments: Environment[];
  environmentId: string;
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  onChanged: () => Promise<unknown>;
  onDeleted: () => Promise<void>;
}) {
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const test = async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await api.datasources.test(datasource.id, environmentId));
    } catch (caught) {
      setTestResult({ ok: false, message: formatError(caught) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <div className="shrink-0 border-b border-slate-200 px-6 pt-4">
        <div className="flex items-center gap-3">
          <PluginGlyph category={plugin.category} />
          <h2 className="text-base font-semibold text-slate-900">{datasource.name}</h2>
          <span className="text-xs text-slate-400">{plugin.name}</span>

          <div className="ml-auto flex items-center gap-2">
            {testResult && (
              <span
                className={clsx(
                  'max-w-md truncate rounded px-2 py-1 text-xs',
                  testResult.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700',
                )}
                title={testResult.message}
              >
                {testResult.ok ? '✓ ' : '✕ '}
                {testResult.message}
                {testResult.latencyMs !== undefined && ` (${testResult.latencyMs}ms)`}
              </span>
            )}
            <button
              type="button"
              onClick={test}
              disabled={testing}
              className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {testing ? 'Testing…' : 'Test connection'}
            </button>
          </div>
        </div>

        <div className="mt-3 flex gap-4">
          <TabButton active={tab === 'data'} onClick={() => onTabChange('data')}>
            Tables
          </TabButton>
          <TabButton active={tab === 'config'} onClick={() => onTabChange('config')}>
            Configurations
          </TabButton>
        </div>
      </div>

      {tab === 'data' ? (
        <SchemaWorkbench
          key={`${datasource.id}:${environmentId}`}
          applicationId={applicationId}
          datasource={datasource}
          plugin={plugin}
          environmentId={environmentId}
        />
      ) : (
        <Configurations
          datasource={datasource}
          plugin={plugin}
          environments={environments}
          environmentId={environmentId}
          onChanged={onChanged}
          onDeleted={onDeleted}
        />
      )}
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        '-mb-px border-b-2 px-0.5 pb-2 text-sm transition-colors',
        active
          ? 'border-blue-600 font-medium text-slate-900'
          : 'border-transparent text-slate-500 hover:text-slate-700',
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Configurations
 * ------------------------------------------------------------------ */

function Configurations({
  datasource,
  plugin,
  environments,
  environmentId,
  onChanged,
  onDeleted,
}: {
  datasource: DatasourceSummary;
  plugin: PluginInfo;
  environments: Environment[];
  environmentId: string;
  onChanged: () => Promise<unknown>;
  onDeleted: () => Promise<void>;
}) {
  const stored = datasource.environments.find(
    (entry) => entry.environmentId === environmentId,
  )?.config;

  const [config, setConfig] = useState<Record<string, unknown>>(() =>
    withMaskedSecrets(plugin.configFields, {
      ...defaultConfig(plugin.configFields),
      ...(stored ?? {}),
    }),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Switching environment loads that environment's own settings.
  useEffect(() => {
    setConfig(
      withMaskedSecrets(plugin.configFields, {
        ...defaultConfig(plugin.configFields),
        ...(datasource.environments.find((entry) => entry.environmentId === environmentId)
          ?.config ?? {}),
      }),
    );
    setMessage(null);
    setError(null);
  }, [environmentId, datasource, plugin.configFields]);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.datasources.updateConfig(datasource.id, environmentId, config);
      await onChanged();
      setMessage('Saved. Pooled connections were dropped so the new settings take effect.');
    } catch (caught) {
      setError(formatError(caught));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (datasource.usage.queryCount > 0) {
      const apps = datasource.usage.applications.map((app) => app.name).join(', ');
      if (
        !window.confirm(
          `${datasource.usage.queryCount} queries in ${apps} use this datasource and will break. Delete anyway?`,
        )
      ) {
        return;
      }
    } else if (!window.confirm(`Delete “${datasource.name}”?`)) {
      return;
    }

    setBusy(true);
    try {
      await api.datasources.remove(datasource.id);
      await onDeleted();
    } catch (caught) {
      setError(formatError(caught));
      setBusy(false);
    }
  };

  const configuredElsewhere = environments.filter(
    (environment) =>
      environment.id !== environmentId &&
      datasource.environments.some((entry) => entry.environmentId === environment.id),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        {!stored && (
          <p className="mb-4 rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
            This datasource has no settings for the{' '}
            <strong>{environments.find((e) => e.id === environmentId)?.name}</strong>{' '}
            environment yet. Fill these in and save to add them
            {configuredElsewhere.length > 0 &&
              ` — it is already configured for ${configuredElsewhere
                .map((environment) => environment.name)
                .join(' and ')}`}
            .
          </p>
        )}

        <DatasourceForm
          fields={plugin.configFields}
          value={config}
          onChange={setConfig}
          isExisting={Boolean(stored)}
        />

        {datasource.usage.applications.length > 0 && (
          <section className="mt-6 border-t border-slate-200 pt-4">
            <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
              Used by
            </h3>
            <ul className="flex flex-col gap-1">
              {datasource.usage.applications.map((application) => (
                <li key={application.id} className="text-xs text-slate-600">
                  {application.name}
                  <span className="text-slate-400">
                    {' '}
                    — {application.queryCount}{' '}
                    {application.queryCount === 1 ? 'query' : 'queries'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {message && (
          <p className="mt-4 rounded bg-green-50 px-3 py-2 text-sm text-green-800">{message}</p>
        )}
        {error && <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>

      <div className="flex items-center gap-2 border-t border-slate-200 px-6 py-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="ml-auto rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function formatError(error: unknown): string {
  if (error && typeof error === 'object' && 'details' in error) {
    const details = (error as { details?: { errors?: { path: string; message: string }[] } })
      .details;
    if (details?.errors?.length) {
      return details.errors.map((entry) => `${entry.path}: ${entry.message}`).join('\n');
    }
  }
  return error instanceof Error ? error.message : String(error);
}
