import { useMemo } from 'react';
import clsx from 'clsx';
import type { TabDisplayMode } from '@vinodapp/shared';
import type { RegisteredWidget, WidgetProps } from './types';
import { useSeededValue } from './useSeededValue';
import { FieldLabel, labelProperties } from './FieldLabel';
import { textStyleProperties, textStyleToCss } from './textStyle';
import { asArray } from './coerce';

/**
 * Boolean and choice inputs.
 *
 * The group widgets take their options the same way Select does — a static list or
 * a query result plus the two column names — so binding a radio group to a lookup
 * table is configuration rather than an expression.
 */

interface Option {
  label: string;
  value: unknown;
}

/**
 * The tick, the dot, the filled track.
 *
 * `accent-color` is how a native checkbox or radio is recoloured — the browser
 * draws the control and takes this as the fill, which keeps the platform's own
 * focus ring, sizing and high-contrast handling rather than reimplementing a
 * control in divs and losing all three.
 *
 * Undefined leaves the Tailwind class in place, so a widget nobody has recoloured
 * still follows the theme.
 */
function accentOf(properties: Record<string, unknown>): string | undefined {
  const accent = properties.accentColor;
  return typeof accent === 'string' && accent !== '' ? accent : undefined;
}

/** Label modes, label typography, and the control's own colour. */
function styleSections(
  defaultText: string,
  { options = false }: { options?: boolean } = {},
) {
  return {
    content: labelProperties(defaultText),
    sections: [
      { name: 'Label style', properties: textStyleProperties('label') },
      ...(options ? [{ name: 'Option style', properties: textStyleProperties('option') }] : []),
      {
        name: 'Control colour',
        properties: [
          {
            key: 'accentColor',
            label: 'Accent',
            control: 'color' as const,
            expectedType: 'string' as const,
            bindable: false,
            helpText: 'The tick or dot. Blank follows the theme.',
          },
        ],
      },
    ],
  };
}

function normaliseOptions(properties: Record<string, unknown>): Option[] {
  const raw = asArray(properties.options);
  if (raw.length === 0) return [];

  const labelKey = typeof properties.labelKey === 'string' ? properties.labelKey : 'label';
  const valueKey = typeof properties.valueKey === 'string' ? properties.valueKey : 'value';

  return raw.map((item) => {
    if (item !== null && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      return {
        label: String(record[labelKey] ?? record.label ?? record.value ?? ''),
        value: record[valueKey] ?? record.value ?? record[labelKey],
      };
    }
    return { label: String(item), value: item };
  });
}

const optionProperties = [
  {
    key: 'options',
    label: 'Options',
    control: 'code' as const,
    expectedType: 'array' as const,
    bindable: true,
    helpText: 'A static list, or a query result such as {{ GetRegions.data }}',
  },
  {
    key: 'labelKey',
    label: 'Label field',
    control: 'text' as const,
    expectedType: 'string' as const,
    bindable: false,
    defaultValue: 'label',
  },
  {
    key: 'valueKey',
    label: 'Value field',
    control: 'text' as const,
    expectedType: 'string' as const,
    bindable: false,
    defaultValue: 'value',
  },
];

const behaviourProperties = (eventKey: string) => [
  {
    key: 'disabled',
    label: 'Disabled',
    control: 'toggle' as const,
    expectedType: 'boolean' as const,
    bindable: true,
    defaultValue: false,
  },
  {
    key: eventKey,
    label: 'On change',
    control: 'action_list' as const,
    expectedType: 'any' as const,
    bindable: false,
  },
];

const CHECKBOX_STYLE = styleSections('Checkbox');
const SWITCH_STYLE = styleSections('Enabled');
const RADIO_STYLE = styleSections('Choose one', { options: true });
const CHECKS_STYLE = styleSections('Choose any', { options: true });

/* ------------------------------------------------------------------ *
 * Checkbox
 * ------------------------------------------------------------------ */

function CheckboxWidget({ properties, state, setState, fireEvent, isDesignMode }: WidgetProps) {
  const seeded = useSeededValue(state, setState, properties.defaultChecked, { isDesignMode });
  const checked = Boolean(seeded);

  return (
    <label className="flex h-full w-full cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        disabled={Boolean(properties.disabled) || isDesignMode}
        onChange={(event) => {
          setState({ value: event.target.checked });
          fireEvent('onChange', { value: event.target.checked });
        }}
        style={{ accentColor: accentOf(properties) }}
        className="h-4 w-4 shrink-0 accent-blue-600"
      />
      {/* A span, not a label: this row is already one, and the caption is the
          control's name through it. */}
      <FieldLabel
        as="span"
        text={properties.label}
        icon={properties.labelIcon}
        display={properties.labelDisplay as TabDisplayMode | undefined}
        style={textStyleToCss(properties, 'label')}
      />
    </label>
  );
}

export const checkboxWidget: RegisteredWidget = {
  component: CheckboxWidget,
  definition: {
    type: 'checkbox',
    displayName: 'Checkbox',
    category: 'input',
    icon: 'check',
    defaultLayout: { x: 0, y: 0, w: 4, h: 2 },
    minSize: { w: 2, h: 1 },
    events: [{ key: 'onChange', label: 'On change', payloadKeys: ['value'] }],
    exposedState: [{ key: 'value', type: 'boolean', description: 'Whether it is checked' }],
    properties: [
      {
        name: 'Content',
        properties: [
          ...CHECKBOX_STYLE.content,
          { key: 'defaultChecked', label: 'Checked by default', control: 'toggle', expectedType: 'boolean', bindable: true, defaultValue: false },
        ],
      },
      ...CHECKBOX_STYLE.sections,
      { name: 'Behaviour', properties: behaviourProperties('onChange') },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * Switch
 * ------------------------------------------------------------------ */

function SwitchWidget({ properties, state, setState, fireEvent, isDesignMode }: WidgetProps) {
  const seeded = useSeededValue(state, setState, properties.defaultChecked, { isDesignMode });
  const checked = Boolean(seeded);
  const disabled = Boolean(properties.disabled) || isDesignMode;

  return (
    <div className="flex h-full w-full items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => {
          setState({ value: !checked });
          fireEvent('onChange', { value: !checked });
        }}
        style={checked ? { background: accentOf(properties) } : undefined}
        className={clsx(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-blue-600' : 'bg-slate-300',
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4.5' : 'translate-x-0.5',
          )}
        />
      </button>
      <FieldLabel
        as="span"
        text={properties.label}
        icon={properties.labelIcon}
        display={properties.labelDisplay as TabDisplayMode | undefined}
        style={textStyleToCss(properties, 'label')}
      />
    </div>
  );
}

export const switchWidget: RegisteredWidget = {
  component: SwitchWidget,
  definition: {
    type: 'switch',
    displayName: 'Switch',
    category: 'input',
    icon: 'toggle',
    defaultLayout: { x: 0, y: 0, w: 4, h: 2 },
    minSize: { w: 2, h: 1 },
    events: [{ key: 'onChange', label: 'On change', payloadKeys: ['value'] }],
    exposedState: [{ key: 'value', type: 'boolean', description: 'Whether it is on' }],
    properties: [
      {
        name: 'Content',
        properties: [
          ...SWITCH_STYLE.content,
          { key: 'defaultChecked', label: 'On by default', control: 'toggle', expectedType: 'boolean', bindable: true, defaultValue: false },
        ],
      },
      ...SWITCH_STYLE.sections,
      { name: 'Behaviour', properties: behaviourProperties('onChange') },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * Radio group
 * ------------------------------------------------------------------ */

function RadioGroupWidget({ widget, properties, state, setState, fireEvent, isDesignMode }: WidgetProps) {
  const selected = useSeededValue(state, setState, properties.defaultValue, { isDesignMode });
  const options = useMemo(() => normaliseOptions(properties), [properties]);
  const horizontal = properties.direction === 'horizontal';
  const optionStyle = textStyleToCss(properties, 'option');

  return (
    <div className="flex h-full w-full flex-col gap-1 overflow-auto">
      <FieldLabel
        as="span"
        text={properties.label}
        icon={properties.labelIcon}
        display={properties.labelDisplay as TabDisplayMode | undefined}
        style={textStyleToCss(properties, 'label')}
      />

      <div className={clsx('flex gap-x-4 gap-y-1', horizontal ? 'flex-row flex-wrap' : 'flex-col')}>
        {options.map((option, index) => (
          <label key={index} className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              // Grouping is by widget name, so two radio groups on one page do not
              // fight over the same browser-level name.
              name={widget.name}
              checked={option.value === selected}
              disabled={Boolean(properties.disabled) || isDesignMode}
              onChange={() => {
                setState({ value: option.value, selectedLabel: option.label });
                fireEvent('onChange', { value: option.value });
              }}
              style={{ accentColor: accentOf(properties) }}
              className="h-4 w-4 accent-blue-600"
            />
            <span className="truncate text-sm text-slate-700" style={optionStyle}>
              {option.label}
            </span>
          </label>
        ))}

        {options.length === 0 && (
          <span className="text-xs text-slate-400">Bind options to show choices</span>
        )}
      </div>
    </div>
  );
}

export const radioGroupWidget: RegisteredWidget = {
  component: RadioGroupWidget,
  definition: {
    type: 'radio_group',
    displayName: 'Radio Group',
    category: 'input',
    icon: 'radio',
    defaultLayout: { x: 0, y: 0, w: 5, h: 5 },
    minSize: { w: 2, h: 2 },
    events: [{ key: 'onChange', label: 'On change', payloadKeys: ['value'] }],
    exposedState: [
      { key: 'value', type: 'string', description: 'Selected value' },
      { key: 'selectedLabel', type: 'string', description: 'Selected label' },
    ],
    properties: [
      { name: 'Data', properties: optionProperties },
      {
        name: 'Content',
        properties: [
          ...RADIO_STYLE.content,
          { key: 'defaultValue', label: 'Default value', control: 'text', expectedType: 'string', bindable: true },
          { key: 'direction', label: 'Direction', control: 'select', expectedType: 'string', bindable: false, defaultValue: 'vertical' },
        ],
      },
      ...RADIO_STYLE.sections,
      { name: 'Behaviour', properties: behaviourProperties('onChange') },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * Checkbox group
 * ------------------------------------------------------------------ */

function CheckboxGroupWidget({ properties, state, setState, fireEvent, isDesignMode }: WidgetProps) {
  const options = useMemo(() => normaliseOptions(properties), [properties]);
  const selected = Array.isArray(state.value) ? (state.value as unknown[]) : [];
  const horizontal = properties.direction === 'horizontal';
  const optionStyle = textStyleToCss(properties, 'option');

  const toggle = (value: unknown): void => {
    const next = selected.includes(value)
      ? selected.filter((entry) => entry !== value)
      : [...selected, value];
    setState({ value: next });
    fireEvent('onChange', { value: next });
  };

  return (
    <div className="flex h-full w-full flex-col gap-1 overflow-auto">
      <FieldLabel
        as="span"
        text={properties.label}
        icon={properties.labelIcon}
        display={properties.labelDisplay as TabDisplayMode | undefined}
        style={textStyleToCss(properties, 'label')}
      />

      <div className={clsx('flex gap-x-4 gap-y-1', horizontal ? 'flex-row flex-wrap' : 'flex-col')}>
        {options.map((option, index) => (
          <label key={index} className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              disabled={Boolean(properties.disabled) || isDesignMode}
              onChange={() => toggle(option.value)}
              style={{ accentColor: accentOf(properties) }}
              className="h-4 w-4 accent-blue-600"
            />
            <span className="truncate text-sm text-slate-700" style={optionStyle}>
              {option.label}
            </span>
          </label>
        ))}

        {options.length === 0 && (
          <span className="text-xs text-slate-400">Bind options to show choices</span>
        )}
      </div>
    </div>
  );
}

export const checkboxGroupWidget: RegisteredWidget = {
  component: CheckboxGroupWidget,
  definition: {
    type: 'checkbox_group',
    displayName: 'Checkbox Group',
    category: 'input',
    icon: 'checks',
    defaultLayout: { x: 0, y: 0, w: 5, h: 5 },
    minSize: { w: 2, h: 2 },
    events: [{ key: 'onChange', label: 'On change', payloadKeys: ['value'] }],
    exposedState: [{ key: 'value', type: 'array', description: 'Selected values' }],
    properties: [
      { name: 'Data', properties: optionProperties },
      {
        name: 'Content',
        properties: [
          ...CHECKS_STYLE.content,
          { key: 'direction', label: 'Direction', control: 'select', expectedType: 'string', bindable: false, defaultValue: 'vertical' },
        ],
      },
      ...CHECKS_STYLE.sections,
      { name: 'Behaviour', properties: behaviourProperties('onChange') },
    ],
  },
};
