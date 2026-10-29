import { ICON_BY_NAME, resolveIconName } from './catalog';

/**
 * Renders a stored icon value.
 *
 * The picker writes a react-icons name. Nav items created before that wrote
 * `home` or an emoji. Both have to paint, or opening an old app blanks its
 * chrome.
 */

export function IconGlyph({
  name,
  size = 16,
  className,
}: {
  name?: unknown;
  size?: number;
  className?: string;
}) {
  const raw = String(name ?? '').trim();
  if (!raw) return null;

  const resolved = resolveIconName(raw);
  if (resolved) {
    const Comp = ICON_BY_NAME.get(resolved)?.Component;
    if (!Comp) return null;
    return <Comp size={size} className={className} aria-hidden="true" />;
  }

  // Unknown PascalCase names are leftover catalog ids, not something to print.
  if (/^[A-Z][A-Za-z0-9]+$/.test(raw)) return null;

  const glyphs = [...raw];
  if (glyphs.length > 3) return null;

  return (
    <span
      className={className}
      style={{ fontSize: size, lineHeight: 1 }}
      aria-hidden="true"
    >
      {raw}
    </span>
  );
}

export function hasIcon(name?: unknown): boolean {
  const raw = String(name ?? '').trim();
  if (!raw) return false;
  if (resolveIconName(raw)) return true;
  if (/^[A-Z][A-Za-z0-9]+$/.test(raw)) return false;
  return [...raw].length <= 3;
}
