import type { DragEvent as ReactDragEvent } from 'react';

/**
 * Palette → canvas drag.
 *
 * HTML5 `dataTransfer` is a poor bus for this: custom MIME types are empty
 * until `drop`, and react-grid-layout's own droppable path misses nested
 * containers. The type lives here for the duration of the gesture instead.
 */

let activeType: string | null = null;
let dragged = false;

export function beginPaletteDrag(type: string, event: ReactDragEvent): void {
  activeType = type;
  dragged = false;
  event.dataTransfer.setData('text/plain', type);
  event.dataTransfer.setData('widget/type', type);
  event.dataTransfer.effectAllowed = 'copy';
}

export function notePaletteDrag(): void {
  dragged = true;
}

export function endPaletteDrag(): void {
  activeType = null;
}

export function peekPaletteType(): string | null {
  return activeType;
}

/** True when the pointer actually moved, so a click after a cancelled drag does not add. */
export function paletteDragMoved(): boolean {
  return dragged;
}

export function acceptPaletteDrag(event: ReactDragEvent): boolean {
  if (!activeType && ![...event.dataTransfer.types].includes('text/plain')) return false;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  return true;
}

export function takePaletteDrop(event: ReactDragEvent): string | null {
  if (!acceptPaletteDrag(event)) return null;
  event.stopPropagation();
  const type = activeType || event.dataTransfer.getData('widget/type') || event.dataTransfer.getData('text/plain');
  activeType = null;
  return type || null;
}

export function dropParentId(event: ReactDragEvent): string | null {
  const nest = (event.target as HTMLElement).closest('[data-drop-parent]');
  return nest?.getAttribute('data-drop-parent') ?? null;
}
