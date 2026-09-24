import { useEffect, useState } from 'react';
import type { DbSchema, QueryEntity, QueryResult } from '@vinodapp/shared';
import { api, type DatasourceSummary } from '@/lib/api';

/**
 * The query editor.
 *
 * The mode selector is driven by the datasource plugin's declared capabilities, so a
 * REST datasource never offers a "stored procedure" tab and Postgres always does.
 * Running a query here posts the unsaved definition to the server, which prepares
 * and parameterises it exactly as it will once saved — the Run button rehearses the
 * real execution path rather than a special editor one.
 */

export function QueryPanel({
  query,
  applicationId,
  environmentId,
  datasources,
  bindings,
  onChange,
  onClose,
}: {
  /** The query being edited, chosen in the entity panel. */
  query: QueryEntity | null;
  applicationId: string;
  environmentId: string;
  datasources: DatasourceSummary[];
  /** Evaluated values for this query's own bindings, keyed by expression text. */
  bindings: Record<string, unknown>;
  onChange: (mutate: (query: QueryEntity) => void) => void;
  onClose: () => void;
}) {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [schema, setSchema] = useState<DbSchema | null>(null);

  const datasource = datasources.find((candidate) => candidate.id === query?.datasourceId);

  useEffect(() => {
    setResult(null);
    setError(null);
    setSchema(null);
    if (!query || !datasource || !SCHEMA_PLUGINS.has(datasource.pluginId)) return;

    let cancelled = false;
    api.datasources
      .schema(datasource.id, environmentId)
      .then((loaded) => !cancelled && setSchema(loaded))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [query?.id, datasource?.id, datasource?.pluginId, environmentId]);

  const run = async (): Promise<void> => {
    if (!query) return;
    setRunning(true);
    setError(null);
    try {
      const response = await api.queries.run(applicationId, {
        datasourceId: query.datasourceId,
        environmentId,
        definition: query.definition,
        bindings,
      });
      setResult(response);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(false);
    }
  };

  if (!query) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Select a query in the Queries tab
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-1.5">
        <input
          value={query.name}
          onChange={(event) => {
            const next = event.target.value;
            onChange((draft) => {
              draft.name = next;
            });
          }}
          className="w-40 rounded border border-slate-300 px-2 py-0.5 font-mono text-xs outline-none focus:border-blue-500"
        />

        <select
          value={query.mode}
          onChange={(event) =>
            onChange((draft) => {
              draft.mode = event.target.value as QueryEntity['mode'];
              draft.definition = blankDefinition(draft.mode);
            })
          }
          className="rounded border border-slate-300 px-1.5 py-0.5 text-xs"
        >
          {availableModes(datasource?.pluginId).map((mode) => (
            <option key={mode} value={mode}>
              {MODE_LABELS[mode]}
            </option>
          ))}
        </select>

        <span className="text-[11px] text-slate-400">{datasource?.name ?? 'No datasource'}</span>

        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={query.runOnPageLoad}
            onChange={(event) =>
              onChange((draft) => {
                draft.runOnPageLoad = event.target.checked;
              })
            }
            className="h-3 w-3 accent-blue-600"
          />
          Run on page load
        </label>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {running ? 'Running…' : 'Run'}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close query editor"
            className="rounded px-1.5 text-sm text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ×
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col border-r border-slate-200">
          <QueryEditorBody query={query} schema={schema} onChange={onChange} />
        </div>

        <div className="flex w-1/2 min-w-0 flex-col">
          <div className="border-b border-slate-200 px-2 py-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            Result
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {error && (
              <pre className="rounded bg-red-50 p-2 text-xs whitespace-pre-wrap text-red-700">
                {error}
              </pre>
            )}
            {!error && result && <ResultTable result={result} />}
            {!error && !result && (
              <p className="text-xs text-slate-400">Run the query to see its result</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Plugins whose schema the query editor can offer for autocomplete. */
const SCHEMA_PLUGINS = new Set(['postgres', 'mysql', 'mssql', 'oracle']);

function QueryEditorBody({
  query,
  schema,
  onChange,
}: {
  query: QueryEntity;
  schema: DbSchema | null;
  onChange: (mutate: (query: QueryEntity) => void) => void;
}) {
  const definition = query.definition as unknown as Record<string, unknown>;

  if (definition.kind === 'raw_sql') {
    return (
      <>
        <textarea
          value={String(definition.sql ?? '')}
          onChange={(event) =>
            onChange((draft) => {
              (draft.definition as unknown as Record<string, unknown>).sql = event.target.value;
            })
          }
          spellCheck={false}
          placeholder="SELECT * FROM orders WHERE region = {{ RegionSelect.value }}"
          className="min-h-0 flex-1 resize-none p-3 font-mono text-xs outline-none"
        />
        {schema && <SchemaHint schema={schema} />}
      </>
    );
  }

  if (definition.kind === 'stored_procedure' || definition.kind === 'function') {
    const isProcedure = definition.kind === 'stored_procedure';
    const routines =
      schema?.schemas.flatMap((namespace) =>
        namespace.routines
          .filter((routine) => (isProcedure ? routine.kind === 'procedure' : routine.kind !== 'procedure'))
          .map((routine) => ({ ...routine, schema: namespace.name })),
      ) ?? [];

    const selectedName = String(definition[isProcedure ? 'procedureName' : 'functionName'] ?? '');
    const selected = routines.find((routine) => routine.name === selectedName);

    return (
      <div className="flex flex-col gap-3 p-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">
            {isProcedure ? 'Procedure' : 'Function'}
          </span>
          <select
            value={selectedName}
            onChange={(event) => {
              const routine = routines.find((candidate) => candidate.name === event.target.value);
              onChange((draft) => {
                const target = draft.definition as unknown as Record<string, unknown>;
                target[isProcedure ? 'procedureName' : 'functionName'] = event.target.value;
                target.schema = routine?.schema;
                // The argument list is generated from the real signature, so the
                // form cannot drift from what the database expects.
                target.arguments = (routine?.parameters ?? []).map((parameter) => ({
                  name: parameter.name,
                  direction: parameter.direction,
                  typeHint: parameter.dataType,
                  value: parameter.direction === 'out' ? undefined : '',
                }));
              });
            }}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="">Select…</option>
            {routines.map((routine) => (
              <option key={`${routine.schema}.${routine.name}`} value={routine.name}>
                {routine.schema}.{routine.name}
              </option>
            ))}
          </select>
        </label>

        {selected && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-slate-600">Parameters</span>
            {(definition.arguments as { name: string; direction: string; value?: string }[]).map(
              (argument, index) => (
                <label key={argument.name} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 truncate font-mono text-xs text-slate-500">
                    {argument.name}
                    <span className="ml-1 text-[10px] text-slate-400">{argument.direction}</span>
                  </span>
                  <input
                    value={argument.value ?? ''}
                    disabled={argument.direction === 'out'}
                    placeholder="{{ Widget.value }}"
                    onChange={(event) =>
                      onChange((draft) => {
                        const args = (draft.definition as unknown as Record<string, unknown>)
                          .arguments as { value?: string }[];
                        args[index]!.value = event.target.value;
                      })
                    }
                    className="flex-1 rounded border border-slate-300 px-2 py-1 font-mono text-xs outline-none focus:border-blue-500 disabled:bg-slate-50"
                  />
                </label>
              ),
            )}
          </div>
        )}
      </div>
    );
  }

  if (definition.kind === 'api') {
    return (
      <div className="flex flex-col gap-3 p-3">
        <div className="flex gap-2">
          <select
            value={String(definition.method ?? 'GET')}
            onChange={(event) =>
              onChange((draft) => {
                (draft.definition as unknown as Record<string, unknown>).method = event.target.value;
              })
            }
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => (
              <option key={method}>{method}</option>
            ))}
          </select>
          <input
            value={String(definition.path ?? '')}
            onChange={(event) =>
              onChange((draft) => {
                (draft.definition as unknown as Record<string, unknown>).path = event.target.value;
              })
            }
            placeholder="orders?region={{ RegionSelect.value }}"
            className="flex-1 rounded border border-slate-300 px-2 py-1 font-mono text-xs outline-none focus:border-blue-500"
          />
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Body (JSON)</span>
          <textarea
            rows={8}
            value={String((definition.body as { content?: string })?.content ?? '')}
            onChange={(event) =>
              onChange((draft) => {
                (draft.definition as unknown as Record<string, unknown>).body = {
                  type: 'json',
                  content: event.target.value,
                };
              })
            }
            spellCheck={false}
            className="resize-y rounded border border-slate-300 p-2 font-mono text-xs outline-none focus:border-blue-500"
          />
        </label>
      </div>
    );
  }

  return (
    <div className="p-3 text-xs text-slate-500">
      The visual builder for this mode is not wired up yet — switch to raw SQL.
    </div>
  );
}

function SchemaHint({ schema }: { schema: DbSchema }) {
  return (
    <div className="max-h-28 shrink-0 overflow-auto border-t border-slate-200 bg-slate-50 p-2">
      <span className="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
        Schema
      </span>
      {schema.schemas.map((namespace) => (
        <div key={namespace.name} className="mt-1">
          {namespace.tables.map((table) => (
            <div key={table.name} className="font-mono text-[11px] text-slate-500">
              <span className="text-slate-700">{table.name}</span>
              <span className="text-slate-400"> ({table.columns.map((c) => c.name).join(', ')})</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ResultTable({ result }: { result: QueryResult }) {
  if (result.rows.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        No rows{result.affectedRows !== undefined ? ` · ${result.affectedRows} affected` : ''} ·{' '}
        {result.durationMs}ms
      </p>
    );
  }

  const columns = Object.keys(result.rows[0]!);

  return (
    <>
      <p className="mb-1 text-[11px] text-slate-400">
        {result.rows.length} rows · {result.durationMs}ms
        {result.truncated && ' · truncated'}
      </p>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                className="border-b border-slate-200 px-1.5 py-1 text-left font-semibold text-slate-600"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.slice(0, 50).map((row, index) => (
            <tr key={index} className="border-b border-slate-100">
              {columns.map((column) => (
                <td key={column} className="max-w-40 truncate px-1.5 py-1 text-slate-700">
                  {formatValue(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const MODE_LABELS: Record<string, string> = {
  raw_sql: 'Raw SQL',
  stored_procedure: 'Stored procedure',
  function: 'Function',
  builder: 'Builder',
  api: 'API request',
};

function availableModes(pluginId: string | undefined): string[] {
  if (pluginId === 'rest') return ['api'];
  return ['raw_sql', 'stored_procedure', 'function', 'builder'];
}

export function blankDefinition(mode: string): QueryEntity['definition'] {
  switch (mode) {
    case 'stored_procedure':
      return { kind: 'stored_procedure', procedureName: '', arguments: [] };
    case 'function':
      return { kind: 'function', functionName: '', arguments: [] };
    case 'builder':
      return { kind: 'builder', operation: 'select', table: '' };
    case 'api':
      return { kind: 'api', protocol: 'rest', method: 'GET', path: '' };
    default:
      return { kind: 'raw_sql', sql: '' };
  }
}
