import { useState } from 'react';
import type { ColumnMetadata, ColumnSpec, TableMetadata } from '@swiftly/shared';
import { api } from '@/lib/api';
import { COLUMN_TYPES, DEFAULT_KINDS, emptyColumn, formatError } from './columnTypes';

export function TableStructureEditor({
  datasourceId,
  environmentId,
  schema,
  table,
  meta,
  canManage,
  onChanged,
}: {
  datasourceId: string;
  environmentId: string;
  schema: string;
  table: string;
  meta: TableMetadata;
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ColumnMetadata | null>(null);

  const run = async (work: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await onChanged();
      return true;
    } catch (caught) {
      setError(formatError(caught));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const drop = async (name: string): Promise<void> => {
    if (!window.confirm(`Drop column “${name}”? Existing values in this column will be lost.`)) {
      return;
    }
    await run(() => api.datasources.dropColumn(datasourceId, environmentId, schema, table, name));
  };

  const rename = async (name: string): Promise<void> => {
    const next = window.prompt('New column name', name)?.trim();
    if (!next || next === name) return;
    await run(() =>
      api.datasources.renameColumn(datasourceId, environmentId, schema, table, name, next),
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-2">
        <span className="text-xs text-slate-500">
          {meta.columns.length} {meta.columns.length === 1 ? 'column' : 'columns'}
        </span>
        {canManage && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={busy}
            className="ml-auto rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Add column
          </button>
        )}
      </div>

      {error && (
        <p className="mx-4 mt-2 rounded bg-red-50 px-3 py-1.5 text-xs whitespace-pre-wrap text-red-700">
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-white">
            <tr>
              {['Column', 'Type', 'Nullable', 'Key', 'Default', ''].map((label) => (
                <th
                  key={label}
                  className="border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-600"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {meta.columns.map((column) => (
              <tr key={column.name} className="border-b border-slate-100">
                <td className="px-3 py-1.5 font-medium text-slate-800">{column.name}</td>
                <td className="px-3 py-1.5 text-slate-600">{column.dataType}</td>
                <td className="px-3 py-1.5 text-slate-600">{column.nullable ? 'YES' : 'NO'}</td>
                <td className="px-3 py-1.5 text-xs">
                  {column.isPrimaryKey && (
                    <span className="rounded bg-amber-100 px-1 font-semibold text-amber-800">PK</span>
                  )}
                  {column.isIdentity && (
                    <span className="ml-1 rounded bg-slate-100 px-1 text-slate-600">identity</span>
                  )}
                </td>
                <td className="max-w-48 truncate px-3 py-1.5 text-xs text-slate-500">
                  {column.defaultValue ?? ''}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {canManage && meta.kind === 'table' && (
                    <span className="flex justify-end gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setEditing(column)}
                        className="text-xs text-slate-500 hover:text-slate-800"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void rename(column.name)}
                        className="text-xs text-slate-500 hover:text-slate-800"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void drop(column.name)}
                        className="text-xs text-red-600 hover:text-red-800"
                      >
                        Drop
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && (
        <ColumnDialog
          title="Add column"
          busy={busy}
          initial={emptyColumn()}
          onClose={() => setAdding(false)}
          onSubmit={async (column) => {
            if (
              await run(() =>
                api.datasources.addColumn(datasourceId, environmentId, schema, table, column),
              )
            ) {
              setAdding(false);
            }
          }}
        />
      )}

      {editing && (
        <ColumnDialog
          title={`Edit ${editing.name}`}
          busy={busy}
          initial={{
            name: editing.name,
            dataType: editing.dataType,
            nullable: editing.nullable,
            defaultKind: editing.hasDefault ? 'literal' : 'none',
            defaultValue: editing.defaultValue ?? '',
          }}
          nameLocked
          onClose={() => setEditing(null)}
          onSubmit={async (column) => {
            if (
              await run(() =>
                api.datasources.alterColumn(
                  datasourceId,
                  environmentId,
                  schema,
                  table,
                  editing.name,
                  {
                    dataType: column.dataType,
                    nullable: column.nullable,
                    defaultKind: column.defaultKind,
                    defaultValue: column.defaultValue,
                  },
                ),
              )
            ) {
              setEditing(null);
            }
          }}
        />
      )}
    </div>
  );
}

function ColumnDialog({
  title,
  busy,
  initial,
  nameLocked,
  onClose,
  onSubmit,
}: {
  title: string;
  busy: boolean;
  initial: ColumnSpec;
  nameLocked?: boolean;
  onClose: () => void;
  onSubmit: (column: ColumnSpec) => Promise<void>;
}) {
  const [column, setColumn] = useState<ColumnSpec>(initial);

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
        aria-label={title}
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(column);
        }}
      >
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        </div>
        <div className="flex flex-col gap-3 px-4 py-4">
          <ColumnFields
            column={column}
            onChange={setColumn}
            nameLocked={nameLocked}
            compact={false}
          />
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
            disabled={busy || column.name.trim() === ''}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function ColumnFields({
  column,
  onChange,
  nameLocked,
  compact,
}: {
  column: ColumnSpec;
  onChange: (next: ColumnSpec) => void;
  nameLocked?: boolean;
  compact: boolean;
}) {
  const set = (patch: Partial<ColumnSpec>): void => onChange({ ...column, ...patch });

  return (
    <>
      <label className={compact ? 'min-w-32 flex-1' : 'flex flex-col gap-1'}>
        {!compact && <span className="text-xs font-medium text-slate-700">Name</span>}
        <input
          value={column.name}
          disabled={nameLocked}
          onChange={(event) => set({ name: event.target.value })}
          placeholder="column_name"
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-blue-500 disabled:bg-slate-50"
        />
      </label>
      <label className={compact ? 'w-40' : 'flex flex-col gap-1'}>
        {!compact && <span className="text-xs font-medium text-slate-700">Type</span>}
        <select
          value={column.dataType}
          onChange={(event) => set({ dataType: event.target.value })}
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-blue-500"
        >
          {!COLUMN_TYPES.includes(column.dataType as (typeof COLUMN_TYPES)[number]) && (
            <option value={column.dataType}>{column.dataType}</option>
          )}
          {COLUMN_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <label className={compact ? 'flex items-center gap-1 text-[11px] text-slate-600' : 'flex items-center gap-2 text-xs text-slate-700'}>
        <input
          type="checkbox"
          checked={column.nullable !== false && !column.primaryKey && !column.identity}
          disabled={column.primaryKey || column.identity}
          onChange={(event) => set({ nullable: event.target.checked })}
        />
        Nullable
      </label>
      <label className={compact ? 'flex items-center gap-1 text-[11px] text-slate-600' : 'flex items-center gap-2 text-xs text-slate-700'}>
        <input
          type="checkbox"
          checked={Boolean(column.primaryKey)}
          onChange={(event) =>
            set({
              primaryKey: event.target.checked,
              nullable: event.target.checked ? false : column.nullable,
            })
          }
        />
        PK
      </label>
      <label className={compact ? 'flex items-center gap-1 text-[11px] text-slate-600' : 'flex items-center gap-2 text-xs text-slate-700'}>
        <input
          type="checkbox"
          checked={Boolean(column.identity)}
          onChange={(event) =>
            set({
              identity: event.target.checked,
              dataType: event.target.checked ? 'integer' : column.dataType,
              nullable: event.target.checked ? false : column.nullable,
              primaryKey: event.target.checked ? true : column.primaryKey,
            })
          }
        />
        Identity
      </label>
      {!compact && (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-700">Default</span>
            <select
              value={column.defaultKind ?? 'none'}
              onChange={(event) =>
                set({ defaultKind: event.target.value as ColumnSpec['defaultKind'] })
              }
              className="rounded border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-blue-500"
            >
              {DEFAULT_KINDS.map((kind) => (
                <option key={kind.value} value={kind.value}>
                  {kind.label}
                </option>
              ))}
            </select>
          </label>
          {column.defaultKind === 'literal' && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-700">Literal</span>
              <input
                value={column.defaultValue ?? ''}
                onChange={(event) => set({ defaultValue: event.target.value })}
                className="rounded border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-blue-500"
              />
            </label>
          )}
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={Boolean(column.unique)}
              onChange={(event) => set({ unique: event.target.checked })}
            />
            Unique
          </label>
        </>
      )}
    </>
  );
}
