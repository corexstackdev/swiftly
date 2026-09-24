import clsx from 'clsx';
import type { PropertyDefinition, TabDisplayMode } from '@vinodapp/shared';

/**
 * The label above a form field.
 *
 * Text, an icon, or both — the same three choices a tab has, and the same type,
 * because "show me the icon only" means the same thing in both places and two
 * different vocabularies for it would be two things to learn.
 *
 * An icon-only label still writes its text into the DOM, hidden. A field with a
 * bare 🔍 above it is unusable with a screen reader and ambiguous to everyone
 * else once the form has more than one of them, so dropping the words is a
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
  display?: TabDisplayMode;
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
  if (label === '' && glyph === '') return null;

  // Asking for an icon without giving one would otherwise render an empty label
  // and lose the field's name entirely.
  const mode: TabDisplayMode = glyph === '' ? 'text' : display;

  const Tag = as;

  return (
    <Tag
      htmlFor={as === 'label' ? htmlFor : undefined}
      style={style}
      className={clsx('flex items-center gap-1.5 text-xs font-medium text-slate-600')}
    >
      {mode !== 'text' && <span aria-hidden="true">{glyph}</span>}

      {mode === 'icon' ? (
        <span className="sr-only">{label}</span>
      ) : (
        <span className="truncate">{label}</span>
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
    helpText: 'Icon-only still reads the label out to a screen reader.',
  },
  {
    key: 'labelIcon',
    label: 'Label icon',
    control: 'text',
    expectedType: 'string',
    bindable: true,
    helpText: 'An emoji or a single character.',
  },
];
