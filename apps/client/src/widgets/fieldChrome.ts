import clsx from 'clsx';

/**
 * Shared look for canvas fields — Input, Number, Date, Select, Currency.
 *
 * The property panel and the published app are two different surfaces, but a
 * form control should still feel like the same product on both. These classes
 * are the published side of that: a soft border, a small shadow, a focus ring
 * that is visible without being loud.
 */

export function fieldSurfaceClass(error?: boolean): string {
  return clsx(
    'no-drag min-h-0 w-full rounded-lg border bg-white px-2.5 outline-none',
    'shadow-[0_1px_2px_rgba(15,23,42,0.05)]',
    'transition-[border-color,box-shadow] duration-150',
    'placeholder:text-slate-400',
    'hover:border-slate-300',
    'focus:border-blue-500 focus:ring-[3px] focus:ring-blue-500/15 focus:shadow-none',
    'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:shadow-none',
    error ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15' : 'border-slate-200',
  );
}

export const fieldErrorClass = 'text-[12px] leading-snug text-red-600';
