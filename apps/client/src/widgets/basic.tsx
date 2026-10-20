import { useMemo } from 'react';
import clsx from 'clsx';
import type { TabDisplayMode } from '@swiftly/shared';
import type { RegisteredWidget, WidgetProps } from './types';
import { useSeededValue } from './useSeededValue';
import { spacingChromeRows, spacingToCss } from '@/editor/SpacingEditor';
import { FieldLabel, LABEL_PROPERTIES } from './FieldLabel';
import { fieldControlStyle, textStyleProperties, textStyleToCss } from './textStyle';
import { mergeFieldRules, showFieldError, validate } from './validation';

/* ------------------------------------------------------------------ *
 * Input
 * ------------------------------------------------------------------ */

function InputWidget({ properties, state, setState, fireEvent, isDesignMode }: WidgetProps) {
  const seeded = useSeededValue(state, setState, properties.defaultValue, { isDesignMode });
  const value = String(seeded ?? '');
  const rules = mergeFieldRules(properties);
  const touched = Boolean(state.touched);

  const result = useMemo(() => validate(value, rules), [value, rules]);
  const showError = showFieldError(result, { touched, value });

  return (
    <div className="flex h-full w-full flex-col gap-1">
      <FieldLabel
        text={properties.label}
        icon={properties.labelIcon}
        display={properties.labelDisplay as TabDisplayMode | undefined}
        required={rules.some((r) => r.kind === 'required')}
        style={textStyleToCss(properties, 'label')}
      />
      <input
        type={String(properties.inputType ?? 'text')}
        value={value}
        style={fieldControlStyle(properties, 'input')}
        placeholder={String(properties.placeholder ?? '')}
        disabled={Boolean(properties.disabled)}
        onChange={(event) => {
          // `isValid` is written alongside the value so a submit button can bind
          // `{{ !EmailInput.isValid }}` to its disabled property.
          const next = event.target.value;
          setState({ value: next, isValid: validate(next, rules).isValid });
          fireEvent('onChange', { value: next });
        }}
        onBlur={() => setState({ touched: true })}
        className={clsx(
          'no-drag min-h-0 w-full flex-1 rounded border px-2 outline-none',
          'focus:ring-2 focus:ring-blue-500/30',
          showError ? 'border-red-400 focus:border-red-500' : 'border-slate-300 focus:border-blue-500',
          'disabled:bg-slate-50 disabled:text-slate-400',
        )}
      />
      {showError && <p className="text-xs text-red-600">{result.errors[0]}</p>}
    </div>
  );
}

export const inputWidget: RegisteredWidget = {
  component: InputWidget,
  definition: {
    type: 'input',
    displayName: 'Input',
    category: 'input',
    icon: 'text-cursor',
    defaultLayout: { x: 0, y: 0, w: 4, h: 2 },
    minSize: { w: 2, h: 1 },
    events: [{ key: 'onChange', label: 'On change', payloadKeys: ['value'] }],
    exposedState: [
      { key: 'value', type: 'string', description: 'Current text' },
      { key: 'isValid', type: 'boolean', description: 'Whether validation passes' },
      { key: 'touched', type: 'boolean', description: 'Whether the user has interacted' },
    ],
    properties: [
      {
        name: 'Content',
        properties: [
          ...LABEL_PROPERTIES,
          { key: 'placeholder', label: 'Placeholder', control: 'text', expectedType: 'string', bindable: true, defaultValue: '' },
          { key: 'defaultValue', label: 'Default value', control: 'text', expectedType: 'string', bindable: true },
          { key: 'inputType', label: 'Type', control: 'select', expectedType: 'string', bindable: false, defaultValue: 'text' },
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
 * Container
 * ------------------------------------------------------------------ */

function ContainerWidget({ properties, renderChildren, isDesignMode }: WidgetProps) {
  return (
    <div
      className={clsx(
        // A column layout rather than `h-full` on the body: with a title, a
        // full-height body overflows by exactly the title's height, which is how
        // the last row of children ends up behind a scrollbar.
        'flex h-full w-full flex-col',
        isDesignMode ? 'overflow-visible' : 'overflow-hidden',
        properties.bordered !== false && 'rounded border border-slate-200',
      )}
      style={{ background: String(properties.background ?? '#ffffff') }}
    >
      {properties.title ? (
        <div className="shrink-0 border-b border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
          {String(properties.title)}
        </div>
      ) : null}
      <div
        className={clsx('relative min-h-0 flex-1', isDesignMode && 'overflow-visible')}
        style={{ padding: spacingToCss(properties.padding) }}
      >
        {renderChildren?.()}
      </div>
    </div>
  );
}

export const containerWidget: RegisteredWidget = {
  component: ContainerWidget,
  // One row for the inner grid's padding, two more when a title bar is showing,
  // and whatever the container's own padding takes off the top and bottom.
  chromeRows: (properties) =>
    (properties.title ? 3 : 1) + spacingChromeRows(properties.padding),
  definition: {
    type: 'container',
    displayName: 'Container',
    category: 'layout',
    icon: 'box',
    isContainer: true,
    defaultLayout: { x: 0, y: 0, w: 12, h: 8 },
    minSize: { w: 3, h: 3 },
    events: [],
    exposedState: [],
    properties: [
      {
        name: 'Appearance',
        properties: [
          { key: 'title', label: 'Title', control: 'text', expectedType: 'string', bindable: true },
          { key: 'padding', label: 'Padding', control: 'spacing', expectedType: 'any', bindable: false, defaultValue: 0 },
          { key: 'bordered', label: 'Border', control: 'toggle', expectedType: 'boolean', bindable: false, defaultValue: true },
          { key: 'background', label: 'Background', control: 'color', expectedType: 'string', bindable: false, defaultValue: '#ffffff' },
        ],
      },
    ],
  },
};
