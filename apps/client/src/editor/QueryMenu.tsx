import type { ApplicationDsl, PageDsl, QueryEntity } from '@swiftly/shared';
import { EntityScopeMenuButton } from './EntityScopeMenu';
import { findQueryBindings } from './queryOps';

export function QueryMenuButton({
  query,
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
  query: QueryEntity;
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
      name={query.name}
      pageId={query.pageId}
      pages={pages}
      currentPageId={currentPageId}
      bindings={() => findQueryBindings(dsl, query)}
      onRename={onRename}
      onCopyToPage={onCopyToPage}
      onMoveToPage={onMoveToPage}
      onMakeGlobal={onMakeGlobal}
      onCopyToThisPage={onCopyToThisPage}
      onDelete={onDelete}
    />
  );
}
