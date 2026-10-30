import clsx from 'clsx';

/**
 * Custom checkbox / radio mark.
 *
 * Native `accent-color` is the easy path, but the platform's checkbox never
 * quite matches the rest of a designed form. This keeps a real input for
 * keyboard, forms and screen readers, and paints the mark on top of it.
 */

export function ChoiceMark({
  type,
  checked,
  disabled,
  accent,
  name,
  onChange,
}: {
  type: 'checkbox' | 'radio';
  checked: boolean;
  disabled?: boolean;
  accent?: string;
  name?: string;
  onChange: () => void;
}) {
  const fill = accent || '#2563eb';
  const radio = type === 'radio';

  return (
    <span className="relative inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center">
      <input
        type={type}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="peer no-drag absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <span
        aria-hidden="true"
        className={clsx(
          'pointer-events-none flex h-full w-full items-center justify-center border-2 bg-white transition-colors duration-150',
          radio ? 'rounded-full' : 'rounded-[5px]',
          'peer-hover:border-slate-400',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500/35 peer-focus-visible:ring-offset-1',
          'peer-disabled:opacity-45',
          checked ? 'border-transparent' : 'border-slate-300',
        )}
        style={checked ? { background: fill, borderColor: fill } : undefined}
      >
        {checked && !radio && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M2 5.2 4.1 7.2 8 2.8"
              stroke="white"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        {checked && radio && <span className="h-[6px] w-[6px] rounded-full bg-white" />}
      </span>
    </span>
  );
}
