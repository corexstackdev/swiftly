import { describe, expect, it } from 'vitest';
import { createControlDocument, matchByClass } from './controlDocument';

type El = { id: string; name: string; className: string };

const input: El = { id: 'w_input', name: 'Input1', className: 'city totals' };
const select: El = { id: 'w_select', name: 'Select1', className: 'city' };

const lookup = {
  byId: (id: string) => [input, select].find((el) => el.id === id),
  byName: (name: string) => [input, select].find((el) => el.name === name),
  byClass: (className: string) => matchByClass([input, select], className),
};

const document = createControlDocument(lookup);

describe('control document lookups', () => {
  it('finds a control by widget id', () => {
    expect(document.getElementById('w_input')).toBe(input);
    expect(document.byId('w_input')).toBe(input);
  });

  it('falls back from id to widget name', () => {
    expect(document.getElementById('Select1')).toBe(select);
  });

  it('finds controls by class', () => {
    expect(document.getElementsByClassName('city')).toEqual([input, select]);
    expect(document.getElementsByClassName('totals')).toEqual([input]);
  });

  it('supports querySelector by id and class', () => {
    expect(document.querySelector('#w_select')).toBe(select);
    expect(document.querySelector('.totals')).toBe(input);
    expect(document.querySelectorAll('.city')).toEqual([input, select]);
  });
});
