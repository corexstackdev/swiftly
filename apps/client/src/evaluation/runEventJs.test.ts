import { describe, expect, it } from 'vitest';
import { CONTROL_LOOKUP } from '@/runtime/controlDocument';
import { compileJsObject, runJsSource } from './runEventJs';

function liveControl() {
  const state: { value: unknown; disabled: boolean; placeholder: unknown } = {
    value: '',
    disabled: false,
    placeholder: '',
  };
  const api = {
    id: 'w_input',
    name: 'Input1',
    className: 'city',
    get value() {
      return state.value;
    },
    set value(next: unknown) {
      state.value = next;
    },
    get disabled() {
      return state.disabled;
    },
    set disabled(next: boolean) {
      state.disabled = next;
    },
    setProperty(key: string, value: unknown) {
      if (key === 'placeholder') state.placeholder = value;
      if (key === 'disabled') state.disabled = Boolean(value);
      if (key === 'value') state.value = value;
    },
    setAttribute(key: string, value: unknown) {
      if (key === 'placeholder') state.placeholder = value;
      if (key === 'disabled') state.disabled = Boolean(value);
      if (key === 'value') state.value = value;
    },
  };
  return { api, state };
}

describe('JS sets properties by element id and class', () => {
  it('assigns value through document.byId', () => {
    const { api, state } = liveControl();
    const lookup = {
      byId: (id: string) => (id === 'w_input' ? api : undefined),
      byName: (name: string) => (name === 'Input1' ? api : undefined),
      byClass: (className: string) => (className === 'city' ? [api] : []),
    };

    runJsSource(
      `document.byId('w_input').value = 'Nairobi';`,
      { [CONTROL_LOOKUP]: lookup } as unknown as Record<string, unknown>,
      {},
    );

    expect(state.value).toBe('Nairobi');
  });

  it('assigns properties through getElementsByClassName', () => {
    const { api, state } = liveControl();
    const lookup = {
      byId: (id: string) => (id === 'w_input' ? api : undefined),
      byName: () => undefined,
      byClass: (className: string) => (className === 'city' ? [api] : []),
    };

    runJsSource(
      `const el = document.byClass('city')[0];
       el.disabled = true;
       el.setProperty('placeholder', 'City');`,
      { [CONTROL_LOOKUP]: lookup } as unknown as Record<string, unknown>,
      {},
    );

    expect(state.disabled).toBe(true);
    expect(state.placeholder).toBe('City');
  });

  it('does not expose widgets or controls', () => {
    const { api } = liveControl();
    const lookup = {
      byId: (id: string) => (id === 'w_input' ? api : undefined),
      byName: () => undefined,
      byClass: () => [],
    };

    const seen = runJsSource(
      `return typeof widgets + ' ' + typeof controls;`,
      { [CONTROL_LOOKUP]: lookup } as unknown as Record<string, unknown>,
      {},
    );

    expect(seen).toBe('undefined undefined');
  });

  it('lets an exported onChange function read document.byId(...).value', () => {
    const { api, state } = liveControl();
    api.value = 'hello';
    const lookup = {
      byId: (id: string) => (id === 'w_q6sxm5ip' ? api : undefined),
      byName: () => undefined,
      byClass: () => [],
    };

    const exports = compileJsObject(
      `module.exports = {
        checkboxOptions() {
          const selected = document.byId("w_q6sxm5ip").value;
          return selected;
        },
      };`,
      { [CONTROL_LOOKUP]: lookup } as unknown as Record<string, unknown>,
    );

    expect(state.value).toBe('hello');
    expect((exports.checkboxOptions as () => unknown)()).toBe('hello');
  });
});
