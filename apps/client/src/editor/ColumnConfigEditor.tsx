import { useState } from 'react';
import clsx from 'clsx';
import { control, controlCompact, dashedButton, ghostButton, Select } from './controls';
import { normaliseColumns, type TableColumnConfig } from '@/widgets/tableColumns';

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
  onChange,
}: {
  value: unknown;
  availableKeys: string[];
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

  const missing = availableKeys.filter((key) => !columns.some((column) => column.key === key));

  if (columns.length === 0) {
    return (
      <div className="no-drag flex flex-col gap-1.5">
        <p className="text-[11px] leading-snug text-slate-400">
          Showing every column the query returns. Take control of them to rename, reorder,
          resize, format, hide, or make them editable.
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

                {column.source === 'static' && (
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
