import clsx from 'clsx';
import {
  jsObjectsOnPage,
  queriesOnPage,
  type ActionDsl,
  type ApplicationDsl,
  type NotificationVariant,
  type SetWidgetMethod,
} from '@swiftly/shared';
import { Select, control, controlCompact, dashedButton, ghostButton } from './controls';
import { jsObjectCompileErrors, listJsFunctions } from './jsObjectOps';
import { flatten } from './widgetOps';

/**
 * Retool-style event handlers: a list of independent actions that run in order
 * when the event fires. Each row picks what to do (query, component, script,
 * notify, …) and may skip itself with Only run when.
 */

const NOTIFICATION_VARIANTS: NotificationVariant[] = ['info', 'success', 'warning', 'error'];

const SET_WIDGET_METHODS: { value: SetWidgetMethod; label: string }[] = [
  { value: 'setValue', label: 'Set value' },
  { value: 'setOptions', label: 'Set options' },
  { value: 'clearValue', label: 'Clear value' },
  { value: 'setDisabled', label: 'Set disabled' },
  { value: 'setProperty', label: 'Set property' },
];

type EditorKind = Exclude<ActionDsl['type'], 'navigate'> | 'navigatePage' | 'navigateUrl';

const KIND_OPTIONS: { value: EditorKind; label: string }[] = [
  { value: 'runQuery', label: 'Control query' },
  { value: 'setWidget', label: 'Control component' },
  { value: 'runJsFunction', label: 'Run JS function' },
  { value: 'runJs', label: 'Run script' },
  { value: 'setState', label: 'Set variable' },
  { value: 'navigatePage', label: 'Go to page' },
  { value: 'navigateUrl', label: 'Go to URL' },
  { value: 'showNotification', label: 'Show notification' },
  { value: 'copyToClipboard', label: 'Copy to clipboard' },
  { value: 'download', label: 'Download file' },
  { value: 'openModal', label: 'Open modal' },
  { value: 'closeModal', label: 'Close modal' },
  { value: 'navigateBack', label: 'Go back' },
];

export function ActionEditor({
  actions,
  dsl,
  pageId,
  onChange,
  nested,
  hint,
}: {
  actions: unknown;
  dsl: ApplicationDsl;
  pageId: string;
  onChange: (actions: ActionDsl[]) => void;
  nested?: boolean;
  hint?: string;
}) {
  const list = Array.isArray(actions) ? (actions as ActionDsl[]) : [];
  const visibleJsObjects = jsObjectsOnPage(dsl.jsObjects, pageId);
  const jsFunctions = listJsFunctions(visibleJsObjects);
  const jsCompileErrors = jsObjectCompileErrors(visibleJsObjects);
  const queries = queriesOnPage(dsl.queries, pageId);
  const page = dsl.pages.find((entry) => entry.id === pageId);
  const widgets = page ? flatten(page.widgets) : [];
  const modals = widgets.filter((widget) => widget.type === 'modal');
  const modalPicker = modals.length > 0 ? modals : widgets;

  const update = (index: number, next: ActionDsl): void => {
    const copy = [...list];
    copy[index] = next;
    onChange(copy);
  };

  return (
    <div className={clsx('no-drag flex flex-col', nested ? 'gap-1' : 'gap-1.5')}>
      {list.map((action, index) => (
        <div
          key={index}
          className="flex flex-col gap-1.5 rounded border border-slate-200 bg-white p-1.5"
        >
          <div className="flex items-center gap-1">
            <Select
              compact
              value={editorKind(action)}
              onChange={(selected) =>
                update(index, emptyAction(selected as EditorKind, action.enabledWhen))
              }
              className="min-w-0 flex-1"
            >
              {KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <button
              type="button"
              onClick={() => onChange(list.filter((_, i) => i !== index))}
              title="Remove handler"
              className={clsx(ghostButton, 'shrink-0 hover:bg-red-50 hover:text-red-600')}
            >
              ×
            </button>
          </div>

          {action.type === 'runQuery' && (
            <Select
              compact
              value={action.queryName ?? ''}
              onChange={(queryName) => update(index, { ...action, queryName })}
            >
              <option value="">Select a query</option>
              {queries.map((query) => (
                <option key={query.id} value={query.name}>
                  {query.name}
                </option>
              ))}
            </Select>
          )}

          {action.type === 'setWidget' && (
            <>
              <Select
                compact
                value={action.widgetName ?? ''}
                onChange={(widgetName) => update(index, { ...action, widgetName })}
              >
                <option value="">Select a component</option>
                {widgets.map((widget) => (
                  <option key={widget.id} value={widget.name}>
                    {widget.name}
                  </option>
                ))}
              </Select>
              <Select
                compact
                value={action.method ?? 'setValue'}
                onChange={(method) =>
                  update(index, { ...action, method: method as SetWidgetMethod })
                }
              >
                {SET_WIDGET_METHODS.map((method) => (
                  <option key={method.value} value={method.value}>
                    {method.label}
                  </option>
                ))}
              </Select>
              {action.method === 'setProperty' && (
                <input
                  value={action.property ?? ''}
                  placeholder="property"
                  onChange={(event) => update(index, { ...action, property: event.target.value })}
                  className={clsx(controlCompact, 'font-mono')}
                />
              )}
              {action.method !== 'clearValue' && (
                <input
                  value={valueAsText(action.value)}
                  placeholder={
                    action.method === 'setDisabled'
                      ? '{{ false }}'
                      : action.method === 'setOptions'
                        ? '{{ dropdowns.shippingcity(event.value) }}'
                        : '{{ event.row.id }}'
                  }
                  onChange={(event) =>
                    update(index, { ...action, value: event.target.value || undefined })
                  }
                  className={clsx(controlCompact, 'font-mono')}
                />
              )}
            </>
          )}

          {action.type === 'runJsFunction' && (
            <>
              <Select
                compact
                value={action.path ?? ''}
                onChange={(path) => update(index, { ...action, path })}
              >
                <option value="">Choose a function…</option>
                {jsFunctions.map((entry) => (
                  <option key={entry.path} value={entry.path}>
                    {entry.path}()
                  </option>
                ))}
              </Select>
              <Select
                compact
                value={action.widgetName ?? ''}
                onChange={(widgetName) =>
                  update(index, {
                    ...action,
                    widgetName: widgetName || undefined,
                    method: widgetName ? (action.method ?? 'setOptions') : action.method,
                  })
                }
              >
                <option value="">Don’t set a widget</option>
                {widgets.map((widget) => (
                  <option key={widget.id} value={widget.name}>
                    Set result on {widget.name}
                  </option>
                ))}
              </Select>
              {action.widgetName ? (
                <>
                  <Select
                    compact
                    value={action.method ?? 'setOptions'}
                    onChange={(method) =>
                      update(index, { ...action, method: method as SetWidgetMethod })
                    }
                  >
                    {SET_WIDGET_METHODS.filter((method) => method.value !== 'clearValue').map(
                      (method) => (
                        <option key={method.value} value={method.value}>
                          {method.label}
                        </option>
                      ),
                    )}
                  </Select>
                  {action.method === 'setProperty' && (
                    <input
                      value={action.property ?? ''}
                      placeholder="property"
                      onChange={(event) =>
                        update(index, { ...action, property: event.target.value })
                      }
                      className={clsx(controlCompact, 'font-mono')}
                    />
                  )}
                </>
              ) : null}
              {jsCompileErrors.map((entry) => (
                <span key={entry.name} className="text-[10px] leading-snug text-red-600">
                  {entry.name} has a syntax error, so its functions are missing from this list.
                </span>
              ))}
              <span className="text-[10px] leading-snug text-slate-400">
                {jsFunctions.length === 0 && jsCompileErrors.length === 0
                  ? 'Create a JS object, export a function, then pick it here.'
                  : 'The function receives the selected value, then event. Return a list and pick a Select to fill.'}
              </span>
            </>
          )}

          {action.type === 'runJs' && (
            <textarea
              rows={3}
              value={action.code ?? ''}
              placeholder={"document.byId('w_input').value = event.row.id;"}
              onChange={(event) => update(index, { ...action, code: event.target.value })}
              className={clsx(control, 'resize-y font-mono leading-snug')}
              spellCheck={false}
            />
          )}

          {action.type === 'setState' && (
            <div className="grid grid-cols-2 gap-1">
              <input
                value={action.key ?? ''}
                placeholder="key"
                onChange={(event) => update(index, { ...action, key: event.target.value })}
                className={clsx(controlCompact, 'font-mono')}
              />
              <input
                value={valueAsText(action.value)}
                placeholder="{{ event.row }}"
                onChange={(event) => update(index, { ...action, value: event.target.value })}
                className={clsx(controlCompact, 'font-mono')}
              />
            </div>
          )}

          {action.type === 'navigate' && action.to.kind === 'page' && (
            <Select
              compact
              value={action.to.pageId ?? ''}
              onChange={(pageTarget) =>
                update(index, { ...action, to: { kind: 'page', pageId: pageTarget } })
              }
            >
              <option value="">Select a page</option>
              {dsl.pages.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </Select>
          )}

          {action.type === 'navigate' && action.to.kind === 'url' && (
            <>
              <input
                value={action.to.href ?? ''}
                placeholder="https://… or {{ event.row.url }}"
                onChange={(event) =>
                  update(index, { ...action, to: { kind: 'url', href: event.target.value } })
                }
                className={controlCompact}
              />
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={action.newTab === true}
                  onChange={(event) => update(index, { ...action, newTab: event.target.checked })}
                  className="h-3 w-3 accent-blue-600"
                />
                <span className="text-[11px] text-slate-600">Open in a new tab</span>
              </label>
            </>
          )}

          {action.type === 'showNotification' && (
            <>
              <input
                value={action.message ?? ''}
                placeholder="Saved {{ event.row.id }}"
                onChange={(event) =>
                  update(index, {
                    ...action,
                    message: event.target.value,
                    variant: action.variant ?? 'success',
                  })
                }
                className={controlCompact}
              />
              <Select
                compact
                value={action.variant ?? 'success'}
                onChange={(variant) =>
                  update(index, { ...action, variant: variant as NotificationVariant })
                }
              >
                {NOTIFICATION_VARIANTS.map((variant) => (
                  <option key={variant} value={variant}>
                    {variant}
                  </option>
                ))}
              </Select>
            </>
          )}

          {action.type === 'copyToClipboard' && (
            <input
              value={action.value ?? ''}
              placeholder="{{ event.row.id }}"
              onChange={(event) => update(index, { ...action, value: event.target.value })}
              className={clsx(controlCompact, 'font-mono')}
            />
          )}

          {action.type === 'download' && (
            <>
              <input
                value={valueAsText(action.data)}
                placeholder="{{ event.row }} or a URL"
                onChange={(event) => update(index, { ...action, data: event.target.value })}
                className={clsx(controlCompact, 'font-mono')}
              />
              <div className="grid grid-cols-2 gap-1">
                <input
                  value={action.fileName ?? ''}
                  placeholder="file.json"
                  onChange={(event) => update(index, { ...action, fileName: event.target.value })}
                  className={controlCompact}
                />
                <input
                  value={action.mimeType ?? ''}
                  placeholder="application/json"
                  onChange={(event) => update(index, { ...action, mimeType: event.target.value })}
                  className={controlCompact}
                />
              </div>
            </>
          )}

          {(action.type === 'openModal' || action.type === 'closeModal') && (
            <Select
              compact
              value={action.widgetName ?? ''}
              onChange={(widgetName) => update(index, { ...action, widgetName })}
            >
              <option value="">Select a modal</option>
              {modalPicker.map((widget) => (
                <option key={widget.id} value={widget.name}>
                  {widget.name}
                </option>
              ))}
            </Select>
          )}

          <input
            value={action.enabledWhen ?? ''}
            placeholder="Only run when — {{ Table1.selectedRow?.id != null }}"
            onChange={(event) =>
              update(index, {
                ...action,
                enabledWhen: event.target.value || undefined,
              } as ActionDsl)
            }
            className={clsx(controlCompact, 'font-mono')}
          />

          {action.type === 'runQuery' && !nested && (
            <div className="flex flex-col gap-1 border-t border-slate-100 pt-1">
              <NestedHandlers
                label="On success"
                actions={action.onSuccess}
                dsl={dsl}
                pageId={pageId}
                onChange={(onSuccess) =>
                  update(index, {
                    ...action,
                    onSuccess: onSuccess.length > 0 ? onSuccess : undefined,
                  })
                }
              />
              <NestedHandlers
                label="On failure"
                actions={action.onError}
                dsl={dsl}
                pageId={pageId}
                onChange={(onError) =>
                  update(index, {
                    ...action,
                    onError: onError.length > 0 ? onError : undefined,
                  })
                }
              />
            </div>
          )}
        </div>
      ))}

      {list.length === 0 && (
        <p className="text-[10px] leading-snug text-slate-400">
          {hint ??
            'Add a handler to run a query, control a component, notify, navigate, or run JS.'}
        </p>
      )}

      <button
        type="button"
        onClick={() => onChange([...list, emptyAction('runQuery')])}
        className={dashedButton}
      >
        {nested ? '+ Add' : '+ Add event handler'}
      </button>
    </div>
  );
}

function NestedHandlers({
  label,
  actions,
  dsl,
  pageId,
  onChange,
}: {
  label: string;
  actions: ActionDsl[] | undefined;
  dsl: ApplicationDsl;
  pageId: string;
  onChange: (actions: ActionDsl[]) => void;
}) {
  const count = actions?.length ?? 0;
  return (
    <details className="rounded border border-dashed border-slate-200 px-1.5 py-1">
      <summary className="cursor-pointer text-[10px] font-medium text-slate-500">
        {label}
        {count > 0 ? ` · ${count}` : ''}
      </summary>
      <div className="mt-1.5">
        <ActionEditor actions={actions ?? []} dsl={dsl} pageId={pageId} nested onChange={onChange} />
      </div>
    </details>
  );
}

function editorKind(action: ActionDsl): EditorKind {
  if (action.type === 'navigate') {
    return action.to.kind === 'url' ? 'navigateUrl' : 'navigatePage';
  }
  return action.type;
}

function emptyAction(kind: EditorKind, enabledWhen?: string): ActionDsl {
  const when = enabledWhen?.trim() ? { enabledWhen } : {};
  switch (kind) {
    case 'runQuery':
      return { ...when, type: 'runQuery', queryName: '' };
    case 'setWidget':
      return { ...when, type: 'setWidget', widgetName: '', method: 'setValue' };
    case 'runJsFunction':
      return { ...when, type: 'runJsFunction', path: '' };
    case 'runJs':
      return { ...when, type: 'runJs', code: '' };
    case 'setState':
      return { ...when, type: 'setState', key: '', value: '' };
    case 'navigatePage':
      return { ...when, type: 'navigate', to: { kind: 'page', pageId: '' } };
    case 'navigateUrl':
      return { ...when, type: 'navigate', to: { kind: 'url', href: '' } };
    case 'showNotification':
      return { ...when, type: 'showNotification', message: '', variant: 'success' };
    case 'copyToClipboard':
      return { ...when, type: 'copyToClipboard', value: '' };
    case 'download':
      return { ...when, type: 'download', data: '', fileName: 'download', mimeType: 'text/plain' };
    case 'openModal':
      return { ...when, type: 'openModal', widgetName: '' };
    case 'closeModal':
      return { ...when, type: 'closeModal', widgetName: '' };
    case 'navigateBack':
      return { ...when, type: 'navigateBack' };
    default:
      return { ...when, type: 'runQuery', queryName: '' };
  }
}

function valueAsText(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}
