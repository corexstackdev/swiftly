import clsx from 'clsx';
import type { TabDisplayMode, ValidationRule } from '@vinodapp/shared';
import type { RegisteredWidget, WidgetProps } from './types';
import { useSeededValue } from './useSeededValue';
import { FieldLabel, LABEL_PROPERTIES } from './FieldLabel';
import { textStyleProperties, textStyleToCss } from './textStyle';
import { validate } from './validation';

/**
 * Numeric and date inputs.
 *
 * Both expose their value in a form bindings can use directly: the number input
 * writes a `number`, and the date picker writes an ISO `yyyy-mm-dd` string, which
 * is what every SQL dialect we target accepts as a date parameter.
 */

/* ------------------------------------------------------------------ *
 * Number input
 * ------------------------------------------------------------------ */

function NumberInputWidget({ properties, state, setState, fireEvent, isDesignMode }: WidgetProps) {
  // Seeded like every other input. Without this the widget was the one field on
  // the palette with no default at all: you could not set one, and the canvas
  // showed an empty box whatever the panel said.
  const raw = useSeededValue(state, setState, properties.defaultValue, { isDesignMode });
  const value = raw === undefined || raw === null ? '' : String(raw);
  const rules = (properties.validation ?? []) as ValidationRule[];
  const touched = Boolean(state.touched);
  const result = validate(value, rules);
  const showError = touched && !result.isValid;

  const prefix =
    properties.format === 'currency'
      ? String(properties.currencySymbol ?? '$')
      : properties.format === 'percent'
        ? '%'
        : null;

  return (
    <div className="flex h-full w-full flex-col gap-1">
      <FieldLabel
        text={properties.label}
        icon={properties.labelIcon}
        display={properties.labelDisplay as TabDisplayMode | undefined}
        style={textStyleToCss(properties, 'label')}
      />

      <div className="relative flex-1">
        {prefix && (
          <span className="absolute top-1/2 left-2 -translate-y-1/2 text-sm text-slate-400">
            {prefix}
          </span>
        )}
        <input
          type="number"
          value={value}
          style={textStyleToCss(properties, 'input')}
          step={Number(properties.step ?? 1)}
          min={properties.min === undefined ? undefined : Number(properties.min)}
          max={properties.max === undefined ? undefined : Number(properties.max)}
          placeholder={String(properties.placeholder ?? '')}
          disabled={Boolean(properties.disabled) || isDesignMode}
          onChange={(event) => {
            // Empty stays undefined rather than becoming 0, so a cleared optional
            // field does not silently submit a value the user never typed.
            const next = event.target.value === '' ? undefined : Number(event.target.value);
            setState({ value: next, isValid: validate(event.target.value, rules).isValid });
            fireEvent('onChange', { value: next });
          }}
          onBlur={() => setState({ touched: true })}
          className={clsx(
            'h-full w-full rounded border px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-blue-500/30',
            prefix && 'pl-6',
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
    minSize: { w: 2, h: 2 },
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
          { key: 'min', label: 'Minimum', control: 'number', expectedType: 'number', bindable: true },
          { key: 'max', label: 'Maximum', control: 'number', expectedType: 'number', bindable: true },
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
        properties: textStyleProperties('input'),
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
 * Date picker
 * ------------------------------------------------------------------ */

function DatePickerWidget({ properties, state, setState, fireEvent, isDesignMode }: WidgetProps) {
  const seeded = useSeededValue(state, setState, properties.defaultValue, { isDesignMode });
  const value = String(seeded ?? '');
  const rules = (properties.validation ?? []) as ValidationRule[];
  const touched = Boolean(state.touched);
  const result = validate(value, rules);
  const showError = touched && !result.isValid;

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
        style={textStyleToCss(properties, 'input')}
        value={value}
        min={properties.minDate ? String(properties.minDate) : undefined}
        max={properties.maxDate ? String(properties.maxDate) : undefined}
        disabled={Boolean(properties.disabled) || isDesignMode}
        onChange={(event) => {
          setState({ value: event.target.value, isValid: validate(event.target.value, rules).isValid });
          fireEvent('onChange', { value: event.target.value });
        }}
        onBlur={() => setState({ touched: true })}
        className={clsx(
          'w-full flex-1 rounded border px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-blue-500/30',
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
    minSize: { w: 2, h: 2 },
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
        properties: textStyleProperties('input'),
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
        disabled={Boolean(properties.disabled) || isDesignMode}
        onChange={(event) => {
          const next = Number(event.target.value);
          setState({ value: next });
          fireEvent('onChange', { value: next });
        }}
        className="w-full accent-blue-600"
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
