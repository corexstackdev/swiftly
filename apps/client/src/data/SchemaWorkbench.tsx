import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import type { ColumnSpec, DbSchema, SchemaNamespace, TableMetadata } from '@swiftly/shared';
import { api, type DatasourceSummary, type PluginInfo } from '@/lib/api';
import { TableDataEditor } from './TableDataEditor';
import { ColumnFields, TableStructureEditor } from './TableStructureEditor';
import { emptyColumn, formatCell, formatError, idColumn } from './columnTypes';

type Pane = 'data' | 'columns';

export function SchemaWorkbench({
  applicationId,
  datasource,
  plugin,
  environmentId,
}: {
  applicationId: string;
  datasource: DatasourceSummary;
  plugin: PluginInfo;
  environmentId: string;
}) {
  const navigate = useNavigate();
  const canManage = Boolean(plugin.capabilities.schemaAdmin) && !datasource.readOnly;
  const [schema, setSchema] = useState<DbSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<{ schema: string; table: string } | null>(null);
  const [pane, setPane] = useState<Pane>('data');
  const [reloadToken, setReloadToken] = useState(0);
  const [newSchemaOpen, setNewSchemaOpen] = useState(false);
  const [newTableOpen, setNewTableOpen] = useState<string | null>(null);

  const loadSchema = useCallback(
    async (refresh = true): Promise<DbSchema | null> => {
      if (!plugin.capabilities.introspection) return null;
      setLoading(true);
      setError(null);
      try {
        const next = await api.datasources.schema(datasource.id, environmentId, refresh);
        setSchema(next);
        return next;
      } catch (caught) {
        setError(formatError(caught));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [datasource.id, environmentId, plugin.capabilities.introspection],
  );

  useEffect(() => {
    void loadSchema(false);
  }, [loadSchema]);

  const namespaces = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (schema?.schemas ?? [])
      .map((namespace) => ({
        ...namespace,
        tables: namespace.tables.filter(
          (table) =>
            !needle || `${namespace.name}.${table.name}`.toLowerCase().includes(needle),
        ),
      }))
      .filter((namespace) => needle === '' || namespace.tables.length > 0 || namespace.name.toLowerCase().includes(needle));
  }, [schema, search]);

  const selectedMeta: TableMetadata | null = useMemo(() => {
    if (!selected) return null;
    return (
      schema?.schemas
        .find((namespace) => namespace.name === selected.schema)
        ?.tables.find((table) => table.name === selected.table) ?? null
    );
  }, [schema, selected]);

  const afterDdl = async (nextTable?: { schema: string; table: string }): Promise<void> => {
    const next = await loadSchema(true);
    if (nextTable) setSelected(nextTable);
    else if (selected && next) {
      const stillThere = next.schemas
        .find((namespace) => namespace.name === selected.schema)
        ?.tables.some((table) => table.name === selected.table);
      if (!stillThere) setSelected(null);
    }
    setReloadToken((value) => value + 1);
  };

  if (!plugin.capabilities.introspection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <p className="max-w-sm text-sm text-slate-400">
          {plugin.name} does not expose a schema to browse. Use Configurations to set it up, then
          write requests against it in the editor.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Schema
          </span>
          <div className="flex items-center gap-1">
            {canManage && (
              <button
                type="button"
                title="New schema"
                onClick={() => setNewSchemaOpen(true)}
                className="rounded px-1.5 text-sm text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                +
              </button>
            )}
            <button
              type="button"
              onClick={() => void loadSchema(true)}
              disabled={loading}
              title="Refresh schema"
              className="rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
            >
              ⟳
            </button>
          </div>
        </div>

        <div className="px-3 pb-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`Search tables in ${datasource.name}`}
            className="w-full rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-blue-500"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
          {loading && !schema && (
            <p className="px-2 py-3 text-xs text-slate-400">Reading schema…</p>
          )}
          {error && (
            <p className="mx-1 rounded bg-red-50 px-2 py-1.5 text-xs text-red-700">{error}</p>
          )}

          {namespaces.map((namespace) => (
            <SchemaGroup
              key={namespace.name}
              namespace={namespace}
              selected={selected}
              canManage={canManage}
              onSelect={setSelected}
              onNewTable={() => setNewTableOpen(namespace.name)}
              onDropSchema={async () => {
                if (namespace.name === 'public') return;
                if (!window.confirm(`Drop schema “${namespace.name}”? It must be empty.`)) return;
                try {
                  await api.datasources.dropSchema(
                    datasource.id,
                    environmentId,
                    namespace.name,
                    false,
                  );
                  await afterDdl();
                } catch (caught) {
                  if (
                    !window.confirm(
                      `${formatError(caught)}\n\nDrop schema “${namespace.name}” and all tables inside it?`,
                    )
                  ) {
                    setError(formatError(caught));
                    return;
                  }
                  try {
                    await api.datasources.dropSchema(
                      datasource.id,
                      environmentId,
                      namespace.name,
                      true,
                    );
                    await afterDdl();
                  } catch (inner) {
                    setError(formatError(inner));
                  }
                }
              }}
              onDropTable={async (table) => {
                if (!window.confirm(`Drop table ${namespace.name}.${table}? This cannot be undone.`)) {
                  return;
                }
                try {
                  await api.datasources.dropTable(
                    datasource.id,
                    environmentId,
                    namespace.name,
                    table,
                  );
                  await afterDdl();
                } catch (caught) {
                  setError(formatError(caught));
                }
              }}
              onRenameTable={async (table) => {
                const next = window.prompt('New table name', table)?.trim();
                if (!next || next === table) return;
                try {
                  await api.datasources.renameTable(
                    datasource.id,
                    environmentId,
                    namespace.name,
                    table,
                    next,
                  );
                  await afterDdl({ schema: namespace.name, table: next });
                } catch (caught) {
                  setError(formatError(caught));
                }
              }}
            />
          ))}

          {schema && namespaces.length === 0 && (
            <p className="px-2 py-3 text-xs text-slate-400">
              {search ? `No tables match “${search}”` : 'No schemas yet'}
            </p>
          )}

          {canManage && schema && (schema.schemas.reduce((n, ns) => n + ns.tables.length, 0) === 0) && (
            <button
              type="button"
              onClick={() => setNewTableOpen(schema.schemas[0]?.name ?? 'public')}
              className="mt-2 w-full rounded border border-dashed border-slate-300 px-2 py-2 text-xs text-slate-600 hover:border-blue-400 hover:text-blue-700"
            >
              Create a table
            </button>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {!selected || !selectedMeta ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-sm text-slate-500">Select a table to inspect its columns and rows</p>
            {canManage && (
              <p className="max-w-sm text-xs text-slate-400">
                Create schemas and tables here, then bind queries to them in the editor.
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 px-4 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">
                  {selected.schema}.{selected.table}
                </p>
                <p className="text-[11px] text-slate-400">
                  {selectedMeta.kind === 'view' ? 'View' : 'Table'} · {selectedMeta.columns.length}{' '}
                  columns
                </p>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-3">
                <div className="flex gap-3">
                  <PaneButton active={pane === 'data'} onClick={() => setPane('data')}>
                    Data
                  </PaneButton>
                  <PaneButton active={pane === 'columns'} onClick={() => setPane('columns')}>
                    Columns
                  </PaneButton>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const params = new URLSearchParams({
                      datasourceId: datasource.id,
                      schema: selected.schema,
                      table: selected.table,
                    });
                    navigate(`/apps/${applicationId}/edit?${params.toString()}`);
                  }}
                  className="shrink-0 whitespace-nowrap rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                >
                  Add query to this app
                </button>
              </div>
            </div>

            {pane === 'data' ? (
              canManage ? (
                <TableDataEditor
                  key={`${selected.schema}.${selected.table}`}
                  datasourceId={datasource.id}
                  environmentId={environmentId}
                  schema={selected.schema}
                  table={selected.table}
                  canManage={selectedMeta.kind === 'table'}
                  reloadToken={reloadToken}
                />
              ) : (
                <ReadOnlyPreview
                  applicationId={applicationId}
                  datasourceId={datasource.id}
                  environmentId={environmentId}
                  schema={selected.schema}
                  table={selected.table}
                />
              )
            ) : (
              <TableStructureEditor
                datasourceId={datasource.id}
                environmentId={environmentId}
                schema={selected.schema}
                table={selected.table}
                meta={selectedMeta}
                canManage={canManage && selectedMeta.kind === 'table'}
                onChanged={() => afterDdl(selected)}
              />
            )}
          </>
        )}
      </div>

      {newSchemaOpen && (
        <NameDialog
          title="New schema"
          label="Schema name"
          placeholder="app"
          confirmLabel="Create schema"
          onClose={() => setNewSchemaOpen(false)}
          onSubmit={async (name) => {
            await api.datasources.createSchema(datasource.id, environmentId, name);
            setNewSchemaOpen(false);
            await afterDdl();
          }}
        />
      )}

      {newTableOpen && (
        <CreateTableDialog
          schemas={(schema?.schemas ?? []).map((namespace) => namespace.name)}
          defaultSchema={newTableOpen}
          onClose={() => setNewTableOpen(null)}
          onSubmit={async (input) => {
            await api.datasources.createTable(datasource.id, environmentId, input);
            setNewTableOpen(null);
            await afterDdl({ schema: input.schema, table: input.name });
          }}
        />
      )}
    </div>
  );
}

function SchemaGroup({
  namespace,
  selected,
  canManage,
  onSelect,
  onNewTable,
  onDropSchema,
  onDropTable,
  onRenameTable,
}: {
  namespace: SchemaNamespace;
  selected: { schema: string; table: string } | null;
  canManage: boolean;
  onSelect: (table: { schema: string; table: string }) => void;
  onNewTable: () => void;
  onDropSchema: () => void;
  onDropTable: (table: string) => Promise<void>;
  onRenameTable: (table: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="mb-2">
      <div className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-slate-50">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase"
        >
          <span className="w-3 text-slate-400">{open ? '▾' : '▸'}</span>
          <span className="truncate">{namespace.name}</span>
          <span className="font-normal text-slate-400">{namespace.tables.length}</span>
        </button>
        {canManage && (
          <>
            <button
              type="button"
              title="New table"
              onClick={onNewTable}
              className="rounded px-1 text-xs text-slate-400 hover:bg-white hover:text-slate-700"
            >
              +
            </button>
            {namespace.name !== 'public' && (
              <button
                type="button"
                title="Drop schema"
                onClick={onDropSchema}
                className="rounded px-1 text-xs text-slate-400 hover:bg-white hover:text-red-700"
              >
                ×
              </button>
            )}
          </>
        )}
      </div>
      {open &&
        namespace.tables.map((table) => (
          <div key={table.name} className="group flex items-center">
            <button
              type="button"
              onClick={() => onSelect({ schema: namespace.name, table: table.name })}
              className={clsx(
                'flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-1 text-left text-xs',
                selected?.table === table.name && selected.schema === namespace.name
                  ? 'bg-slate-100 font-medium text-slate-900'
                  : 'text-slate-600 hover:bg-slate-50',
              )}
            >
              <span className="text-slate-400">{table.kind === 'view' ? '▣' : '▦'}</span>
              <span className="truncate">{table.name}</span>
              {table.kind === 'view' && (
                <span className="ml-auto text-[9px] text-slate-400">view</span>
              )}
            </button>
            {canManage && table.kind === 'table' && (
              <span className="hidden shrink-0 group-hover:flex">
                <button
                  type="button"
                  title="Rename table"
                  onClick={() => void onRenameTable(table.name)}
                  className="rounded px-1 text-[10px] text-slate-400 hover:text-slate-700"
                >
                  Rename
                </button>
                <button
                  type="button"
                  title="Drop table"
                  onClick={() => void onDropTable(table.name)}
                  className="rounded px-1 text-[10px] text-red-500 hover:text-red-700"
                >
                  Drop
                </button>
              </span>
            )}
          </div>
        ))}
    </div>
  );
}

function PaneButton({
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
        'border-b-2 px-0.5 pb-1 text-xs transition-colors',
        active
          ? 'border-blue-600 font-medium text-slate-900'
          : 'border-transparent text-slate-500 hover:text-slate-700',
      )}
    >
      {children}
    </button>
  );
}

function NameDialog({
  title,
  label,
  placeholder,
  confirmLabel,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  placeholder: string;
  confirmLabel: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-24"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-lg border border-slate-200 bg-white shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          void onSubmit(name.trim())
            .catch((caught) => setError(formatError(caught)))
            .finally(() => setBusy(false));
        }}
      >
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        </div>
        <div className="px-4 py-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-700">{label}</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={placeholder}
              className="rounded border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:border-blue-500"
            />
          </label>
          {error && <p className="mt-3 text-xs text-red-700">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || name.trim() === ''}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Saving…' : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function CreateTableDialog({
  schemas,
  defaultSchema,
  onClose,
  onSubmit,
}: {
  schemas: string[];
  defaultSchema: string;
  onClose: () => void;
  onSubmit: (input: { schema: string; name: string; columns: ColumnSpec[] }) => Promise<void>;
}) {
  const [schemaName, setSchemaName] = useState(defaultSchema);
  const [name, setName] = useState('');
  const [columns, setColumns] = useState<ColumnSpec[]>([idColumn()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const schemaOptions = schemas.includes(defaultSchema) ? schemas : [defaultSchema, ...schemas];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-16"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Create table"
        className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-lg border border-slate-200 bg-white shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          const ready = columns.filter((column) => column.name.trim() !== '');
          if (ready.length === 0) {
            setError('Add at least one column');
            return;
          }
          setBusy(true);
          setError(null);
          void onSubmit({ schema: schemaName, name: name.trim(), columns: ready })
            .catch((caught) => setError(formatError(caught)))
            .finally(() => setBusy(false));
        }}
      >
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Create table</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Columns become the fields widgets can bind to after you add a query.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 px-4 py-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-700">Schema</span>
            <select
              value={schemaName}
              onChange={(event) => setSchemaName(event.target.value)}
              className="rounded border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:border-blue-500"
            >
              {schemaOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-700">Table name</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="orders"
              className="rounded border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:border-blue-500"
            />
          </label>
        </div>
        <div className="px-4 pb-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-700">Columns</span>
            <button
              type="button"
              onClick={() => setColumns((current) => [...current, emptyColumn()])}
              className="text-xs font-medium text-blue-700 hover:text-blue-900"
            >
              Add column
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {columns.map((column, index) => (
              <div
                key={index}
                className="flex flex-wrap items-center gap-2 rounded border border-slate-200 px-2 py-2"
              >
                <ColumnFields
                  compact
                  column={column}
                  onChange={(next) =>
                    setColumns((current) => current.map((entry, i) => (i === index ? next : entry)))
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    setColumns((current) => current.filter((_, i) => i !== index))
                  }
                  className="ml-auto text-xs text-slate-400 hover:text-red-600"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          {error && <p className="mt-3 text-xs text-red-700">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || name.trim() === ''}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create table'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ReadOnlyPreview({
  applicationId,
  datasourceId,
  environmentId,
  schema,
  table,
}: {
  applicationId: string;
  datasourceId: string;
  environmentId: string;
  schema: string;
  table: string;
}) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    api.queries
      .run(applicationId, {
        datasourceId,
        environmentId,
        definition: {
          kind: 'builder',
          operation: 'select',
          schema,
          table,
          limit: '50',
        },
        bindings: {},
      })
      .then((result) => {
        if (cancelled) return;
        setRows(result.rows);
        setColumns(result.columns?.map((column) => column.name) ?? Object.keys(result.rows[0] ?? {}));
      })
      .catch((caught) => !cancelled && setError(formatError(caught)));
    return () => {
      cancelled = true;
    };
  }, [applicationId, datasourceId, environmentId, schema, table]);

  if (error) {
    return <pre className="m-4 rounded bg-red-50 p-3 text-xs whitespace-pre-wrap text-red-700">{error}</pre>;
  }
  if (!rows) {
    return <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Loading rows…</div>;
  }
  if (rows.length === 0) {
    return <div className="flex flex-1 items-center justify-center text-sm text-slate-400">This table is empty</div>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-white">
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                className="border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold whitespace-nowrap text-slate-600"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-slate-100">
              {columns.map((column) => (
                <td key={column} className="max-w-64 truncate px-3 py-1.5 text-slate-700">
                  {formatCell(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
