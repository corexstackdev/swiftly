import { useState } from 'react';
import clsx from 'clsx';
import type { TabDisplayMode } from '@swiftly/shared';
import type { RegisteredWidget, WidgetProps } from './types';
import { textStyleProperties, textStyleToCss } from './textStyle';
import { stateStyleProperties, stateStyleToCss } from './stateStyle';
import { spacingToCss } from '@/editor/SpacingEditor';
import { useSeededValue } from './useSeededValue';
import { IconGlyph } from '@/icons/IconGlyph';

/**
 * Button.
 *
 * Three things beyond "a thing you click".
 *
 * It can show text, an icon, or both, the same three modes a tab and a field
 * label use. An icon-only button keeps its words in the accessible name — a bare
 * glyph with no label is a button nobody can describe, in a tool where the next
 * person to open the app did not build it.
 *
 * It carries its own colours for three states. Normal, hover and selected are
 * each a foreground, a background and a border, and anything left unset falls
 * through to the variant preset, so recolouring a theme still reaches a button
 * that was never touched.
 *
 * And it can hold that selected state. A button with nothing to stay selected
 * about has no use for a selected style, so the third set only appears once the
 * button is a toggle — which is what a filter or a view switcher in an internal
 * tool actually is.
 */

const VARIANTS: Record<string, string> = {
  primary:
    'border border-transparent bg-blue-600 text-white shadow-sm shadow-blue-600/20 hover:bg-blue-700',
  secondary:
    'border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50',
  danger:
    'border border-transparent bg-red-600 text-white shadow-sm shadow-red-600/20 hover:bg-red-700',
  ghost: 'border border-transparent bg-transparent text-slate-700 hover:bg-slate-100',
};

const JUSTIFY: Record<string, string> = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end',
};

function ButtonWidget({ properties, state, setState, fireEvent, isDesignMode }: WidgetProps) {
  const [hovered, setHovered] = useState(false);

  const toggleable = Boolean(properties.toggleable);
  const seeded = useSeededValue(state, setState, properties.defaultSelected, {
    isDesignMode,
    key: 'selected',
  });
  const selected = toggleable && Boolean(seeded);

  const label = String(properties.label ?? 'Button');
  const icon = String(properties.icon ?? '').trim();
  // Asking for an icon without giving one would leave a button with no content
  // at all, so the mode falls back rather than rendering an empty box. Picking
  // an icon while "Text only" is selected still shows it beside the label.
  const requested = (properties.labelDisplay as TabDisplayMode) ?? 'text';
  const display: TabDisplayMode =
    icon === '' ? 'text' : requested === 'text' ? 'icon_text' : requested;

  const disabled = Boolean(properties.disabled) || Boolean(properties.isLoading);
  const loading = Boolean(properties.isLoading);

  /*
   * Hover is applied here rather than in CSS because the colours come from the
   * document: there is no class to write for a background the builder typed in.
   * Hover last, so a selected button still answers the pointer.
   */
  const style: React.CSSProperties = {
    ...textStyleToCss(properties, 'label'),
    ...stateStyleToCss(properties, 'normal'),
    ...(selected ? stateStyleToCss(properties, 'selected') : {}),
    ...(hovered && !disabled ? stateStyleToCss(properties, 'hover') : {}),
    padding: spacingToCss(properties.padding, 8),
    borderRadius: Number(properties.borderRadius ?? 6),
    ...(properties.borderWidth === undefined ? {} : { borderWidth: Number(properties.borderWidth) }),
  };

  const click = (): void => {
    // On the canvas a click selects the widget; running its actions there would
    // be a side effect nobody asked for.
    if (isDesignMode) return;
    if (toggleable) setState({ selected: !selected });
    fireEvent('onClick', toggleable ? { selected: !selected } : undefined);
  };

  return (
    <button
      type="button"
      onClick={click}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      disabled={disabled}
      aria-pressed={toggleable ? selected : undefined}
      // An icon-only button has no text to read out, so the label becomes the
      // accessible name instead of being dropped with the glyph.
      aria-label={display === 'icon' ? label : undefined}
      title={properties.tooltip ? String(properties.tooltip) : display === 'icon' ? label : undefined}
      style={style}
      className={clsx(
        'flex h-full w-full items-center gap-1.5 text-sm font-medium transition-all duration-150',
        'focus-visible:ring-[3px] focus-visible:ring-blue-500/25 focus-visible:outline-none',
        JUSTIFY[String(properties.align ?? 'center')],
        // The preset is the starting point; anything set above overrides it,
        // because an inline style beats a class.
        VARIANTS[String(properties.variant ?? 'primary')] ?? VARIANTS.primary,
        disabled && 'cursor-not-allowed opacity-50 shadow-none',
        !disabled && !isDesignMode && 'cursor-pointer active:scale-[0.99]',
      )}
    >
      {loading ? (
        <>
          <span
            className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
          <span className="truncate">Working…</span>
        </>
      ) : (
        <>
          {display !== 'text' && properties.iconPosition !== 'right' && (
            <IconGlyph name={icon} size={16} className="shrink-0" />
          )}
          {display !== 'icon' && <span className="truncate">{label}</span>}
          {display !== 'text' && properties.iconPosition === 'right' && (
            <IconGlyph name={icon} size={16} className="shrink-0" />
          )}
        </>
      )}
    </button>
  );
}

const WHEN_TOGGLEABLE = { key: 'toggleable', equals: true };

export const buttonWidget: RegisteredWidget = {
  component: ButtonWidget,
  definition: {
    type: 'button',
    displayName: 'Button',
    category: 'input',
    icon: 'square',
    defaultLayout: { x: 0, y: 0, w: 3, h: 1 },
    minSize: { w: 2, h: 1 },
    events: [{ key: 'onClick', label: 'On click', payloadKeys: ['selected'] }],
    exposedState: [
      { key: 'selected', type: 'boolean', description: 'Whether a toggle button is on' },
    ],
    properties: [
      {
        name: 'Content',
        properties: [
          {
            key: 'label',
            label: 'Label',
            control: 'text',
            expectedType: 'string',
            bindable: true,
            defaultValue: 'Submit',
          },
          {
            key: 'labelDisplay',
            label: 'Button shows',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'text',
            options: [
              { value: 'text', label: 'Text only' },
              { value: 'icon_text', label: 'Icon and text' },
              { value: 'icon', label: 'Icon only' },
            ],
            helpText: 'An icon-only button still reads its label out to a screen reader.',
          },
          {
            key: 'icon',
            label: 'Icon',
            control: 'icon',
            expectedType: 'string',
            bindable: true,
            helpText: 'A React icon or an emoji. Shown beside the label unless Button shows is Icon only.',
          },
          {
            key: 'iconPosition',
            label: 'Icon side',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'left',
            options: [
              { value: 'left', label: 'Before the text' },
              { value: 'right', label: 'After the text' },
            ],
            visibleWhen: { key: 'labelDisplay', equals: 'icon_text' },
          },
        ],
      },
      {
        name: 'Layout',
        properties: [
          {
            key: 'variant',
            label: 'Preset',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'primary',
            options: [
              { value: 'primary', label: 'Primary' },
              { value: 'secondary', label: 'Secondary' },
              { value: 'danger', label: 'Danger' },
              { value: 'ghost', label: 'Ghost' },
            ],
            helpText: 'A starting point. Any colour set below overrides it.',
          },
          {
            key: 'align',
            label: 'Content align',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'center',
            options: [
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Centre' },
              { value: 'right', label: 'Right' },
            ],
          },
          {
            key: 'padding',
            label: 'Padding',
            control: 'spacing',
            expectedType: 'any',
            bindable: false,
            defaultValue: 8,
          },
          {
            key: 'borderRadius',
            label: 'Corner radius',
            control: 'number',
            expectedType: 'number',
            bindable: false,
            defaultValue: 6,
          },
          {
            key: 'borderWidth',
            label: 'Border width',
            control: 'number',
            expectedType: 'number',
            bindable: false,
            helpText: 'Blank follows the preset.',
          },
        ],
      },
      {
        name: 'Font',
        properties: textStyleProperties('label'),
      },
      {
        name: 'Normal colours',
        properties: stateStyleProperties('normal'),
      },
      {
        name: 'Hover colours',
        properties: stateStyleProperties('hover'),
      },
      {
        name: 'Selected colours',
        // Hidden wholesale until the button is a toggle: the panel drops a
        // section whose properties are all invisible, so there is no empty
        // heading promising a state the button cannot be in.
        properties: stateStyleProperties('selected', { visibleWhen: WHEN_TOGGLEABLE }),
      },
      {
        name: 'Behaviour',
        properties: [
          {
            key: 'onClick',
            label: 'On click',
            control: 'action_list',
            expectedType: 'any',
            bindable: false,
          },
          {
            key: 'toggleable',
            label: 'Stays selected',
            control: 'toggle',
            expectedType: 'boolean',
            bindable: false,
            defaultValue: false,
            helpText: 'Makes it a toggle, readable as {{ Name.selected }}.',
          },
          {
            key: 'defaultSelected',
            label: 'Selected to start',
            control: 'toggle',
            expectedType: 'boolean',
            bindable: true,
            defaultValue: false,
            visibleWhen: WHEN_TOGGLEABLE,
          },
          {
            key: 'tooltip',
            label: 'Tooltip',
            control: 'text',
            expectedType: 'string',
            bindable: true,
          },
          {
            key: 'disabled',
            label: 'Disabled',
            control: 'toggle',
            expectedType: 'boolean',
            bindable: true,
            defaultValue: false,
          },
          {
            key: 'isLoading',
            label: 'Loading',
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
