import type { PropertyDefinition, TabDisplayMode } from '@swiftly/shared';
import { IconGlyph } from '@/icons/IconGlyph';

/** How a field label paints. `hidden` is field-only — tabs have no equivalent. */
export type LabelDisplayMode = TabDisplayMode | 'hidden';

/**
 * The label above a form field.
 *
 * Text, an icon, both, or none. Icon-only still writes its text into the DOM,
 * hidden: a field with a bare 🔍 above it is unusable with a screen reader and
 * ambiguous once the form has more than one of them, so dropping the words is a
 * visual choice, never an informational one.
 */

export function FieldLabel({
  text,
  icon,
  display = 'text',
  required,
  htmlFor,
  style,
  as = 'label',
}: {
  text: unknown;
  icon?: unknown;
  display?: LabelDisplayMode;
  required?: boolean;
  htmlFor?: string;
  /** Typography from the widget's Label style section. */
  style?: React.CSSProperties;
  /**
   * A checkbox row is already a `<label>` wrapping its input, and a label inside
   * a label is invalid markup that browsers resolve by guessing. Those widgets
   * ask for a span; the caption is still the control's name, through the
   * wrapping label rather than through this element.
   */
  as?: 'label' | 'span';
}) {
  const label = String(text ?? '');
  const glyph = String(icon ?? '').trim();
  const requested: LabelDisplayMode = display ?? 'text';
  // A chosen icon with "Text only" still showing is the usual intent of picking
  // one. Hidden stays hidden; Icon only stays icon-only.
  const mode: LabelDisplayMode =
    requested === 'text' && glyph !== '' ? 'icon_text' : requested;

  if (mode === 'hidden') return null;
  if (label === '' && glyph === '') return null;

  const showIcon = (mode === 'icon' || mode === 'icon_text') && glyph !== '';
  const showText = mode !== 'icon';

  const Tag = as;

  // Icon-only with no glyph: keep the name for assistive tech, hide it visually
  // so changing Label shows actually changes the canvas.
  if (!showIcon && !showText) {
    if (label === '') return null;
    return (
      <Tag htmlFor={as === 'label' ? htmlFor : undefined} className="sr-only">
        {label}
        {required ? ' (required)' : ''}
      </Tag>
    );
  }

  return (
    <Tag
      htmlFor={as === 'label' ? htmlFor : undefined}
      style={{
        fontSize: 12,
        fontWeight: 500,
        color: '#475569',
        ...style,
      }}
      className="flex items-center gap-1.5 tracking-tight"
    >
      {showIcon && <IconGlyph name={glyph} size={14} className="shrink-0" />}

      {showText ? (
        <span className="truncate">{label}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}

      {required && (
        <span className="text-red-500" aria-hidden="true">
          *
        </span>
      )}
    </Tag>
  );
}

/**
 * The same three properties, with the label's own default text.
 *
 * A checkbox that arrives called "Label" is a checkbox somebody has to rename
 * before the page reads as anything.
 */
export function labelProperties(defaultText: string): PropertyDefinition[] {
  return LABEL_PROPERTIES.map((property) =>
    property.key === 'label' ? { ...property, defaultValue: defaultText } : property,
  );
}

/**
 * The three properties every widget using FieldLabel exposes.
 *
 * Shared so the panel reads identically on each of them, and so adding a fourth
 * display mode later is one edit rather than one per widget.
 *
 * The icon field stays visible in every mode on purpose. Hiding it while the mode
 * is "text" would mean switching to icon-only shows an empty box, having quietly
 * dropped the character that was already typed.
 */
export const LABEL_PROPERTIES: PropertyDefinition[] = [
  {
    key: 'label',
    label: 'Label',
    control: 'text',
    expectedType: 'string',
    bindable: true,
    defaultValue: 'Label',
  },
  {
    key: 'labelDisplay',
    label: 'Label shows',
    control: 'select',
    expectedType: 'string',
    bindable: false,
    defaultValue: 'text',
    options: [
      { value: 'text', label: 'Text only' },
      { value: 'icon_text', label: 'Icon and text' },
      { value: 'icon', label: 'Icon only' },
      { value: 'hidden', label: 'Hidden' },
    ],
    helpText: 'Hidden and icon-only still read the label out to a screen reader.',
  },
  {
    key: 'labelIcon',
    label: 'Label icon',
    control: 'icon',
    expectedType: 'string',
    bindable: true,
    helpText: 'A React icon or an emoji. Shown beside the label unless Label shows is Hidden or Icon only.',
  },
];
