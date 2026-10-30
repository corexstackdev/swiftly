import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import clsx from 'clsx';

/**
 * One set of form-control styles for the whole editor.
 *
 * Every panel had been writing its own class string, which is how the property
 * panel ended up as the only part of the editor at 14px in pure black while the
 * widget tree, the header and the page menu were all 12px slate. A control is a
 * control: it should not matter which panel it happens to be sitting in.
 */

const BASE =
  'no-drag w-full rounded-md border bg-white text-xs text-slate-800 outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-slate-400 disabled:bg-slate-50 disabled:text-slate-400 disabled:shadow-none';

/*
 * A visible focus ring rather than a border colour alone. Border-only focus is
 * a one-pixel change that a keyboard user can lose track of, and this panel is
 * a long column of near-identical fields.
 */
const STATE =
  'border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300 focus:border-blue-500 focus:ring-[3px] focus:ring-blue-500/15 focus:shadow-none';

/** Standard field: a text input, a number, a select. */
export const control = clsx(BASE, STATE, 'px-2 py-1.5');

/** For fields packed into a row — a validation rule, an action. */
export const controlCompact = clsx(BASE, STATE, 'px-1.5 py-1');

/** A row of small buttons that sit beside a compact field. */
export const ghostButton =
  'rounded-md px-1.5 py-1 text-[11px] text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700';

export const dashedButton =
  'self-start rounded-md border border-dashed border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600';

export function Chevron({ className }: { className?: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={className} aria-hidden="true">
      <path
        d="M2 3.5 5 6.5 8 3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
  children: ReactNode;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'className'>) {
  return (
    <span className="relative block min-w-0">
      <select
        {...rest}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={clsx(compact ? controlCompact : control, 'appearance-none pr-7', className)}
      >
        {children}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-slate-400"
      >
        <Chevron />
      </span>
    </span>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
  compact,
  autoFocus,
  className,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  compact?: boolean;
  autoFocus?: boolean;
  className?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'className' | 'type'>) {
  return (
    <span className={clsx('relative block min-w-0', className)}>
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-slate-400"
      >
        <circle cx="5" cy="5" r="3.25" stroke="currentColor" strokeWidth="1.4" />
        <path d="M7.4 7.4 10 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <input
        {...rest}
        type="search"
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={clsx(compact ? controlCompact : control, 'pl-7')}
      />
    </span>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  labelledBy,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  labelledBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative h-[18px] w-8 shrink-0 rounded-full transition-colors duration-150',
        'focus-visible:ring-[3px] focus-visible:ring-blue-500/25 focus-visible:outline-none',
        checked ? 'bg-blue-600' : 'bg-slate-300',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={clsx(
          'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform duration-150',
          checked ? 'translate-x-[14px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}

export function SegmentedControl({
  value,
  options,
  onChange,
  icons,
}: {
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
  onChange: (value: string) => void;
  icons?: Partial<Record<string, ReactNode>>;
}) {
  const hasIcons = Boolean(icons) && options.every((option) => icons?.[option.value]);
  const iconOnly =
    hasIcons && (options.length >= 4 || options.every((option) => option.label.length <= 8));
  const wrap =
    !iconOnly && options.length > 3 && options.some((option) => option.label.length > 9);

  return (
    <div
      role="radiogroup"
      className="grid gap-0.5 rounded-lg bg-slate-100 p-0.5"
      style={{
        gridTemplateColumns: wrap && !iconOnly ? 'repeat(2, minmax(0, 1fr))' : `repeat(${options.length}, minmax(0, 1fr))`,
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        const icon = icons?.[option.value];
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={option.disabled}
            title={option.label}
            onClick={() => onChange(option.value)}
            className={clsx(
              'flex items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-all',
              active
                ? 'bg-white text-slate-900 shadow-sm ring-1 ring-black/4'
                : 'text-slate-500 hover:text-slate-800',
              option.disabled && 'cursor-not-allowed opacity-40',
            )}
          >
            {icon}
            {!iconOnly && <span className="truncate">{option.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

const SEGMENTED_KEYS = new Set([
  'align',
  'direction',
  'orientation',
  'verticalAlign',
  'size',
  'shadow',
  'fit',
  'format',
  'chartType',
  'iconPosition',
  'rowMode',
  'variant',
  'labelDisplay',
  'justifyItems',
  'alignItems',
  'density',
  'sourceKind',
]);

/** Short, closed lists read better as a segmented control than as a native select. */
export function shouldUseSegmented(
  key: string,
  options: { value: string; label: string }[],
): boolean {
  if (options.length < 2 || options.length > 6) return false;
  if (key.endsWith('FontWeight') || key.endsWith('FontFamily')) return true;
  if (SEGMENTED_KEYS.has(key)) return true;
  return options.length <= 4 && options.every((option) => option.label.length <= 10);
}

export function segmentIconsFor(key: string): Partial<Record<string, ReactNode>> | undefined {
  if (key === 'align') {
    return { left: <AlignIcon edge="left" />, center: <AlignIcon edge="center" />, right: <AlignIcon edge="right" /> };
  }
  if (key === 'direction' || key === 'orientation') {
    return { vertical: <StackIcon axis="y" />, horizontal: <StackIcon axis="x" /> };
  }
  if (key === 'verticalAlign') {
    return { top: <VAlignIcon edge="top" />, middle: <VAlignIcon edge="middle" />, bottom: <VAlignIcon edge="bottom" /> };
  }
  if (key === 'iconPosition') {
    return { left: <AlignIcon edge="left" />, right: <AlignIcon edge="right" /> };
  }
  if (key.endsWith('FontWeight')) {
    return {
      inherit: <span className="text-[10px] font-normal">A</span>,
      normal: <span className="text-[10px] font-normal">Rg</span>,
      medium: <span className="text-[10px] font-medium">Md</span>,
      semibold: <span className="text-[10px] font-semibold">Sm</span>,
      bold: <span className="text-[10px] font-bold">Bd</span>,
    };
  }
  return undefined;
}

export const COLOR_PRESETS = [
  '#0f172a',
  '#334155',
  '#64748b',
  '#ffffff',
  '#2563eb',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
];

export function ColorField({
  value,
  onChange,
  presets = COLOR_PRESETS,
}: {
  value: unknown;
  onChange: (value: string) => void;
  presets?: string[];
}) {
  const raw = String(value ?? '');
  const hex = toHex(raw);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2">
        <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-md border border-slate-200 shadow-sm">
          <span className="absolute inset-0 bg-[conic-gradient(#e2e8f0_0_25%,#fff_0_50%,#e2e8f0_0_75%,#fff_0)] bg-[length:8px_8px]" />
          <input
            type="color"
            value={hex}
            onChange={(event) => onChange(event.target.value)}
            aria-label="Colour"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
          <span className="pointer-events-none absolute inset-0" style={{ background: raw || hex }} />
        </span>
        <input
          type="text"
          value={raw}
          placeholder="#2563EB"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          className={clsx(control, 'font-mono uppercase')}
        />
      </span>
      <div className="flex flex-wrap gap-1">
        {presets.map((swatch) => (
          <button
            key={swatch}
            type="button"
            title={swatch}
            onClick={() => onChange(swatch)}
            className={clsx(
              'h-4 w-4 rounded-full border border-black/10 shadow-sm transition-transform hover:scale-110',
              raw.toLowerCase() === swatch.toLowerCase() && 'ring-2 ring-blue-500 ring-offset-1',
            )}
            style={{ background: swatch }}
          />
        ))}
      </div>
    </div>
  );
}

function toHex(value: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    const [, r, g, b] = value;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return '#ffffff';
}

function AlignIcon({ edge }: { edge: 'left' | 'center' | 'right' }) {
  const bars = [
    { w: 9, y: 2 },
    { w: 6, y: 5.25 },
    { w: 8, y: 8.5 },
  ];
  const xOf = (width: number): number =>
    edge === 'left' ? 1.5 : edge === 'right' ? 10.5 - width : (12 - width) / 2;
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      {bars.map((bar) => (
        <rect key={bar.y} x={xOf(bar.w)} y={bar.y} width={bar.w} height="1.4" rx="0.5" />
      ))}
    </svg>
  );
}

function VAlignIcon({ edge }: { edge: 'top' | 'middle' | 'bottom' }) {
  const y = edge === 'top' ? 1.5 : edge === 'bottom' ? 6.5 : 4;
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <rect x="2" y={y} width="8" height="4" rx="0.75" />
    </svg>
  );
}

function StackIcon({ axis }: { axis: 'x' | 'y' }) {
  if (axis === 'x') {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
        <rect x="1.5" y="3" width="4" height="6" rx="0.75" />
        <rect x="6.5" y="3" width="4" height="6" rx="0.75" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <rect x="3" y="1.5" width="6" height="4" rx="0.75" />
      <rect x="3" y="6.5" width="6" height="4" rx="0.75" />
    </svg>
  );
}
