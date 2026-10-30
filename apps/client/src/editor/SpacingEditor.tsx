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
        <LinkButton
          linked={linked}
          onClick={() => {
            const next = !linked;
            setLinked(next);
            if (next) setAll(current.top);
          }}
        />
        {linked ? (
          <input
            type="number"
            min={0}
            value={current.top}
            onChange={(event) => setAll(Math.max(0, Number(event.target.value) || 0))}
            className={control}
          />
        ) : (
          <span className="text-[11px] text-slate-400">Each side, in pixels</span>
        )}
      </div>

      {!linked && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-2">
          <div className="flex flex-col items-center gap-1">
            <SideInput value={current.top} onChange={(next) => setSide('top', next)} label="T" />
            <div className="flex w-full items-center gap-1">
              <SideInput value={current.left} onChange={(next) => setSide('left', next)} label="L" />
              <div className="flex h-9 min-w-0 flex-1 items-center justify-center rounded-md border border-dashed border-slate-300 bg-white text-[10px] text-slate-300">
                box
              </div>
              <SideInput value={current.right} onChange={(next) => setSide('right', next)} label="R" />
            </div>
            <SideInput value={current.bottom} onChange={(next) => setSide('bottom', next)} label="B" />
          </div>
        </div>
      )}
    </div>
  );
}

function SideInput({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
}) {
  return (
    <label className="flex w-12 flex-col items-center gap-0.5">
      <span className="text-[9px] font-medium tracking-wide text-slate-400">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
        className="w-full rounded-md border border-slate-200 bg-white px-1 py-1 text-center text-xs tabular-nums outline-none focus:border-blue-500 focus:ring-[3px] focus:ring-blue-500/15"
      />
    </label>
  );
}

function LinkButton({ linked, onClick }: { linked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={linked ? 'Set each side separately' : 'Use one value for all sides'}
      className={clsx(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors',
        linked
          ? 'border-blue-200 bg-blue-50 text-blue-700'
          : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
      )}
    >
      {linked ? <LinkIcon /> : <UnlinkIcon />}
    </button>
  );
}

function LinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M5 8.5 3.8 9.7a2 2 0 0 1-2.8-2.8L2.2 5.7M7 3.5 8.2 2.3a2 2 0 1 1 2.8 2.8L9.8 6.3M4.5 7.5l3-3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function UnlinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M5 8.5 3.8 9.7a2 2 0 0 1-2.8-2.8L2.2 5.7M7 3.5 8.2 2.3a2 2 0 1 1 2.8 2.8L9.8 6.3M1.5 1.5l9 9"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
