import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import type { RegisteredWidget, WidgetProps } from './types';
import { textStyleProperties, textStyleToCss } from './textStyle';
import { stateStyleProperties, stateStyleToCss } from './stateStyle';
import { formatValue, type ValueFormat } from './formatValue';
import { asRows, isRow } from './coerce';
import { spacingToCss } from '@/editor/SpacingEditor';

/**
 * The list.
 *
 * A table answers "compare these rows field by field". A list answers "find the
 * one I mean" — so an item is a title, a description and a picture rather than a
 * grid of cells, and the description is allowed to wrap, because the sentence
 * that tells two similar records apart rarely fits on one line.
 *
 * Selection is the other half of it. A list is usually how people pick things,
 * often several, often from more results than fit on a screen — so what is
 * selected is shown at the top as its own set of chips and can be taken back
 * from there. Scrolling away from a choice must not mean losing sight of it.
 *
 * Heights are measured rather than assumed. Items differ in height the moment
 * descriptions differ in length, and a virtualizer told they are all the same
 * puts the scrollbar in the wrong place and drifts further with every screen.
 */

type PagingMode = 'scroll' | 'infinite' | 'client' | 'server';
type SelectionMode = 'none' | 'single' | 'multiple';

const SAMPLE_ITEMS: Record<string, unknown>[] = [
  {
    id: 'SKU-4417',
    title: 'Deep groove ball bearing 6204-2RS',
    description:
      'Sealed on both sides, 20 × 47 × 14 mm. Standard fit for the conveyor drive units on lines 3 and 4.',
    image: '',
    meta: '412 in stock',
  },
  {
    id: 'SKU-4418',
    title: 'Tapered roller bearing 30206',
    description: 'Separable, 30 × 62 × 17.25 mm. Ordered against the gearbox rebuild programme.',
    image: '',
    meta: '38 in stock',
  },
  {
    id: 'SKU-5120',
    title: 'Spherical roller bearing 22212 E',
    description:
      'Self-aligning, takes shaft deflection from the older mounts. Long lead time — check before promising a date.',
    image: '',
    meta: 'On order',
  },
  {
    id: 'SKU-5121',
    title: 'Needle roller cage K20×26×20',
    description: 'For the indexing heads. Consumable — reorder point sits at 200.',
    image: '',
    meta: '1,204 in stock',
  },
];

function ListWidget({ properties, state, setState, fireEvent, isDesignMode }: WidgetProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);

  /* --- data ------------------------------------------------------- */

  const showingSample = properties.data === undefined && isDesignMode;

  const rows = useMemo<Record<string, unknown>[]>(
    () => (showingSample ? SAMPLE_ITEMS : asRows(properties.data)),
    [showingSample, properties.data],
  );

  const pagingMode = String(properties.paging ?? 'scroll') as PagingMode;
  const pageSize = Math.max(1, Number(properties.pageSize ?? 25));
  const fromServer = pagingMode === 'server' || pagingMode === 'infinite';

  const serverTotal = Number(properties.totalRows);
  const totalRows = fromServer && Number.isFinite(serverTotal) ? serverTotal : rows.length;

  const titleKey = String(properties.titleKey ?? 'title');
  const descriptionKey = String(properties.descriptionKey ?? 'description');
  const imageKey = String(properties.imageKey ?? 'image');
  const metaKey = String(properties.metaKey ?? '');
  const keyField = String(properties.rowKey ?? '');

  const identityOf = useCallback(
    (row: Record<string, unknown>, index: number): string => {
      if (keyField !== '' && row[keyField] !== undefined) return String(row[keyField]);
      // Falling back to the title rather than the position: a list is searched
      // and paged, and an index means something different after either.
      const title = row[titleKey];
      return title === undefined ? `#${index}` : String(title);
    },
    [keyField, titleKey],
  );

  /*
   * Searching is the server's job once it is paging: the widget holds one window,
   * so filtering it would hide rows the server counted and leave the pager
   * describing a total that no longer matches what is on screen.
   */
  const searchesLocally = !fromServer && properties.searchable !== false;

  const matched = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!searchesLocally || needle === '') return rows;

    return rows.filter((row) =>
      [titleKey, descriptionKey, metaKey].some(
        (key) => key !== '' && String(row[key] ?? '').toLowerCase().includes(needle),
      ),
    );
  }, [rows, search, searchesLocally, titleKey, descriptionKey, metaKey]);

  const pageCount =
    pagingMode === 'client' || pagingMode === 'server'
      ? Math.max(1, Math.ceil(totalRows / pageSize))
      : 1;

  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1);
  }, [page, pageCount]);

  const items = useMemo(() => {
    if (pagingMode !== 'client') return matched;
    const start = page * pageSize;
    return matched.slice(start, start + pageSize);
  }, [matched, pagingMode, page, pageSize]);

  /* --- selection --------------------------------------------------- */

  const selectionMode = String(properties.selectionMode ?? 'multiple') as SelectionMode;

  /*
   * The whole row is kept, not just its key. Chips have to render a title for
   * something that may be on another page or filtered out of the current search,
   * and asking the current window for it would make selections vanish from view
   * the moment you typed.
   */
  const selected = isRow(state.selectedItems)
    ? (state.selectedItems as Record<string, Record<string, unknown>>)
    : {};
  const selectedKeys = Object.keys(selected);

  const publish = (next: Record<string, Record<string, unknown>>): void => {
    const list = Object.values(next);
    setState({
      selectedItems: next,
      selectedRows: list,
      selectedKeys: Object.keys(next),
      selectedItem: list[list.length - 1] ?? null,
      selectedCount: list.length,
    });
    fireEvent('onSelectionChange', { rows: list, keys: Object.keys(next) });
  };

  const toggle = (row: Record<string, unknown>, key: string): void => {
    if (isDesignMode || selectionMode === 'none') return;

    if (selectionMode === 'single') {
      publish(key in selected ? {} : { [key]: row });
      return;
    }

    const next = { ...selected };
    if (key in next) delete next[key];
    else next[key] = row;
    publish(next);
  };

  /* --- windowed loading -------------------------------------------- */

  const requestedRef = useRef(-1);

  const requestMore = useCallback(() => {
    if (pagingMode !== 'infinite' || isDesignMode) return;
    if (rows.length >= totalRows) return;
    // One request per offset: the scroll handler fires many times crossing the
    // threshold, and without this each one would re-ask for the same window.
    if (requestedRef.current === rows.length) return;

    requestedRef.current = rows.length;
    setState({ pageOffset: rows.length, pageSize });
    fireEvent('onLoadMore', { pageOffset: rows.length, pageSize, loaded: rows.length, totalRows });
  }, [pagingMode, isDesignMode, rows.length, totalRows, pageSize, fireEvent, setState]);

  const goToPage = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(next, 0), pageCount - 1);
      if (clamped === page) return;
      setPage(clamped);
      setState({ pageIndex: clamped, pageOffset: clamped * pageSize, pageSize, pageCount });
      fireEvent('onPageChange', {
        pageIndex: clamped,
        pageSize,
        pageOffset: clamped * pageSize,
      });
    },
    [page, pageCount, pageSize, fireEvent, setState],
  );

  /* --- virtualization ---------------------------------------------- */

  const estimated = Math.max(32, Number(properties.itemHeight ?? 68));

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimated,
    // Items are as tall as their description makes them, so each is measured
    // once it is on screen rather than assumed to match the estimate.
    measureElement: (element) => element.getBoundingClientRect().height,
    overscan: 6,
  });

  const virtualItems = virtualizer.getVirtualItems();

  useEffect(() => {
    const last = virtualItems[virtualItems.length - 1];
    if (last && last.index >= items.length - 5) requestMore();
  }, [virtualItems, items.length, requestMore]);

  /* --- styling ------------------------------------------------------ */

  const titleStyle = textStyleToCss(properties, 'title');
  const descriptionStyle = textStyleToCss(properties, 'description');
  const metaStyle = textStyleToCss(properties, 'meta');
  const descriptionLines = Number(properties.descriptionLines);
  const clamped = Number.isFinite(descriptionLines) && descriptionLines > 0;

  const imageSize = Math.max(0, Number(properties.imageSize ?? 44));
  const imageShape = String(properties.imageShape ?? 'rounded');
  const showImage = properties.showImage !== false && imageSize > 0;

  const itemBackground = (key: string, isSelected: boolean): string | undefined => {
    if (isSelected) return colour(properties, 'itemSelectedBackground');
    if (key === hovered) return colour(properties, 'itemHoverBackground');
    return colour(properties, 'itemBackground');
  };

  /* --- render -------------------------------------------------------- */

  const pager =
    pagingMode === 'client' || pagingMode === 'server' ? (
      <Pager page={page} pageCount={pageCount} pageSize={pageSize} totalRows={totalRows} properties={properties} onGo={goToPage} />
    ) : null;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded border border-slate-200 bg-white">
      {/* --- header: title, count, search ---------------------------- */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-2 py-1.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-medium text-slate-600">
            {String(properties.title ?? '')}
          </span>
          {showingSample && (
            <span
              title="Placeholder items so the list can be styled. They disappear once List data is bound, and never appear in preview or a published app."
              className="shrink-0 rounded bg-amber-100 px-1 text-[9px] font-semibold tracking-wide text-amber-700 uppercase"
            >
              Sample
            </span>
          )}
        </span>

        <span className="ml-auto shrink-0 text-xs tabular-nums text-slate-400">
          {totalRows.toLocaleString()}
        </span>

        {properties.searchable !== false && (
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
              setState({ searchText: event.target.value });
              // Under server paging the widget cannot filter what it does not
              // hold, so the query is told and does it instead.
              if (fromServer) fireEvent('onSearch', { searchText: event.target.value });
            }}
            placeholder="Search"
            className="w-32 shrink-0 rounded border border-slate-300 px-2 py-0.5 text-xs outline-none focus:border-blue-500"
          />
        )}
      </div>

      {/* --- chips: what is selected, and how to undo it -------------- */}
      {selectionMode !== 'none' && selectedKeys.length > 0 && properties.showSelectionBar !== false && (
        <div
          style={{ background: colour(properties, 'chipBarBackground') }}
          className="flex shrink-0 flex-wrap items-center gap-1 border-b border-slate-200 px-2 py-1.5"
        >
          <span className="mr-0.5 text-[10px] font-medium tracking-wide text-slate-400 uppercase">
            {selectedKeys.length} selected
          </span>

          {selectedKeys.map((key) => (
            <span
              key={key}
              style={stateStyleToCss(properties, 'chip')}
              className="flex max-w-[12rem] items-center gap-1 rounded-full border border-slate-300 bg-white py-0.5 pr-1 pl-2 text-[11px] text-slate-700"
            >
              <span className="truncate">{String(selected[key]?.[titleKey] ?? key)}</span>
              <button
                type="button"
                onClick={() => {
                  const next = { ...selected };
                  delete next[key];
                  publish(next);
                }}
                aria-label={`Remove ${String(selected[key]?.[titleKey] ?? key)}`}
                className="shrink-0 rounded-full px-1 leading-none text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              >
                ×
              </button>
            </span>
          ))}

          <button
            type="button"
            onClick={() => publish({})}
            className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-200 hover:text-slate-800"
          >
            Clear all
          </button>
        </div>
      )}

      {String(properties.pagerPosition ?? 'bottom') === 'top' && pager}

      {/* --- the items ------------------------------------------------ */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtualItems.map((virtualItem) => {
            const row = items[virtualItem.index];
            if (!row) return null;

            const key = identityOf(row, virtualItem.index);
            const isSelected = key in selected;
            const image = String(row[imageKey] ?? '');

            return (
              <div
                key={key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`,
                  padding: spacingToCss(properties.itemPadding, 8),
                  background: itemBackground(key, isSelected),
                  ...(isSelected ? stateStyleToCss(properties, 'itemSelected') : {}),
                  ...(key === hovered ? stateStyleToCss(properties, 'itemHover') : {}),
                }}
                onMouseEnter={() => setHovered(key)}
                onMouseLeave={() => setHovered((current) => (current === key ? null : current))}
                onClick={() => {
                  if (isDesignMode) return;
                  fireEvent('onItemClick', { row, key });
                  if (selectionMode !== 'none' && properties.selectOnRowClick !== false) {
                    toggle(row, key);
                  }
                }}
                className={clsx(
                  'flex items-start gap-2 border-b border-slate-100',
                  !isDesignMode && selectionMode !== 'none' && 'cursor-pointer',
                  !isSelected && 'hover:bg-slate-50',
                )}
              >
                {selectionMode === 'multiple' && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => toggle(row, key)}
                    aria-label={`Select ${String(row[titleKey] ?? key)}`}
                    style={{ accentColor: colour(properties, 'accentColor') }}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-blue-600"
                  />
                )}

                {selectionMode === 'single' && (
                  <input
                    type="radio"
                    checked={isSelected}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => toggle(row, key)}
                    aria-label={`Select ${String(row[titleKey] ?? key)}`}
                    style={{ accentColor: colour(properties, 'accentColor') }}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-blue-600"
                  />
                )}

                {showImage && (
                  <Thumbnail
                    src={image}
                    alt=""
                    size={imageSize}
                    shape={imageShape}
                    fallback={String(row[titleKey] ?? '?')}
                  />
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span
                      style={titleStyle}
                      className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800"
                    >
                      {formatValue(row[titleKey], partOptions(properties, 'title'))}
                    </span>
                    {metaKey !== '' && (
                      <span
                        style={metaStyle}
                        className="shrink-0 text-[11px] whitespace-nowrap text-slate-400"
                      >
                        {formatValue(row[metaKey], partOptions(properties, 'meta'))}
                      </span>
                    )}
                  </div>

                  {descriptionKey !== '' && (
                    <p
                      style={{
                        ...descriptionStyle,
                        ...(clamped
                          ? {
                              display: '-webkit-box',
                              WebkitLineClamp: descriptionLines,
                              WebkitBoxOrient: 'vertical' as const,
                              overflow: 'hidden',
                            }
                          : {}),
                      }}
                      className="mt-0.5 text-xs leading-snug whitespace-pre-wrap text-slate-500"
                    >
                      {formatValue(row[descriptionKey], partOptions(properties, 'description'))}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {items.length === 0 && (
          <div className="flex h-24 items-center justify-center text-sm text-slate-400">
            {properties.data === undefined
              ? 'Bind this list to a query'
              : search.trim() !== ''
                ? `Nothing matches “${search}”`
                : 'No items'}
          </div>
        )}

        {pagingMode === 'infinite' && rows.length < totalRows && (
          <div className="py-2 text-center text-[11px] text-slate-400">
            {rows.length.toLocaleString()} of {totalRows.toLocaleString()} loaded…
          </div>
        )}
      </div>

      {String(properties.pagerPosition ?? 'bottom') !== 'top' && pager}
    </div>
  );
}

/**
 * The picture, or something in its place.
 *
 * A broken image that hides itself takes the row's alignment with it and says
 * nothing about why. The initial on a tinted square keeps the layout and reads
 * as deliberate.
 */
function Thumbnail({
  src,
  alt,
  size,
  shape,
  fallback,
}: {
  src: string;
  alt: string;
  size: number;
  shape: string;
  fallback: string;
}) {
  const [failed, setFailed] = useState(false);
  const radius = shape === 'circle' ? '9999px' : shape === 'square' ? '0' : '6px';

  if (src === '' || failed) {
    return (
      <span
        aria-hidden="true"
        style={{ width: size, height: size, borderRadius: radius }}
        className="flex shrink-0 items-center justify-center bg-slate-100 text-xs font-semibold text-slate-400"
      >
        {fallback.trim().charAt(0).toUpperCase() || '?'}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      style={{ width: size, height: size, borderRadius: radius }}
      className="shrink-0 bg-slate-100 object-cover"
    />
  );
}

function Pager({
  page,
  pageCount,
  pageSize,
  totalRows,
  properties,
  onGo,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  totalRows: number;
  properties: Record<string, unknown>;
  onGo: (page: number) => void;
}) {
  const first = totalRows === 0 ? 0 : page * pageSize + 1;
  const last = Math.min((page + 1) * pageSize, totalRows);
  const buttonStyle = stateStyleToCss(properties, 'pagerButton');

  return (
    <div
      style={{
        ...textStyleToCss(properties, 'pager'),
        background: colour(properties, 'pagerBackground'),
      }}
      className="flex shrink-0 items-center gap-1.5 border-t border-slate-200 px-2 py-1 text-xs text-slate-500"
    >
      <span className="mr-auto tabular-nums">
        {first.toLocaleString()}–{last.toLocaleString()} of {totalRows.toLocaleString()}
      </span>
      <PagerButton style={buttonStyle} disabled={page === 0} onClick={() => onGo(page - 1)} label="Previous">
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

function colour(properties: Record<string, unknown>, key: string): string | undefined {
  const value = properties[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Formatting options for one part of an item, read off its own prefixed keys. */
function partOptions(properties: Record<string, unknown>, prefix: string) {
  return {
    format: properties[`${prefix}Format`] as ValueFormat | undefined,
    decimals: properties[`${prefix}Decimals`] as number | undefined,
    currency: properties[`${prefix}Currency`] as string | undefined,
    dateStyle: properties[`${prefix}DateStyle`] as 'short' | 'medium' | 'long' | undefined,
    emptyText: properties[`${prefix}EmptyText`] as string | undefined,
    prefix: properties[`${prefix}Prefix`] as string | undefined,
    suffix: properties[`${prefix}Suffix`] as string | undefined,
  };
}

/** The three formatting properties a part gets, prefixed onto it. */
function partFormatProperties(prefix: string, label: string) {
  return [
    {
      key: `${prefix}Format`,
      label: `${label} shows as`,
      control: 'select' as const,
      expectedType: 'string' as const,
      bindable: false,
      defaultValue: 'plain',
      options: [
        { value: 'plain', label: 'Plain text' },
        { value: 'number', label: 'Number' },
        { value: 'currency', label: 'Currency' },
        { value: 'percent', label: 'Percentage' },
        { value: 'date', label: 'Date' },
        { value: 'datetime', label: 'Date and time' },
        { value: 'relative', label: 'Relative time' },
      ],
    },
    {
      key: `${prefix}EmptyText`,
      label: 'When empty, show',
      control: 'text' as const,
      expectedType: 'string' as const,
      bindable: false,
    },
  ];
}

const WHEN_PAGED = { key: 'paging', oneOf: ['client', 'server'] };
const WHEN_FROM_SERVER = { key: 'paging', oneOf: ['server', 'infinite'] };
const WHEN_SELECTABLE = { key: 'selectionMode', oneOf: ['single', 'multiple'] };

export const listWidget: RegisteredWidget = {
  component: ListWidget,
  definition: {
    type: 'list',
    displayName: 'List',
    category: 'data',
    icon: 'list',
    defaultLayout: { x: 0, y: 0, w: 8, h: 12 },
    minSize: { w: 3, h: 4 },
    events: [
      { key: 'onSelectionChange', label: 'On selection change', payloadKeys: ['rows', 'keys'] },
      { key: 'onItemClick', label: 'On item click', payloadKeys: ['row', 'key'] },
      { key: 'onPageChange', label: 'On page change', payloadKeys: ['pageIndex', 'pageSize', 'pageOffset'] },
      { key: 'onLoadMore', label: 'On load more', payloadKeys: ['pageOffset', 'pageSize', 'loaded', 'totalRows'] },
      { key: 'onSearch', label: 'On search', payloadKeys: ['searchText'] },
    ],
    exposedState: [
      { key: 'selectedRows', type: 'array', description: 'Every selected item, in full' },
      { key: 'selectedKeys', type: 'array', description: 'Their identifiers' },
      { key: 'selectedItem', type: 'object', description: 'The most recently selected one' },
      { key: 'selectedCount', type: 'number', description: 'How many are selected' },
      { key: 'searchText', type: 'string', description: 'What is in the search box' },
      { key: 'pageOffset', type: 'number', description: 'Rows before this window — bind to a query OFFSET' },
      { key: 'pageSize', type: 'number', description: 'Rows per window' },
      { key: 'pageIndex', type: 'number', description: 'Current page, counting from zero' },
    ],
    properties: [
      {
        name: 'Data',
        properties: [
          {
            key: 'data',
            label: 'List data',
            control: 'code',
            expectedType: 'array',
            bindable: true,
            helpText: 'A query such as {{ GetParts.data }}, or a JSON array pasted in.',
          },
          {
            key: 'rowKey',
            label: 'Item identifier',
            control: 'text',
            expectedType: 'string',
            bindable: false,
            helpText: 'Column holding a stable id. Selection is keyed by it; without one the title is used.',
          },
        ],
      },
      {
        name: 'Item content',
        properties: [
          { key: 'titleKey', label: 'Title field', control: 'text', expectedType: 'string', bindable: false, defaultValue: 'title' },
          { key: 'descriptionKey', label: 'Description field', control: 'text', expectedType: 'string', bindable: false, defaultValue: 'description' },
          { key: 'metaKey', label: 'Right-hand field', control: 'text', expectedType: 'string', bindable: false, helpText: 'Shown small, at the end of the title line.' },
          {
            key: 'descriptionLines',
            label: 'Description lines',
            control: 'number',
            expectedType: 'number',
            bindable: false,
            helpText: 'Blank lets it run to its full length. Items are measured either way.',
          },
          { key: 'showImage', label: 'Show an image', control: 'toggle', expectedType: 'boolean', bindable: false, defaultValue: true },
          { key: 'imageKey', label: 'Image field', control: 'text', expectedType: 'string', bindable: false, defaultValue: 'image', visibleWhen: { key: 'showImage', equals: true } },
          { key: 'imageSize', label: 'Image size', control: 'number', expectedType: 'number', bindable: false, defaultValue: 44, visibleWhen: { key: 'showImage', equals: true } },
          {
            key: 'imageShape',
            label: 'Image shape',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'rounded',
            options: [
              { value: 'rounded', label: 'Rounded' },
              { value: 'circle', label: 'Circle' },
              { value: 'square', label: 'Square' },
            ],
            visibleWhen: { key: 'showImage', equals: true },
          },
        ],
      },
      {
        name: 'Formatting',
        properties: [
          ...partFormatProperties('title', 'Title'),
          ...partFormatProperties('meta', 'Right-hand field'),
        ],
      },
      {
        name: 'Selection',
        properties: [
          {
            key: 'selectionMode',
            label: 'Selecting',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'multiple',
            options: [
              { value: 'multiple', label: 'Several — checkboxes' },
              { value: 'single', label: 'One at a time' },
              { value: 'none', label: 'Not selectable' },
            ],
          },
          {
            key: 'showSelectionBar',
            label: 'Show what is selected',
            control: 'toggle',
            expectedType: 'boolean',
            bindable: false,
            defaultValue: true,
            helpText: 'A removable chip per selection, above the list.',
            visibleWhen: WHEN_SELECTABLE,
          },
          {
            key: 'selectOnRowClick',
            label: 'Clicking an item selects it',
            control: 'toggle',
            expectedType: 'boolean',
            bindable: false,
            defaultValue: true,
            helpText: 'Off leaves the checkbox as the only way, so a click can do something else.',
            visibleWhen: WHEN_SELECTABLE,
          },
        ],
      },
      {
        name: 'Paging',
        properties: [
          {
            key: 'paging',
            label: 'Move through items by',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'scroll',
            options: [
              { value: 'scroll', label: 'Scrolling — virtualized' },
              { value: 'infinite', label: 'Scrolling, fetching as you go' },
              { value: 'client', label: 'Pages, from loaded items' },
              { value: 'server', label: 'Pages, fetched per page' },
            ],
            helpText: 'Fetching as you go asks the query for the next window before you reach the end.',
          },
          {
            key: 'pageSize',
            label: 'Items per window',
            control: 'number',
            expectedType: 'number',
            bindable: true,
            defaultValue: 25,
            visibleWhen: { key: 'paging', oneOf: ['client', 'server', 'infinite'] },
          },
          {
            key: 'totalRows',
            label: 'Total items',
            control: 'text',
            expectedType: 'number',
            bindable: true,
            helpText: 'Bind to the count from your query. Without it the list cannot know when to stop asking for more.',
            visibleWhen: WHEN_FROM_SERVER,
          },
          {
            key: 'pagerPosition',
            label: 'Pager position',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'bottom',
            options: [
              { value: 'bottom', label: 'Below the items' },
              { value: 'top', label: 'Above the items' },
            ],
            visibleWhen: WHEN_PAGED,
          },
        ],
      },
      {
        name: 'Appearance',
        properties: [
          { key: 'title', label: 'Title', control: 'text', expectedType: 'string', bindable: true },
          { key: 'searchable', label: 'Search box', control: 'toggle', expectedType: 'boolean', bindable: false, defaultValue: true },
          { key: 'itemPadding', label: 'Item padding', control: 'spacing', expectedType: 'any', bindable: false, defaultValue: 8 },
          {
            key: 'itemHeight',
            label: 'Estimated item height',
            control: 'number',
            expectedType: 'number',
            bindable: false,
            defaultValue: 68,
            helpText: 'Only a starting guess — every item is measured once it is on screen.',
          },
          { key: 'accentColor', label: 'Checkbox accent', control: 'color', expectedType: 'string', bindable: false },
        ],
      },
      { name: 'Title font', properties: textStyleProperties('title') },
      { name: 'Description font', properties: textStyleProperties('description') },
      { name: 'Right-hand font', properties: textStyleProperties('meta') },
      {
        name: 'Item background',
        properties: [
          { key: 'itemBackground', label: 'Background', control: 'color', expectedType: 'string', bindable: false },
        ],
      },
      { name: 'Item hover', properties: stateStyleProperties('itemHover') },
      { name: 'Item selected', properties: stateStyleProperties('itemSelected') },
      {
        name: 'Selection chips',
        properties: [
          {
            key: 'chipBarBackground',
            label: 'Bar background',
            control: 'color',
            expectedType: 'string',
            bindable: false,
            visibleWhen: WHEN_SELECTABLE,
          },
          ...stateStyleProperties('chip', { visibleWhen: WHEN_SELECTABLE }),
        ],
      },
      {
        name: 'Pager',
        properties: [
          ...textStyleProperties('pager').map((property) => ({ ...property, visibleWhen: WHEN_PAGED })),
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
          { key: 'onSelectionChange', label: 'On selection change', control: 'action_list', expectedType: 'any', bindable: false },
          { key: 'onItemClick', label: 'On item click', control: 'action_list', expectedType: 'any', bindable: false },
          { key: 'onSearch', label: 'On search', control: 'action_list', expectedType: 'any', bindable: false, visibleWhen: WHEN_FROM_SERVER },
          { key: 'onLoadMore', label: 'On load more', control: 'action_list', expectedType: 'any', bindable: false, visibleWhen: { key: 'paging', equals: 'infinite' } },
          { key: 'onPageChange', label: 'On page change', control: 'action_list', expectedType: 'any', bindable: false, visibleWhen: WHEN_PAGED },
        ],
      },
    ],
  },
};
