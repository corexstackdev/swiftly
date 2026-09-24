import clsx from 'clsx';
import type { ApplicationDsl, PageDsl } from '@vinodapp/shared';

/**
 * Shown when no widget is selected.
 *
 * An empty right panel is wasted space on the screen a builder looks at most, and
 * page-level settings have nowhere else to live. The canvas width control is here
 * too: checking a layout at tablet width is a thing you do constantly, and it
 * belongs next to the canvas rather than behind a preview round-trip.
 */

export const CANVAS_PRESETS = [
  { id: 'fluid', label: 'Fluid', width: null, icon: '↔' },
  { id: 'desktop', label: 'Desktop', width: 1280, icon: '🖥' },
  { id: 'tablet', label: 'Tablet', width: 768, icon: '▭' },
  { id: 'mobile', label: 'Mobile', width: 390, icon: '▯' },
] as const;

export type CanvasPresetId = (typeof CANVAS_PRESETS)[number]['id'];

export function PagePropertiesPanel({
  dsl,
  page,
  canvasPreset,
  onCanvasPresetChange,
  onPageChange,
  onAppChange,
}: {
  dsl: ApplicationDsl;
  page: PageDsl | undefined;
  canvasPreset: CanvasPresetId;
  onCanvasPresetChange: (preset: CanvasPresetId) => void;
  onPageChange: (mutate: (page: PageDsl) => void, label?: string) => void;
  onAppChange: (mutate: (dsl: ApplicationDsl) => void, label?: string) => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-auto">
      <Section title="Canvas size">
        <div className="flex gap-1">
          {CANVAS_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.width ? `${preset.label} — ${preset.width}px` : preset.label}
              onClick={() => onCanvasPresetChange(preset.id)}
              className={clsx(
                'flex-1 rounded border px-1 py-1.5 text-xs',
                canvasPreset === preset.id
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-slate-300 text-slate-500 hover:bg-slate-50',
              )}
            >
              {preset.icon}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-slate-400">
          Changes the canvas width only. Widget positions are stored in grid units, so
          nothing moves in the app.
        </p>
      </Section>

      {page && (
        <Section title="Page">
          <Field label="Name">
            <input
              value={page.name}
              onChange={(event) =>
                onPageChange((draft) => {
                  draft.name = event.target.value;
                }, 'page-name')
              }
              className={inputClass}
            />
          </Field>

          <Field label="URL path" help="Named segments like orders/:orderId become page.params">
            <input
              value={page.slug}
              onChange={(event) =>
                onPageChange((draft) => {
                  draft.slug = event.target.value;
                }, 'page-slug')
              }
              placeholder="orders/:orderId"
              className={`${inputClass} font-mono text-xs`}
            />
          </Field>

          <Field
            label="Required permissions"
            help="One per line. Enforced on the server, not just hidden in the menu."
          >
            <textarea
              rows={2}
              value={(page.requiredPermissions ?? []).join('\n')}
              onChange={(event) =>
                onPageChange((draft) => {
                  const lines = event.target.value
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean);
                  draft.requiredPermissions = lines.length > 0 ? lines : undefined;
                }, 'page-permissions')
              }
              placeholder="app:view"
              className={`${inputClass} resize-y font-mono text-xs`}
            />
          </Field>
        </Section>
      )}

      <Section title="Navigation">
        <Field label="Style">
          <select
            value={dsl.navigation.style}
            onChange={(event) =>
              onAppChange((draft) => {
                draft.navigation.style = event.target.value as 'sidebar' | 'topbar' | 'none';
              }, 'nav-style')
            }
            className={inputClass}
          >
            <option value="sidebar">Sidebar</option>
            <option value="topbar">Top bar</option>
            <option value="none">None</option>
          </select>
        </Field>

        <Field label="Title">
          <input
            value={dsl.navigation.title ?? ''}
            onChange={(event) =>
              onAppChange((draft) => {
                draft.navigation.title = event.target.value;
              }, 'nav-title')
            }
            className={inputClass}
          />
        </Field>
      </Section>

      <Section title="Theme">
        <Field label="Primary colour">
          <input
            type="color"
            value={dsl.theme.primaryColor}
            onChange={(event) =>
              onAppChange((draft) => {
                draft.theme.primaryColor = event.target.value;
              }, 'theme')
            }
            className="h-8 w-16 cursor-pointer rounded border border-slate-300"
          />
        </Field>

        <Field label="Density">
          <select
            value={dsl.theme.density}
            onChange={(event) =>
              onAppChange((draft) => {
                draft.theme.density = event.target.value as 'compact' | 'comfortable';
              }, 'theme')
            }
            className={inputClass}
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </Field>
      </Section>

      <p className="px-3 py-4 text-[11px] text-slate-400">
        Select a widget on the canvas to edit its properties.
      </p>
    </div>
  );
}

const inputClass =
  'w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none transition-colors hover:border-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-slate-200 px-3 py-3">
      <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
        {title}
      </h3>
      <div className="flex flex-col gap-3">{children}</div>
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
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
      {help && <span className="text-[11px] text-slate-400">{help}</span>}
    </label>
  );
}
