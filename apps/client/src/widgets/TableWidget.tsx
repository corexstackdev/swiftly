import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import type { RegisteredWidget, WidgetProps } from './types';
import { textStyleProperties, textStyleToCss } from './textStyle';
import { stateStyleProperties, stateStyleToCss } from './stateStyle';
import { formatValue } from './formatValue';
import { asRows, isRow, sourceDataError } from './coerce';
import {
  cellValue,
  normaliseColumns,
  resolveColumns,
  type TableColumnConfig,
} from './tableColumns';
import {
  emptyRowHint,
  ROW_SOURCE_PROPERTIES,
  rowSource,
  rowSourceConfigured,
} from './choiceSource';

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

/**
 * What an unbound table shows while it is being designed.
 *
 * A table with nothing in it cannot be styled: the header colours, the row font,
 * the stripe and the selection are all invisible against no rows. Design mode
 * only, and never when `data` has been set — an empty result is real information.
 */
const SAMPLE_ROWS: Record<string, unknown>[] = [
  { id: 1041, customer: 'Fabrikam', region: 'APAC', status: 'Shipped', total: 2310.75, placed: '2026-09-18' },
  { id: 1042, customer: 'Northwind Traders', region: 'EMEA', status: 'Picking', total: 1250, placed: '2026-09-19' },
  { id: 1043, customer: 'Contoso', region: 'EMEA', status: 'Shipped', total: 890.5, placed: '2026-09-19' },
  { id: 1044, customer: 'Tailspin Toys', region: 'AMER', status: 'On hold', total: 430, placed: '2026-09-20' },
  { id: 1045, customer: 'Litware', region: 'APAC', status: 'Draft', total: 77.25, placed: '2026-09-21' },
];

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
  const showingSample = !configured && isDesignMode;

  // Memoised on the raw property: `asRows` must not run per render, and its
  // result must keep the same identity so nothing downstream recomputes.
  const rows = useMemo<Record<string, unknown>[]>(
    () => (showingSample ? SAMPLE_ROWS : asRows(source)),
    [showingSample, source],
  );

  const pagingMode = String(properties.paging ?? 'scroll') as PagingMode;
  const pageSize = Math.max(1, Number(properties.pageSize ?? 25));

  /*
   * Server paging means the widget holds one page and nothing else, so it cannot
   * count the rows. The query has to say, and until it does the table reports
   * what it can see rather than inventing a total.
   */
  const serverTotal = Number(properties.totalRows);
  const totalRows =
    pagingMode === 'server' && Number.isFinite(serverTotal) ? serverTotal : rows.length;

  const columns = useMemo(() => {
    const configured = normaliseColumns(properties.columns);
    return resolveColumns(configured, rows[0]);
  }, [properties.columns, rows]);

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
        columns.some((column) =>
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
    pagingMode === 'scroll' ? 1 : Math.max(1, Math.ceil(totalRows / pageSize));

  // A filter that shortens the result must not leave the view on a page that no
  // longer exists.
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1);
  }, [page, pageCount]);

  const pageRows = useMemo(() => {
    if (pagingMode === 'scroll' || serverPaged) return visibleRows;
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
      setPage(clamped);
      // Fired so a server-paged query can re-run on the new offset.
      fireEvent('onPageChange', {
        pageIndex: clamped,
        pageSize,
        pageOffset: clamped * pageSize,
      });
    },
    [page, pageCount, pageSize, fireEvent],
  );

  /* --- styling ---------------------------------------------------- */

  const rowHeight = Math.max(18, Number(properties.rowHeight ?? ROW_HEIGHT));
  const striped = properties.striped === true;

  const headerStyle: React.CSSProperties = {
    ...textStyleToCss(properties, 'header'),
    ...(readColour(properties, 'headerBackground')
      ? { background: readColour(properties, 'headerBackground') }
      : {}),
  };
  const rowTextStyle = textStyleToCss(properties, 'row');

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

  /* --- render ------------------------------------------------------ */

  const pagerAtTop = properties.pagerPosition === 'top';
  const pager =
    pagingMode === 'scroll' ? null : (
      <Pager
        page={page}
        pageCount={pageCount}
        totalRows={totalRows}
        properties={properties}
        onGo={goToPage}
      />
    );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded border border-slate-200 bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-2 py-1.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-medium text-slate-600">
            {String(properties.title ?? '')}
          </span>
          {showingSample && (
            <span
              title="Placeholder rows so the table can be styled. They disappear once Source Data or a JavaScript function is set, and never appear in preview or a published app."
              className="shrink-0 rounded bg-amber-100 px-1 text-[9px] font-semibold tracking-wide text-amber-700 uppercase"
            >
              Sample
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-slate-400">
            {totalRows.toLocaleString()} rows
          </span>
          {properties.searchable !== false && !serverPaged && (
            <input
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setPage(0);
              }}
              placeholder="Search"
              className="w-32 rounded border border-slate-300 px-2 py-0.5 text-xs outline-none focus:border-blue-500"
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
                    if (serverPaged || column.source === 'static') return;
                    setSort((current) =>
                      current?.key === column.key
                        ? current.direction === 'asc'
                          ? { key: column.key, direction: 'desc' }
                          : null
                        : { key: column.key, direction: 'asc' },
                    );
                  }}
                  className={clsx(
                    'border-b border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-600 select-none',
                    !serverPaged && column.source !== 'static' && 'cursor-pointer hover:bg-slate-100',
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
                          'truncate px-2 py-1 text-slate-700',
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
            {sourceError ? <span className="text-red-600">{sourceError}</span> : configured ? 'No rows' : emptyRowHint(properties)}
          </div>
        )}
      </div>

      {!pagerAtTop && pager}
    </div>
  );
}

/**
 * The pager.
 *
 * Styled from the document like everything else on this widget, and it says
 * which rows are on screen rather than only which page: "26–50 of 1,284" is the
 * question people actually have.
 */
function Pager({
  page,
  pageCount,
  totalRows,
  properties,
  onGo,
}: {
  page: number;
  pageCount: number;
  totalRows: number;
  properties: Record<string, unknown>;
  onGo: (page: number) => void;
}) {
  const pageSize = Math.max(1, Number(properties.pageSize ?? 25));
  const first = totalRows === 0 ? 0 : page * pageSize + 1;
  const last = Math.min((page + 1) * pageSize, totalRows);

  const buttonStyle = stateStyleToCss(properties, 'pagerButton');
  const align = String(properties.pagerAlign ?? 'right');

  return (
    <div
      style={{
        ...textStyleToCss(properties, 'pager'),
        ...(readColour(properties, 'pagerBackground')
          ? { background: readColour(properties, 'pagerBackground') }
          : {}),
      }}
      className={clsx(
        'flex shrink-0 items-center gap-1.5 border-t border-slate-200 px-2 py-1 text-xs text-slate-500',
        align === 'left' && 'justify-start',
        align === 'center' && 'justify-center',
        align === 'right' && 'justify-end',
      )}
    >
      {properties.pagerShowRange !== false && (
        <span className="mr-auto tabular-nums" style={{ order: align === 'left' ? 1 : 0 }}>
          {first.toLocaleString()}–{last.toLocaleString()} of {totalRows.toLocaleString()}
        </span>
      )}

      <PagerButton style={buttonStyle} disabled={page === 0} onClick={() => onGo(0)} label="First">
        «
      </PagerButton>
      <PagerButton
        style={buttonStyle}
        disabled={page === 0}
        onClick={() => onGo(page - 1)}
        label="Previous"
      >
        ‹
      </PagerButton>

      <span className="px-1 tabular-nums">
        {page + 1} / {pageCount}
      </span>

      <PagerButton
        style={buttonStyle}
        disabled={page >= pageCount - 1}
        onClick={() => onGo(page + 1)}
        label="Next"
      >
        ›
      </PagerButton>
      <PagerButton
        style={buttonStyle}
        disabled={page >= pageCount - 1}
        onClick={() => onGo(pageCount - 1)}
        label="Last"
      >
        »
      </PagerButton>
    </div>
  );
}

function PagerButton({
  style,
  disabled,
  onClick,
  label,
  children,
}: {
  style: React.CSSProperties;
  disabled: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
      style={disabled ? undefined : style}
      className={clsx(
        'rounded border border-slate-200 px-1.5 leading-5 transition-colors',
        disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-slate-100',
      )}
    >
      {children}
    </button>
  );
}

function readColour(properties: Record<string, unknown>, key: string): string | undefined {
  const value = properties[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
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
    ],
    properties: [
      {
        name: 'Data',
        properties: [
          ...ROW_SOURCE_PROPERTIES,
          { key: 'columns', label: 'Columns', control: 'column_config', expectedType: 'array', bindable: false },
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
            helpText: 'Scrolling keeps only the visible rows in the page, however many were returned.',
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
            helpText: 'Bind to the count from your query, e.g. {{ CountOrders.data[0].total }}. Without it the pager can only count the page it is holding.',
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
      { name: 'Header font', properties: textStyleProperties('header') },
      {
        name: 'Header background',
        properties: [
          { key: 'headerBackground', label: 'Background', control: 'color', expectedType: 'string', bindable: false },
        ],
      },
      { name: 'Row font', properties: textStyleProperties('row') },
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
        ],
      },
    ],
  },
};
