import type { PropertyDefinition } from '@swiftly/shared';

/**
 * Colours for one interaction state.
 *
 * A control usually needs three: how it sits, how it answers the pointer, and
 * how it looks once it has been chosen. Built the same way the typography
 * properties are — once, prefixed — so a widget can declare as many states as it
 * actually has without three copies of the same three fields.
 *
 * Unset means inherit, as everywhere else: a button nobody has recoloured keeps
 * taking its variant's colours, so restyling the palette still reaches it.
 */

export function stateStyleProperties(
  prefix: string,
  { visibleWhen }: { visibleWhen?: PropertyDefinition['visibleWhen'] } = {},
): PropertyDefinition[] {
  const key = (name: string): string => `${prefix}${name}`;
  const common = { bindable: false as const, ...(visibleWhen ? { visibleWhen } : {}) };

  return [
    {
      ...common,
      key: key('Foreground'),
      label: 'Text colour',
      control: 'color',
      expectedType: 'string',
    },
    {
      ...common,
      key: key('Background'),
      label: 'Background',
      control: 'color',
      expectedType: 'string',
    },
    {
      ...common,
      key: key('Border'),
      label: 'Border colour',
      control: 'color',
      expectedType: 'string',
    },
  ];
}

/** The CSS for one state, with unset colours left out so they inherit. */
export function stateStyleToCss(
  properties: Record<string, unknown>,
  prefix: string,
): React.CSSProperties {
  const read = (name: string): string | undefined => {
    const value = properties[`${prefix}${name}`];
    return typeof value === 'string' && value !== '' ? value : undefined;
  };

  const foreground = read('Foreground');
  const background = read('Background');
  const border = read('Border');

  return {
    ...(foreground ? { color: foreground } : {}),
    ...(background ? { background } : {}),
    ...(border ? { borderColor: border } : {}),
  };
}
