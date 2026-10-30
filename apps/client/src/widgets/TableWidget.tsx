import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import type { ActionDsl } from '@swiftly/shared';
import type { RegisteredWidget, WidgetProps } from './types';
import { textStyleProperties, textStyleToCss } from './textStyle';
import { stateStyleProperties, stateStyleToCss } from './stateStyle';
import { formatValue } from './formatValue';
import { asRows, isRow, sourceDataError } from './coerce';
import {
  actionMeta,
  cellValue,
  isActionsColumn,
  normaliseColumns,
  resolveColumns,
  type TableColumnConfig,
  type TableRowAction,
} from './tableColumns';
import {
  emptyRowHint,
  ROW_SOURCE_PROPERTIES,
  rowSource,
  rowSourceConfigured,
} from './choiceSource';
import { PagerBar } from './PagerBar';
import { IconGlyph, hasIcon } from '@/icons/IconGlyph';

/**
 * The table.
 *
 * Rows are rendered here rather than by a table library, which is what makes the
 * virtualization possible: only the window on screen is ever in the DOM, so a
 * hundred thousand rows scroll at the speed of a hundred. Nothing upstream copies
 * the array either — the rows the query returned are the rows the table reads.
 *
 * Three ways to move through data, because they are genuinely different problems.
 * Scrolling suits a result you already hold. Client paging suits the same result
 * when people want stable pages to work through. Server paging is for the result
 * you cannot hold at all, and there the table stops pretending to know the total
 * and asks the query instead.
 */

const ROW_HEIGHT = 34;

type PagingMode = 'scroll' | 'client' | 'server';

function TableWidget({ properties, state, setState, fireEvent, isDesignMode }: WidgetProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState(-1);
  const [editing, setEditing] = useState<{ row: number; key: string } | null>(null);

  /* --- data ------------------------------------------------------- */

  const source = rowSource(properties);
  const sourceError = sourceDataError(source);
  const configured = rowSourceConfigured(properties);

  const rows = useMemo<Record<string, unknown>[]>(() => asRows(source), [source]);

  const pagingMode = String(properties.paging ?? 'scroll') as PagingMode;
  const pageSize = Math.max(1, Number(properties.pageSize ?? 25));

  /*
   * Server paging means the widget holds one page and nothing else, so it cannot
   * count the rows. The query has to say, and until it does the table reports
   * what it can see rather than inventing a total.
   */
  const serverTotal = Number(properties.totalRows);
  const totalKnown = pagingMode !== 'server' || Number.isFinite(serverTotal);
  const totalRows = totalKnown ? (pagingMode === 'server' ? serverTotal : rows.length) : rows.length;

  const columns = useMemo(() => {
    const configured = normaliseColumns(properties.columns);
    const sourceColumns = Array.isArray(properties.sourceColumns)
      ? properties.sourceColumns.filter((key): key is string => typeof key === 'string')
      : [];
    return resolveColumns(configured, rows[0], sourceColumns);
  }, [properties.columns, properties.sourceColumns, rows]);

  /*
   * Filtering and sorting are skipped entirely under server paging: the widget
   * is holding one page, so sorting it would order that page against itself and
   * filtering it would hide rows the server counted. Both belong in the query.
   */
  const serverPaged = pagingMode === 'server';

  const visibleRows = useMemo(() => {
    if (serverPaged) return rows;

    const needle = filter.trim().toLowerCase();
    let working = rows;

    if (needle !== '') {
      working = working.filter((row) =>
        columns.some(
          (column) =>
            !isActionsColumn(column) &&
            String(cellValue(row, column) ?? '').toLowerCase().includes(needle),
        ),
      );
    }

    if (sort) {
      // A copy only when sorting, and only of what survived the filter — the
      // unsorted path never allocates a second array.
      working = [...working].sort((left, right) => {
        const a = left[sort.key];
        const b = right[sort.key];
        if (a === b) return 0;
        if (a === undefined || a === null) return 1;
        if (b === undefined || b === null) return -1;
        const order =
          typeof a === 'number' && typeof b === 'number'
            ? a - b
            : String(a).localeCompare(String(b), undefined, { numeric: true });
        return sort.direction === 'asc' ? order : -order;
      });
    }

    return working;
  }, [rows, columns, filter, sort, serverPaged]);

  const pageCount =
    pagingMode === 'scroll'
      ? 1
      : totalKnown
        ? Math.max(1, Math.ceil(totalRows / pageSize))
        : page + (rows.length >= pageSize ? 2 : 1);

  // A filter that shortens the result must not leave the view on a page that no
  // longer exists.
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1);
  }, [page, pageCount]);

  const pageRows = useMemo(() => {
    if (pagingMode === 'scroll') return visibleRows;
    // Server paging is one page from the query. If the query still returned more
    // than pageSize (raw SQL that had its own unpaged SELECT), slice so Next
    // moves through what we hold instead of showing the same dump on every page.
    if (serverPaged && visibleRows.length <= pageSize) return visibleRows;
    const start = page * pageSize;
    return visibleRows.slice(start, start + pageSize);
  }, [visibleRows, pagingMode, serverPaged, page, pageSize]);

  /* --- what the rest of the app can read -------------------------- */

  const edits = isRow(state.edits) ? (state.edits as Record<string, Record<string, unknown>>) : {};

  useEffect(() => {
    const offset = page * pageSize;
    if (state.pageIndex !== page || state.pageSize !== pageSize || state.pageOffset !== offset) {
      setState({ pageIndex: page, pageSize, pageOffset: offset, pageCount });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, pageCount, state.pageIndex, state.pageSize, state.pageOffset]);

  const goToPage = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(next, 0), pageCount - 1);
      if (clamped === page) return;
      const offset = clamped * pageSize;
      setPage(clamped);
      // Written before fireEvent so {{ Table.pageOffset }} and the page-window
      // overlay both see the page the user just asked for, not the previous one.
      setState({ pageIndex: clamped, pageSize, pageOffset: offset, pageCount });
      fireEvent(
        'onPageChange',
        { pageIndex: clamped, pageSize, pageOffset: offset },
        pageChangeRefetch(properties, pagingMode),
      );
    },
    [page, pageCount, pageSize, fireEvent, setState, properties, pagingMode],
  );

  /* --- styling ---------------------------------------------------- */

  const rowHeight = Math.max(18, Number(properties.rowHeight ?? ROW_HEIGHT));
  const striped = properties.striped === true;

  const headerStyle: React.CSSProperties = {
    fontSize: 14,
    ...textStyleToCss(properties, 'header'),
    ...(readColour(properties, 'headerBackground')
      ? { background: readColour(properties, 'headerBackground') }
      : {}),
  };
  const rowTextStyle: React.CSSProperties = {
    fontSize: 14,
    ...textStyleToCss(properties, 'row'),
  };

  const selectedIndex = typeof state.selectedIndex === 'number' ? state.selectedIndex : -1;

  const rowBackground = (index: number, isSelected: boolean): string | undefined => {
    if (isSelected) return readColour(properties, 'rowSelectedBackground');
    if (index === hoveredIndex) return readColour(properties, 'rowHoverBackground');
    if (striped && index % 2 === 1) return readColour(properties, 'rowStripe');
    return readColour(properties, 'rowBackground');
  };

  /* --- virtualization --------------------------------------------- */

  const virtualizer = useVirtualizer({
    count: pageRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const paddingTop = virtualRows[0]?.start ?? 0;
  const paddingBottom =
    virtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0);

  /* --- editing ---------------------------------------------------- */

  const commitEdit = (rowIndex: number, column: TableColumnConfig, raw: string): void => {
    const original = pageRows[rowIndex];
    if (!original) return;

    const rowKey = String(properties.rowKey ?? '');
    const identity = rowKey !== '' ? String(original[rowKey]) : String(page * pageSize + rowIndex);

    const previous = cellValue(original, column);
    // Typed text stays text unless the cell held a number: a postcode that looks
    // numeric must not be turned into one on its way through an edit.
    const value = typeof previous === 'number' && raw.trim() !== '' && !Number.isNaN(Number(raw))
      ? Number(raw)
      : raw;

    setState({
      edits: { ...edits, [identity]: { ...(edits[identity] ?? {}), [column.key]: value } },
      lastEdit: { rowKey: identity, column: column.key, value, previous },
    });
    fireEvent('onCellEdit', { rowKey: identity, column: column.key, value, previous, row: original });
    setEditing(null);
  };

  const editedValue = (rowIndex: number, column: TableColumnConfig): unknown => {
    const original = pageRows[rowIndex];
    if (!original) return undefined;
    const rowKey = String(properties.rowKey ?? '');
    const identity = rowKey !== '' ? String(original[rowKey]) : String(page * pageSize + rowIndex);
    const edit = edits[identity];
    return edit && column.key in edit ? edit[column.key] : cellValue(original, column);
  };

  const rowIdentity = (row: Record<string, unknown>, index: number): string => {
    const rowKey = String(properties.rowKey ?? '');
    return rowKey !== '' ? String(row[rowKey]) : String(page * pageSize + index);
  };

  const runRowAction = (action: TableRowAction, row: Record<string, unknown>, index: number): void => {
    if (isDesignMode) return;
    const rowKey = rowIdentity(row, index);
    setState({
      selectedIndex: index,
      selectedRow: row,
      lastAction: { kind: action.kind, rowKey, index, row },
    });

    if (action.kind === 'download') downloadFromRow(row, action);

    const meta = actionMeta(action.kind);
    fireEvent(
      meta.event,
      {
        row,
        index,
        rowKey,
        currentRow: row,
        action: action.kind,
        label: action.label ?? meta.label,
      },
      action.onClick,
    );
  };

  /* --- render ------------------------------------------------------ */

  const pagerAtTop = properties.pagerPosition === 'top';
  const pager =
    pagingMode === 'scroll' ? null : (
      <PagerBar
        page={page}
        pageCount={pageCount}
        pageLength={pageRows.length}
        pageSize={pageSize}
        totalRows={totalRows}
        totalKnown={totalKnown}
        properties={properties}
        onGo={goToPage}
        align={String(properties.pagerAlign ?? 'right')}
      />
    );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded border border-slate-200 bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-2 py-1.5">
        <span className="min-w-0 truncate text-sm font-medium text-slate-600">
          {String(properties.title ?? '')}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-sm tabular-nums text-slate-400">
            {totalKnown
              ? `${totalRows.toLocaleString()} rows`
              : `${rows.length.toLocaleString()} this page`}
          </span>
          {properties.searchable !== false && !serverPaged && (
            <input
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setPage(0);
              }}
              placeholder="Search"
              className="w-32 rounded border border-slate-300 px-2 py-0.5 text-sm outline-none focus:border-blue-500"
            />
          )}
        </div>
      </div>

      {pagerAtTop && pager}

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50" style={headerStyle}>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  style={{
                    width: column.width,
                    textAlign: column.align ?? 'left',
                    ...headerStyle,
                    background: undefined,
                  }}
                  onClick={() => {
                    if (serverPaged || column.source === 'static' || isActionsColumn(column)) return;
                    setSort((current) =>
                      current?.key === column.key
                        ? current.direction === 'asc'
                          ? { key: column.key, direction: 'desc' }
                          : null
                        : { key: column.key, direction: 'asc' },
                    );
                  }}
                  className={clsx(
                    'border-b border-slate-200 px-2 py-1.5 text-sm font-semibold text-slate-600 select-none',
                    !serverPaged &&
                      column.source !== 'static' &&
                      !isActionsColumn(column) &&
                      'cursor-pointer hover:bg-slate-100',
                  )}
                >
                  {column.label ?? column.key}
                  {sort?.key === column.key ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {paddingTop > 0 && <tr style={{ height: paddingTop }} />}

            {virtualRows.map((virtualRow) => {
              const row = pageRows[virtualRow.index];
              if (!row) return null;
              const isSelected = virtualRow.index === selectedIndex;

              return (
                <tr
                  key={virtualRow.key}
                  style={{
                    height: rowHeight,
                    ...rowTextStyle,
                    ...(isSelected ? stateStyleToCss(properties, 'rowSelected') : {}),
                    ...(virtualRow.index === hoveredIndex
                      ? stateStyleToCss(properties, 'rowHover')
                      : {}),
                    background: rowBackground(virtualRow.index, isSelected),
                  }}
                  onMouseEnter={() => setHoveredIndex(virtualRow.index)}
                  onMouseLeave={() =>
                    setHoveredIndex((current) => (current === virtualRow.index ? -1 : current))
                  }
                  onClick={() => {
                    if (isDesignMode) return;
                    setState({ selectedIndex: virtualRow.index, selectedRow: row });
                    fireEvent('onRowSelect', { row, index: virtualRow.index });
                  }}
                  className={clsx(
                    'cursor-pointer border-b border-slate-100',
                    isSelected ? 'bg-blue-50' : 'hover:bg-slate-50',
                  )}
                >
                  {columns.map((column) => {
                    if (isActionsColumn(column)) {
                      return (
                        <td
                          key={column.key}
                          style={{
                            width: column.width,
                            textAlign: column.align ?? 'right',
                          }}
                          className="whitespace-nowrap px-2 py-1 text-sm"
                        >
                          <RowActionButtons
                            actions={column.actions ?? []}
                            disabled={isDesignMode}
                            onAction={(action) =>
                              runRowAction(action, row, virtualRow.index)
                            }
                          />
                        </td>
                      );
                    }

                    const isEditing =
                      editing?.row === virtualRow.index && editing.key === column.key;
                    const raw = editedValue(virtualRow.index, column);

                    return (
                      <td
                        key={column.key}
                        onDoubleClick={() => {
                          if (!isDesignMode && column.editable) {
                            setEditing({ row: virtualRow.index, key: column.key });
                          }
                        }}
                        style={{
                          maxWidth: column.width,
                          textAlign: column.align ?? 'left',
                          color: 'inherit',
                          font: 'inherit',
                        }}
                        className={clsx(
                          'truncate px-2 py-1 text-sm text-slate-700',
                          column.editable && !isDesignMode && 'cursor-text',
                        )}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            defaultValue={raw === undefined || raw === null ? '' : String(raw)}
                            onClick={(event) => event.stopPropagation()}
                            onBlur={(event) =>
                              commitEdit(virtualRow.index, column, event.target.value)
                            }
                            onKeyDown={(event) => {
                              // Committed here rather than by blurring and
                              // letting the blur handler do it: asking the
                              // element to blur only works if it is focused,
                              // and Enter then did nothing at all.
                              if (event.key === 'Enter') {
                                commitEdit(virtualRow.index, column, event.currentTarget.value);
                              }
                              // Escape abandons the edit: a cell that committed
                              // on the way out would make cancelling impossible.
                              if (event.key === 'Escape') setEditing(null);
                            }}
                            className="w-full rounded border border-blue-500 px-1 py-0 text-inherit outline-none"
                          />
                        ) : (
                          formatValue(raw, column)
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {paddingBottom > 0 && <tr style={{ height: paddingBottom }} />}
          </tbody>
        </table>

        {pageRows.length === 0 && (
          <div className="flex h-24 items-center justify-center px-3 text-center text-sm text-slate-400">
            {properties.sourceLoading ? (
              'Loading…'
            ) : typeof properties.queryError === 'string' && properties.queryError ? (
              <span className="text-red-600">{properties.queryError}</span>
            ) : sourceError ? (
              <span className="text-red-600">{sourceError}</span>
            ) : configured ? (
              'No rows'
            ) : (
              emptyRowHint(properties)
            )}
          </div>
        )}
        {pageRows.length > 0 && columns.length === 0 && (
          <div className="flex h-24 items-center justify-center px-3 text-center text-sm text-slate-400">
            {isDesignMode
              ? 'Every column is hidden. Show one from Columns in the property panel.'
              : 'No columns to show.'}
          </div>
        )}
      </div>

      {!pagerAtTop && pager}
    </div>
  );
}

function RowActionButtons({
  actions,
  disabled,
  onAction,
}: {
  actions: TableRowAction[];
  disabled: boolean;
  onAction: (action: TableRowAction) => void;
}) {
  if (actions.length === 0) {
    return <span className="text-sm text-slate-300">—</span>;
  }

  return (
    <div className="flex items-center justify-end gap-0.5">
      {actions.map((action) => {
        const meta = actionMeta(action.kind);
        const iconName = action.icon === undefined ? meta.icon : action.icon;
        const glyph = hasIcon(iconName);
        const explicit =
          typeof action.label === 'string' && action.label.trim() !== '' ? action.label.trim() : '';
        const matchesDefault = explicit.toLowerCase() === meta.label.toLowerCase();
        const caption = glyph
          ? explicit && !matchesDefault
            ? explicit
            : ''
          : explicit || meta.label;
        const name = explicit || meta.label;
        return (
          <button
            key={action.kind}
            type="button"
            disabled={disabled}
            title={name}
            aria-label={name}
            onClick={(event) => {
              event.stopPropagation();
              if (!disabled) onAction(action);
            }}
            className={clsx(
              'no-drag inline-flex items-center justify-center gap-1 rounded text-sm font-medium',
              glyph && !caption ? 'h-7 w-7 p-0' : 'px-1.5 py-0.5',
              action.kind === 'delete'
                ? 'text-red-600 hover:bg-red-50'
                : action.kind === 'edit'
                  ? 'text-blue-700 hover:bg-blue-50'
                  : 'text-slate-700 hover:bg-slate-100',
              disabled && 'cursor-default opacity-70',
            )}
          >
            {glyph ? <IconGlyph name={iconName} size={14} className="shrink-0" /> : null}
            {caption ? <span>{caption}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function downloadFromRow(row: Record<string, unknown>, action: TableRowAction): void {
  const raw = action.downloadKey ? row[action.downloadKey] : undefined;
  if (raw === undefined || raw === null || raw === '') return;

  const fileName =
    (action.fileNameKey && row[action.fileNameKey] != null
      ? String(row[action.fileNameKey])
      : '') || 'download';

  if (typeof raw === 'string' && /^(https?:|blob:|data:)/i.test(raw.trim())) {
    const anchor = document.createElement('a');
    anchor.href = raw.trim();
    anchor.download = fileName;
    anchor.target = '_blank';
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return;
  }

  const body = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
  const blob = new Blob([body], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function readColour(properties: Record<string, unknown>, key: string): string | undefined {
  const value = properties[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function boundSourceQuery(properties: Record<string, unknown>): string {
  if (properties.sourceKind !== 'query') return '';
  return typeof properties.sourceQuery === 'string' ? properties.sourceQuery.trim() : '';
}

function actionsRunQuery(actions: unknown, queryName: string): boolean {
  if (!Array.isArray(actions) || queryName === '') return false;
  return actions.some(
    (action) =>
      action !== null &&
      typeof action === 'object' &&
      (action as ActionDsl).type === 'runQuery' &&
      (action as { queryName?: string }).queryName === queryName,
  );
}

function pageChangeRefetch(
  properties: Record<string, unknown>,
  pagingMode: string,
): ActionDsl[] {
  if (pagingMode !== 'server') return [];
  const queryName = boundSourceQuery(properties);
  if (!queryName || actionsRunQuery(properties.onPageChange, queryName)) return [];
  return [{ type: 'runQuery', queryName }];
}

const WHEN_PAGED = { key: 'paging', oneOf: ['client', 'server'] };

export const tableWidget: RegisteredWidget = {
  component: TableWidget,
  definition: {
    type: 'table',
    displayName: 'Table',
    category: 'data',
    icon: 'table',
    defaultLayout: { x: 0, y: 0, w: 12, h: 10 },
    minSize: { w: 4, h: 4 },
    events: [
      { key: 'onRowSelect', label: 'On row select', payloadKeys: ['row', 'index'] },
      { key: 'onPageChange', label: 'On page change', payloadKeys: ['pageIndex', 'pageSize', 'pageOffset'] },
      { key: 'onCellEdit', label: 'On cell edit', payloadKeys: ['rowKey', 'column', 'value', 'previous', 'row'] },
      { key: 'onRowEdit', label: 'On row edit', payloadKeys: ['row', 'index', 'rowKey'] },
      { key: 'onRowDelete', label: 'On row delete', payloadKeys: ['row', 'index', 'rowKey'] },
      { key: 'onRowDownload', label: 'On row download', payloadKeys: ['row', 'index', 'rowKey'] },
    ],
    exposedState: [
      { key: 'selectedRow', type: 'object', description: 'The row the user clicked' },
      { key: 'selectedIndex', type: 'number', description: 'Index of the selected row' },
      { key: 'pageIndex', type: 'number', description: 'Current page, counting from zero' },
      { key: 'pageSize', type: 'number', description: 'Rows per page' },
      { key: 'pageOffset', type: 'number', description: 'Rows before this page — bind to a query OFFSET' },
      { key: 'pageCount', type: 'number', description: 'How many pages there are' },
      { key: 'edits', type: 'object', description: 'Every edited cell, keyed by row' },
      { key: 'lastEdit', type: 'object', description: 'The most recent cell edit' },
      { key: 'lastAction', type: 'object', description: 'The last Edit / Delete / Download click' },
    ],
    properties: [
      {
        name: 'Data',
        properties: [
          ...ROW_SOURCE_PROPERTIES,
          {
            key: 'columns',
            label: 'Columns',
            control: 'column_config',
            expectedType: 'array',
            bindable: false,
            helpText: 'Hide a column to keep it out of the table without dropping it from the data.',
          },
          {
            key: 'rowKey',
            label: 'Row identifier',
            control: 'text',
            expectedType: 'string',
            bindable: false,
            helpText: 'Column holding a stable id. Edits are keyed by it; without one they are keyed by position and will follow the wrong row once the data reorders.',
          },
        ],
      },
      {
        name: 'Paging',
        properties: [
          {
            key: 'paging',
            label: 'Move through rows by',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'scroll',
            options: [
              { value: 'scroll', label: 'Scrolling — virtualized' },
              { value: 'client', label: 'Pages, from loaded rows' },
              { value: 'server', label: 'Pages, fetched per page' },
            ],
            helpText:
              'Fetched per page re-runs the bound query for each page. Bind Total rows if you know the count; otherwise Next stays available while a full page comes back.',
          },
          {
            key: 'pageSize',
            label: 'Rows per page',
            control: 'number',
            expectedType: 'number',
            bindable: true,
            defaultValue: 25,
            visibleWhen: WHEN_PAGED,
          },
          {
            key: 'totalRows',
            label: 'Total rows',
            control: 'text',
            expectedType: 'number',
            bindable: true,
            helpText:
              'Bind to the count from your query, e.g. {{ CountOrders.data[0].total }}. Optional — without it Next stays enabled while a full page comes back.',
            visibleWhen: { key: 'paging', equals: 'server' },
          },
          {
            key: 'pagerPosition',
            label: 'Pager position',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'bottom',
            options: [
              { value: 'bottom', label: 'Below the rows' },
              { value: 'top', label: 'Above the rows' },
            ],
            visibleWhen: WHEN_PAGED,
          },
          {
            key: 'pagerAlign',
            label: 'Pager alignment',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'right',
            options: [
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Centre' },
              { value: 'right', label: 'Right' },
            ],
            visibleWhen: WHEN_PAGED,
          },
          {
            key: 'pagerShowRange',
            label: 'Show the row range',
            control: 'toggle',
            expectedType: 'boolean',
            bindable: false,
            defaultValue: true,
            visibleWhen: WHEN_PAGED,
          },
        ],
      },
      {
        name: 'Appearance',
        properties: [
          { key: 'title', label: 'Title', control: 'text', expectedType: 'string', bindable: true },
          { key: 'searchable', label: 'Search box', control: 'toggle', expectedType: 'boolean', bindable: false, defaultValue: true },
          {
            key: 'rowHeight',
            label: 'Row height',
            control: 'number',
            expectedType: 'number',
            bindable: false,
            defaultValue: ROW_HEIGHT,
            helpText: 'Pixels. Denser rows fit more on a screen.',
          },
          {
            key: 'striped',
            label: 'Striped rows',
            control: 'toggle',
            expectedType: 'boolean',
            bindable: false,
            defaultValue: false,
          },
        ],
      },
      { name: 'Header font', properties: textStyleProperties('header', { fontSize: 14 }) },
      {
        name: 'Header background',
        properties: [
          { key: 'headerBackground', label: 'Background', control: 'color', expectedType: 'string', bindable: false },
        ],
      },
      { name: 'Row font', properties: textStyleProperties('row', { fontSize: 14 }) },
      {
        name: 'Row background',
        properties: [
          { key: 'rowBackground', label: 'Background', control: 'color', expectedType: 'string', bindable: false },
          {
            key: 'rowStripe',
            label: 'Every other row',
            control: 'color',
            expectedType: 'string',
            bindable: false,
            visibleWhen: { key: 'striped', equals: true },
          },
        ],
      },
      { name: 'Row hover', properties: stateStyleProperties('rowHover') },
      { name: 'Row selected', properties: stateStyleProperties('rowSelected') },
      {
        name: 'Pager font',
        properties: textStyleProperties('pager').map((property) => ({
          ...property,
          visibleWhen: WHEN_PAGED,
        })),
      },
      {
        name: 'Pager colours',
        properties: [
          {
            key: 'pagerBackground',
            label: 'Bar background',
            control: 'color',
            expectedType: 'string',
            bindable: false,
            visibleWhen: WHEN_PAGED,
          },
          ...stateStyleProperties('pagerButton', { visibleWhen: WHEN_PAGED }),
        ],
      },
      {
        name: 'Behaviour',
        properties: [
          { key: 'onRowSelect', label: 'On row select', control: 'action_list', expectedType: 'any', bindable: false },
          { key: 'onPageChange', label: 'On page change', control: 'action_list', expectedType: 'any', bindable: false, visibleWhen: WHEN_PAGED },
          { key: 'onCellEdit', label: 'On cell edit', control: 'action_list', expectedType: 'any', bindable: false },
          {
            key: 'onRowEdit',
            label: 'On row edit',
            control: 'action_list',
            expectedType: 'any',
            bindable: false,
            helpText:
              'Also fired after an Edit button’s own event handlers. The row is event.row.',
          },
          {
            key: 'onRowDelete',
            label: 'On row delete',
            control: 'action_list',
            expectedType: 'any',
            bindable: false,
            helpText:
              'Also fired after a Delete button’s own event handlers. The row is event.row.',
          },
          {
            key: 'onRowDownload',
            label: 'On row download',
            control: 'action_list',
            expectedType: 'any',
            bindable: false,
            helpText:
              'Also fired after a Download button’s own event handlers. A file column still saves immediately.',
          },
        ],
      },
    ],
  },
};
