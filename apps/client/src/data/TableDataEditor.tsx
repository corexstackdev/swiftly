import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import type { ColumnMetadata, TableRowsPage } from '@swiftly/shared';
import { api } from '@/lib/api';
import { formatCell, formatError, parseCell } from './columnTypes';
import { SchemaAccessPanel, schemaAccessFromError } from './SchemaAccessPanel';

const PAGE_SIZE = 50;

export function TableDataEditor({
  datasourceId,
  environmentId,
  schema,
  table,
  canManage,
  reloadToken,
  dbUser,
  owner,
  onAccessFixed,
}: {
  datasourceId: string;
  environmentId: string;
  schema: string;
  table: string;
  canManage: boolean;
  reloadToken: number;
  dbUser?: string;
  owner?: string;
  onAccessFixed?: () => void;
}) {
  const [page, setPage] = useState<TableRowsPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [inserting, setInserting] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setPage(
        await api.datasources.tableRows(
          datasourceId,
          environmentId,
          schema,
          table,
          PAGE_SIZE,
          offset,
        ),
      );
    } catch (caught) {
      setError(caught);
      setPage(null);
    }
  }, [datasourceId, environmentId, schema, table, offset]);

  const errorText = error ? formatError(error) : null;
  const accessHint = schemaAccessFromError(
    error,
    dbUser ? { schema, dbUser, owner } : undefined,
  );

  useEffect(() => {
    setOffset(0);
    setSelected(new Set());
  }, [schema, table]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const columns = page?.columns ?? [];
  const primary = useMemo(
    () => columns.filter((column) => column.isPrimaryKey).map((column) => column.name),
    [columns],
  );
  const canEditRows = canManage && primary.length > 0 && !accessHint;
  const total = page?.totalRows ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  const toggle = (index: number): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const saveCell = async (
    row: Record<string, unknown>,
    column: ColumnMetadata,
    raw: string,
  ): Promise<void> => {
    if (!canEditRows) return;
    const current = formatCell(row[column.name]);
    if (raw === current) return;
    setBusy(true);
    setError(null);
    try {
      const key: Record<string, unknown> = {};
      for (const name of primary) key[name] = row[name];
      await api.datasources.updateRow(datasourceId, environmentId, schema, table, key, {
        [column.name]: parseCell(raw, column.dataType),
      });
      await load();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const removeSelected = async (): Promise<void> => {
    if (!page || selected.size === 0 || !canEditRows) return;
    if (!window.confirm(`Delete ${selected.size} ${selected.size === 1 ? 'row' : 'rows'}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const keys = [...selected].map((index) => {
        const row = page.rows[index]!;
        const key: Record<string, unknown> = {};
        for (const name of primary) key[name] = row[name];
        return key;
      });
      await api.datasources.deleteRows(datasourceId, environmentId, schema, table, keys);
      setSelected(new Set());
      await load();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  if (accessHint) {
    return (
      <SchemaAccessPanel
        hint={accessHint}
        refreshing={busy}
        onRefresh={() => {
          if (onAccessFixed) onAccessFixed();
          else void load();
        }}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-2">
        <span className="text-xs text-slate-500">
          {!page && !errorText ? 'Loading…' : total === 0 ? 'No rows' : `${from}–${to} of ${total.toLocaleString()} rows`}
          {page ? ` · ${page.durationMs}ms` : ''}
        </span>
        {!canEditRows && canManage && page && (
          <span className="text-[11px] text-amber-700">Add a primary key to edit rows from here</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {canManage && (
            <>
              <button
                type="button"
                onClick={() => setInserting(true)}
                disabled={busy || !page}
                className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Insert row
              </button>
              <button
                type="button"
                onClick={() => void removeSelected()}
                disabled={busy || selected.size === 0 || !canEditRows}
                className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
              >
                Delete
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            title="Reload rows from the database"
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M10 6A4 4 0 1 1 8.2 2.4"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              <path
                d="M8.6 1.2v2.2H6.4"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Refresh
          </button>
          <button
            type="button"
            disabled={offset === 0 || busy}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={offset + PAGE_SIZE >= total || busy}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      {errorText && (
        <p className="mx-4 mt-2 rounded bg-red-50 px-3 py-1.5 text-xs whitespace-pre-wrap text-red-700">
          {errorText}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {!page ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            {error ? 'Could not load rows' : 'Loading rows…'}
          </div>
        ) : columns.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            This table has no columns
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-white">
              <tr>
                {canEditRows && <th className="w-8 border-b border-slate-200" />}
                {columns.map((column) => (
                  <th
                    key={column.name}
                    className="border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold whitespace-nowrap text-slate-600"
                  >
                    {column.name}
                    <span className="ml-1 font-normal text-slate-400">{column.dataType}</span>
                    {column.isPrimaryKey && (
                      <span className="ml-1 text-[9px] font-semibold text-amber-700">PK</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.rows.map((row, index) => (
                <tr key={index} className="border-b border-slate-100 hover:bg-slate-50">
                  {canEditRows && (
                    <td className="px-2">
                      <input
                        type="checkbox"
                        checked={selected.has(index)}
                        onChange={() => toggle(index)}
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <EditableCell
                      key={column.name}
                      value={row[column.name]}
                      column={column}
                      disabled={!canEditRows || column.isPrimaryKey || busy}
                      onSave={(raw) => saveCell(row, column, raw)}
                    />
                  ))}
                </tr>
              ))}
              {page.rows.length === 0 && (
                <tr>
                  <td
                    colSpan={columns.length + (canEditRows ? 1 : 0)}
                    className="px-3 py-8 text-center text-sm text-slate-400"
                  >
                    This table is empty
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {inserting && page && (
        <InsertRowDialog
          columns={page.columns}
          busy={busy}
          onClose={() => setInserting(false)}
          onSubmit={async (values) => {
            setBusy(true);
            setError(null);
            try {
              await api.datasources.insertRow(datasourceId, environmentId, schema, table, values);
              setInserting(false);
              await load();
            } catch (caught) {
              setError(caught);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

function EditableCell({
  value,
  column,
  disabled,
  onSave,
}: {
  value: unknown;
  column: ColumnMetadata;
  disabled: boolean;
  onSave: (raw: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = formatCell(value);

  return (
    <td className="max-w-64 px-1 py-0.5 whitespace-nowrap text-slate-700">
      {disabled ? (
        <span className="block truncate px-2 py-1" title={display}>
          {display}
        </span>
      ) : (
        <input
          value={draft ?? display}
          onFocus={() => setDraft(display)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (draft !== null) onSave(draft);
            setDraft(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
            if (event.key === 'Escape') setDraft(null);
          }}
          aria-label={column.name}
          className={clsx(
            'w-full min-w-24 rounded border border-transparent bg-transparent px-2 py-1 text-sm outline-none',
            'hover:border-slate-200 focus:border-blue-500 focus:bg-white',
          )}
        />
      )}
    </td>
  );
}

function InsertRowDialog({
  columns,
  busy,
  onClose,
  onSubmit,
}: {
  columns: ColumnMetadata[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}) {
  const fields = columns.filter((column) => !column.isIdentity);
  const [values, setValues] = useState<Record<string, string>>({});

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-20"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Insert row"
        className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-lg border border-slate-200 bg-white shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          const payload: Record<string, unknown> = {};
          for (const column of fields) {
            payload[column.name] = parseCell(values[column.name] ?? '', column.dataType);
          }
          void onSubmit(payload);
        }}
      >
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Insert row</h3>
        </div>
        <div className="flex flex-col gap-3 px-4 py-4">
          {fields.length === 0 && (
            <p className="text-xs text-slate-500">All columns are generated. Save to insert a row.</p>
          )}
          {fields.map((column) => (
            <label key={column.name} className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-700">
                {column.name}
                <span className="ml-1 font-normal text-slate-400">{column.dataType}</span>
                {column.nullable === false && <span className="text-red-500"> *</span>}
              </span>
              <input
                value={values[column.name] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [column.name]: event.target.value }))
                }
                required={column.nullable === false}
                className="rounded border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:border-blue-500"
              />
            </label>
          ))}
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
            disabled={busy}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Insert'}
          </button>
        </div>
      </form>
    </div>
  );
}
