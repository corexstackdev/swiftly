import clsx from 'clsx';
import {
  jsObjectsOnPage,
  queriesOnPage,
  type ApplicationDsl,
} from '@swiftly/shared';
import { control, Select } from './controls';
import {
  DEFAULT_SELECT_JSON,
  type FormChoiceSource,
  type FormChoiceSourceKind,
} from './formImport';
import {
  jsCallBinding,
  jsObjectCompileErrors,
  listJsFunctions,
  pathFromJsCall,
} from './jsObjectOps';

/**
 * Options for a Select: JSON paste, a JS function, or a query — the same three
 * sources the property panel offers on a dropped Select.
 */
export function ChoiceSourceEditor({
  value,
  dsl,
  pageId,
  disabled,
  onChange,
}: {
  value: FormChoiceSource;
  dsl: ApplicationDsl;
  pageId: string;
  disabled?: boolean;
  onChange: (next: FormChoiceSource) => void;
}) {
  const queries = queriesOnPage(dsl.queries, pageId);
  const visible = jsObjectsOnPage(dsl.jsObjects, pageId);
  const functions = listJsFunctions(visible);
  const compileErrors = jsObjectCompileErrors(visible);
  const selectedFn = pathFromJsCall(value.sourceJs);
  const groups = new Map<string, typeof functions>();
  for (const fn of functions) {
    const group = groups.get(fn.objectName) ?? [];
    group.push(fn);
    groups.set(fn.objectName, group);
  }

  const jsonText =
    typeof value.sourceData === 'string'
      ? value.sourceData
      : value.sourceData === undefined
        ? DEFAULT_SELECT_JSON
        : JSON.stringify(value.sourceData, null, 2);

  const patch = (partial: Partial<FormChoiceSource>): void => {
    onChange({ ...value, ...partial });
  };

  return (
    <div className={clsx('space-y-2', disabled && 'pointer-events-none opacity-50')}>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-medium tracking-wide text-slate-500 uppercase">
          Options from
        </span>
        <Select
          compact
          value={value.sourceKind}
          disabled={disabled}
          onChange={(kind) => patch({ sourceKind: kind as FormChoiceSourceKind })}
        >
          <option value="json">JSON</option>
          <option value="js">JavaScript</option>
          <option value="query">Query</option>
        </Select>
      </label>

      {value.sourceKind === 'json' && (
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium tracking-wide text-slate-500 uppercase">
            Source data
          </span>
          <textarea
            rows={4}
            disabled={disabled}
            value={jsonText}
            placeholder='[{"label":"Red","value":"red"}]'
            onChange={(event) => patch({ sourceData: event.target.value })}
            className={clsx(control, 'resize-y font-mono leading-snug')}
            spellCheck={false}
          />
        </label>
      )}

      {value.sourceKind === 'js' && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-medium tracking-wide text-slate-500 uppercase">
            JavaScript function
          </span>
          <Select
            compact
            value={selectedFn}
            disabled={disabled}
            onChange={(path) => patch({ sourceJs: path ? jsCallBinding(path) : '' })}
          >
            <option value="">Choose a function…</option>
            {[...groups.entries()].map(([objectName, entries]) => (
              <optgroup key={objectName} label={objectName}>
                {entries.map((entry) => (
                  <option key={entry.path} value={entry.path}>
                    {entry.functionName}()
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          <textarea
            rows={2}
            disabled={disabled}
            value={typeof value.sourceJs === 'string' ? value.sourceJs : ''}
            placeholder="{{ Utils.getOptions() }}"
            onChange={(event) => patch({ sourceJs: event.target.value })}
            className={clsx(control, 'resize-y font-mono leading-snug')}
            spellCheck={false}
          />
          {compileErrors.map((entry) => (
            <span key={entry.name} className="text-[11px] text-red-600">
              {entry.name} has a syntax error, so its functions are missing from this list.
            </span>
          ))}
          {functions.length === 0 && compileErrors.length === 0 && (
            <span className="text-[11px] text-slate-400">
              Create a JS object on this page, export a function that returns the options, then pick
              it here.
            </span>
          )}
        </div>
      )}

      {value.sourceKind === 'query' && (
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium tracking-wide text-slate-500 uppercase">
            Query
          </span>
          <Select
            compact
            value={value.sourceQuery ?? ''}
            disabled={disabled}
            onChange={(sourceQuery) => patch({ sourceQuery })}
          >
            <option value="">None</option>
            {queries.map((query) => (
              <option key={query.id} value={query.name}>
                {query.name}
              </option>
            ))}
          </Select>
          {queries.length === 0 && (
            <span className="text-[11px] text-slate-400">
              Add a query on this page, then pick it here. Options load from the query result.
            </span>
          )}
        </label>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium tracking-wide text-slate-500 uppercase">
            Label field
          </span>
          <input
            type="text"
            disabled={disabled}
            value={value.labelKey}
            onChange={(event) => patch({ labelKey: event.target.value })}
            className={control}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium tracking-wide text-slate-500 uppercase">
            Value field
          </span>
          <input
            type="text"
            disabled={disabled}
            value={value.valueKey}
            onChange={(event) => patch({ valueKey: event.target.value })}
            className={control}
          />
        </label>
      </div>
    </div>
  );
}
