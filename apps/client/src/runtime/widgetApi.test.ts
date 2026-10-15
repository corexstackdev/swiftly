import { describe, expect, it } from 'vitest';
import type { WidgetDsl } from '@swiftly/shared';
import { buildWidgetScope } from './widgetApi';

const widget: WidgetDsl = {
  id: 'w_input',
  name: 'Input1',
  type: 'input',
  properties: { className: 'city' },
  layout: { x: 0, y: 0, w: 4, h: 2 },
};

describe('buildWidgetScope', () => {
  it('lets JS set value and properties by id or class', () => {
    const state: Record<string, Record<string, unknown>> = {};
    const properties: Record<string, Record<string, unknown>> = {
      Input1: { className: 'city' },
    };

    const scope = buildWidgetScope({
      widgets: [widget],
      getState: (name) => state[name] ?? {},
      getProperties: (name) => properties[name] ?? {},
      setState: (name, patch) => {
        state[name] = { ...(state[name] ?? {}), ...patch };
      },
      setOverride: (name, patch) => {
        properties[name] = { ...(properties[name] ?? {}), ...patch };
      },
    });

    const byId = scope.getElementById as (id: string) => {
      value: unknown;
      disabled: boolean;
      placeholder?: unknown;
    };
    const byClass = scope.getElementsByClassName as (className: string) => Array<{
      value: unknown;
      setProperty: (key: string, value: unknown) => void;
    }>;

    const el = byId('w_input');
    el.value = 'Nairobi';
    el.disabled = true;
    (el as { placeholder: unknown }).placeholder = 'City';

    expect(state.Input1?.value).toBe('Nairobi');
    expect(properties.Input1?.disabled).toBe(true);
    expect(properties.Input1?.placeholder).toBe('City');
    expect(byId('Input1').value).toBe('Nairobi');
    expect(byClass('city')[0]?.value).toBe('Nairobi');
    expect(scope.widgets).toBeUndefined();
    expect(scope.controls).toBeUndefined();
  });
});
