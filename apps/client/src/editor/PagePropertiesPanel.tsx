import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  isAppLevelEntity,
  resolveSidebarWidth,
  type ApplicationDsl,
  type AppLayoutId,
  type NavAppearance,
  type PageDsl,
  type PageLayoutId,
  type SidebarPosition,
} from '@swiftly/shared';
import {
  pageQueryVariableOverrides,
  setPageQueryVariableValue,
} from '@/evaluation/queryVariables';
import { NavItemsEditor } from './NavItemsEditor';
import { AppLayoutPicker, PageLayoutPicker } from './LayoutOptions';
import { ColorField, SegmentedControl, Switch, control } from './controls';

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
  onApplyPageLayout,
}: {
  dsl: ApplicationDsl;
  page: PageDsl | undefined;
  canvasPreset: CanvasPresetId;
  onCanvasPresetChange: (preset: CanvasPresetId) => void;
  onPageChange: (mutate: (page: PageDsl) => void, label?: string) => void;
  onAppChange: (mutate: (dsl: ApplicationDsl) => void, label?: string) => void;
  onApplyPageLayout: (layout: PageLayoutId) => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-auto">
      <Section title="Canvas size">
        <SegmentedControl
          value={canvasPreset}
          options={CANVAS_PRESETS.map((preset) => ({
            value: preset.id,
            label: preset.label,
          }))}
          onChange={(next) => onCanvasPresetChange(next as CanvasPresetId)}
        />
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
              className={control}
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
              className={`${control} font-mono`}
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
              className={`${control} resize-y font-mono`}
            />
          </Field>
        </Section>
      )}

      {page && <PageQueryInputs dsl={dsl} page={page} onPageChange={onPageChange} />}

      {page && (
        <Section title="Page layout">
          <p className="text-[11px] text-slate-400">
            Replaces the widgets on this page. Undo brings the previous ones back.
          </p>
          <PageLayoutPicker size="sm" onSelect={onApplyPageLayout} />
        </Section>
      )}

      <Section title="App layout">
        <AppLayoutPicker
          size="sm"
          value={dsl.navigation.style}
          onChange={(style: AppLayoutId) =>
            onAppChange((draft) => {
              draft.navigation.style = style;
            }, 'nav-style')
          }
        />

        <Field label="Title">
          <input
            value={dsl.navigation.title ?? ''}
            onChange={(event) =>
              onAppChange((draft) => {
                draft.navigation.title = event.target.value;
              }, 'nav-title')
            }
            className={control}
          />
        </Field>

        {dsl.navigation.style !== 'none' && (
          <Field label="Look" help="Dark fills the page like a product shell. Brand uses the theme colour.">
            <SegmentedControl
              value={dsl.navigation.appearance ?? 'dark'}
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
                { value: 'brand', label: 'Brand' },
              ]}
              onChange={(next) =>
                onAppChange((draft) => {
                  draft.navigation.appearance = next as NavAppearance;
                }, 'nav-appearance')
              }
            />
          </Field>
        )}

        {dsl.navigation.style === 'sidebar' && (
          <>
            <Field label="Side">
              <SegmentedControl
                value={dsl.navigation.sidebarPosition ?? 'left'}
                options={[
                  { value: 'left', label: 'Left' },
                  { value: 'right', label: 'Right' },
                ]}
                onChange={(next) =>
                  onAppChange((draft) => {
                    draft.navigation.sidebarPosition = next as SidebarPosition;
                  }, 'nav-side')
                }
              />
            </Field>

            <Field
              label="Width"
              help={`How wide the side panel is (${MIN_SIDEBAR_WIDTH}–${MAX_SIDEBAR_WIDTH} px). It always runs the full height of the page.`}
            >
              <SegmentedControl
                value={String(
                  [180, DEFAULT_SIDEBAR_WIDTH, 280].includes(
                    resolveSidebarWidth(dsl.navigation.sidebarWidth),
                  )
                    ? resolveSidebarWidth(dsl.navigation.sidebarWidth)
                    : 'custom',
                )}
                options={[
                  { value: '180', label: 'Narrow' },
                  { value: String(DEFAULT_SIDEBAR_WIDTH), label: 'Default' },
                  { value: '280', label: 'Wide' },
                ]}
                onChange={(next) =>
                  onAppChange((draft) => {
                    draft.navigation.sidebarWidth = Number(next);
                  }, 'nav-width')
                }
              />
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="number"
                  min={MIN_SIDEBAR_WIDTH}
                  max={MAX_SIDEBAR_WIDTH}
                  value={resolveSidebarWidth(dsl.navigation.sidebarWidth)}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (!Number.isFinite(next)) return;
                    onAppChange((draft) => {
                      draft.navigation.sidebarWidth = resolveSidebarWidth(next);
                    }, 'nav-width');
                  }}
                  className={control}
                />
                <span className="text-[11px] text-slate-400">px</span>
              </div>
            </Field>

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-600">Start collapsed</p>
                <p className="text-[11px] text-slate-400">
                  Opens as an icon rail until someone expands it.
                </p>
              </div>
              <Switch
                checked={Boolean(dsl.navigation.collapsedByDefault)}
                onChange={(next) =>
                  onAppChange((draft) => {
                    draft.navigation.collapsedByDefault = next;
                  }, 'nav-collapsed')
                }
              />
            </div>
          </>
        )}

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Links</span>
          <p className="text-[11px] text-slate-400">
            Items in the app sidebar or top bar. Click them on the canvas to switch pages.
          </p>
          <NavItemsEditor dsl={dsl} onChange={onAppChange} />
        </div>
      </Section>

      <Section title="Theme">
        <Field label="Primary colour">
          <ColorField
            value={dsl.theme.primaryColor}
            onChange={(next) =>
              onAppChange((draft) => {
                draft.theme.primaryColor = next;
              }, 'theme')
            }
          />
        </Field>

        <Field label="Density">
          <SegmentedControl
            value={dsl.theme.density}
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]}
            onChange={(next) =>
              onAppChange((draft) => {
                draft.theme.density = next as 'compact' | 'comfortable';
              }, 'theme')
            }
          />
        </Field>
      </Section>

      <p className="px-3 py-4 text-[11px] text-slate-400">
        Select a widget on the canvas to edit its properties.
      </p>
    </div>
  );
}

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

function PageQueryInputs({
  dsl,
  page,
  onPageChange,
}: {
  dsl: ApplicationDsl;
  page: PageDsl;
  onPageChange: (mutate: (page: PageDsl) => void, label?: string) => void;
}) {
  const queries = (dsl.queries ?? []).filter(
    (query) => isAppLevelEntity(query) && (query.variables?.length ?? 0) > 0,
  );
  if (queries.length === 0) return null;

  return (
    <Section title="Query inputs">
      <p className="text-[11px] text-slate-400">
        Global queries are available on every page. Pass this page&apos;s widgets into their
        variables.
      </p>
      {queries.map((query) => {
        const overrides = new Map(
          pageQueryVariableOverrides(page, query.id).map((variable) => [
            variable.name,
            variable.value,
          ]),
        );
        return (
          <div key={query.id} className="flex flex-col gap-2">
            <span className="font-mono text-[11px] font-medium text-slate-700">{query.name}</span>
            {(query.variables ?? []).map((variable) => (
              <Field
                key={`${query.id}-${variable.name}`}
                label={variable.name}
                help={
                  variable.value
                    ? `Default: ${variable.value}. Leave empty to use it.`
                    : 'Leave empty to use the query default.'
                }
              >
                <input
                  value={overrides.get(variable.name) ?? ''}
                  placeholder={variable.value || '{{ Form2.data.Name }}'}
                  onChange={(event) =>
                    onPageChange((draft) => {
                      setPageQueryVariableValue(draft, query.id, variable.name, event.target.value);
                    }, 'page-query-input')
                  }
                  className={`${control} font-mono`}
                />
              </Field>
            ))}
          </div>
        );
      })}
    </Section>
  );
}
