import type { PropertyDefinition } from '@vinodapp/shared';

/**
 * Typography properties, and the CSS they produce.
 *
 * A form is where a low-code app most often has to match a house style — a label
 * that reads like the rest of the intranet, a field set in the same face as the
 * report it feeds. Built once and prefixed, so the label and the field each get
 * their own set without either the panel or the widget repeating itself.
 *
 * Every property is unset by default and unset means "inherit". A widget that
 * has never been styled must keep taking the platform's own type, so restyling
 * the application does not leave old widgets stranded on whatever happened to be
 * hard-coded the day they were made.
 */

const FONT_FAMILIES: Record<string, string> = {
  inherit: '',
  sans: 'Inter, ui-sans-serif, system-ui, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

const WEIGHTS: Record<string, string> = {
  inherit: '',
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
};

/**
 * The six properties one piece of text gets.
 *
 * `prefix` namespaces them onto the widget — 'label' gives `labelFontSize`,
 * 'input' gives `inputFontSize` — so one widget can style several parts of
 * itself without its property keys colliding.
 */
export function textStyleProperties(prefix: string): PropertyDefinition[] {
  const key = (name: string): string => `${prefix}${name}`;

  return [
    {
      key: key('FontFamily'),
      label: 'Font',
      control: 'select',
      expectedType: 'string',
      bindable: false,
      defaultValue: 'inherit',
      options: [
        { value: 'inherit', label: 'Theme default' },
        { value: 'sans', label: 'Sans serif' },
        { value: 'serif', label: 'Serif' },
        { value: 'mono', label: 'Monospace' },
      ],
    },
    {
      key: key('FontSize'),
      label: 'Size',
      control: 'number',
      expectedType: 'number',
      bindable: false,
      helpText: 'Pixels. Blank follows the theme.',
    },
    {
      key: key('FontWeight'),
      label: 'Weight',
      control: 'select',
      expectedType: 'string',
      bindable: false,
      defaultValue: 'inherit',
      options: [
        { value: 'inherit', label: 'Theme default' },
        { value: 'normal', label: 'Normal' },
        { value: 'medium', label: 'Medium' },
        { value: 'semibold', label: 'Semibold' },
        { value: 'bold', label: 'Bold' },
      ],
    },
    {
      key: key('Color'),
      label: 'Colour',
      control: 'color',
      expectedType: 'string',
      bindable: false,
    },
    {
      key: key('Italic'),
      label: 'Italic',
      control: 'toggle',
      expectedType: 'boolean',
      bindable: false,
      defaultValue: false,
    },
    {
      key: key('Underline'),
      label: 'Underline',
      control: 'toggle',
      expectedType: 'boolean',
      bindable: false,
      defaultValue: false,
    },
  ];
}

/**
 * The CSS for one prefix, with every unset property left out entirely.
 *
 * Omitting rather than writing a fallback is the point: an absent
 * `font-size` inherits, while `font-size: 12px` written as a "default" would
 * pin the widget to 12px and silently ignore the theme for ever after.
 */
export function textStyleToCss(
  properties: Record<string, unknown>,
  prefix: string,
): React.CSSProperties {
  const read = (name: string): unknown => properties[`${prefix}${name}`];

  const family = FONT_FAMILIES[String(read('FontFamily') ?? 'inherit')] ?? '';
  const weight = WEIGHTS[String(read('FontWeight') ?? 'inherit')] ?? '';
  const size = Number(read('FontSize'));
  const colour = read('Color');

  const decorations = [read('Underline') ? 'underline' : null].filter(Boolean);

  return {
    ...(family ? { fontFamily: family } : {}),
    ...(weight ? { fontWeight: weight } : {}),
    ...(Number.isFinite(size) && size > 0 ? { fontSize: size } : {}),
    ...(typeof colour === 'string' && colour !== '' ? { color: colour } : {}),
    ...(read('Italic') ? { fontStyle: 'italic' as const } : {}),
    ...(decorations.length > 0 ? { textDecoration: decorations.join(' ') } : {}),
  };
}
