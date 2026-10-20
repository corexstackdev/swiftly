import { useEffect, useMemo } from 'react';
import clsx from 'clsx';
import type { WidgetDsl } from '@swiftly/shared';
import type { RegisteredWidget, WidgetHost, WidgetProps } from './types';
import { clampToBounds, constrainNumeric, mergeFieldRules, validate } from './validation';
import { spacingChromeRows, spacingToCss } from '@/editor/SpacingEditor';

/** Controls whose `value` a Form collects. Anything else is layout or display. */
const FIELD_TYPES = new Set([
  'input',
  'number_input',
  'currency_input',
  'select',
  'date_picker',
  'checkbox',
  'checkbox_group',
  'radio_group',
  'switch',
  'slider',
  'rating',
]);

/**
 * Form — a container you drop any controls into, then submit.
 *
 * Nothing is pre-seeded. The builder places Input, Select, DatePicker, or any
 * other widget inside, and marks required on that control's own Validation
 * rules. Submit walks those children, blocks while any required field is empty,
 * and writes the payload as `{{ Form1.data.Input1 }}`.
 */

function FormWidget({
  widget,
  properties,
  state,
  setState,
  fireEvent,
  renderChildren,
  children = [],
  host,
  isDesignMode,
}: WidgetProps) {
  const fields = useMemo(() => collectFields(children), [children]);
  const snapshot = useMemo(
    () => evaluateFields(fields, host),
    [fields, host.widgetState, host.propertiesOf],
  );

  useEffect(() => {
    if (
      JSON.stringify(state.data) === JSON.stringify(snapshot.data) &&
      state.isValid === snapshot.isValid
    ) {
      return;
    }
    setState({
      data: snapshot.data,
      values: snapshot.data,
      isValid: snapshot.isValid,
      errors: snapshot.errors,
    });
  }, [snapshot, state.data, state.isValid, setState]);

  const submit = (): void => {
    const next = evaluateFields(fields, host);
    for (const field of fields) {
      host.setWidgetState?.(field.name, { touched: true, isValid: !next.errors[field.name] });
    }
    setState({
      data: next.data,
      values: next.data,
      isValid: next.isValid,
      errors: next.errors,
      submitAttempted: true,
    });
    if (!next.isValid) return;

    const count = Number(state.submitCount ?? 0) + 1;
    setState({ submitted: true, submitCount: count });
    fireEvent('onSubmit', { data: next.data });
  };

  const reset = (): void => {
    const cleared: Record<string, unknown> = {};
    for (const field of fields) {
      const props = host.propertiesOf?.(field.name) ?? field.properties;
      const value = defaultFieldValue(field.type, props.defaultValue);
      cleared[field.name] = value;
      host.setWidgetState?.(field.name, { value, touched: false, isValid: true });
    }
    setState({
      data: cleared,
      values: cleared,
      isValid: true,
      errors: {},
      submitted: false,
      submitAttempted: false,
    });
    fireEvent('onReset', { data: cleared });
  };

  const showReset = properties.showReset !== false;
  const submitted = Boolean(state.submitted);
  const successText = String(properties.successMessage ?? 'Submitted.');
  const showErrors = Boolean(state.submitAttempted) && !snapshot.isValid;
  const buttonAlign = String(properties.buttonAlign ?? 'left');

  return (
    <div
      role="form"
      className={clsx(
        'flex h-full w-full flex-col',
        // Hidden overflow clips the drag handle that sits above each child.
        isDesignMode ? 'overflow-visible' : 'overflow-hidden',
        properties.bordered !== false && 'rounded border border-slate-200',
      )}
      style={{
        background: String(properties.background ?? '#ffffff'),
      }}
    >
      {properties.title || (isDesignMode && host.openFormTableImport && children.length > 0) ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
          <span className="truncate text-sm font-medium text-slate-700">
            {properties.title ? String(properties.title) : ''}
          </span>
          {isDesignMode && host.openFormTableImport && children.length > 0 ? (
            <button
              type="button"
              title="Generate fields from a database table"
              className="no-drag shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-blue-600 hover:bg-blue-50"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                host.openFormTableImport?.(widget.id);
              }}
            >
              Import
            </button>
          ) : null}
        </div>
      ) : null}

      {properties.description ? (
        <p className="shrink-0 px-3 pt-2 text-xs text-slate-500">{String(properties.description)}</p>
      ) : null}

      <div
        className={clsx('relative min-h-0 flex-1', isDesignMode && 'overflow-visible')}
        style={{ padding: spacingToCss(properties.padding, 8) }}
      >
        {renderChildren?.()}
      </div>

      {submitted && successText ? (
        <p className="shrink-0 px-3 text-xs text-emerald-700">{successText}</p>
      ) : null}

      {showErrors ? (
        <p className="shrink-0 px-3 text-xs text-red-600">Fix the highlighted fields before submitting.</p>
      ) : null}

      <div
        className={clsx(
          'mt-auto flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-100 px-3 py-2',
          buttonAlign === 'right' ? 'justify-end' : 'justify-start',
        )}
      >
        <button
          type="button"
          disabled={Boolean(properties.disabled)}
          onClick={submit}
          className={clsx(
            'no-drag rounded px-3 py-1.5 text-sm font-medium text-white',
            'bg-blue-600 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {String(properties.submitLabel ?? 'Submit')}
        </button>
        {showReset && (
          <button
            type="button"
            disabled={Boolean(properties.disabled)}
            onClick={reset}
            className="no-drag rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {String(properties.resetLabel ?? 'Reset')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Widgets that expose a `value` — those are the fields a Form collects. */
function collectFields(widgets: WidgetDsl[]): WidgetDsl[] {
  const fields: WidgetDsl[] = [];
  const walk = (nodes: WidgetDsl[]): void => {
    for (const node of nodes) {
      if (FIELD_TYPES.has(node.type)) fields.push(node);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(widgets);
  return fields;
}

function evaluateFields(
  fields: WidgetDsl[],
  host: WidgetHost,
): { data: Record<string, unknown>; isValid: boolean; errors: Record<string, string> } {
  const data: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  let isValid = true;

  for (const field of fields) {
    const props = host.propertiesOf?.(field.name) ?? field.properties;
    const stored = host.widgetState?.[field.name] ?? {};
    let value =
      stored.value !== undefined ? stored.value : defaultFieldValue(field.type, props.defaultValue);
    if (field.type === 'currency_input') {
      value = constrainNumeric(value, props);
    } else if (field.type === 'number_input') {
      value = clampToBounds(value, props);
    }
    data[field.name] = value;

    const rules = mergeFieldRules(props);
    if (rules.length === 0) continue;

    const outcome = validate(value, rules);
    if (!outcome.isValid) {
      isValid = false;
      errors[field.name] = outcome.errors[0] ?? `${field.name} is invalid`;
    }
  }

  return { data, isValid, errors };
}

function defaultFieldValue(type: string, configured: unknown): unknown {
  if (configured !== undefined) return configured;
  if (type === 'checkbox' || type === 'switch') return false;
  if (type === 'checkbox_group') return [];
  if (type === 'slider' || type === 'rating') return 0;
  return '';
}

export const formWidget: RegisteredWidget = {
  component: FormWidget,
  chromeRows: (properties) => {
    let rows = 3;
    if (properties.title) rows += 2;
    if (properties.description) rows += 2;
    return rows + spacingChromeRows(properties.padding, 8);
  },
  definition: {
    type: 'form',
    displayName: 'Form',
    category: 'input',
    icon: 'form',
    isContainer: true,
    defaultLayout: { x: 0, y: 0, w: 12, h: 10 },
    minSize: { w: 4, h: 6 },
    events: [
      { key: 'onSubmit', label: 'On submit', payloadKeys: ['data'] },
      { key: 'onReset', label: 'On reset', payloadKeys: ['data'] },
    ],
    exposedState: [
      { key: 'data', type: 'object', description: 'Values of every control inside the form, keyed by widget name' },
      { key: 'values', type: 'object', description: 'Current field values' },
      { key: 'isValid', type: 'boolean', description: 'Whether every required child is valid' },
      { key: 'errors', type: 'object', description: 'Per-widget error messages' },
      { key: 'submitted', type: 'boolean', description: 'Whether the form has been submitted' },
      { key: 'submitCount', type: 'number', description: 'How many times Submit succeeded' },
    ],
    properties: [
      {
        name: 'Content',
        properties: [
          {
            key: 'title',
            label: 'Title',
            control: 'text',
            expectedType: 'string',
            bindable: true,
            defaultValue: 'Form',
          },
          {
            key: 'description',
            label: 'Description',
            control: 'textarea',
            expectedType: 'string',
            bindable: true,
            defaultValue: '',
            helpText:
              'Drop Input, Select, or any control into this form, or import columns from a table. Mark required on that control.',
          },
        ],
      },
      {
        name: 'Actions',
        properties: [
          {
            key: 'buttonAlign',
            label: 'Button alignment',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'left',
            options: [
              { value: 'left', label: 'Left' },
              { value: 'right', label: 'Right' },
            ],
            helpText: 'Where Submit and Reset sit on the form footer.',
          },
          {
            key: 'submitLabel',
            label: 'Submit label',
            control: 'text',
            expectedType: 'string',
            bindable: true,
            defaultValue: 'Submit',
          },
          {
            key: 'showReset',
            label: 'Show reset',
            control: 'toggle',
            expectedType: 'boolean',
            bindable: false,
            defaultValue: true,
          },
          {
            key: 'resetLabel',
            label: 'Reset label',
            control: 'text',
            expectedType: 'string',
            bindable: true,
            defaultValue: 'Reset',
            visibleWhen: { key: 'showReset', equals: true },
          },
          {
            key: 'successMessage',
            label: 'Success message',
            control: 'text',
            expectedType: 'string',
            bindable: true,
            defaultValue: 'Submitted.',
          },
          {
            key: 'onSubmit',
            label: 'On submit',
            control: 'action_list',
            expectedType: 'any',
            bindable: false,
            helpText: 'Runs after every required child is valid. Payload is event.data.',
          },
          {
            key: 'onReset',
            label: 'On reset',
            control: 'action_list',
            expectedType: 'any',
            bindable: false,
          },
        ],
      },
      {
        name: 'Appearance',
        properties: [
          {
            key: 'padding',
            label: 'Padding',
            control: 'spacing',
            expectedType: 'any',
            bindable: false,
            defaultValue: 8,
          },
          {
            key: 'bordered',
            label: 'Border',
            control: 'toggle',
            expectedType: 'boolean',
            bindable: false,
            defaultValue: true,
          },
          {
            key: 'background',
            label: 'Background',
            control: 'color',
            expectedType: 'string',
            bindable: false,
            defaultValue: '#ffffff',
          },
          {
            key: 'disabled',
            label: 'Disabled',
            control: 'toggle',
            expectedType: 'boolean',
            bindable: true,
            defaultValue: false,
          },
        ],
      },
    ],
  },
};
