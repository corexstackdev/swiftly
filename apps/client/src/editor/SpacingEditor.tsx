import { useState } from 'react';
import clsx from 'clsx';
import { control } from './controls';

/**
 * Four-sided spacing.
 *
 * A single number is the common case, so the control opens linked and behaves
 * like one field. Unlinking splits it into four, seeded from the value that was
 * already there — so going from uniform to per-side never starts from zero and
 * lose what was set.
 */

export interface SpacingValue {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/** Accepts a plain number, so older documents keep working unchanged. */
export function normaliseSpacing(value: unknown, fallback = 0): Required<SpacingValue> {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { top: value, right: value, bottom: value, left: value };
  }

  if (value !== null && typeof value === 'object') {
    const record = value as SpacingValue;
    const side = (side: number | undefined) => (Number.isFinite(side) ? Number(side) : fallback);
    return {
      top: side(record.top),
      right: side(record.right),
      bottom: side(record.bottom),
      left: side(record.left),
    };
  }

  return { top: fallback, right: fallback, bottom: fallback, left: fallback };
}

/** CSS shorthand, in the order CSS expects. */
export function spacingToCss(value: unknown, fallback = 0): string {
  const { top, right, bottom, left } = normaliseSpacing(value, fallback);
  return `${top}px ${right}px ${bottom}px ${left}px`;
}

/*
 * A canvas row plus its gap. Duplicated rather than imported from the runtime:
 * widgets are what need this, and importing the runtime from a widget closes a
 * cycle through the registry.
 */
const CANVAS_ROW_PITCH = 28;

/**
 * How many canvas rows a container's vertical padding costs it.
 *
 * Padding eats into the space children have, so a container that did not count
 * it would end up exactly that much too short and clip its last row.
 */
export function spacingChromeRows(value: unknown, fallback = 0): number {
  const { top, bottom } = normaliseSpacing(value, fallback);
  return Math.ceil((top + bottom) / CANVAS_ROW_PITCH);
}

function isUniform(value: Required<SpacingValue>): boolean {
  return value.top === value.right && value.right === value.bottom && value.bottom === value.left;
}

export function SpacingEditor({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: SpacingValue | number) => void;
}) {
  const current = normaliseSpacing(value);
  const [linked, setLinked] = useState(() => isUniform(current));

  const setAll = (next: number): void => onChange(next);
  const setSide = (side: keyof SpacingValue, next: number): void =>
    onChange({ ...current, [side]: next });

  return (
    <div className="no-drag flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            const next = !linked;
            setLinked(next);
            // Collapsing to linked takes the top value, which is the one the
            // combined field was already showing.
            if (next) setAll(current.top);
          }}
          title={linked ? 'Set each side separately' : 'Use one value for all sides'}
          className={clsx(
            'rounded border px-1.5 py-1 text-[11px]',
            linked
              ? 'border-blue-500 bg-blue-50 text-blue-700'
              : 'border-slate-300 bg-white text-slate-500 hover:bg-slate-50',
          )}
        >
          {linked ? '🔗' : '⛓'}
        </button>

        {linked ? (
          <input
            type="number"
            min={0}
            value={current.top}
            onChange={(event) => setAll(Math.max(0, Number(event.target.value) || 0))}
            className={control}
          />
        ) : (
          <span className="text-[11px] text-slate-400">Top / Right / Bottom / Left</span>
        )}
      </div>

      {!linked && (
        <div className="grid grid-cols-4 gap-1">
          {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
            <label key={side} className="flex flex-col gap-0.5">
              <span className="text-center text-[9px] tracking-wide text-slate-400 uppercase">
                {side.charAt(0)}
              </span>
              <input
                type="number"
                min={0}
                value={current[side]}
                onChange={(event) => setSide(side, Math.max(0, Number(event.target.value) || 0))}
                className="w-full rounded border border-slate-300 px-1 py-1 text-center text-xs outline-none focus:border-blue-500"
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
