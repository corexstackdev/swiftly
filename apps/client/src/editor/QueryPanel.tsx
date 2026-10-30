import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  isAppLevelEntity,
  type ApplicationDsl,
  type DbSchema,
  type PageDsl,
  type QueryEntity,
  type QueryResult,
  type QueryVariable,
  type RoutineMetadata,
} from '@swiftly/shared';
import { api, type DatasourceSummary } from '@/lib/api';
import {
  isQueryVariableName,
  nextVariableName,
  pageQueryVariableOverrides,
  setPageQueryVariableValue,
} from '@/evaluation/queryVariables';
import { QueryMenuButton } from './QueryMenu';
import { isJsIdentifier } from './jsObjectOps';
import { controlCompact, ghostButton } from './controls';

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
  dsl,
  pages,
  currentPageId,
  applicationId,
  environmentId,
  datasources,
  bindings,
  onChange,
  onExecuted,
  onClose,
  onRename,
  onCopyToPage,
  onMoveToPage,
  onMakeGlobal,
  onCopyToThisPage,
  onDelete,
  onPageChange,
}: {
  /** The query being edited, chosen in the entity panel. */
  query: QueryEntity | null;
  dsl: ApplicationDsl;
  pages: PageDsl[];
  currentPageId: string;
  applicationId: string;
  environmentId: string;
  datasources: DatasourceSummary[];
  /** Evaluated values for this query's own bindings, keyed by expression text. */
  bindings: Record<string, unknown>;
  onChange: (mutate: (query: QueryEntity) => void) => void;
  /** Pushes the Run result onto the canvas so bound widgets update immediately. */
  onExecuted?: (result: QueryResult) => void;
  onClose: () => void;
  onRename: (name: string) => void;
  onCopyToPage: (pageId: string) => void;
  onMoveToPage: (pageId: string) => void;
  onMakeGlobal: () => void;
  onCopyToThisPage: () => void;
  onDelete: () => void;
  onPageChange: (mutate: (page: PageDsl) => void, label?: string) => void;
}) {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [schema, setSchema] = useState<DbSchema | null>(null);
  const [draftName, setDraftName] = useState(query?.name ?? '');

  const datasource = datasources.find((candidate) => candidate.id === query?.datasourceId);
  const page = pages.find((candidate) => candidate.id === currentPageId);

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

  useEffect(() => {
    setDraftName(query?.name ?? '');
  }, [query?.id, query?.name]);

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
      onExecuted?.(response);
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
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-1.5">
        <input
          value={draftName}
          aria-label="Query name"
          onChange={(event) => setDraftName(event.target.value.replace(/[^\w]/g, ''))}
          onBlur={() => {
            if (draftName !== query.name && isJsIdentifier(draftName)) onRename(draftName);
            else setDraftName(query.name);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
          className="w-40 rounded border border-slate-300 px-2 py-0.5 font-mono text-xs outline-none focus:border-blue-500"
        />
        <QueryMenuButton
          query={query}
          dsl={dsl}
          pages={pages}
          currentPageId={currentPageId}
          onRename={onRename}
          onCopyToPage={onCopyToPage}
          onMoveToPage={onMoveToPage}
          onMakeGlobal={onMakeGlobal}
          onCopyToThisPage={onCopyToThisPage}
          onDelete={onDelete}
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

        <span className="text-[11px] text-slate-400">
          {query.pageId ? 'This page' : 'Global'} · {datasource?.name ?? 'No datasource'}
        </span>

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
        <div className="flex min-h-0 min-w-0 flex-[1.4] flex-col overflow-hidden border-r border-slate-200">
          <QueryEditorBody query={query} schema={schema} onChange={onChange} />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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

      <QueryVariablesEditor
        query={query}
        page={page}
        bindings={bindings}
        onChange={onChange}
        onPageChange={onPageChange}
      />
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
  const sqlRef = useRef<HTMLTextAreaElement>(null);

  if (definition.kind === 'raw_sql') {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden overflow-y-auto">
        <textarea
          ref={sqlRef}
          value={String(definition.sql ?? '')}
          onChange={(event) =>
            onChange((draft) => {
              (draft.definition as unknown as Record<string, unknown>).sql = event.target.value;
            })
          }
          spellCheck={false}
          placeholder="SELECT * FROM orders WHERE region = {{ region }}"
          className="min-h-24 min-w-0 flex-1 resize-none p-2 font-mono text-xs outline-none"
        />
        <p className="shrink-0 border-t border-slate-100 px-2 py-1.5 text-[10px] leading-snug text-slate-400">
          A table set to fetch per page adds LIMIT and OFFSET when this statement has
          none. Write your own to keep control, using {'{{ Table1.pageSize }}'} and{' '}
          {'{{ Table1.pageOffset }}'}.
        </p>
        {schema && (
          <SchemaBrowser
            schema={schema}
            onInsert={(snippet, variables) =>
              onChange((draft) => {
                const target = draft.definition as unknown as Record<string, unknown>;
                target.sql = insertSqlSnippet(
                  String(target.sql ?? ''),
                  snippet,
                  sqlRef.current,
                );
                if (variables && variables.length > 0) {
                  draft.variables = mergeVariables(draft.variables, variables);
                }
              })
            }
          />
        )}
      </div>
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
    const selectedSchema = String(definition.schema ?? '');
    const selectedKey = selectedName
      ? selectedSchema
        ? `${selectedSchema}.${selectedName}`
        : selectedName
      : '';
    const selected =
      routines.find((routine) => `${routine.schema}.${routine.name}` === selectedKey) ??
      routines.find((routine) => routine.name === selectedName);

    return (
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">
              {isProcedure ? 'Procedure' : 'Function'}
            </span>
            <select
              value={selected ? `${selected.schema}.${selected.name}` : selectedKey}
              onChange={(event) => {
                const routine = routines.find(
                  (candidate) => `${candidate.schema}.${candidate.name}` === event.target.value,
                );
                onChange((draft) => {
                  const target = draft.definition as unknown as Record<string, unknown>;
                  target[isProcedure ? 'procedureName' : 'functionName'] = routine?.name ?? '';
                  target.schema = routine?.schema;
                  if (!isProcedure) target.tableValued = routine?.returnsSet === true;
                  const inputs = routine ? inParameters(routine) : [];
                  const names = uniqueVarNames(inputs.map((parameter) => safeVarName(parameter.name)));
                  const listed = (routine?.parameters ?? []).filter(
                    (parameter) => isProcedure || parameter.direction !== 'out',
                  );
                  let inputIndex = 0;
                  target.arguments = listed.map((parameter) => {
                    const isOut = parameter.direction === 'out';
                    const varName = isOut ? '' : names[inputIndex++]!;
                    return {
                      name: parameter.name || varName || 'arg',
                      direction: parameter.direction,
                      typeHint: parameter.dataType,
                      value: isOut ? undefined : `{{ ${varName} }}`,
                    };
                  });
                  if (names.length > 0) {
                    draft.variables = mergeVariables(
                      draft.variables,
                      names.map((name) => ({ name, value: '' })),
                    );
                  }
                });
              }}
              className="rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">{schema ? 'Select…' : 'Schema loading…'}</option>
              {routines.map((routine) => (
                <option
                  key={`${routine.schema}.${routine.name}`}
                  value={`${routine.schema}.${routine.name}`}
                >
                  {routine.schema}.{routine.name}
                  {routine.returnsSet ? ' · set' : ''}
                </option>
              ))}
            </select>
          </label>

          {selected && !isProcedure && (
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={definition.tableValued === true}
                onChange={(event) =>
                  onChange((draft) => {
                    (draft.definition as unknown as Record<string, unknown>).tableValued =
                      event.target.checked;
                  })
                }
                className="h-3 w-3 accent-blue-600"
              />
              Table-valued — SELECT * FROM fn(...)
            </label>
          )}

          {selected && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-slate-600">Arguments</span>
              <p className="text-[10px] leading-snug text-slate-400">
                Bind each argument to a widget, or to a query variable below. Do not put widget
                paths in SQL — use {'{{ name }}'}.
              </p>
              {(definition.arguments as { name: string; direction: string; value?: string }[]).map(
                (argument, index) => (
                  <label key={`${argument.name}-${index}`} className="flex items-center gap-2">
                    <span className="w-28 shrink-0 truncate font-mono text-xs text-slate-500">
                      {argument.name}
                      <span className="ml-1 text-[10px] text-slate-400">{argument.direction}</span>
                    </span>
                    <input
                      value={argument.value ?? ''}
                      disabled={argument.direction === 'out'}
                      placeholder="{{ name }} or {{ Form1.data.Name }}"
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
      </div>
    );
  }

  if (definition.kind === 'builder') {
    const tables =
      schema?.schemas.flatMap((namespace) =>
        namespace.tables.map((table) => ({
          schema: namespace.name,
          name: table.name,
          kind: table.kind,
          columns: table.columns,
        })),
      ) ?? [];
    const selectedKey =
      definition.schema && definition.table
        ? `${String(definition.schema)}::${String(definition.table)}`
        : definition.table
          ? `::${String(definition.table)}`
          : '';
    const selected = tables.find(
      (table) =>
        table.name === definition.table &&
        (!definition.schema || table.schema === definition.schema),
    );

    return (
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">Table or view</span>
            <select
              value={selectedKey}
              onChange={(event) => {
                const [schemaName, tableName] = event.target.value.split('::');
                onChange((draft) => {
                  const target = draft.definition as unknown as Record<string, unknown>;
                  target.schema = schemaName || undefined;
                  target.table = tableName ?? '';
                  target.operation = 'select';
                });
              }}
              className="rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">{schema ? 'Select a table or view…' : 'Schema loading…'}</option>
              {tables.map((table) => (
                <option key={`${table.schema}::${table.name}`} value={`${table.schema}::${table.name}`}>
                  {table.schema}.{table.name}
                  {table.kind === 'view' ? ' (view)' : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">Limit</span>
              <input
                value={String(definition.limit ?? '50')}
                onChange={(event) =>
                  onChange((draft) => {
                    (draft.definition as unknown as Record<string, unknown>).limit = event.target.value;
                  })
                }
                className="w-32 rounded border border-slate-300 px-2 py-1 font-mono text-xs outline-none focus:border-blue-500"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">Offset</span>
              <input
                value={String(definition.offset ?? '')}
                placeholder="0"
                onChange={(event) =>
                  onChange((draft) => {
                    (draft.definition as unknown as Record<string, unknown>).offset =
                      event.target.value;
                  })
                }
                className="w-32 rounded border border-slate-300 px-2 py-1 font-mono text-xs outline-none focus:border-blue-500"
              />
            </label>
          </div>
          <p className="text-[10px] leading-snug text-slate-400">
            A table set to fetch per page supplies limit and offset for each page, including
            raw SQL that has no LIMIT / OFFSET of its own.
          </p>

          {selected && (
            <p className="font-mono text-[11px] text-slate-500">
              {selected.columns.map((column) => column.name).join(', ') || 'No columns'}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (definition.kind === 'api') {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
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
            placeholder="orders?region={{ region }}"
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
      </div>
    );
  }

  return (
    <div className="p-3 text-xs text-slate-500">
      The visual builder for this mode is not wired up yet — switch to raw SQL.
    </div>
  );
}

function QueryVariablesEditor({
  query,
  page,
  bindings,
  onChange,
  onPageChange,
}: {
  query: QueryEntity;
  page: PageDsl | undefined;
  bindings: Record<string, unknown>;
  onChange: (mutate: (query: QueryEntity) => void) => void;
  onPageChange: (mutate: (page: PageDsl) => void, label?: string) => void;
}) {
  const variables = query.variables ?? [];
  const global = isAppLevelEntity(query);
  const pageValues = new Map(
    pageQueryVariableOverrides(page, query.id).map((variable) => [variable.name, variable.value]),
  );

  const updateDeclared = (index: number, patch: Partial<QueryVariable>): void => {
    const previousName = variables[index]?.name;
    onChange((draft) => {
      const next = [...(draft.variables ?? [])];
      next[index] = { ...next[index]!, ...patch };
      draft.variables = next;
    });
    if (!global || !page || patch.name === undefined || patch.name === previousName) return;
    const previousValue = pageValues.get(previousName ?? '');
    if (previousValue === undefined) return;
    onPageChange((draft) => {
      if (previousName) setPageQueryVariableValue(draft, query.id, previousName, '');
      if (patch.name) setPageQueryVariableValue(draft, query.id, patch.name, previousValue);
    }, 'query-page-vars');
  };

  return (
    <div className="min-w-0 shrink-0 overflow-hidden border-t border-slate-200 bg-white">
      <div className="flex h-7 min-w-0 items-center gap-2 px-2">
        <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
          Variables
        </span>
        {global && (
          <span className="truncate text-[10px] text-slate-400">
            Defaults apply on every page. Bind this page&apos;s widgets under This page.
          </span>
        )}
        <button
          type="button"
          onClick={() =>
            onChange((draft) => {
              const current = draft.variables ?? [];
              draft.variables = [...current, { name: nextVariableName(current), value: '' }];
            })
          }
          className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-blue-600 hover:bg-blue-50"
        >
          + Add
        </button>
      </div>
      {variables.length === 0 ? (
        <p className="truncate px-2 pb-1.5 text-[10px] text-slate-400">
          {global
            ? `Use {{ name }} in SQL. Defaults apply on every page; bind widgets under This page.`
            : `Use {{ name }} in SQL, then map it to a widget here.`}
        </p>
      ) : global ? (
        <div className="max-h-32 overflow-auto px-2 pb-2">
          {variables.map((variable, index) => {
            const resolved = bindings[variable.name];
            const pageValue = pageValues.get(variable.name) ?? '';
            return (
              <div
                key={`${variable.name}-${index}`}
                className="grid grid-cols-[4.5rem_minmax(0,1fr)_1.25rem] items-center gap-x-1.5 gap-y-1 border-b border-slate-100 py-1.5 last:border-b-0"
              >
                <span className="text-[9px] font-medium tracking-wide text-slate-400 uppercase">
                  Name
                </span>
                <input
                  value={variable.name}
                  aria-label="Variable name"
                  onChange={(event) =>
                    updateDeclared(index, { name: event.target.value.replace(/[^\w]/g, '') })
                  }
                  placeholder="name"
                  className={clsx(controlCompact, 'min-w-0 font-mono')}
                />
                <button
                  type="button"
                  title="Remove variable"
                  onClick={() => {
                    onChange((draft) => {
                      draft.variables = (draft.variables ?? []).filter((_, i) => i !== index);
                    });
                    if (pageValues.has(variable.name)) {
                      onPageChange((draft) => {
                        setPageQueryVariableValue(draft, query.id, variable.name, '');
                      }, 'query-page-vars');
                    }
                  }}
                  className={clsx(
                    ghostButton,
                    'row-span-3 flex h-6 w-5 items-center justify-center self-start p-0 hover:bg-red-50 hover:text-red-600',
                  )}
                >
                  ×
                </button>
                <span className="text-[9px] font-medium tracking-wide text-slate-400 uppercase">
                  Default
                </span>
                <input
                  value={variable.value}
                  aria-label={`Default for ${variable.name || 'variable'}`}
                  onChange={(event) => updateDeclared(index, { value: event.target.value })}
                  placeholder="optional"
                  className={clsx(controlCompact, 'min-w-0 font-mono')}
                />
                <span className="text-[9px] font-medium tracking-wide text-slate-400 uppercase">
                  This page
                </span>
                <input
                  value={pageValue}
                  aria-label={`This page value for ${variable.name || 'variable'}`}
                  title={resolved !== undefined ? String(formatValue(resolved)) : undefined}
                  onChange={(event) =>
                    onPageChange((draft) => {
                      setPageQueryVariableValue(draft, query.id, variable.name, event.target.value);
                    }, 'query-page-vars')
                  }
                  placeholder={variable.value || '{{ Form2.data.Name }}'}
                  className={clsx(controlCompact, 'min-w-0 font-mono')}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid max-h-24 grid-cols-[5.25rem_minmax(0,1fr)_1.25rem] items-center gap-x-1.5 gap-y-1 overflow-auto px-2 pb-2">
          <span className="text-[9px] font-medium tracking-wide text-slate-400 uppercase">Name</span>
          <span className="text-[9px] font-medium tracking-wide text-slate-400 uppercase">Value</span>
          <span />
          {variables.map((variable, index) => {
            const resolved = bindings[variable.name];
            return (
              <div key={`${variable.name}-${index}`} className="contents">
                <input
                  value={variable.name}
                  aria-label="Variable name"
                  onChange={(event) =>
                    updateDeclared(index, { name: event.target.value.replace(/[^\w]/g, '') })
                  }
                  placeholder="name"
                  className={clsx(controlCompact, 'min-w-0 font-mono')}
                />
                <input
                  value={variable.value}
                  aria-label={`Value for ${variable.name || 'variable'}`}
                  title={resolved !== undefined ? String(formatValue(resolved)) : undefined}
                  onChange={(event) => updateDeclared(index, { value: event.target.value })}
                  placeholder="{{ Form2.data.Name }}"
                  className={clsx(controlCompact, 'min-w-0 font-mono')}
                />
                <button
                  type="button"
                  title="Remove variable"
                  onClick={() =>
                    onChange((draft) => {
                      draft.variables = (draft.variables ?? []).filter((_, i) => i !== index);
                    })
                  }
                  className={clsx(
                    ghostButton,
                    'flex h-6 w-5 items-center justify-center p-0 hover:bg-red-50 hover:text-red-600',
                  )}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SchemaBrowser({
  schema,
  onInsert,
}: {
  schema: DbSchema;
  onInsert: (snippet: string, variables?: QueryVariable[]) => void;
}) {
  return (
    <div className="max-h-28 min-w-0 shrink-0 overflow-auto border-t border-slate-200 bg-slate-50 px-2 py-1.5">
      <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
        Schema
      </span>
      {schema.schemas.map((namespace) => {
        const tables = namespace.tables.filter((table) => table.kind !== 'view');
        const views = namespace.tables.filter((table) => table.kind === 'view');
        const functions = namespace.routines.filter((routine) => routine.kind !== 'procedure');
        if (tables.length === 0 && views.length === 0 && functions.length === 0) return null;

        return (
          <div key={namespace.name} className="mt-1.5">
            <div className="text-[10px] font-medium text-slate-500">{namespace.name}</div>
            {tables.map((table) => (
              <SchemaRow
                key={`table:${table.name}`}
                kind="table"
                label={table.name}
                detail={table.columns.map((column) => column.name).join(', ')}
                onClick={() => onInsert(`SELECT * FROM ${qualifyIdent(namespace.name, table.name)}`)}
              />
            ))}
            {views.map((view) => (
              <SchemaRow
                key={`view:${view.name}`}
                kind="view"
                label={view.name}
                detail={view.columns.map((column) => column.name).join(', ')}
                onClick={() => onInsert(`SELECT * FROM ${qualifyIdent(namespace.name, view.name)}`)}
              />
            ))}
            {functions.map((routine) => (
              <SchemaRow
                key={`fn:${routine.name}`}
                kind="function"
                label={routine.name}
                detail={routineSignature(routine)}
                onClick={() => {
                  const inputs = inParameters(routine);
                  const names = uniqueVarNames(inputs.map((parameter) => safeVarName(parameter.name)));
                  onInsert(functionCallSql(namespace.name, routine, names), names.map((name) => ({ name, value: '' })));
                }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function SchemaRow({
  kind,
  label,
  detail,
  onClick,
}: {
  kind: 'table' | 'view' | 'function';
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-w-0 items-baseline gap-1.5 rounded px-0.5 py-0.5 text-left hover:bg-white"
    >
      <span className="w-12 shrink-0 text-[9px] font-medium tracking-wide text-slate-400 uppercase">
        {kind}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-slate-700">{label}</span>
      <span className="min-w-0 truncate font-mono text-[10px] text-slate-400">{detail}</span>
    </button>
  );
}

function insertSqlSnippet(
  current: string,
  snippet: string,
  textarea: HTMLTextAreaElement | null,
): string {
  if (textarea && document.activeElement === textarea) {
    const start = textarea.selectionStart ?? current.length;
    const end = textarea.selectionEnd ?? current.length;
    return current.slice(0, start) + snippet + current.slice(end);
  }
  const trimmed = current.replace(/\s*$/, '');
  return trimmed ? `${trimmed}\n\n${snippet}` : snippet;
}

function mergeVariables(
  existing: QueryVariable[] | undefined,
  incoming: QueryVariable[],
): QueryVariable[] {
  const next = [...(existing ?? [])];
  const taken = new Set(next.map((variable) => variable.name));
  for (const variable of incoming) {
    if (!variable.name || taken.has(variable.name) || !isQueryVariableName(variable.name)) continue;
    taken.add(variable.name);
    next.push({ name: variable.name, value: variable.value });
  }
  return next;
}

function inParameters(routine: RoutineMetadata) {
  return routine.parameters.filter((parameter) => parameter.direction !== 'out');
}

function safeVarName(name: string): string {
  const cleaned = name.replace(/[^\w]/g, '');
  if (isQueryVariableName(cleaned)) return cleaned;
  return 'arg';
}

function uniqueVarNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    let candidate = name || 'arg';
    let index = 2;
    while (used.has(candidate)) {
      candidate = `${name || 'arg'}${index}`;
      index += 1;
    }
    used.add(candidate);
    return candidate;
  });
}

function qualifyIdent(schema: string, name: string): string {
  return `${schema}.${name}`;
}

function functionCallSql(schema: string, routine: RoutineMetadata, argNames: string[]): string {
  const call = `${qualifyIdent(schema, routine.name)}(${argNames.map((name) => `{{ ${name} }}`).join(', ')})`;
  return routine.returnsSet ? `SELECT * FROM ${call}` : `SELECT ${call} AS result`;
}

function routineSignature(routine: RoutineMetadata): string {
  const args = inParameters(routine)
    .map((parameter) => `${parameter.name || 'arg'} ${parameter.dataType}`.trim())
    .join(', ');
  return args ? `(${args})` : '()';
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

  const columns =
    result.columns && result.columns.length > 0
      ? result.columns.map((column) => column.name)
      : Object.keys(result.rows[0] ?? {});

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

export function queryNameFromTable(table: string): string {
  const cleaned = table.replace(/[^A-Za-z0-9]+/g, '');
  if (!cleaned) return 'Query';
  return `Get${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`;
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
