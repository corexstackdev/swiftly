import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import type { ApplicationDsl, ColumnMetadata, DbSchema, TableMetadata } from '@swiftly/shared';
import {
  api,
  type DatasourceSummary,
  type PluginInfo,
} from '@/lib/api';
import { formatError } from '@/data/columnTypes';
import { control } from './controls';
import { ChoiceSourceEditor } from './ChoiceSourceEditor';
import {
  FORM_FIELD_WIDGETS,
  defaultChoiceSource,
  type FormChoiceSource,
  type FormColumnChoice,
  type FormFieldWidgetType,
  labelForWidgetType,
  mapColumnToFormChoice,
  prettyTableTitle,
} from './formImport';

export interface FormImportRequest {
  datasourceId: string;
  schema: string;
  table: string;
  tableTitle: string;
  replaceExisting: boolean;
  fields: Array<{
    column: ColumnMetadata;
    widgetType: FormFieldWidgetType;
    choiceSource?: FormChoiceSource;
  }>;
}

export interface FormImportSource {
  datasourceId: string;
  schema: string;
  table: string;
}

/**
 * Generate a form from a database table.
 *
 * Dropping controls by hand is still available; this is the other path. Pick a
 * table, tick the columns that belong on the form, and each one becomes the
 * matching input — a date column a DatePicker, a boolean a Switch, and so on.
 */
export function FormTableImportDialog({
  formName,
  hasExistingFields,
  datasources,
  environmentId,
  dsl,
  pageId,
  initialSource,
  onClose,
  onImport,
}: {
  formName: string;
  hasExistingFields: boolean;
  datasources: DatasourceSummary[];
  environmentId: string;
  dsl: ApplicationDsl;
  pageId: string;
  initialSource?: FormImportSource | null;
  onClose: () => void;
  onImport: (request: FormImportRequest) => void;
}) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [datasourceId, setDatasourceId] = useState(initialSource?.datasourceId ?? '');
  const [schema, setSchema] = useState<DbSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<{ schema: string; table: string } | null>(
    initialSource ? { schema: initialSource.schema, table: initialSource.table } : null,
  );
  const [choices, setChoices] = useState<FormColumnChoice[]>([]);
  const [replaceExisting, setReplaceExisting] = useState(false);

  useEffect(() => {
    void api.datasources.plugins().then(setPlugins).catch(() => setPlugins([]));
  }, []);

  const introspectable = useMemo(() => {
    if (plugins.length === 0) return datasources;
    return datasources.filter((datasource) => {
      const plugin = plugins.find((candidate) => candidate.id === datasource.pluginId);
      return plugin?.capabilities.introspection;
    });
  }, [datasources, plugins]);

  useEffect(() => {
    if (datasourceId && introspectable.some((entry) => entry.id === datasourceId)) return;
    const fallback =
      introspectable.find((entry) => entry.id === initialSource?.datasourceId) ?? introspectable[0];
    setDatasourceId(fallback?.id ?? '');
  }, [datasourceId, initialSource?.datasourceId, introspectable]);

  useEffect(() => {
    if (!datasourceId || !environmentId) {
      setSchema(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api.datasources
      .schema(datasourceId, environmentId, false)
      .then((next) => {
        if (cancelled) return;
        setSchema(next);
      })
      .catch((caught) => {
        if (cancelled) return;
        setSchema(null);
        setError(formatError(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [datasourceId, environmentId]);

  const tables = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows: { schema: string; table: TableMetadata }[] = [];
    for (const namespace of schema?.schemas ?? []) {
      for (const table of namespace.tables) {
        const haystack = `${namespace.name}.${table.name}`.toLowerCase();
        if (needle && !haystack.includes(needle)) continue;
        rows.push({ schema: namespace.name, table });
      }
    }
    return rows;
  }, [schema, search]);

  const selectedTable = useMemo(() => {
    if (!selected) return null;
    return (
      tables.find(
        (entry) => entry.schema === selected.schema && entry.table.name === selected.table,
      ) ?? null
    );
  }, [selected, tables]);

  useEffect(() => {
    if (!selectedTable) {
      setChoices([]);
      return;
    }
    setChoices(selectedTable.table.columns.map(mapColumnToFormChoice));
  }, [selectedTable]);

  const selectedCount = choices.filter((choice) => choice.selected).length;

  const submit = (): void => {
    if (!datasourceId || !selectedTable) return;
    const fields = choices
      .filter((choice) => choice.selected)
      .map((choice) => ({
        column: choice.column,
        widgetType: choice.widgetType,
        choiceSource:
          choice.widgetType === 'select'
            ? (choice.choiceSource ?? defaultChoiceSource())
            : undefined,
      }));
    if (fields.length === 0) return;
    onImport({
      datasourceId,
      schema: selectedTable.schema,
      table: selectedTable.table.name,
      tableTitle: prettyTableTitle(selectedTable.table.name),
      replaceExisting,
      fields,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Import table into ${formName}`}
        className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
      >
        <div className="shrink-0 border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Import from table</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Choose a table, then the columns {formName} should show. Pick Select when a column is a
            list of choices, and fill its options the same way as a normal Select.
          </p>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[14rem_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-r border-slate-100">
            <div className="shrink-0 space-y-2 p-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-slate-600">Datasource</span>
                <select
                  className={control}
                  value={datasourceId}
                  onChange={(event) => {
                    setDatasourceId(event.target.value);
                    setSelected(null);
                  }}
                >
                  {introspectable.length === 0 && <option value="">No database datasources</option>}
                  {introspectable.map((datasource) => (
                    <option key={datasource.id} value={datasource.id}>
                      {datasource.name}
                    </option>
                  ))}
                </select>
              </label>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search tables"
                className={control}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
              {loading && <p className="px-2 py-3 text-xs text-slate-400">Reading schema…</p>}
              {error && <p className="mx-1 rounded bg-red-50 px-2 py-1.5 text-xs text-red-700">{error}</p>}
              {!loading && !error && tables.length === 0 && (
                <p className="px-2 py-3 text-xs text-slate-400">
                  {search ? `No tables match “${search}”` : 'No tables in this datasource'}
                </p>
              )}
              {tables.map((entry) => {
                const active =
                  selected?.schema === entry.schema && selected.table === entry.table.name;
                return (
                  <button
                    key={`${entry.schema}.${entry.table.name}`}
                    type="button"
                    onClick={() =>
                      setSelected({ schema: entry.schema, table: entry.table.name })
                    }
                    className={clsx(
                      'mb-0.5 flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs',
                      active ? 'bg-blue-50 text-blue-800' : 'text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    <span className="min-w-0 truncate font-mono">
                      {entry.schema}.{entry.table.name}
                    </span>
                    {entry.table.kind === 'view' && (
                      <span className="ml-2 shrink-0 text-[10px] tracking-wide text-slate-400 uppercase">
                        view
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="flex min-h-0 flex-col">
            {!selectedTable ? (
              <div className="flex flex-1 items-center justify-center p-6 text-center">
                <p className="max-w-xs text-xs text-slate-400">
                  Select a table to see its columns. Untick any you do not want on the form.
                </p>
              </div>
            ) : (
              <>
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
                  <p className="text-xs font-medium text-slate-700">
                    {selectedTable.schema}.{selectedTable.table.name}
                    <span className="ml-2 font-normal text-slate-400">
                      {selectedCount} of {choices.length} columns
                    </span>
                  </p>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="rounded px-1.5 py-1 text-[11px] text-slate-500 hover:bg-slate-100"
                      onClick={() =>
                        setChoices((current) =>
                          current.map((choice) => ({
                            ...choice,
                            selected: !(choice.column.isIdentity || choice.column.isPrimaryKey),
                          })),
                        )
                      }
                    >
                      Recommended
                    </button>
                    <button
                      type="button"
                      className="rounded px-1.5 py-1 text-[11px] text-slate-500 hover:bg-slate-100"
                      onClick={() =>
                        setChoices((current) => current.map((choice) => ({ ...choice, selected: true })))
                      }
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className="rounded px-1.5 py-1 text-[11px] text-slate-500 hover:bg-slate-100"
                      onClick={() =>
                        setChoices((current) =>
                          current.map((choice) => ({ ...choice, selected: false })),
                        )
                      }
                    >
                      None
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-white text-[10px] tracking-wide text-slate-400 uppercase">
                      <tr>
                        <th className="w-8 px-3 py-2 font-medium" />
                        <th className="px-2 py-2 font-medium">Column</th>
                        <th className="px-2 py-2 font-medium">Type</th>
                        <th className="w-40 px-2 py-2 font-medium">Control</th>
                      </tr>
                    </thead>
                    <tbody>
                      {choices.map((choice, index) => (
                        <ChoiceRow
                          key={choice.column.name}
                          choice={choice}
                          dsl={dsl}
                          pageId={pageId}
                          onToggle={(selected) =>
                            setChoices((current) =>
                              current.map((entry, at) =>
                                at === index ? { ...entry, selected } : entry,
                              ),
                            )
                          }
                          onWidgetType={(widgetType) =>
                            setChoices((current) =>
                              current.map((entry, at) =>
                                at === index
                                  ? {
                                      ...entry,
                                      widgetType,
                                      choiceSource:
                                        widgetType === 'select'
                                          ? (entry.choiceSource ?? defaultChoiceSource())
                                          : entry.choiceSource,
                                    }
                                  : entry,
                              ),
                            )
                          }
                          onChoiceSource={(choiceSource) =>
                            setChoices((current) =>
                              current.map((entry, at) =>
                                at === index ? { ...entry, choiceSource } : entry,
                              ),
                            )
                          }
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
          {hasExistingFields ? (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-blue-600"
                checked={replaceExisting}
                onChange={(event) => setReplaceExisting(event.target.checked)}
              />
              Replace existing fields
            </label>
          ) : (
            <span className="text-[11px] text-slate-400">
              {selectedTable
                ? `Selected columns become ${labelForWidgetType('input').toLowerCase()}s, dates, numbers, or selects…`
                : 'You can keep dragging controls onto the form after this.'}
            </span>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={selectedCount === 0}
              onClick={submit}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Add {selectedCount || ''} {selectedCount === 1 ? 'field' : 'fields'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChoiceRow({
  choice,
  dsl,
  pageId,
  onToggle,
  onWidgetType,
  onChoiceSource,
}: {
  choice: FormColumnChoice;
  dsl: ApplicationDsl;
  pageId: string;
  onToggle: (selected: boolean) => void;
  onWidgetType: (widgetType: FormFieldWidgetType) => void;
  onChoiceSource: (choiceSource: FormChoiceSource) => void;
}) {
  const showOptions = choice.widgetType === 'select';
  return (
    <>
      <tr
        className={clsx(
          'border-t border-slate-100',
          choice.selected ? 'bg-white' : 'bg-slate-50 text-slate-400',
        )}
      >
        <td className="px-3 py-1.5">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-blue-600"
            checked={choice.selected}
            onChange={(event) => onToggle(event.target.checked)}
          />
        </td>
        <td className="px-2 py-1.5">
          <div className="font-mono text-slate-800">{choice.column.name}</div>
          <div className="text-[10px] text-slate-400">
            {choice.label}
            {choice.column.isPrimaryKey ? ' · primary key' : ''}
            {choice.column.isIdentity ? ' · identity' : ''}
            {choice.column.nullable === false ? ' · required' : ''}
          </div>
        </td>
        <td className="px-2 py-1.5 font-mono text-slate-500">{choice.column.dataType}</td>
        <td className="px-2 py-1.5">
          <ControlTypePicker
            value={choice.widgetType}
            disabled={!choice.selected}
            onChange={onWidgetType}
          />
        </td>
      </tr>
      {showOptions && (
        <tr className={clsx(choice.selected ? 'bg-white' : 'bg-slate-50')}>
          <td className="px-3 pb-3" />
          <td colSpan={3} className="px-2 pb-3">
            <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
              <p className="mb-2 text-[10px] font-medium tracking-wide text-slate-500 uppercase">
                Select options
              </p>
              <ChoiceSourceEditor
                value={choice.choiceSource ?? defaultChoiceSource()}
                dsl={dsl}
                pageId={pageId}
                disabled={!choice.selected}
                onChange={onChoiceSource}
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Native <select> lists are clipped by the dialog’s overflow:auto, so Select
 * (and anything below Date) never made it onto the screen. This menu renders
 * in a portal above the dialog.
 */
function ControlTypePicker({
  value,
  disabled,
  onChange,
}: {
  value: FormFieldWidgetType;
  disabled?: boolean;
  onChange: (widgetType: FormFieldWidgetType) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 176 });

  useEffect(() => {
    if (!open) return;

    const place = (): void => {
      const anchor = buttonRef.current;
      const menu = menuRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const menuHeight = menu?.offsetHeight ?? FORM_FIELD_WIDGETS.length * 32;
      const width = Math.max(rect.width, 176);
      let top = rect.bottom + 4;
      let left = rect.left;
      if (top + menuHeight > window.innerHeight - 8) {
        top = Math.max(8, rect.top - menuHeight - 4);
      }
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - width - 8);
      }
      setPos({ top, left, width });
    };

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Control: ${labelForWidgetType(value)}`}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          const rect = buttonRef.current?.getBoundingClientRect();
          if (rect) {
            setPos({
              top: rect.bottom + 4,
              left: rect.left,
              width: Math.max(rect.width, 176),
            });
          }
          setOpen(true);
        }}
        className={clsx(control, 'relative flex min-w-[10rem] items-center justify-between gap-2 pr-6 text-left')}
      >
        <span className="truncate">{labelForWidgetType(value)}</span>
        <span aria-hidden="true" className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[8px] text-slate-400">
          ▼
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label="Control"
            style={{ top: pos.top, left: pos.left, width: pos.width }}
            className="fixed z-[90] overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg"
          >
            {FORM_FIELD_WIDGETS.map((widget) => {
              const active = widget.type === value;
              return (
                <button
                  key={widget.type}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(widget.type);
                    setOpen(false);
                  }}
                  className={clsx(
                    'flex w-full flex-col px-2.5 py-1.5 text-left text-xs',
                    active ? 'bg-blue-50 text-blue-800' : 'text-slate-800 hover:bg-slate-50',
                  )}
                >
                  <span className="font-medium">{widget.label}</span>
                  {widget.type === 'select' && (
                    <span className="text-[10px] font-normal text-slate-500">
                      Options from JSON, JavaScript, or a query
                    </span>
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
