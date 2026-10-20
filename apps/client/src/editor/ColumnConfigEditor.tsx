import { useState } from 'react';
import clsx from 'clsx';
import type { ApplicationDsl } from '@swiftly/shared';
import { control, controlCompact, dashedButton, ghostButton, Select } from './controls';
import { ActionEditor } from './ActionEditor';
import {
  defaultActionsColumn,
  isActionsColumn,
  normaliseColumns,
  TABLE_ROW_ACTION_KINDS,
  type TableColumnConfig,
  type TableRowAction,
  type TableRowActionKind,
} from '@/widgets/tableColumns';

/**
 * Per-column settings for a table.
 *
 * The table shows every key of the first row while this is empty, which is what
 * makes a freshly bound query useful immediately. The moment a column needs
 * renaming, widening, moving, hiding, formatting or making editable, it lives
 * here — and columns are seeded from the query's own result rather than typed
 * in, because a mistyped key renders an empty column with nothing to say why.
 *
 * One column is expanded at a time. Twelve columns with eight settings each is
 * ninety-six controls, and a panel that shows them all at once is a panel nobody
 * can find anything in.
 */

export function ColumnConfigEditor({
  value,
  availableKeys,
  dsl,
  pageId,
  onChange,
}: {
  value: unknown;
  availableKeys: string[];
  dsl: ApplicationDsl;
  pageId: string;
  onChange: (columns: TableColumnConfig[]) => void;
}) {
  const columns = normaliseColumns(value);
  const [dragging, setDragging] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const update = (index: number, patch: Partial<TableColumnConfig>): void => {
    const next = [...columns];
    next[index] = { ...next[index]!, ...patch };
    onChange(next);
  };

  const move = (from: number, to: number): void => {
    if (from === to) return;
    const next = [...columns];
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);
    onChange(next);
  };

  const addStatic = (): void => {
    let index = 1;
    while (columns.some((column) => column.key === `column${index}`)) index += 1;
    const key = `column${index}`;
    onChange([...columns, { key, label: 'New column', source: 'static', defaultValue: '' }]);
    setExpanded(key);
  };

  const addActions = (): void => {
    const seeded =
      columns.length === 0
        ? availableKeys.map((key) => ({ key, source: 'data' as const }))
        : columns;
    const column = defaultActionsColumn(seeded);
    onChange([...seeded, column]);
    setExpanded(column.key);
  };

  const setActions = (index: number, actions: TableRowAction[]): void => {
    update(index, { actions });
  };

  const missing = availableKeys.filter((key) => !columns.some((column) => column.key === key));

  if (columns.length === 0) {
    return (
      <div className="no-drag flex flex-col gap-1.5">
        <p className="text-[11px] leading-snug text-slate-400">
          Showing every column the query returns. Take control of them to rename, reorder,
          resize, format, hide, or add Edit / Delete / Download buttons.
        </p>
        <button
          type="button"
          disabled={availableKeys.length === 0}
          onClick={() => onChange(availableKeys.map((key) => ({ key, source: 'data' as const })))}
          className={clsx(dashedButton, availableKeys.length === 0 && 'opacity-50')}
        >
          {availableKeys.length === 0
            ? 'Bind data first'
            : `Configure ${availableKeys.length} columns`}
        </button>
        <button
          type="button"
          disabled={availableKeys.length === 0}
          onClick={addActions}
          className={clsx(dashedButton, availableKeys.length === 0 && 'opacity-50')}
        >
          + Add an actions column
        </button>
      </div>
    );
  }

  return (
    <div className="no-drag flex flex-col gap-1">
      {columns.map((column, index) => {
        const isOpen = expanded === column.key;

        return (
          <div
            key={column.key}
            draggable={!isOpen}
            onDragStart={() => setDragging(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragging !== null) move(dragging, index);
              setDragging(null);
            }}
            onDragEnd={() => setDragging(null)}
            className={clsx(
              'rounded border border-slate-200 bg-slate-50/60',
              dragging === index && 'opacity-50',
            )}
          >
            <div className="flex items-center gap-1 p-1.5">
              <span className="cursor-grab text-[10px] text-slate-300" title="Drag to reorder">
                ⠿
              </span>

              <input
                type="checkbox"
                checked={!column.hidden}
                onChange={(event) => update(index, { hidden: !event.target.checked })}
                title={column.hidden ? 'Hidden' : 'Showing'}
                className="h-3 w-3 shrink-0 accent-blue-600"
              />

              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : column.key)}
                className="flex min-w-0 flex-1 items-center gap-1 text-left"
              >
                <span className="truncate text-xs text-slate-700">
                  {column.label || column.key}
                </span>
                {column.source === 'static' && (
                  <span className="shrink-0 rounded bg-violet-100 px-1 text-[9px] font-medium text-violet-700">
                    added
                  </span>
                )}
                {isActionsColumn(column) && (
                  <span className="shrink-0 rounded bg-emerald-100 px-1 text-[9px] font-medium text-emerald-700">
                    actions
                  </span>
                )}
                {column.editable && (
                  <span className="shrink-0 rounded bg-blue-100 px-1 text-[9px] font-medium text-blue-700">
                    edit
                  </span>
                )}
              </button>

              <span className="shrink-0 text-[9px] text-slate-300">{isOpen ? '▾' : '▸'}</span>

              <button
                type="button"
                onClick={() => onChange(columns.filter((_, i) => i !== index))}
                title={`Remove ${column.key}`}
                className={clsx(ghostButton, 'shrink-0 hover:bg-red-50 hover:text-red-600')}
              >
                ×
              </button>
            </div>

            {isOpen && (
              <div className="flex flex-col gap-1.5 border-t border-slate-200 p-1.5">
                <Field label="Heading">
                  <input
                    value={column.label ?? ''}
                    placeholder={column.key}
                    onChange={(event) => update(index, { label: event.target.value || undefined })}
                    className={controlCompact}
                  />
                </Field>

                {(column.source === 'static' || isActionsColumn(column)) && (
                  <Field label="Field name" help="How bindings and edits refer to it.">
                    <input
                      value={column.key}
                      onChange={(event) => {
                        const key = event.target.value.trim();
                        if (key !== '' && !columns.some((c) => c.key === key)) {
                          update(index, { key });
                          setExpanded(key);
                        }
                      }}
                      className={clsx(controlCompact, 'font-mono')}
                    />
                  </Field>
                )}

                <div className="grid grid-cols-2 gap-1.5">
                  <Field label="Width">
                    <input
                      type="number"
                      min={40}
                      value={column.width ?? ''}
                      placeholder="auto"
                      onChange={(event) =>
                        update(index, {
                          width: event.target.value === '' ? undefined : Number(event.target.value),
                        })
                      }
                      className={controlCompact}
                    />
                  </Field>

                  <Field label="Align">
                    <Select
                      compact
                      value={column.align ?? 'left'}
                      onChange={(next) =>
                        update(index, { align: next as TableColumnConfig['align'] })
                      }
                    >
                      <option value="left">Left</option>
                      <option value="center">Centre</option>
                      <option value="right">Right</option>
                    </Select>
                  </Field>
                </div>

                {!isActionsColumn(column) && (
                <Field label="Show as">
                  <Select
                    compact
                    value={column.format ?? 'plain'}
                    onChange={(next) =>
                      update(index, {
                        format: next === 'plain' ? undefined : (next as TableColumnConfig['format']),
                      })
                    }
                  >
                    <option value="plain">Plain text</option>
                    <option value="number">Number</option>
                    <option value="currency">Currency</option>
                    <option value="percent">Percentage</option>
                    <option value="date">Date</option>
                    <option value="datetime">Date and time</option>
                    <option value="time">Time</option>
                    <option value="relative">Relative time</option>
                  </Select>
                </Field>
                )}

                {(column.format === 'number' ||
                  column.format === 'currency' ||
                  column.format === 'percent') && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <Field label="Decimals">
                      <input
                        type="number"
                        min={0}
                        value={column.decimals ?? ''}
                        placeholder="locale"
                        onChange={(event) =>
                          update(index, {
                            decimals:
                              event.target.value === '' ? undefined : Number(event.target.value),
                          })
                        }
                        className={controlCompact}
                      />
                    </Field>
                    {column.format === 'currency' && (
                      <Field label="Currency">
                        <input
                          value={column.currency ?? ''}
                          placeholder="EUR"
                          onChange={(event) =>
                            update(index, { currency: event.target.value || undefined })
                          }
                          className={clsx(controlCompact, 'uppercase')}
                        />
                      </Field>
                    )}
                  </div>
                )}

                {!isActionsColumn(column) && (
                  <>
                    <Field
                      label={column.source === 'static' ? 'Value' : 'When empty, show'}
                      help={
                        column.source === 'static'
                          ? 'Every row starts with this.'
                          : 'Used wherever the row has nothing.'
                      }
                    >
                      <input
                        value={String(column.defaultValue ?? '')}
                        onChange={(event) =>
                          update(index, { defaultValue: event.target.value || undefined })
                        }
                        className={controlCompact}
                      />
                    </Field>

                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={column.editable === true}
                        onChange={(event) => update(index, { editable: event.target.checked })}
                        className="h-3 w-3 accent-blue-600"
                      />
                      <span className="text-[11px] text-slate-600">
                        Editable — double-click a cell
                      </span>
                    </label>
                  </>
                )}

                {isActionsColumn(column) && (
                  <ActionsPicker
                    actions={column.actions ?? []}
                    availableKeys={availableKeys}
                    dsl={dsl}
                    pageId={pageId}
                    onChange={(actions) => setActions(index, actions)}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}

      <div className="mt-0.5 flex flex-col gap-1">
        {missing.length > 0 && (
          <Select
            value=""
            onChange={(next) => {
              if (next) onChange([...columns, { key: next, source: 'data' }]);
            }}
            className={control}
          >
            <option value="">Add a column from the data…</option>
            {missing.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </Select>
        )}

        <button type="button" onClick={addStatic} className={dashedButton}>
          + Add a column with a default
        </button>

        <button type="button" onClick={addActions} className={dashedButton}>
          + Add an actions column
        </button>

        <button
          type="button"
          onClick={() => onChange([])}
          className={clsx(ghostButton, 'self-start')}
        >
          Reset to every column
        </button>
      </div>
    </div>
  );
}

function ActionsPicker({
  actions,
  availableKeys,
  dsl,
  pageId,
  onChange,
}: {
  actions: TableRowAction[];
  availableKeys: string[];
  dsl: ApplicationDsl;
  pageId: string;
  onChange: (actions: TableRowAction[]) => void;
}) {
  const enabled = new Set(actions.map((action) => action.kind));

  const toggle = (kind: TableRowActionKind, on: boolean): void => {
    if (!on) {
      onChange(actions.filter((action) => action.kind !== kind));
      return;
    }
    if (enabled.has(kind)) return;
    const order = TABLE_ROW_ACTION_KINDS.map((entry) => entry.kind);
    onChange(
      [...actions, { kind }].sort((left, right) => order.indexOf(left.kind) - order.indexOf(right.kind)),
    );
  };

  const patch = (kind: TableRowActionKind, next: Partial<TableRowAction>): void => {
    onChange(actions.map((action) => (action.kind === kind ? { ...action, ...next } : action)));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-medium text-slate-500">Buttons on each row</span>
      {TABLE_ROW_ACTION_KINDS.map((entry) => {
        const current = actions.find((action) => action.kind === entry.kind);
        return (
          <div key={entry.kind} className="rounded border border-slate-200 bg-white p-1.5">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={Boolean(current)}
                onChange={(event) => toggle(entry.kind, event.target.checked)}
                className="h-3 w-3 accent-blue-600"
              />
              <span className="text-[11px] font-medium text-slate-700">{entry.label}</span>
              {current?.onClick && current.onClick.length > 0 && (
                <span className="ml-auto text-[9px] font-medium text-slate-400">
                  {current.onClick.length} handler{current.onClick.length === 1 ? '' : 's'}
                </span>
              )}
            </label>
            {current && (
              <div className="mt-1.5 flex flex-col gap-1.5">
                <Field label="Button label">
                  <input
                    value={current.label ?? ''}
                    placeholder={entry.label}
                    onChange={(event) =>
                      patch(entry.kind, { label: event.target.value || undefined })
                    }
                    className={controlCompact}
                  />
                </Field>
                {entry.kind === 'download' && (
                  <>
                    <Field
                      label="File from column"
                      help="A URL, or the file contents. Leave blank to handle download in a handler."
                    >
                      <Select
                        compact
                        value={current.downloadKey ?? ''}
                        onChange={(next) =>
                          patch(entry.kind, { downloadKey: next || undefined })
                        }
                      >
                        <option value="">None — run handlers only</option>
                        {availableKeys.map((key) => (
                          <option key={key} value={key}>
                            {key}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="File name column">
                      <Select
                        compact
                        value={current.fileNameKey ?? ''}
                        onChange={(next) =>
                          patch(entry.kind, { fileNameKey: next || undefined })
                        }
                      >
                        <option value="">download</option>
                        {availableKeys.map((key) => (
                          <option key={key} value={key}>
                            {key}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </>
                )}
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[10px] font-medium text-slate-500">Event handlers</span>
                  <p className="text-[10px] leading-snug text-slate-400">
                    Each runs on click, in order. The row is event.row.
                  </p>
                  <ActionEditor
                    actions={current.onClick ?? []}
                    dsl={dsl}
                    pageId={pageId}
                    hint="Add a handler — run a query, notify, navigate, copy, or run JS."
                    onChange={(onClick) =>
                      patch(entry.kind, {
                        onClick: onClick.length > 0 ? onClick : undefined,
                      })
                    }
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
      {actions.length === 0 && (
        <p className="text-[10px] leading-snug text-slate-400">
          Pick at least one button, then add event handlers on the click.
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] font-medium text-slate-500">{label}</span>
      {children}
      {help && <span className="text-[10px] leading-snug text-slate-400">{help}</span>}
    </label>
  );
}
