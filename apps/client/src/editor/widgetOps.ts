import type { PageDsl, WidgetDsl } from '@vinodapp/shared';
import { getChromeRows, getWidgetDefinition } from '@/widgets/registry';

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
  const children = container.children ?? [];
  const minimum = getWidgetDefinition(container.type)?.minSize.h ?? 1;
  if (children.length === 0) return minimum;

  const contentRows = Math.max(
    ...children.map((child) => child.layout.y + child.layout.h),
  );
  return Math.max(minimum, contentRows + getChromeRows(container.type, container.properties));
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
      return widget.layout.h < requiredContainerHeight(widget);
    });
  return check(page.widgets);
}

export function newWidgetId(): string {
  return `w_${Math.random().toString(36).slice(2, 10)}`;
}
