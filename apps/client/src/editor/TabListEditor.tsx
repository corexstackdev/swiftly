import { useState } from 'react';
import clsx from 'clsx';
import type { TabDefinition, TabDisplayMode, TabStateStyle } from '@swiftly/shared';
import { IconPicker } from '@/icons/IconPicker';

/**
 * Editor for a Tabs widget's tab list.
 *
 * Each tab is a row that can be reordered, renamed, opened for settings, or
 * removed. Settings expand inline beneath the row rather than in a floating
 * popover: the property panel is under 300px wide, and a popover that narrow ends
 * up covering the very list it belongs to.
 *
 * Appearance is edited per state. A tab's selected look is not derivable from its
 * normal look — a tab can invert, or change weight without changing colour — so
 * the two are separate rather than one style plus a highlight.
 */

export function TabListEditor({
  tabs,
  onChange,
}: {
  tabs: TabDefinition[];
  onChange: (tabs: TabDefinition[]) => void;
}) {
  const [openTabId, setOpenTabId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const update = (index: number, patch: Partial<TabDefinition>): void => {
    const next = tabs.map((tab, i) => (i === index ? { ...tab, ...patch } : tab));
    onChange(next);
  };

  const move = (from: number, to: number): void => {
    if (from === to || to < 0 || to >= tabs.length) return;
    const next = [...tabs];
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);
    onChange(next);
  };

  const add = (): void => {
    const existing = new Set(tabs.map((tab) => tab.id));
    let index = tabs.length + 1;
    let id = `tab${index}`;
    while (existing.has(id)) id = `tab${++index}`;
    onChange([...tabs, { id, label: `Tab ${index}`, display: 'text' }]);
    setOpenTabId(id);
  };

  return (
    <div className="no-drag flex flex-col gap-1.5">
      <div className="flex items-center justify-end">
        <span className="rounded bg-slate-100 px-1.5 text-[10px] text-slate-500">{tabs.length}</span>
      </div>

      {tabs.map((tab, index) => (
        <div key={tab.id} className="rounded border border-slate-200">
          <div
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragIndex !== null) move(dragIndex, index);
              setDragIndex(null);
            }}
            onDragEnd={() => setDragIndex(null)}
            className={clsx(
              'flex items-center gap-1 px-1.5 py-1',
              dragIndex === index && 'opacity-50',
            )}
          >
            <span className="cursor-grab text-[10px] text-slate-400 active:cursor-grabbing">⠿</span>

            <input
              value={tab.label}
              onChange={(event) => update(index, { label: event.target.value })}
              className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-xs text-slate-700 hover:border-slate-200 focus:border-blue-500 focus:outline-none"
            />

            <button
              type="button"
              title="Tab settings"
              aria-label={`Settings for ${tab.label}`}
              onClick={() => setOpenTabId(openTabId === tab.id ? null : tab.id)}
              className={clsx(
                'rounded px-1 text-xs hover:bg-slate-100',
                openTabId === tab.id ? 'text-blue-600' : 'text-slate-400 hover:text-slate-700',
              )}
            >
              ⚙
            </button>

            <button
              type="button"
              title="Delete tab"
              aria-label={`Delete ${tab.label}`}
              disabled={tabs.length <= 1}
              onClick={() => onChange(tabs.filter((_, i) => i !== index))}
              className="rounded px-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
            >
              🗑
            </button>
          </div>

          {openTabId === tab.id && (
            <TabSettings tab={tab} onChange={(patch) => update(index, patch)} />
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="self-end rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-blue-600"
      >
        + Add tab
      </button>
    </div>
  );
}

function TabSettings({
  tab,
  onChange,
}: {
  tab: TabDefinition;
  onChange: (patch: Partial<TabDefinition>) => void;
}) {
  const [state, setState] = useState<'normal' | 'selected'>('normal');
  const current = (state === 'normal' ? tab.normal : tab.selected) ?? {};

  const setStyle = (patch: Partial<TabStateStyle>): void => {
    const merged = { ...current, ...patch };
    onChange(state === 'normal' ? { normal: merged } : { selected: merged });
  };

  return (
    <div className="flex flex-col gap-2.5 border-t border-slate-200 bg-slate-50 px-2 py-2">
      <Field label="Show">
        <div className="flex gap-1">
          {(
            [
              ['text', 'Text'],
              ['icon', 'Icon'],
              ['icon_text', 'Both'],
            ] as [TabDisplayMode, string][]
          ).map(([mode, caption]) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChange({ display: mode })}
              className={clsx(
                'flex-1 rounded border px-1 py-1 text-[11px]',
                (tab.display ?? 'text') === mode
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              {caption}
            </button>
          ))}
        </div>
      </Field>

      {(tab.display ?? 'text') !== 'text' && (
        <Field label="Icon" help="A React icon or an emoji">
          <IconPicker
            compact
            value={tab.icon ?? ''}
            onChange={(next) => onChange({ icon: next })}
          />
        </Field>
      )}

      {/* State switch: the two looks are edited separately, never derived. */}
      <div className="flex gap-1 rounded bg-slate-200/60 p-0.5">
        {(['normal', 'selected'] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => setState(candidate)}
            className={clsx(
              'flex-1 rounded px-2 py-0.5 text-[11px] capitalize',
              state === candidate ? 'bg-white font-medium text-slate-800 shadow-sm' : 'text-slate-500',
            )}
          >
            {candidate}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Text">
          <ColorInput
            value={current.foreground}
            onChange={(value) => setStyle({ foreground: value })}
          />
        </Field>
        <Field label="Background">
          <ColorInput
            value={current.background}
            onChange={(value) => setStyle({ background: value })}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Weight">
          <select
            value={current.fontWeight ?? ''}
            onChange={(event) =>
              setStyle({ fontWeight: (event.target.value || undefined) as TabStateStyle['fontWeight'] })
            }
            className="w-full rounded border border-slate-300 px-1 py-1 text-[11px]"
          >
            <option value="">Default</option>
            <option value="normal">Normal</option>
            <option value="medium">Medium</option>
            <option value="semibold">Semibold</option>
            <option value="bold">Bold</option>
          </select>
        </Field>

        <Field label="Size">
          <input
            type="number"
            min={8}
            max={32}
            value={current.fontSize ?? ''}
            placeholder="auto"
            onChange={(event) =>
              setStyle({ fontSize: event.target.value === '' ? undefined : Number(event.target.value) })
            }
            className="w-full rounded border border-slate-300 px-1.5 py-1 text-[11px]"
          />
        </Field>
      </div>

      <div className="flex gap-1">
        <Toggle active={current.italic} onClick={() => setStyle({ italic: !current.italic })}>
          <span className="italic">I</span>
        </Toggle>
        <Toggle active={current.underline} onClick={() => setStyle({ underline: !current.underline })}>
          <span className="underline">U</span>
        </Toggle>

        <button
          type="button"
          onClick={() =>
            onChange(state === 'normal' ? { normal: undefined } : { selected: undefined })
          }
          className="ml-auto rounded px-2 py-1 text-[11px] text-slate-500 hover:bg-white hover:text-slate-700"
          title="Fall back to the widget's own styling"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'w-7 rounded border py-1 text-[11px]',
        active
          ? 'border-blue-500 bg-blue-50 text-blue-700'
          : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
      )}
    >
      {children}
    </button>
  );
}

/**
 * A colour well that can also be cleared. A native colour input has no empty
 * state, so "not set" — which is what lets a tab inherit the widget's styling —
 * needs its own control next to it.
 */
function ColorInput({
  value,
  onChange,
}: {
  value?: string;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="color"
        value={value ?? '#000000'}
        onChange={(event) => onChange(event.target.value)}
        className="h-6 w-8 cursor-pointer rounded border border-slate-300"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          title="Clear"
          className="rounded px-1 text-[11px] text-slate-400 hover:bg-white hover:text-slate-700"
        >
          ×
        </button>
      ) : (
        <span className="text-[10px] text-slate-400">auto</span>
      )}
    </div>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-slate-600">{label}</span>
      {children}
      {help && <span className="text-[10px] text-slate-400">{help}</span>}
    </label>
  );
}

/** Accepts the older `{id,label}` and bare-string shapes as well as the full one. */
export function normaliseTabs(raw: unknown): TabDefinition[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [
      { id: 'tab1', label: 'Tab 1', display: 'text' },
      { id: 'tab2', label: 'Tab 2', display: 'text' },
    ];
  }

  return raw.map((entry, index) => {
    if (entry !== null && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      return {
        id: String(record.id ?? `tab${index + 1}`),
        label: String(record.label ?? record.id ?? `Tab ${index + 1}`),
        icon: typeof record.icon === 'string' ? record.icon : undefined,
        display: (record.display as TabDisplayMode) ?? 'text',
        normal: record.normal as TabStateStyle | undefined,
        selected: record.selected as TabStateStyle | undefined,
      };
    }
    return { id: `tab${index + 1}`, label: String(entry), display: 'text' as const };
  });
}
