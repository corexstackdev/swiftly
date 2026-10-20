import type { PageDsl, WidgetDsl } from '@swiftly/shared';
import { getChromeRows, getWidgetDefinition } from '@/widgets/registry';
import { isFixedModal } from '@/widgets/layout';
import {
  childNeedsCellPlacement,
  gridMinRowHeight,
  placeUnpositionedGridChildren,
  rowTrackHeights,
} from './gridCells';

/** Canvas row height plus gap — same pitch SpacingEditor uses for padding chrome. */
const CANVAS_ROW_PITCH = 28;

/**
 * Widget tree operations.
 *
 * Containers nest arbitrarily, so nothing may assume a widget lives at the top
 * level of a page. Every lookup and mutation here walks the tree.
 */

export function findWidget(widgets: WidgetDsl[], id: string): WidgetDsl | undefined {
  for (const widget of widgets) {
    if (widget.id === id) return widget;
    const found = findWidget(widget.children ?? [], id);
    if (found) return found;
  }
  return undefined;
}

export function findWidgetByName(widgets: WidgetDsl[], name: string): WidgetDsl | undefined {
  for (const widget of widgets) {
    if (widget.name === name) return widget;
    const found = findWidgetByName(widget.children ?? [], name);
    if (found) return found;
  }
  return undefined;
}

/**
 * Lowest row where a new widget of this size does not sit on top of a sibling.
 * Used when dropping into a container so a second control is not stacked on the first.
 */
export function firstFreeRow(
  siblings: WidgetDsl[],
  x: number,
  y: number,
  w: number,
  h: number,
): number {
  let row = Math.max(0, y);
  const overlaps = (candidate: number) =>
    siblings.some((sibling) => {
      const box = sibling.layout;
      return candidate < box.y + box.h && candidate + h > box.y && x < box.x + box.w && x + w > box.x;
    });
  while (overlaps(row)) row += 1;
  return row;
}

/** The array a widget belongs to: the page root, or a container's children. */
export function childListOf(page: PageDsl, parentId: string | null): WidgetDsl[] | undefined {
  if (parentId === null) return page.widgets;
  const parent = findWidget(page.widgets, parentId);
  if (!parent) return undefined;
  return (parent.children ??= []);
}

/** The container holding `id`, or null when it sits at the page root. */
export function findParent(widgets: WidgetDsl[], id: string): WidgetDsl | null {
  for (const widget of widgets) {
    if ((widget.children ?? []).some((child) => child.id === id)) return widget;
    const deeper = findParent(widget.children ?? [], id);
    if (deeper) return deeper;
  }
  return null;
}

export function removeWidget(widgets: WidgetDsl[], id: string): boolean {
  const index = widgets.findIndex((widget) => widget.id === id);
  if (index >= 0) {
    widgets.splice(index, 1);
    return true;
  }
  for (const widget of widgets) {
    if (widget.children && removeWidget(widget.children, id)) return true;
  }
  return false;
}

/** Every widget on the page, depth-first — used for name collisions and the tree view. */
export function flatten(widgets: WidgetDsl[]): WidgetDsl[] {
  return widgets.flatMap((widget) => [widget, ...flatten(widget.children ?? [])]);
}

/**
 * A name unique across the whole page, not just one container. Bindings address
 * widgets by bare name (`{{ Table1.data }}`), so two `Table1`s in different
 * containers would be ambiguous to the evaluator.
 */
export function uniqueWidgetName(base: string, page: PageDsl): string {
  const taken = new Set(flatten(page.widgets).map((widget) => widget.name));
  let index = 1;
  let candidate = `${base}${index}`;
  while (taken.has(candidate)) candidate = `${base}${++index}`;
  return candidate;
}

/**
 * Prefer the given name when it is free — form fields imported from a table
 * should keep the column's name so `{{ Form1.data.CustomerName }}` matches.
 */
export function uniqueExactName(base: string, page: PageDsl): string {
  const cleaned = base.replace(/[^A-Za-z0-9_]/g, '') || 'Field';
  const taken = new Set(flatten(page.widgets).map((widget) => widget.name));
  if (!taken.has(cleaned)) return cleaned;
  let index = 2;
  let candidate = `${cleaned}${index}`;
  while (taken.has(candidate)) candidate = `${cleaned}${++index}`;
  return candidate;
}

export function uniqueName(base: string, existing: { name: string }[]): string {
  const taken = new Set(existing.map((item) => item.name));
  let index = 1;
  let candidate = `${base}${index}`;
  while (taken.has(candidate)) candidate = `${base}${++index}`;
  return candidate;
}

/**
 * A route segment derived from a page name.
 *
 * The name is what someone types; the slug is what ends up in the URL, so it has
 * to survive being one. Spaces become dashes and anything that is not a path
 * character is dropped. A collision takes a numeric suffix, because two pages
 * answering on the same route is a page you cannot reach.
 */
export function uniqueSlug(name: string, existing: { slug: string }[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'page';

  const taken = new Set(existing.map((item) => item.slug));
  if (!taken.has(base)) return base;

  let index = 2;
  while (taken.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

/**
 * The height a container needs for everything inside it.
 *
 * Children are positioned on the container's own grid, so the container has to be
 * at least as tall as its lowest child plus its chrome. Anything less and the
 * content is clipped or scrolled — which is what makes a nested layout feel like
 * it is fighting back.
 */
export function requiredContainerHeight(container: WidgetDsl): number {
  const definition = getWidgetDefinition(container.type);
  const children = container.children ?? [];
  const minimum = definition?.minSize.h ?? 1;
  const chrome = getChromeRows(container.type, container.properties);

  // A fixed modal keeps the size the builder set. Growing it to fit children
  // would undo the resize and make "Fixed" mean the same as Auto.
  if (container.type === 'modal' && isFixedModal(container.properties)) {
    return Math.max(minimum, container.layout.h);
  }

  if (definition?.childLayout === 'cells') {
    const columns = Math.max(1, Number(container.properties.columns ?? 3));
    const minRowHeight = gridMinRowHeight(container.properties);
    const rowGap = Number(container.properties.rowGap ?? 12);
    const tracks = rowTrackHeights(children, columns, minRowHeight);
    const contentPx =
      tracks.reduce((total, height) => total + height, 0) + Math.max(0, tracks.length - 1) * rowGap;
    return Math.max(minimum, Math.ceil(contentPx / CANVAS_ROW_PITCH) + chrome);
  }

  if (children.length === 0) return minimum;

  const contentRows = Math.max(
    ...children.map((child) => child.layout.y + child.layout.h),
  );
  return Math.max(minimum, contentRows + chrome);
}

/**
 * Grows every container on the page so each one fits its contents.
 *
 * Runs deepest-first: making room inside an inner container makes that container
 * taller, which can in turn overflow the container holding it, so the outer one
 * has to be measured after the inner one has settled.
 *
 * Containers only ever grow here. Shrinking them as content moves up would yank
 * the layout around while the user is still working.
 */
export function fitAllContainers(page: PageDsl): void {
  const walk = (widgets: WidgetDsl[]): void => {
    for (const widget of widgets) {
      if (!widget.children || widget.children.length === 0) continue;
      walk(widget.children);

      if (getWidgetDefinition(widget.type)?.childLayout === 'cells') {
        placeUnpositionedGridChildren(widget);
      }

      const required = requiredContainerHeight(widget);
      if (widget.layout.h < required) {
        widget.layout = { ...widget.layout, h: required };
      }
    }
  };
  walk(page.widgets);
}

/** Whether any container is currently too short for its contents. */
export function needsContainerFit(page: PageDsl): boolean {
  const check = (widgets: WidgetDsl[]): boolean =>
    widgets.some((widget) => {
      if (!widget.children || widget.children.length === 0) return false;
      if (check(widget.children)) return true;
      if (
        getWidgetDefinition(widget.type)?.childLayout === 'cells' &&
        widget.children.some(childNeedsCellPlacement)
      ) {
        return true;
      }
      return widget.layout.h < requiredContainerHeight(widget);
    });
  return check(page.widgets);
}

export function newWidgetId(): string {
  return `w_${Math.random().toString(36).slice(2, 10)}`;
}
