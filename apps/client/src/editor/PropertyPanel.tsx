import { useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  jsObjectsOnPage,
  queriesOnPage,
  type ApplicationDsl,
  type PropertyDefinition,
  type ValidationRule,
  type WidgetDsl,
} from '@swiftly/shared';
import { getWidgetDefinition } from '@/widgets/registry';
import { TabListEditor, normaliseTabs } from './TabListEditor';
import { SpacingEditor } from './SpacingEditor';
import { ColumnConfigEditor } from './ColumnConfigEditor';
import { ActionEditor } from './ActionEditor';
import { asRows } from '@/widgets/coerce';
import {
  ColorField,
  SearchField,
  SegmentedControl,
  Select,
  Switch,
  control,
  controlCompact,
  dashedButton,
  ghostButton,
  segmentIconsFor,
  shouldUseSegmented,
} from './controls';
import { jsCallBinding, jsObjectCompileErrors, listJsFunctions, pathFromJsCall } from './jsObjectOps';
import { gridCanvasScale } from './gridCells';
import { IconPicker } from '@/icons/IconPicker';

/**
 * The property panel.
 *
 * Every control is generated from the widget's `WidgetDefinition`, so a custom
 * component gets the same panel as a built-in without the editor knowing anything
 * about it. Bindable properties show their evaluated result inline — seeing what
 * `{{ GetOrders.data }}` currently resolves to is most of debugging a low-code app.
 */

export function PropertyPanel({
  widget,
  parent,
  dsl,
  pageId,
  evaluated,
  resolvedProperties,
  onChange,
  onLayout,
  onRename,
  onDelete,
  onImportFromTable,
}: {
  widget: WidgetDsl | null;
  /** The container holding this widget, if any. Drives layout-slot properties. */
  parent: WidgetDsl | null;
  dsl: ApplicationDsl;
  pageId: string;
  evaluated: Record<string, { value: unknown; error?: { message: string } }>;
  /** Live widget properties as the canvas sees them, including query rows. */
  resolvedProperties?: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  /** Page-canvas size of the selected widget, used for Grid 1× / 2× / 3×. */
  onLayout?: (patch: {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    canvasSize?: number;
  }) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onImportFromTable?: () => void;
}) {
  if (!widget) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M5 8h6M8 5v6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </span>
        <p className="text-xs font-medium text-slate-600">Nothing selected</p>
        <p className="max-w-[15rem] text-[11px] leading-relaxed text-slate-400">
          Pick a widget on the canvas or in the tree to edit what it shows, where its data
          comes from, and what it does.
        </p>
      </div>
    );
  }

  const definition = getWidgetDefinition(widget.type);
  if (!definition) {
    return <div className="p-4 text-xs text-amber-700">Unknown widget type: {widget.type}</div>;
  }

  return (
    <PropertyPanelBody
      widget={widget}
      parent={parent}
      definition={definition}
      dsl={dsl}
      pageId={pageId}
      evaluated={evaluated}
      resolvedProperties={resolvedProperties}
      onChange={onChange}
      onLayout={onLayout}
      onRename={onRename}
      onDelete={onDelete}
      onImportFromTable={onImportFromTable}
    />
  );
}

/** Below this many properties a filter box costs more than it saves. */
const FILTER_THRESHOLD = 12;

function PropertyPanelBody({
  widget,
  parent,
  definition,
  dsl,
  pageId,
  evaluated,
  resolvedProperties,
  onChange,
  onLayout,
  onRename,
  onDelete,
  onImportFromTable,
}: {
  widget: WidgetDsl;
  parent: WidgetDsl | null;
  definition: NonNullable<ReturnType<typeof getWidgetDefinition>>;
  dsl: ApplicationDsl;
  pageId: string;
  evaluated: Record<string, { value: unknown; error?: { message: string } }>;
  resolvedProperties?: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  onLayout?: (patch: {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    canvasSize?: number;
  }) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onImportFromTable?: () => void;
}) {
  const [filter, setFilter] = useState('');

  /*
   * The column names the bound data actually has. Read from the evaluated value
   * rather than the expression, so `{{ GetOrders.data }}` yields the query's real
   * columns and the column editor can offer them instead of asking someone to
   * retype keys they already have.
   */
  const dataKeys = useMemo(() => {
    // Prefer the live properties the canvas uses (query rows land here as soon
    // as the query returns) so the column editor cannot lag behind the table.
    const fromResolved = resolvedProperties
      ? asRows(
          resolvedProperties.sourceKind === 'query'
            ? resolvedProperties.sourceData
            : resolvedProperties.sourceKind === 'js'
              ? resolvedProperties.sourceJs
              : (resolvedProperties.sourceJs ??
                resolvedProperties.sourceData ??
                resolvedProperties.data ??
                resolvedProperties.options),
        )
      : [];
    const fromRow = fromResolved[0] ? Object.keys(fromResolved[0]) : [];
    const reported = Array.isArray(resolvedProperties?.sourceColumns)
      ? resolvedProperties.sourceColumns.filter((key): key is string => typeof key === 'string')
      : [];
    if (fromRow.length > 0 || reported.length > 0) {
      return [...new Set([...reported, ...fromRow])];
    }

    const evaluation =
      evaluated[`${widget.name}.sourceJs`] ??
      evaluated[`${widget.name}.sourceData`] ??
      evaluated[`${widget.name}.data`] ??
      evaluated[`${widget.name}.options`];
    const rows = asRows(
      evaluation
        ? evaluation.value
        : (widget.properties.sourceJs ??
            widget.properties.sourceData ??
            widget.properties.data ??
            widget.properties.options),
    );
    return rows[0] ? Object.keys(rows[0]) : [];
  }, [
    evaluated,
    resolvedProperties,
    widget.name,
    widget.properties.data,
    widget.properties.sourceData,
    widget.properties.sourceJs,
    widget.properties.sourceKind,
    widget.properties.options,
  ]);

  const propertyCount = definition.properties.reduce(
    (total, section) => total + section.properties.length,
    0,
  );

  /*
   * Sections are filtered rather than fields: a field on its own, under no
   * heading, loses the context that tells you what it belongs to. A section that
   * ends up empty drops out entirely.
   */
  const sections = useMemo(() => {
    const needle = filter.trim().toLowerCase();

    return definition.properties
      .map((section) => ({
        name: section.name,
        properties: section.properties.filter(
          (property) =>
            isVisible(property, widget.properties) &&
            (needle === '' ||
              property.label.toLowerCase().includes(needle) ||
              property.key.toLowerCase().includes(needle) ||
              section.name.toLowerCase().includes(needle)),
        ),
      }))
      .filter((section) => section.properties.length > 0);
  }, [definition.properties, widget.properties, filter]);

  return (
    <div className="flex h-full flex-col">
      {/* Outside the scrolling region: which widget you are editing is the one
          fact you need at every point in a long property list. */}
      <div className="shrink-0 border-b border-slate-200 px-3 pt-2.5 pb-3">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
            {definition.displayName}
          </span>
        </div>

        <input
          value={widget.name}
          onChange={(event) => onRename(event.target.value)}
          aria-label="Widget name"
          className={clsx(control, 'font-mono')}
        />

        <p className="mt-1.5 text-[11px] text-slate-400">
          Bind to it as <code className="text-slate-500">{widget.name}.property</code>
        </p>

        <label className="mt-2 flex flex-col gap-1">
          <span className="text-[11px] font-medium text-slate-600">Id</span>
          <input value={widget.id} readOnly aria-label="Widget id" className={clsx(control, 'font-mono text-slate-500')} />
          <span className="text-[11px] text-slate-400">
            In JavaScript: <code className="text-slate-500">{`document.byId('${widget.id}')`}</code>
          </span>
        </label>
        <label className="mt-2 flex flex-col gap-1">
          <span className="text-[11px] font-medium text-slate-600">Class</span>
          <input
            value={String(widget.properties.className ?? '')}
            onChange={(event) => onChange('className', event.target.value)}
            placeholder="my-field"
            aria-label="Widget class"
            className={clsx(control, 'font-mono')}
          />
          <span className="text-[11px] text-slate-400">
            In JavaScript:{' '}
            <code className="text-slate-500">
              {`document.byClass('${String(widget.properties.className ?? '').trim() || 'my-field'}')`}
            </code>
          </span>
        </label>

        <button
          type="button"
          onClick={onDelete}
          title={`Delete ${widget.name}`}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-red-200/80 bg-red-50 px-2 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M3 4.5h10M6 4.5V3h4v1.5M5 6.5v6m3-6v6m3-6v6M4.5 4.5l.5 9h6l.5-9"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Delete widget
        </button>
      </div>

      {/* A Table or a Chart carries more properties than fit on a screen, so past
          a certain count the panel gets a way to jump straight to one. Below it,
          the box is one more thing in the way. */}
      {propertyCount > FILTER_THRESHOLD && (
        <div className="shrink-0 border-b border-slate-200 px-3 py-2">
          <SearchField
            value={filter}
            onChange={setFilter}
            placeholder="Filter properties"
            aria-label="Filter properties"
          />
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {widget.type === 'form' && onImportFromTable && (
          <Section title="Generate">
            <p className="text-[11px] leading-snug text-slate-400">
              Build this form from a database table. You pick the columns; each one becomes a text,
              number, date, select, or switch from its type. For a Select, populate options from
              JSON, JavaScript, or a query. You can still drop extra widgets afterwards.
            </p>
            <button
              type="button"
              onClick={onImportFromTable}
              className="self-start rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
            >
              Import from table…
            </button>
          </Section>
        )}
        {widget.type === 'grid' && (
          <Section title="Size">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-slate-600">Items per row</span>
              <SizeToggle
                value={Math.max(1, Number(widget.properties.columns ?? 3))}
                options={[2, 3]}
                labels={{ 2: '2 items', 3: '3 items' }}
                onChange={(columns) => onChange('columns', columns)}
              />
              <span className="text-[11px] leading-snug text-slate-400">
                How many controls sit side by side. A field can still span two or three of those slots.
              </span>
            </div>
            {onLayout && (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-slate-600">Canvas size</span>
                <SizeToggle
                  value={gridCanvasScale(widget.properties, widget.layout)}
                  options={[1, 2, 3]}
                  labels={{ 1: '1×', 2: '2×', 3: '3×' }}
                  onChange={(scale) =>
                    onLayout({ ...gridCanvasLayout(widget.layout, scale), canvasSize: scale })
                  }
                />
                <span className="text-[11px] leading-snug text-slate-400">
                  How large this Grid is on the page. 2× is full width with taller cells; 3× is larger still.
                </span>
              </div>
            )}
          </Section>
        )}

        {parent?.type === 'grid' && (
          <Section title="Cell">
            <p className="text-[11px] text-slate-400">
              Drag the handles on the canvas, or pick a size. Pull the bottom edge up to shorten this
              field — the next row stays where it is.
            </p>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-slate-600">Width</span>
              <SizeToggle
                value={Math.max(1, Number(widget.properties.colSpan ?? 1))}
                options={widthOptions(parent)}
                labels={spanLabels(widthOptions(parent))}
                onChange={(span) => setChildSpan(widget, parent, onChange, 'colSpan', span)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-slate-600">Height</span>
              <SizeToggle
                value={Math.max(1, Number(widget.properties.rowSpan ?? 1))}
                options={[1, 2, 3]}
                labels={{ 1: '1×', 2: '2×', 3: '3×' }}
                onChange={(span) => {
                  onChange('rowSpan', span);
                  onChange('heightPx', null);
                }}
              />
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-slate-600">Column</span>
              <input
                type="number"
                min={0}
                max={Math.max(0, Number(parent.properties.columns ?? 3) - 1)}
                value={Number(widget.properties.col ?? 0)}
                onChange={(event) => onChange('col', Number(event.target.value))}
                className={control}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-slate-600">Row</span>
              <input
                type="number"
                min={0}
                value={Number(widget.properties.row ?? 0)}
                onChange={(event) => onChange('row', Number(event.target.value))}
                className={control}
              />
            </label>
          </Section>
        )}

        {parent?.type === 'tabs' && (
          <Section title="Layout">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-slate-600">Tab</span>
              {/* Which tab shows this widget. It lives on the child rather than on
                  Tabs so the container keeps one flat child list. */}
              <Select
                value={String(widget.properties.tabId ?? '')}
                onChange={(next) => onChange('tabId', next)}
              >
                <option value="">First tab</option>
                {tabsOf(parent).map((tab) => (
                  <option key={tab.id} value={tab.id}>
                    {tab.label}
                  </option>
                ))}
              </Select>
            </label>
          </Section>
        )}

        {parent?.type === 'accordion' && (
          <Section title="Layout">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-slate-600">Panel</span>
              <Select
                value={String(widget.properties.panelId ?? '')}
                onChange={(next) => onChange('panelId', next)}
              >
                <option value="">First panel</option>
                {tabsOf(parent, 'panels').map((tab) => (
                  <option key={tab.id} value={tab.id}>
                    {tab.label}
                  </option>
                ))}
              </Select>
            </label>
          </Section>
        )}

        {parent?.type === 'columns' && (
          <Section title="Layout">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-slate-600">Column</span>
              <Select
                value={String(widget.properties.column ?? 0)}
                onChange={(next) => onChange('column', Number(next))}
              >
                {Array.from(
                  { length: Math.max(2, Math.min(4, Number(parent.properties.count ?? 2) || 2)) },
                  (_, index) => (
                    <option key={index} value={String(index)}>
                      Column {index + 1}
                    </option>
                  ),
                )}
              </Select>
            </label>
          </Section>
        )}

        {sections.map((section) => (
          <Section key={section.name} title={section.name}>
            {groupPropertyRows(section.properties).map((row) => {
              if (isBorderShadowRow(row)) {
                return (
                  <ToggleButtonRow
                    key={row.map((property) => property.key).join('-')}
                    items={row.map((property) => ({
                      key: property.key,
                      label: property.label,
                      checked: toggleChecked(widget.properties[property.key], property.defaultValue),
                      onChange: (next) => onChange(property.key, next),
                    }))}
                  />
                );
              }

              const property = row[0];
              return (
                <PropertyField
                  key={property.key}
                  property={property}
                  value={
                    widget.properties[property.key] ??
                    (property.key === 'sourceData'
                      ? (widget.properties.options ?? widget.properties.data)
                      : undefined)
                  }
                  evaluation={
                    evaluated[`${widget.name}.${property.key}`] ??
                    (property.key === 'sourceData'
                      ? (evaluated[`${widget.name}.options`] ?? evaluated[`${widget.name}.data`])
                      : undefined)
                  }
                  dsl={dsl}
                  pageId={pageId}
                  dataKeys={dataKeys}
                  onChange={(value) => onChange(property.key, value)}
                />
              );
            })}
          </Section>
        ))}

        {filter.trim() !== '' && sections.length === 0 && (
          <p className="px-3 py-6 text-center text-[11px] text-slate-400">
            No property matches “{filter}”.
          </p>
        )}

        {definition.exposedState.length > 0 && (
          <Section title="Exposed state" defaultOpen={false}>
            <ul className="flex flex-col gap-1.5">
              {definition.exposedState.map((entry) => (
                <li key={entry.key} className="text-xs">
                  <code className="text-blue-600">
                    {widget.name}.{entry.key}
                  </code>
                  <span className="ml-1 text-slate-400">— {entry.description}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}

const PAGE_COLUMNS = 24;
const GRID_BASE = { w: 12, h: 10 };

function gridCanvasLayout(
  layout: { x: number; y: number; w: number; h: number },
  scale: number,
): { x: number; w: number; h: number } {
  const w = scale === 1 ? GRID_BASE.w : PAGE_COLUMNS;
  const h = GRID_BASE.h * scale;
  return { x: Math.min(layout.x, PAGE_COLUMNS - w), w, h };
}

function widthOptions(parent: WidgetDsl): number[] {
  const columns = Math.max(1, Number(parent.properties.columns ?? 3));
  const options = [1, 2, 3].filter((span) => span <= columns);
  if (!options.includes(columns)) options.push(columns);
  return options;
}

function spanLabels(options: number[]): Record<number, string> {
  return Object.fromEntries(options.map((span) => [span, `${span}×`]));
}

function setChildSpan(
  widget: WidgetDsl,
  parent: WidgetDsl,
  onChange: (key: string, value: unknown) => void,
  key: 'colSpan' | 'rowSpan',
  span: number,
): void {
  if (key === 'rowSpan') {
    onChange('rowSpan', span);
    return;
  }

  const columns = Math.max(1, Number(parent.properties.columns ?? 3));
  const nextSpan = Math.max(1, Math.min(span, columns));
  const col = Number(widget.properties.col ?? 0);
  const nextCol = Math.min(col, columns - nextSpan);
  onChange('colSpan', nextSpan);
  if (nextCol !== col) onChange('col', nextCol);
}

function SizeToggle({
  value,
  options,
  labels,
  onChange,
}: {
  value: number;
  options: number[];
  labels: Record<number, string>;
  onChange: (value: number) => void;
}) {
  return (
    <SegmentedControl
      value={String(value)}
      options={options.map((option) => ({
        value: String(option),
        label: labels[option] ?? `${option}×`,
      }))}
      onChange={(next) => onChange(Number(next))}
    />
  );
}

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-slate-200">
      {/* Sticky, so a long section still tells you which group you are inside
          once its first fields have scrolled past. */}
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        className="sticky top-0 z-10 flex w-full items-center gap-1.5 bg-white/95 px-3 py-2 text-left backdrop-blur transition-colors hover:bg-slate-50"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden="true"
          className={clsx('text-slate-400 transition-transform', open ? 'rotate-90' : 'rotate-0')}
        >
          <path
            d="M3.5 2 7 5 3.5 8"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
          {title}
        </span>
      </button>
      {open && <div className="flex flex-col gap-3 px-3 pt-0.5 pb-3">{children}</div>}
    </div>
  );
}

function PropertyField({
  property,
  value,
  evaluation,
  dsl,
  pageId,
  dataKeys,
  onChange,
}: {
  property: PropertyDefinition;
  value: unknown;
  evaluation?: { value: unknown; error?: { message: string } };
  dsl: ApplicationDsl;
  pageId: string;
  /** Column names from the widget's bound data, for the column editor. */
  dataKeys: string[];
  onChange: (value: unknown) => void;
}) {
  const isBound = typeof value === 'string' && value.includes('{{');

  /*
   * "Changed" means changed from the widget's own default, which is what makes
   * the reset worth showing at all: on a panel of twenty fields it says which
   * ones someone actually touched.
   */
  const changed =
    property.defaultValue !== undefined &&
    value !== undefined &&
    JSON.stringify(value) !== JSON.stringify(property.defaultValue);

  const jsBadge = property.bindable ? (
    <span
      className={clsx(
        'rounded px-1 text-[9px] font-semibold tracking-wide',
        isBound ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400',
      )}
      title={isBound ? 'Bound to an expression' : 'Accepts {{ }} bindings'}
    >
      JS
    </span>
  ) : null;

  const reset =
    changed ? (
      <button
        type="button"
        title={`Reset ${property.label} to its default`}
        onClick={(event) => {
          event.preventDefault();
          onChange(property.defaultValue);
        }}
        className="rounded px-1 text-[10px] text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-600"
      >
        Reset
      </button>
    ) : null;

  if (property.control === 'toggle') {
    const styleKind = styleToggleKind(property.key);
    const checked = toggleChecked(value, property.defaultValue);
    if (styleKind) {
      return (
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-slate-600">{property.label}</span>
              {jsBadge}
              {reset && <span className="ml-auto">{reset}</span>}
            </span>
          </div>
          <StyleToggleButton
            kind={styleKind}
            checked={checked}
            onChange={(next) => onChange(next)}
          />
        </div>
      );
    }

    /*
     * Same 32px chip as Border / Shadow so a lone switch (Wrap lines) does not
     * sit 18px high beside the segmented rows and number inputs.
     */
    return (
      <div className="flex flex-col gap-1">
        <ToggleButtonRow
          items={[
            {
              key: property.key,
              label: property.label,
              checked,
              onChange: (next) => onChange(next),
            },
          ]}
        />
        {property.helpText && !isBound && (
          <span className="text-[11px] leading-snug text-slate-400">{property.helpText}</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium text-slate-600">{property.label}</span>
        {jsBadge}
        {reset && <span className="ml-auto">{reset}</span>}
      </span>

      <Control
        property={property}
        value={value}
        dsl={dsl}
        pageId={pageId}
        dataKeys={dataKeys}
        onChange={onChange}
      />

      {property.helpText && !isBound && (
        <span className="text-[11px] leading-snug text-slate-400">{property.helpText}</span>
      )}

      {isBound && evaluation && (
        <div
          className={clsx(
            'rounded-md border px-1.5 py-1 font-mono text-[10px] leading-snug break-all',
            evaluation.error
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-slate-200 bg-slate-50 text-slate-500',
          )}
        >
          {evaluation.error ? evaluation.error.message : preview(evaluation.value)}
        </div>
      )}
    </div>
  );
}

function styleToggleKind(key: string): 'italic' | 'underline' | null {
  if (key.endsWith('Italic')) return 'italic';
  if (key.endsWith('Underline')) return 'underline';
  return null;
}

/** Default-true flags (Border, Shadow) stay on until someone turns them off. */
function toggleChecked(value: unknown, defaultValue: unknown): boolean {
  if (value === undefined) return Boolean(defaultValue);
  return Boolean(value);
}

function groupPropertyRows(properties: PropertyDefinition[]): PropertyDefinition[][] {
  const rows: PropertyDefinition[][] = [];
  for (let index = 0; index < properties.length; index += 1) {
    const current = properties[index];
    const next = properties[index + 1];
    if (next && isBorderShadowRow([current, next])) {
      rows.push([current, next]);
      index += 1;
      continue;
    }
    rows.push([current]);
  }
  return rows;
}

function isBorderShadowRow(row: PropertyDefinition[]): row is [PropertyDefinition, PropertyDefinition] {
  if (row.length !== 2) return false;
  const keys = new Set(row.map((property) => property.key));
  return keys.has('bordered') && keys.has('shadow');
}

function ToggleButtonRow({
  items,
}: {
  items: { key: string; label: string; checked: boolean; onChange: (next: boolean) => void }[];
}) {
  return (
    <div
      role="group"
      className="grid gap-0.5 rounded-lg bg-slate-100 p-0.5"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-pressed={item.checked}
          title={item.checked ? `Turn ${item.label.toLowerCase()} off` : `Turn ${item.label.toLowerCase()} on`}
          onClick={() => item.onChange(!item.checked)}
          className={clsx(
            'flex h-8 items-center justify-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-all',
            item.checked
              ? 'bg-white text-slate-900 shadow-sm ring-1 ring-black/4'
              : 'text-slate-500 hover:text-slate-800',
          )}
        >
          <ToggleGlyph kind={item.key} />
          <span className="truncate">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

function ToggleGlyph({ kind }: { kind: string }) {
  if (kind === 'bordered') {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="shrink-0">
        <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }

  if (kind === 'shadow') {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="shrink-0">
        <rect x="1.25" y="1.25" width="7.5" height="7.5" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M4.5 9.6h4.3c.9 0 1.45-.55 1.45-1.45V3.9"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (kind === 'wrap') {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="shrink-0">
        <path d="M2 3h8M2 6h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <path
          d="M2 9h4.2M9.4 6.6v1.1c0 .9-.7 1.6-1.6 1.6H6.3"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <path
          d="M7.2 8.3 6.2 9.3l1 1"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return null;
}

function StyleToggleButton({
  kind,
  checked,
  onChange,
}: {
  kind: 'italic' | 'underline';
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      title={kind === 'italic' ? 'Italic' : 'Underline'}
      onClick={() => onChange(!checked)}
      className={clsx(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm transition-colors',
        checked
          ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
          : 'bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-800',
      )}
    >
      {kind === 'italic' ? <span className="italic">I</span> : <span className="underline">U</span>}
    </button>
  );
}

function Control({
  property,
  value,
  dsl,
  pageId,
  dataKeys,
  onChange,
}: {
  property: PropertyDefinition;
  value: unknown;
  dsl: ApplicationDsl;
  pageId: string;
  dataKeys: string[];
  onChange: (value: unknown) => void;
}) {
  switch (property.control) {
    case 'toggle':
      return <Switch checked={Boolean(value)} onChange={(next) => onChange(next)} />;

    case 'number':
      return (
        <input
          type="number"
          value={value === undefined ? '' : String(value)}
          onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
          className={control}
        />
      );

    case 'color':
      // The swatch alone does not say which colour is set; the hex beside it is
      // what someone reads off to match another widget.
      return <ColorField value={value} onChange={onChange} />;

    case 'select': {
      // The definition's own options win. SELECT_OPTIONS is the fallback for the
      // built-ins that predate the field, and is what a custom component cannot
      // add to.
      const options: { value: string; label: string; disabled?: boolean }[] =
        property.options ??
        (SELECT_OPTIONS[property.key] ?? []).map((option) => ({ value: option, label: option }));

      const selected = String(value ?? property.defaultValue ?? '');
      if (shouldUseSegmented(property.key, options)) {
        return (
          <SegmentedControl
            value={selected}
            options={options}
            icons={segmentIconsFor(property.key)}
            onChange={onChange}
          />
        );
      }

      return (
        <Select value={selected} onChange={onChange}>
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </Select>
      );
    }

    case 'query_picker':
      return (
        <Select value={String(value ?? '')} onChange={onChange}>
          <option value="">None</option>
          {queriesOnPage(dsl.queries, pageId).map((query) => (
            <option key={query.id} value={query.name}>
              {query.name}
            </option>
          ))}
        </Select>
      );

    case 'page_picker':
      return (
        <Select value={String(value ?? '')} onChange={onChange}>
          <option value="">None</option>
          {dsl.pages.map((page) => (
            <option key={page.id} value={page.id}>
              {page.name}
            </option>
          ))}
        </Select>
      );

    case 'js_function':
      return (
        <JsFunctionPicker
          value={value}
          pageId={pageId}
          dsl={dsl}
          placeholder={property.placeholder}
          onChange={onChange}
        />
      );

    case 'textarea':
    case 'code':
    case 'json':
      return (
        <textarea
          rows={property.control === 'textarea' ? 2 : 4}
          value={typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value, null, 2)}
          placeholder={property.placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={clsx(control, 'resize-y font-mono leading-snug')}
          spellCheck={false}
        />
      );

    case 'validation_rules':
      return <ValidationEditor rules={(value as ValidationRule[]) ?? []} onChange={onChange} />;

    case 'tab_list':
      return <TabListEditor tabs={normaliseTabs(value)} onChange={onChange} />;

    case 'icon':
      return <IconPicker value={value} onChange={(next) => onChange(next)} />;

    case 'spacing':
      return <SpacingEditor value={value} onChange={onChange} />;

    case 'column_config':
      return (
        <ColumnConfigEditor
          value={value}
          availableKeys={dataKeys}
          dsl={dsl}
          pageId={pageId}
          onChange={onChange}
        />
      );

    case 'action_list':
      return <ActionEditor actions={value} dsl={dsl} pageId={pageId} onChange={onChange} />;

    default: {
      const current = value === undefined ? '' : String(value);
      if (FIELD_KEY_PROPERTIES.has(property.key) && dataKeys.length > 0) {
        const options = dataKeys.includes(current) || current === '' ? dataKeys : [current, ...dataKeys];
        return (
          <Select value={current} onChange={onChange}>
            <option value="">None</option>
            {options.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </Select>
        );
      }

      return (
        <input
          type="text"
          value={current}
          onChange={(event) => onChange(event.target.value)}
          className={control}
        />
      );
    }
  }
}

const FIELD_KEY_PROPERTIES = new Set([
  'titleKey',
  'subtitleKey',
  'valueKey',
  'labelKey',
  'descriptionKey',
  'metaKey',
  'imageKey',
  'rowKey',
]);

const SELECT_OPTIONS: Record<string, string[]> = {
  variant: ['primary', 'secondary', 'danger', 'body', 'heading', 'subheading', 'caption'],
  align: ['left', 'center', 'right'],
  inputType: ['text', 'password', 'email', 'number', 'tel', 'date'],
  labelDisplay: ['text', 'icon', 'icon_text', 'hidden'],
  rowMode: ['auto', 'fixed'],
  alignItems: ['stretch', 'start', 'center', 'end'],
  justifyItems: ['stretch', 'start', 'center', 'end'],
  shadow: ['none', 'sm', 'md', 'lg'],
  fit: ['contain', 'cover', 'fill'],
  orientation: ['horizontal', 'vertical'],
  direction: ['vertical', 'horizontal'],
  size: ['small', 'medium', 'large'],
  format: ['plain', 'currency', 'percent'],
  chartType: ['bar', 'line', 'area', 'pie'],
};

function JsFunctionPicker({
  value,
  pageId,
  dsl,
  placeholder,
  onChange,
}: {
  value: unknown;
  pageId: string;
  dsl: ApplicationDsl;
  placeholder?: string;
  onChange: (value: unknown) => void;
}) {
  const visible = jsObjectsOnPage(dsl.jsObjects, pageId);
  const functions = listJsFunctions(visible);
  const compileErrors = jsObjectCompileErrors(visible);
  const selected = pathFromJsCall(value);
  const groups = new Map<string, typeof functions>();
  for (const fn of functions) {
    const group = groups.get(fn.objectName) ?? [];
    group.push(fn);
    groups.set(fn.objectName, group);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Select
        value={selected}
        onChange={(path) => onChange(path ? jsCallBinding(path) : '')}
      >
        <option value="">Choose a function…</option>
        {[...groups.entries()].map(([objectName, entries]) => (
          <optgroup key={objectName} label={objectName}>
            {entries.map((entry) => (
              <option key={entry.path} value={entry.path}>
                {entry.functionName}()
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      <textarea
        rows={2}
        value={typeof value === 'string' ? value : ''}
        placeholder={placeholder ?? '{{ Utils.getOptions() }}'}
        onChange={(event) => onChange(event.target.value)}
        className={clsx(control, 'resize-y font-mono leading-snug')}
        spellCheck={false}
      />
      {compileErrors.map((entry) => (
        <span key={entry.name} className="text-[11px] text-red-600">
          {entry.name} has a syntax error, so its functions are missing from this list. Open the
          JS tab and fix it.
        </span>
      ))}
      {functions.length === 0 && compileErrors.length === 0 && (
        <span className="text-[11px] text-slate-400">
          Create a JS object on this page, export a function that returns the options, then pick it here.
        </span>
      )}
    </div>
  );
}

function ValidationEditor({
  rules,
  onChange,
}: {
  rules: ValidationRule[];
  onChange: (rules: ValidationRule[]) => void;
}) {
  const kinds: ValidationRule['kind'][] = [
    'required', 'minLength', 'maxLength', 'min', 'max',
    'email', 'url', 'numeric', 'integer', 'regex', 'custom',
  ];

  return (
    <div className="no-drag flex flex-col gap-1.5">
      {rules.map((rule, index) => (
        <div key={index} className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50/70 p-1.5">
          <Select
            value={rule.kind}
            onChange={(selected) => {
              const next = [...rules];
              next[index] = { ...rule, kind: selected as ValidationRule['kind'] };
              onChange(next);
            }}
            compact
          >
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </Select>

          {NEEDS_VALUE.has(rule.kind) && (
            <input
              type={rule.kind === 'min' || rule.kind === 'max' || rule.kind === 'minLength' || rule.kind === 'maxLength' ? 'number' : 'text'}
              value={rule.value ?? ''}
              onChange={(event) => {
                const next = [...rules];
                const raw = event.target.value;
                next[index] = {
                  ...rule,
                  value:
                    event.target.type === 'number'
                      ? raw === ''
                        ? ''
                        : Number(raw)
                      : raw,
                };
                onChange(next);
              }}
              placeholder="value"
              className={clsx(controlCompact, "w-14")}
            />
          )}

          <input
            value={rule.message}
            onChange={(event) => {
              const next = [...rules];
              next[index] = { ...rule, message: event.target.value };
              onChange(next);
            }}
            placeholder="Error message"
            className={clsx(controlCompact, "min-w-0 flex-1")}
          />

          <button
            type="button"
            onClick={() => onChange(rules.filter((_, i) => i !== index))}
            className={clsx(ghostButton, "shrink-0 hover:bg-red-50 hover:text-red-600")}
          >
            ×
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...rules, { kind: 'required', message: '' }])}
        className={dashedButton}
      >
        + Add rule
      </button>
    </div>
  );
}

const NEEDS_VALUE = new Set(['minLength', 'maxLength', 'min', 'max', 'regex', 'custom', 'matchesField']);


/** Reads the tab/panel list off a container, tolerating a half-edited JSON value. */
function tabsOf(parent: WidgetDsl, key: string = 'tabs'): { id: string; label: string }[] {
  const raw = parent.properties[key];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry, index) => {
    if (entry === null || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const id = String(record.id ?? `tab${index + 1}`);
    return [{ id, label: String(record.label ?? id) }];
  });
}

function isVisible(property: PropertyDefinition, properties: Record<string, unknown>): boolean {
  const condition = property.visibleWhen;
  if (!condition) return true;

  const value = properties[condition.key];
  if (condition.oneOf) return condition.oneOf.includes(value);
  return value === condition.equals;
}

function preview(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `Array(${value.length})  ${truncate(JSON.stringify(value))}`;
  if (typeof value === 'object') return truncate(JSON.stringify(value));
  return truncate(String(value));
}

function truncate(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
