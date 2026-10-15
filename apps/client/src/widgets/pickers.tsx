import { useEffect } from 'react';
import clsx from 'clsx';
import type { TabDisplayMode } from '@swiftly/shared';
import type { RegisteredWidget, WidgetProps } from './types';
import { useSeededValue } from './useSeededValue';
import { FieldLabel, LABEL_PROPERTIES, labelProperties } from './FieldLabel';
import { fieldControlStyle, textStyleProperties, textStyleToCss } from './textStyle';
import {
  constrainNumeric,
  fieldBounds,
  mergeFieldRules,
  showFieldError,
  validate,
} from './validation';

/**
 * Numeric and date inputs.
 *
 * Both expose their value in a form bindings can use directly: the number input
 * writes a `number`, and the date picker writes an ISO `yyyy-mm-dd` string, which
 * is what every SQL dialect we target accepts as a date parameter.
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  INR: '₹',
  JPY: '¥',
  CNY: '¥',
  AUD: 'A$',
  CAD: 'C$',
};

function currencySymbolOf(properties: Record<string, unknown>): string {
  const explicit = properties.currencySymbol;
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit.trim();
  return CURRENCY_SYMBOLS[String(properties.currency ?? 'USD')] ?? '$';
}

function stepFromDecimals(decimals: unknown): number {
  const places = Number(decimals ?? 2);
  if (!Number.isFinite(places) || places <= 0) return 1;
  const n = Math.min(8, Math.trunc(places));
  return Number((1 / 10 ** n).toFixed(n));
}

/* ------------------------------------------------------------------ *
 * Number input
 * ------------------------------------------------------------------ */

function NumberInputWidget({ properties, state, setState, fireEvent, isDesignMode }: WidgetProps) {
  // Seeded like every other input. Without this the widget was the one field on
  // the palette with no default at all: you could not set one, and the canvas
  // showed an empty box whatever the panel said.
  const raw = useSeededValue(state, setState, properties.defaultValue, { isDesignMode });
  const rules = mergeFieldRules(properties);
  const bounds = fieldBounds(properties);
  const constrained = constrainNumeric(raw, properties);
  const value = constrained === undefined || constrained === null ? '' : String(constrained);
  const touched = Boolean(state.touched);
  const result = validate(value, rules);
  const showError = showFieldError(result, { touched, value });

  // Range min/max used to be HTML attributes only, which do not stop someone
  // typing 6 into a field whose minimum is 10. Keep the stored value inside
  // those bounds so the canvas, Form submit, and bindings all see the same number.
  useEffect(() => {
    if (constrained === raw) return;
    setState({
      value: constrained,
      isValid: validate(constrained === undefined || constrained === null ? '' : String(constrained), rules)
        .isValid,
    });
    // setState is recreated each render by the host; rules is rebuilt from properties.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [constrained, raw, bounds.min, bounds.max]);

  const prefix =
    properties.format === 'currency'
      ? currencySymbolOf(properties)
      : properties.format === 'percent'
        ? '%'
        : null;

  return (
    <div className="flex h-full w-full flex-col gap-1">
      <FieldLabel
        text={properties.label}
        icon={properties.labelIcon}
        display={properties.labelDisplay as TabDisplayMode | undefined}
        required={rules.some((rule) => rule.kind === 'required')}
        style={textStyleToCss(properties, 'label')}
      />

      <div className="relative min-h-0 flex-1">
        {prefix && (
          <span className="absolute top-1/2 left-2 -translate-y-1/2 text-slate-400" style={{ fontSize: fieldControlStyle(properties).fontSize }}>
            {prefix}
          </span>
        )}
        <input
          type="number"
          value={value}
          style={fieldControlStyle(properties, 'input')}
          step={Number(properties.step ?? 1)}
          min={bounds.min}
          max={bounds.max}
          placeholder={String(properties.placeholder ?? '')}
          disabled={Boolean(properties.disabled)}
          onChange={(event) => {
            // Empty stays undefined rather than becoming 0, so a cleared optional
            // field does not silently submit a value the user never typed.
            const next = event.target.value === '' ? undefined : Number(event.target.value);
            const clamped = constrainNumeric(next, properties);
            setState({
              value: clamped,
              isValid: validate(clamped === undefined || clamped === null ? '' : String(clamped), rules)
                .isValid,
            });
            fireEvent('onChange', { value: clamped });
          }}
          onBlur={() => {
            const clamped = constrainNumeric(raw, properties);
            setState({
              value: clamped,
              touched: true,
              isValid: validate(clamped === undefined || clamped === null ? '' : String(clamped), rules)
                .isValid,
            });
            if (clamped !== raw) fireEvent('onChange', { value: clamped });
          }}
          className={clsx(
            'no-drag h-full w-full rounded border px-2 outline-none focus:ring-2 focus:ring-blue-500/30',
            prefix && (String(prefix).length > 1 ? 'pl-8' : 'pl-6'),
            showError ? 'border-red-400' : 'border-slate-300 focus:border-blue-500',
            'disabled:bg-slate-50 disabled:text-slate-400',
          )}
        />
      </div>

      {showError && <p className="text-xs text-red-600">{result.errors[0]}</p>}
    </div>
  );
}

export const numberInputWidget: RegisteredWidget = {
  component: NumberInputWidget,
  definition: {
    type: 'number_input',
    displayName: 'Number Input',
    category: 'input',
    icon: 'hash',
    defaultLayout: { x: 0, y: 0, w: 4, h: 2 },
    minSize: { w: 2, h: 1 },
    events: [{ key: 'onChange', label: 'On change', payloadKeys: ['value'] }],
    exposedState: [
      { key: 'value', type: 'number', description: 'Current number' },
      { key: 'isValid', type: 'boolean', description: 'Whether validation passes' },
    ],
    properties: [
      {
        name: 'Content',
        properties: [
          ...LABEL_PROPERTIES,
          { key: 'placeholder', label: 'Placeholder', control: 'text', expectedType: 'string', bindable: true },
          { key: 'defaultValue', label: 'Default value', control: 'number', expectedType: 'number', bindable: true },
          { key: 'format', label: 'Format', control: 'select', expectedType: 'string', bindable: false, defaultValue: 'plain' },
          {
            key: 'currencySymbol',
            label: 'Currency symbol',
            control: 'text',
            expectedType: 'string',
            bindable: false,
            defaultValue: '$',
            visibleWhen: { key: 'format', equals: 'currency' },
          },
        ],
      },
      {
        name: 'Range',
        properties: [
          {
            key: 'min',
            label: 'Minimum',
            control: 'number',
            expectedType: 'number',
            bindable: true,
            helpText: 'Values below this are corrected as you type.',
          },
          {
            key: 'max',
            label: 'Maximum',
            control: 'number',
            expectedType: 'number',
            bindable: true,
            helpText: 'Values above this are corrected as you type.',
          },
          { key: 'step', label: 'Step', control: 'number', expectedType: 'number', bindable: false, defaultValue: 1 },
        ],
      },
      {
        name: 'Validation',
        properties: [
          { key: 'validation', label: 'Rules', control: 'validation_rules', expectedType: 'array', bindable: false, defaultValue: [] },
        ],
      },
      {
        name: 'Label style',
        properties: textStyleProperties('label'),
      },
      {
        name: 'Field style',
        properties: textStyleProperties('input', { fontSize: 14 }),
      },
      {
        name: 'Behaviour',
        properties: [
          { key: 'disabled', label: 'Disabled', control: 'toggle', expectedType: 'boolean', bindable: true, defaultValue: false },
          { key: 'onChange', label: 'On change', control: 'action_list', expectedType: 'any', bindable: false },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * Currency input
 * ------------------------------------------------------------------ */

function CurrencyInputWidget(props: WidgetProps) {
  return (
    <NumberInputWidget
      {...props}
      properties={{
        ...props.properties,
        format: 'currency',
        currencySymbol: currencySymbolOf(props.properties),
        decimals: props.properties.decimals ?? 2,
        step: props.properties.step ?? stepFromDecimals(props.properties.decimals ?? 2),
      }}
    />
  );
}

export const currencyInputWidget: RegisteredWidget = {
  component: CurrencyInputWidget,
  definition: {
    type: 'currency_input',
    displayName: 'Currency Input',
    category: 'input',
    icon: 'currency',
    defaultLayout: { x: 0, y: 0, w: 4, h: 2 },
    minSize: { w: 2, h: 1 },
    events: [{ key: 'onChange', label: 'On change', payloadKeys: ['value'] }],
    exposedState: [
      { key: 'value', type: 'number', description: 'Amount as a number' },
      { key: 'isValid', type: 'boolean', description: 'Whether validation passes' },
    ],
    properties: [
      {
        name: 'Content',
        properties: [
          ...labelProperties('Amount'),
          {
            key: 'placeholder',
            label: 'Placeholder',
            control: 'text',
            expectedType: 'string',
            bindable: true,
            defaultValue: '0.00',
          },
          {
            key: 'defaultValue',
            label: 'Default value',
            control: 'number',
            expectedType: 'number',
            bindable: true,
          },
          {
            key: 'currency',
            label: 'Currency',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'USD',
            options: [
              { value: 'USD', label: 'USD ($)' },
              { value: 'EUR', label: 'EUR (€)' },
              { value: 'GBP', label: 'GBP (£)' },
              { value: 'INR', label: 'INR (₹)' },
              { value: 'JPY', label: 'JPY (¥)' },
              { value: 'CNY', label: 'CNY (¥)' },
              { value: 'AUD', label: 'AUD (A$)' },
              { value: 'CAD', label: 'CAD (C$)' },
            ],
          },
          {
            key: 'currencySymbol',
            label: 'Symbol',
            control: 'text',
            expectedType: 'string',
            bindable: true,
            helpText: 'Leave blank to use the currency’s usual symbol.',
          },
          {
            key: 'decimals',
            label: 'Decimals',
            control: 'number',
            expectedType: 'number',
            bindable: false,
            defaultValue: 2,
            helpText: 'How many places after the point. Amounts round to this on entry.',
          },
        ],
      },
      {
        name: 'Range',
        properties: [
          {
            key: 'min',
            label: 'Minimum',
            control: 'number',
            expectedType: 'number',
            bindable: true,
            helpText: 'Values below this are corrected as you type.',
          },
          {
            key: 'max',
            label: 'Maximum',
            control: 'number',
            expectedType: 'number',
            bindable: true,
            helpText: 'Values above this are corrected as you type.',
          },
        ],
      },
      {
        name: 'Validation',
        properties: [
          { key: 'validation', label: 'Rules', control: 'validation_rules', expectedType: 'array', bindable: false, defaultValue: [] },
        ],
      },
      {
        name: 'Label style',
        properties: textStyleProperties('label'),
      },
      {
        name: 'Field style',
        properties: textStyleProperties('input', { fontSize: 14 }),
      },
      {
        name: 'Behaviour',
        properties: [
          { key: 'disabled', label: 'Disabled', control: 'toggle', expectedType: 'boolean', bindable: true, defaultValue: false },
          { key: 'onChange', label: 'On change', control: 'action_list', expectedType: 'any', bindable: false },
        ],
      },
    ],
  },
};

function DatePickerWidget({ properties, state, setState, fireEvent, isDesignMode }: WidgetProps) {
  const seeded = useSeededValue(state, setState, properties.defaultValue, { isDesignMode });
  const value = String(seeded ?? '');
  const rules = mergeFieldRules(properties);
  const touched = Boolean(state.touched);
  const result = validate(value, rules);
  const showError = showFieldError(result, { touched, value });

  return (
    <div className="flex h-full w-full flex-col gap-1">
      <FieldLabel
        text={properties.label}
        icon={properties.labelIcon}
        display={properties.labelDisplay as TabDisplayMode | undefined}
        required={rules.some((rule) => rule.kind === 'required')}
        style={textStyleToCss(properties, 'label')}
      />

      <input
        type={properties.includeTime ? 'datetime-local' : 'date'}
        style={fieldControlStyle(properties, 'input')}
        value={value}
        min={properties.minDate ? String(properties.minDate) : undefined}
        max={properties.maxDate ? String(properties.maxDate) : undefined}
        disabled={Boolean(properties.disabled)}
        onChange={(event) => {
          setState({ value: event.target.value, isValid: validate(event.target.value, rules).isValid });
          fireEvent('onChange', { value: event.target.value });
        }}
        onBlur={() => setState({ touched: true })}
        className={clsx(
          'no-drag min-h-0 w-full flex-1 rounded border px-2 outline-none focus:ring-2 focus:ring-blue-500/30',
          showError ? 'border-red-400' : 'border-slate-300 focus:border-blue-500',
          'disabled:bg-slate-50 disabled:text-slate-400',
        )}
      />

      {showError && <p className="text-xs text-red-600">{result.errors[0]}</p>}
    </div>
  );
}

export const datePickerWidget: RegisteredWidget = {
  component: DatePickerWidget,
  definition: {
    type: 'date_picker',
    displayName: 'DatePicker',
    category: 'input',
    icon: 'calendar',
    defaultLayout: { x: 0, y: 0, w: 4, h: 2 },
    minSize: { w: 2, h: 1 },
    events: [{ key: 'onChange', label: 'On change', payloadKeys: ['value'] }],
    exposedState: [
      { key: 'value', type: 'string', description: 'ISO date, ready to bind into a query' },
      { key: 'isValid', type: 'boolean', description: 'Whether validation passes' },
    ],
    properties: [
      {
        name: 'Content',
        properties: [
          ...LABEL_PROPERTIES,
          { key: 'defaultValue', label: 'Default value', control: 'text', expectedType: 'string', bindable: true },
          { key: 'includeTime', label: 'Include time', control: 'toggle', expectedType: 'boolean', bindable: false, defaultValue: false },
        ],
      },
      {
        name: 'Range',
        properties: [
          { key: 'minDate', label: 'Earliest', control: 'text', expectedType: 'string', bindable: true },
          { key: 'maxDate', label: 'Latest', control: 'text', expectedType: 'string', bindable: true },
        ],
      },
      {
        name: 'Validation',
        properties: [
          { key: 'validation', label: 'Rules', control: 'validation_rules', expectedType: 'array', bindable: false, defaultValue: [] },
        ],
      },
      {
        name: 'Label style',
        properties: textStyleProperties('label'),
      },
      {
        name: 'Field style',
        properties: textStyleProperties('input', { fontSize: 14 }),
      },
      {
        name: 'Behaviour',
        properties: [
          { key: 'disabled', label: 'Disabled', control: 'toggle', expectedType: 'boolean', bindable: true, defaultValue: false },
          { key: 'onChange', label: 'On change', control: 'action_list', expectedType: 'any', bindable: false },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * Slider
 * ------------------------------------------------------------------ */

function SliderWidget({ properties, state, setState, fireEvent, isDesignMode }: WidgetProps) {
  const seeded = useSeededValue(state, setState, properties.defaultValue, { isDesignMode });
  const min = Number(properties.min ?? 0);
  const max = Number(properties.max ?? 100);
  const value = Number(seeded ?? min);

  return (
    <div className="flex h-full w-full flex-col justify-center gap-1">
      <div className="flex items-baseline justify-between">
        {properties.label ? (
          <span className="text-xs font-medium text-slate-600">{String(properties.label)}</span>
        ) : (
          <span />
        )}
        <span className="text-xs tabular-nums text-slate-500">{value}</span>
      </div>

      <input
        type="range"
        min={min}
        max={max}
        step={Number(properties.step ?? 1)}
        value={value}
        disabled={Boolean(properties.disabled)}
        onChange={(event) => {
          const next = Number(event.target.value);
          setState({ value: next });
          fireEvent('onChange', { value: next });
        }}
        className="no-drag w-full accent-blue-600"
      />

      <div className="flex justify-between text-[10px] text-slate-400">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

export const sliderWidget: RegisteredWidget = {
  component: SliderWidget,
  definition: {
    type: 'slider',
    displayName: 'Slider',
    category: 'input',
    icon: 'slider',
    defaultLayout: { x: 0, y: 0, w: 5, h: 3 },
    minSize: { w: 3, h: 2 },
    events: [{ key: 'onChange', label: 'On change', payloadKeys: ['value'] }],
    exposedState: [{ key: 'value', type: 'number', description: 'Current value' }],
    properties: [
      {
        name: 'Content',
        properties: [
          { key: 'label', label: 'Label', control: 'text', expectedType: 'string', bindable: true, defaultValue: 'Value' },
        ],
      },
      {
        name: 'Range',
        properties: [
          { key: 'min', label: 'Minimum', control: 'number', expectedType: 'number', bindable: true, defaultValue: 0 },
          { key: 'max', label: 'Maximum', control: 'number', expectedType: 'number', bindable: true, defaultValue: 100 },
          { key: 'step', label: 'Step', control: 'number', expectedType: 'number', bindable: false, defaultValue: 1 },
          { key: 'defaultValue', label: 'Default value', control: 'number', expectedType: 'number', bindable: true },
        ],
      },
      {
        name: 'Behaviour',
        properties: [
          { key: 'disabled', label: 'Disabled', control: 'toggle', expectedType: 'boolean', bindable: true, defaultValue: false },
          { key: 'onChange', label: 'On change', control: 'action_list', expectedType: 'any', bindable: false },
        ],
      },
    ],
  },
};
