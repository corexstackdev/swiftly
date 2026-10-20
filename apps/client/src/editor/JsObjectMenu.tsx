import type { ApplicationDsl, JsObjectDsl, PageDsl } from '@swiftly/shared';
import { EntityScopeMenuButton } from './EntityScopeMenu';
import { findJsObjectBindings } from './jsObjectOps';

export function JsObjectMenuButton({
  jsObject,
  dsl,
  pages,
  currentPageId,
  onRename,
  onCopyToPage,
  onMoveToPage,
  onMakeGlobal,
  onCopyToThisPage,
  onDelete,
}: {
  jsObject: JsObjectDsl;
  dsl: ApplicationDsl;
  pages: PageDsl[];
  currentPageId: string;
  onRename: (name: string) => void;
  onCopyToPage: (pageId: string) => void;
  onMoveToPage: (pageId: string) => void;
  onMakeGlobal: () => void;
  onCopyToThisPage: () => void;
  onDelete: () => void;
}) {
  return (
    <EntityScopeMenuButton
      name={jsObject.name}
      pageId={jsObject.pageId}
      pages={pages}
      currentPageId={currentPageId}
      bindings={() => findJsObjectBindings(dsl, jsObject)}
      onRename={onRename}
      onCopyToPage={onCopyToPage}
      onMoveToPage={onMoveToPage}
      onMakeGlobal={onMakeGlobal}
      onCopyToThisPage={onCopyToThisPage}
      onDelete={onDelete}
    />
  );
}
