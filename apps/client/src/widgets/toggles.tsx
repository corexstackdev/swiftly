import { useMemo, type CSSProperties } from 'react';
import clsx from 'clsx';
import type { TabDisplayMode } from '@swiftly/shared';
import type { RegisteredWidget, WidgetProps } from './types';
import { useSeededValue } from './useSeededValue';
import { FieldLabel, labelProperties } from './FieldLabel';
import { textStyleProperties, textStyleToCss } from './textStyle';
import { spacingToCss } from '@/editor/SpacingEditor';
import {
  CHOICE_SOURCE_PROPERTIES,
  choiceSourceError,
  emptyChoiceHint,
  normaliseChoiceOptions,
} from './choiceSource';

/**
 * Boolean and choice inputs.
 *
 * The group widgets take their options the same way Select does — a static list or
 * a query result plus the two column names — so binding a radio group to a lookup
 * table is configuration rather than an expression.
 */

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

function isHorizontal(properties: Record<string, unknown>): boolean {
  return String(properties.direction ?? 'vertical') === 'horizontal';
}

function optionTextStyle(properties: Record<string, unknown>): CSSProperties {
  return {
    fontSize: 14,
    color: '#334155',
    ...textStyleToCss(properties, 'option'),
  };
}

function optionsRowStyle(horizontal: boolean): CSSProperties {
  return {
    display: 'flex',
    flexDirection: horizontal ? 'row' : 'column',
    flexWrap: 'nowrap',
    alignItems: horizontal ? 'center' : 'stretch',
    columnGap: 16,
    rowGap: 4,
    overflowX: horizontal ? 'auto' : undefined,
  };
}

/**
 * Where the option list sits in the leftover height under the field label.
 *
 * Auto margins, not `justify-content`: a centred flex item that overflows is
 * clipped at both ends, so the first checkboxes disappear. Auto margins collapse
 * when the list is taller than the box, and scrolling still starts at the top.
 */
function optionListPlacement(properties: Record<string, unknown>): CSSProperties {
  const align = String(properties.verticalAlign ?? 'top');
  return {
    flexShrink: 0,
    ...(align === 'middle'
      ? { marginTop: 'auto', marginBottom: 'auto' }
      : align === 'bottom'
        ? { marginTop: 'auto' }
        : {}),
  };
}

const DIRECTION_PROPERTY = {
  key: 'direction',
  label: 'Direction',
  control: 'select' as const,
  expectedType: 'string' as const,
  bindable: false,
  defaultValue: 'vertical',
  options: [
    { value: 'vertical', label: 'Vertical' },
    { value: 'horizontal', label: 'Horizontal' },
  ],
  helpText: 'Vertical stacks the choices. Horizontal puts them in a row.',
};

const OPTION_LAYOUT_PROPERTIES = [
  DIRECTION_PROPERTY,
  {
    key: 'padding',
    label: 'Padding',
    control: 'spacing' as const,
    expectedType: 'any' as const,
    bindable: false,
    defaultValue: 0,
    helpText:
      'Space around the checkboxes. Unlink to set the top independently of the other sides.',
  },
  {
    key: 'verticalAlign',
    label: 'Vertical align',
    control: 'select' as const,
    expectedType: 'string' as const,
    bindable: false,
    defaultValue: 'top',
    options: [
      { value: 'top', label: 'Top' },
      { value: 'middle', label: 'Middle' },
      { value: 'bottom', label: 'Bottom' },
    ],
    helpText: 'Where the checkboxes sit in the leftover height. Middle centres them.',
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
        disabled={Boolean(properties.disabled)}
        onChange={(event) => {
          setState({ value: event.target.checked });
          fireEvent('onChange', { value: event.target.checked });
        }}
        style={{ accentColor: accentOf(properties) }}
        className="no-drag h-4 w-4 shrink-0 accent-blue-600"
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
  const disabled = Boolean(properties.disabled);

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
          'no-drag relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50',
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
  const options = useMemo(() => normaliseChoiceOptions(properties), [properties]);
  const dataError = choiceSourceError(properties);
  const horizontal = isHorizontal(properties);
  const optionStyle = optionTextStyle(properties);

  return (
    <div className="flex h-full w-full flex-col gap-1 overflow-auto">
      <FieldLabel
        as="span"
        text={properties.label}
        icon={properties.labelIcon}
        display={properties.labelDisplay as TabDisplayMode | undefined}
        style={textStyleToCss(properties, 'label')}
      />

      <div className="min-w-0" style={optionsRowStyle(horizontal)}>
        {options.map((option, index) => (
          <label
            key={index}
            className={clsx('flex cursor-pointer items-center gap-2', horizontal && 'shrink-0')}
          >
            <input
              type="radio"
              // Grouping is by widget name, so two radio groups on one page do not
              // fight over the same browser-level name.
              name={widget.name}
              checked={option.value === selected}
              disabled={Boolean(properties.disabled)}
              onChange={() => {
                setState({ value: option.value, selectedLabel: option.label });
                fireEvent('onChange', { value: option.value });
              }}
              style={{ accentColor: accentOf(properties) }}
              className="no-drag h-4 w-4 shrink-0 accent-blue-600"
            />
            <span
              className={horizontal ? 'whitespace-nowrap' : 'min-w-0 truncate'}
              style={optionStyle}
            >
              {option.label}
            </span>
          </label>
        ))}

        {options.length === 0 && !dataError && (
          <span className="text-xs text-slate-400">{emptyChoiceHint(properties)}</span>
        )}
      </div>
      {dataError ? <p className="text-xs text-red-600">{dataError}</p> : null}
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
    defaultLayout: { x: 0, y: 0, w: 10, h: 4 },
    minSize: { w: 2, h: 2 },
    events: [{ key: 'onChange', label: 'On change', payloadKeys: ['value'] }],
    exposedState: [
      { key: 'value', type: 'string', description: 'Selected value' },
      { key: 'selectedLabel', type: 'string', description: 'Selected label' },
    ],
    properties: [
      { name: 'Data', properties: CHOICE_SOURCE_PROPERTIES },
      {
        name: 'Content',
        properties: [
          ...RADIO_STYLE.content,
          { key: 'defaultValue', label: 'Default value', control: 'text', expectedType: 'string', bindable: true },
          DIRECTION_PROPERTY,
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

function CheckboxGroupWidget({ properties, state, setState, fireEvent }: WidgetProps) {
  const options = useMemo(() => normaliseChoiceOptions(properties), [properties]);
  const dataError = choiceSourceError(properties);
  const selected = Array.isArray(state.value) ? (state.value as unknown[]) : [];
  const horizontal = isHorizontal(properties);
  const optionStyle = optionTextStyle(properties);

  const toggle = (value: unknown): void => {
    const next = selected.includes(value)
      ? selected.filter((entry) => entry !== value)
      : [...selected, value];
    setState({ value: next });
    fireEvent('onChange', { value: next });
  };

  return (
    <div className="flex h-full w-full flex-col gap-1 overflow-hidden">
      <FieldLabel
        as="span"
        text={properties.label}
        icon={properties.labelIcon}
        display={properties.labelDisplay as TabDisplayMode | undefined}
        style={textStyleToCss(properties, 'label')}
      />

      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto"
        style={{ padding: spacingToCss(properties.padding, 0) }}
      >
        <div className="min-w-0" style={optionListPlacement(properties)}>
          <div className="min-w-0" style={optionsRowStyle(horizontal)}>
            {options.map((option, index) => (
              <label
                key={index}
                className={clsx('flex cursor-pointer items-center gap-2', horizontal && 'shrink-0')}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(option.value)}
                  disabled={Boolean(properties.disabled)}
                  onChange={() => toggle(option.value)}
                  style={{ accentColor: accentOf(properties) }}
                  className="no-drag h-4 w-4 shrink-0 accent-blue-600"
                />
                <span
                  className={horizontal ? 'whitespace-nowrap' : 'min-w-0 truncate'}
                  style={optionStyle}
                >
                  {option.label}
                </span>
              </label>
            ))}

            {options.length === 0 && !dataError && (
              <span className="text-xs text-slate-400">{emptyChoiceHint(properties)}</span>
            )}
          </div>
          {dataError ? <p className="mt-1 text-xs text-red-600">{dataError}</p> : null}
        </div>
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
    defaultLayout: { x: 0, y: 0, w: 10, h: 4 },
    minSize: { w: 2, h: 2 },
    events: [{ key: 'onChange', label: 'On change', payloadKeys: ['value'] }],
    exposedState: [{ key: 'value', type: 'array', description: 'Selected values' }],
    properties: [
      { name: 'Data', properties: CHOICE_SOURCE_PROPERTIES },
      {
        name: 'Content',
        properties: [
          ...CHECKS_STYLE.content,
          ...OPTION_LAYOUT_PROPERTIES,
        ],
      },
      ...CHECKS_STYLE.sections,
      { name: 'Behaviour', properties: behaviourProperties('onChange') },
    ],
  },
};
