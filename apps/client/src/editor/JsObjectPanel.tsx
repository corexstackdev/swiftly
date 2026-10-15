import type { ApplicationDsl, JsObjectDsl, PageDsl } from '@swiftly/shared';
import { control } from './controls';
import { JsObjectMenuButton } from './JsObjectMenu';

/**
 * The JS object editor.
 *
 * Source lives on the DSL; evaluation compiles it in the worker. This panel is
 * only the place the source is written — bindings call the exported names as
 * `{{ Utils.format(Input1.text) }}`.
 */

export function JsObjectPanel({
  jsObject,
  dsl,
  pages,
  currentPageId,
  onChange,
  onClose,
  onDelete,
  onRename,
  onCopyToPage,
  onMoveToPage,
}: {
  jsObject: JsObjectDsl | null;
  dsl: ApplicationDsl;
  pages: PageDsl[];
  currentPageId: string;
  onChange: (mutate: (target: JsObjectDsl) => void) => void;
  onClose: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  onCopyToPage: (pageId: string) => void;
  onMoveToPage: (pageId: string) => void;
}) {
  if (!jsObject) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Select a JS object in the JS tab
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-1.5">
        <input
          value={jsObject.name}
          onChange={(event) => {
            const next = event.target.value.replace(/[^\w]/g, '');
            if (next) onChange((target) => {
              target.name = next;
            });
          }}
          aria-label="JS object name"
          className={`${control} w-40 font-mono`}
        />
        <JsObjectMenuButton
          jsObject={jsObject}
          dsl={dsl}
          pages={pages}
          currentPageId={currentPageId}
          onRename={onRename}
          onCopyToPage={onCopyToPage}
          onMoveToPage={onMoveToPage}
          onDelete={onDelete}
        />
        <span className="text-[11px] text-slate-400">
          Call as <code className="text-slate-500">{`{{ ${jsObject.name}.format(x) }}`}</code>
          . Find controls with <code className="text-slate-500">document.byId(id)</code>
          {' '}or <code className="text-slate-500">document.byClass(class)</code>, then set{' '}
          <code className="text-slate-500">.value</code>
        </span>
        <button
          type="button"
          onClick={onDelete}
          className="ml-auto rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
        >
          Close
        </button>
      </div>
      <textarea
        value={jsObject.code}
        onChange={(event) => onChange((target) => {
          target.code = event.target.value;
        })}
        spellCheck={false}
        className="no-drag min-h-0 flex-1 resize-none bg-slate-50 px-3 py-2 font-mono text-xs leading-relaxed text-slate-800 outline-none"
      />
    </div>
  );
}
