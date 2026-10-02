import type { WidgetDefinition } from '@swiftly/shared';
import type { RegisteredWidget } from './types';
import { containerWidget, inputWidget } from './basic';
import { buttonWidget } from './ButtonWidget';
import { formWidget } from './FormWidget';
import { textWidget } from './TextWidget';
import { tableWidget } from './TableWidget';
import { listWidget } from './ListWidget';
import { selectWidget } from './SelectWidget';
import { chartWidget } from './ChartWidget';
import { modalWidget, tabsWidget } from './layout';
import { gridWidget } from './GridWidget';
import {
  checkboxGroupWidget,
  checkboxWidget,
  radioGroupWidget,
  switchWidget,
} from './toggles';
import { datePickerWidget, numberInputWidget, sliderWidget } from './pickers';
import {
  dividerWidget,
  iframeWidget,
  imageWidget,
  progressWidget,
  ratingWidget,
  statsBoxWidget,
} from './display';

/**
 * The widget registry.
 *
 * Built-ins and tenant-authored custom components register through the same shape,
 * so a custom component gets the property panel, binding support and validation the
 * built-ins have — no special case anywhere in the editor or runtime.
 */

const registry = new Map<string, RegisteredWidget>();

function register(widget: RegisteredWidget): void {
  registry.set(widget.definition.type, widget);
}

// Layout
register(containerWidget);
register(gridWidget);
register(tabsWidget);
register(modalWidget);
register(dividerWidget);

// Inputs
register(inputWidget);
register(numberInputWidget);
register(selectWidget);
register(datePickerWidget);
register(checkboxWidget);
register(checkboxGroupWidget);
register(radioGroupWidget);
register(switchWidget);
register(sliderWidget);

// Buttons
register(buttonWidget);
register(formWidget);

// Display
register(textWidget);
register(tableWidget);
register(listWidget);
register(statsBoxWidget);
register(progressWidget);
register(ratingWidget);
register(iframeWidget);

// Charts and media
register(chartWidget);
register(imageWidget);

export function getWidget(type: string): RegisteredWidget | undefined {
  return registry.get(type);
}

export function getWidgetDefinition(type: string): WidgetDefinition | undefined {
  return registry.get(type)?.definition;
}

/** Rows a container spends on its own chrome before any child fits. */
export function getChromeRows(type: string, properties: Record<string, unknown>): number {
  return registry.get(type)?.chromeRows?.(properties) ?? 0;
}

export function listWidgets(): WidgetDefinition[] {
  return [...registry.values()].map((widget) => widget.definition);
}

/** Registers a tenant-uploaded component under `custom:{name}`. */
export function registerCustomWidget(widget: RegisteredWidget): void {
  register(widget);
}

/** Property defaults for a newly dropped widget. */
export function defaultProperties(definition: WidgetDefinition): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const section of definition.properties) {
    for (const property of section.properties) {
      if (property.defaultValue !== undefined) properties[property.key] = property.defaultValue;
    }
  }
  return properties;
}
