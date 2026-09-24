import clsx from 'clsx';

/**
 * One set of form-control styles for the whole editor.
 *
 * Every panel had been writing its own class string, which is how the property
 * panel ended up as the only part of the editor at 14px in pure black while the
 * widget tree, the header and the page menu were all 12px slate. A control is a
 * control: it should not matter which panel it happens to be sitting in.
 *
 * The sizes match the rest of the editor deliberately. A property panel is read
 * alongside the tree and the canvas, and three type scales in one screen read as
 * three different applications.
 */

const BASE =
  'no-drag w-full rounded border bg-white text-xs text-slate-800 outline-none transition-colors placeholder:text-slate-400 disabled:bg-slate-50 disabled:text-slate-400';

/*
 * A visible focus ring rather than a border colour alone. Border-only focus is
 * a one-pixel change that a keyboard user can lose track of, and this panel is
 * a long column of near-identical fields.
 */
const STATE =
  'border-slate-300 hover:border-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15';

/** Standard field: a text input, a number, a select. */
export const control = clsx(BASE, STATE, 'px-2 py-1.5');

/** For fields packed into a row — a validation rule, an action. */
export const controlCompact = clsx(BASE, STATE, 'px-1.5 py-1');

/** A row of small buttons that sit beside a compact field. */
export const ghostButton =
  'rounded px-1.5 py-1 text-[11px] text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700';

export const dashedButton =
  'self-start rounded border border-dashed border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600';

/**
 * A select that looks like the rest of the fields.
 *
 * The native control paints its own arrow in the platform's style and sizes it
 * to the platform's metrics, so it never quite matches the inputs above and
 * below it. `appearance-none` drops that and the chevron here replaces it. The
 * option list itself is drawn by the operating system and cannot be styled —
 * that is the one part of a dropdown no web page controls.
 */
export function Select({
  value,
  onChange,
  compact,
  className,
  children,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
  className?: string;
  children: React.ReactNode;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'className'>) {
  return (
    <span className="relative block min-w-0">
      <select
        {...rest}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={clsx(compact ? controlCompact : control, 'appearance-none pr-6', className)}
      >
        {children}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[8px] text-slate-400"
      >
        ▼
      </span>
    </span>
  );
}
