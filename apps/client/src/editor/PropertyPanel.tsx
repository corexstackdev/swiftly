import { useMemo, useState } from 'react';
import clsx from 'clsx';
import type {
  ApplicationDsl,
  PropertyDefinition,
  ValidationRule,
  WidgetDsl,
} from '@vinodapp/shared';
import { getWidgetDefinition } from '@/widgets/registry';
import { TabListEditor, normaliseTabs } from './TabListEditor';
import { SpacingEditor } from './SpacingEditor';
import { ColumnConfigEditor } from './ColumnConfigEditor';
import { asRows } from '@/widgets/coerce';
import { Select, control, controlCompact, dashedButton, ghostButton } from './controls';

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
  evaluated,
  onChange,
  onRename,
  onDelete,
}: {
  widget: WidgetDsl | null;
  /** The container holding this widget, if any. Drives layout-slot properties. */
  parent: WidgetDsl | null;
  dsl: ApplicationDsl;
  evaluated: Record<string, { value: unknown; error?: { message: string } }>;
  onChange: (key: string, value: unknown) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  if (!widget) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
        <p className="text-xs font-medium text-slate-500">Nothing selected</p>
        <p className="max-w-[15rem] text-[11px] text-slate-400">
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
      evaluated={evaluated}
      onChange={onChange}
      onRename={onRename}
      onDelete={onDelete}
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
  evaluated,
  onChange,
  onRename,
  onDelete,
}: {
  widget: WidgetDsl;
  parent: WidgetDsl | null;
  definition: NonNullable<ReturnType<typeof getWidgetDefinition>>;
  dsl: ApplicationDsl;
  evaluated: Record<string, { value: unknown; error?: { message: string } }>;
  onChange: (key: string, value: unknown) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [filter, setFilter] = useState('');

  /*
   * The column names the bound data actually has. Read from the evaluated value
   * rather than the expression, so `{{ GetOrders.data }}` yields the query's real
   * columns and the column editor can offer them instead of asking someone to
   * retype keys they already have.
   */
  const dataKeys = useMemo(() => {
    // The evaluated value when the property is bound, the raw one when a list
    // was pasted in — and through the same coercion the widget uses, so the
    // editor cannot decide there is no data while the table is showing rows.
    const evaluation = evaluated[`${widget.name}.data`];
    const rows = asRows(evaluation ? evaluation.value : widget.properties.data);
    return rows[0] ? Object.keys(rows[0]) : [];
  }, [evaluated, widget.name, widget.properties.data]);

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
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
            {definition.displayName}
          </span>
          <button
            type="button"
            onClick={onDelete}
            title={`Delete ${widget.name}`}
            className="ml-auto rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            Delete
          </button>
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
      </div>

      {/* A Table or a Chart carries more properties than fit on a screen, so past
          a certain count the panel gets a way to jump straight to one. Below it,
          the box is one more thing in the way. */}
      {propertyCount > FILTER_THRESHOLD && (
        <div className="shrink-0 border-b border-slate-200 px-3 py-2">
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter properties"
            aria-label="Filter properties"
            className={control}
          />
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {parent?.type === 'grid' && (
          <Section title="Cell">
            {/* A child's footprint lives on the child, so moving it between
                containers carries its own sizing with it. */}
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-slate-600">Column span</span>
                <input
                  type="number"
                  min={1}
                  value={Number(widget.properties.colSpan ?? 1)}
                  onChange={(event) => onChange('colSpan', Math.max(1, Number(event.target.value)))}
                  className={control}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-slate-600">Row span</span>
                <input
                  type="number"
                  min={1}
                  value={Number(widget.properties.rowSpan ?? 1)}
                  onChange={(event) => onChange('rowSpan', Math.max(1, Number(event.target.value)))}
                  className={control}
                />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-slate-600">Order</span>
              <input
                type="number"
                value={widget.properties.order === undefined ? '' : Number(widget.properties.order)}
                placeholder="as placed"
                onChange={(event) =>
                  onChange('order', event.target.value === '' ? undefined : Number(event.target.value))
                }
                className={control}
              />
              <span className="text-[11px] text-slate-400">
                Lower comes first. Blank keeps the order they were added in.
              </span>
            </label>
            <p className="text-[11px] text-slate-400">
              A span is clamped to the columns actually showing, so a wide tile still fits
              once the grid collapses.
            </p>
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

        {sections.map((section) => (
          <Section key={section.name} title={section.name}>
            {section.properties.map((property) => (
              <PropertyField
                key={property.key}
                property={property}
                value={widget.properties[property.key]}
                evaluation={evaluated[`${widget.name}.${property.key}`]}
                dsl={dsl}
                dataKeys={dataKeys}
                onChange={(value) => onChange(property.key, value)}
              />
            ))}
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
        <span
          aria-hidden="true"
          className={clsx(
            'text-[8px] text-slate-400 transition-transform',
            open ? 'rotate-90' : 'rotate-0',
          )}
        >
          ▶
        </span>
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
  dataKeys,
  onChange,
}: {
  property: PropertyDefinition;
  value: unknown;
  evaluation?: { value: unknown; error?: { message: string } };
  dsl: ApplicationDsl;
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

  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium text-slate-600">{property.label}</span>

        {property.bindable && (
          <span
            className={clsx(
              'rounded px-1 text-[9px] font-semibold tracking-wide',
              isBound ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400',
            )}
            title={isBound ? 'Bound to an expression' : 'Accepts {{ }} bindings'}
          >
            JS
          </span>
        )}

        {changed && (
          <button
            type="button"
            title={`Reset ${property.label} to its default`}
            onClick={(event) => {
              // The label wraps the control, so a click here would otherwise
              // land on the field and move the caret instead of resetting.
              event.preventDefault();
              onChange(property.defaultValue);
            }}
            className="ml-auto rounded px-1 text-[10px] text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            Reset
          </button>
        )}
      </span>

      <Control
        property={property}
        value={value}
        dsl={dsl}
        dataKeys={dataKeys}
        onChange={onChange}
      />

      {property.helpText && !isBound && (
        <span className="text-[11px] leading-snug text-slate-400">{property.helpText}</span>
      )}

      {isBound && evaluation && (
        <div
          className={clsx(
            'rounded border px-1.5 py-1 font-mono text-[10px] leading-snug break-all',
            evaluation.error
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-slate-200 bg-slate-50 text-slate-500',
          )}
        >
          {evaluation.error ? evaluation.error.message : preview(evaluation.value)}
        </div>
      )}
    </label>
  );
}

function Control({
  property,
  value,
  dsl,
  dataKeys,
  onChange,
}: {
  property: PropertyDefinition;
  value: unknown;
  dsl: ApplicationDsl;
  dataKeys: string[];
  onChange: (value: unknown) => void;
}) {
  switch (property.control) {
    case 'toggle':
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          className="no-drag h-3.5 w-3.5 self-start rounded accent-blue-600"
        />
      );

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
      return (
        <span className="flex items-center gap-2">
          <input
            type="color"
            value={String(value ?? '#ffffff')}
            onChange={(event) => onChange(event.target.value)}
            className="no-drag h-7 w-10 shrink-0 cursor-pointer rounded border border-slate-300"
          />
          <input
            type="text"
            value={String(value ?? '')}
            placeholder="#ffffff"
            onChange={(event) => onChange(event.target.value)}
            className={clsx(control, 'font-mono uppercase')}
          />
        </span>
      );

    case 'select': {
      // The definition's own options win. SELECT_OPTIONS is the fallback for the
      // built-ins that predate the field, and is what a custom component cannot
      // add to.
      const options =
        property.options ??
        (SELECT_OPTIONS[property.key] ?? []).map((option) => ({ value: option, label: option }));

      return (
        <Select value={String(value ?? '')} onChange={onChange}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
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
          {dsl.queries.map((query) => (
            <option key={query.id} value={query.name}>
              {query.name}
            </option>
          ))}
        </Select>
      );

    case 'textarea':
    case 'code':
    case 'json':
      return (
        <textarea
          rows={property.control === 'textarea' ? 2 : 4}
          value={typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value, null, 2)}
          onChange={(event) => onChange(event.target.value)}
          className={clsx(control, 'resize-y font-mono leading-snug')}
          spellCheck={false}
        />
      );

    case 'validation_rules':
      return <ValidationEditor rules={(value as ValidationRule[]) ?? []} onChange={onChange} />;

    case 'tab_list':
      return <TabListEditor tabs={normaliseTabs(value)} onChange={onChange} />;

    case 'spacing':
      return <SpacingEditor value={value} onChange={onChange} />;

    case 'column_config':
      return (
        <ColumnConfigEditor value={value} availableKeys={dataKeys} onChange={onChange} />
      );

    case 'action_list':
      return <ActionEditor actions={value} dsl={dsl} onChange={onChange} />;

    default:
      return (
        <input
          type="text"
          value={value === undefined ? '' : String(value)}
          onChange={(event) => onChange(event.target.value)}
          className={control}
        />
      );
  }
}

const SELECT_OPTIONS: Record<string, string[]> = {
  variant: ['primary', 'secondary', 'danger', 'body', 'heading', 'subheading', 'caption'],
  align: ['left', 'center', 'right'],
  inputType: ['text', 'password', 'email', 'number', 'tel', 'date'],
  labelDisplay: ['text', 'icon', 'icon_text'],
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
        <div key={index} className="flex items-center gap-1 rounded border border-slate-200 bg-slate-50/60 p-1.5">
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
              value={rule.value ?? ''}
              onChange={(event) => {
                const next = [...rules];
                next[index] = { ...rule, value: event.target.value };
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

function ActionEditor({
  actions,
  dsl,
  onChange,
}: {
  actions: unknown;
  dsl: ApplicationDsl;
  onChange: (actions: unknown) => void;
}) {
  const list = Array.isArray(actions) ? (actions as Record<string, unknown>[]) : [];

  return (
    <div className="no-drag flex flex-col gap-1.5">
      {list.map((action, index) => (
        <div key={index} className="flex items-center gap-1 rounded border border-slate-200 bg-slate-50/60 p-1.5">
          <Select
            value={String(action.type ?? 'runQuery')}
            onChange={(selected) => {
              const next = [...list];
              next[index] = { type: selected };
              onChange(next);
            }}
            compact
          >
            <option value="runQuery">Run query</option>
            <option value="navigate">Navigate</option>
            <option value="showNotification">Notify</option>
            <option value="setState">Set state</option>
          </Select>

          {action.type === 'runQuery' && (
            <Select
              value={String(action.queryName ?? '')}
              onChange={(selected) => {
                const next = [...list];
                next[index] = { ...action, queryName: selected };
                onChange(next);
              }}
              compact
              className="min-w-0"
            >
              <option value="">Select a query</option>
              {dsl.queries.map((query) => (
                <option key={query.id} value={query.name}>
                  {query.name}
                </option>
              ))}
            </Select>
          )}

          {action.type === 'navigate' && (
            <Select
              value={String((action.to as { pageId?: string })?.pageId ?? '')}
              onChange={(selected) => {
                const next = [...list];
                next[index] = { ...action, to: { kind: 'page', pageId: selected } };
                onChange(next);
              }}
              compact
              className="min-w-0"
            >
              <option value="">Select a page</option>
              {dsl.pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.name}
                </option>
              ))}
            </Select>
          )}

          {action.type === 'showNotification' && (
            <input
              value={String(action.message ?? '')}
              onChange={(event) => {
                const next = [...list];
                next[index] = { ...action, message: event.target.value, variant: action.variant ?? 'success' };
                onChange(next);
              }}
              placeholder="Message"
              className={clsx(controlCompact, "min-w-0 flex-1")}
            />
          )}

          <button
            type="button"
            onClick={() => onChange(list.filter((_, i) => i !== index))}
            className={clsx(ghostButton, "shrink-0 hover:bg-red-50 hover:text-red-600")}
          >
            ×
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...list, { type: 'runQuery', queryName: '' }])}
        className={dashedButton}
      >
        + Add action
      </button>
    </div>
  );
}

/** Reads the tab list off a Tabs container, tolerating a half-edited JSON value. */
function tabsOf(parent: WidgetDsl): { id: string; label: string }[] {
  const raw = parent.properties.tabs;
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
