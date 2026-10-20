import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import type { TabDisplayMode } from '@swiftly/shared';
import type { RegisteredWidget, WidgetProps } from './types';
import { FieldLabel, LABEL_PROPERTIES } from './FieldLabel';
import { fieldControlStyle, textStyleProperties, textStyleToCss } from './textStyle';
import {
  CHOICE_SOURCE_PROPERTIES,
  choiceSourceError,
  emptyChoiceHint,
  normaliseChoiceOptions,
  type ChoiceOption,
} from './choiceSource';

/**
 * Select / combobox.
 *
 * The option list is virtualized because low-code selects get bound straight to a
 * query result — "all customers" is routinely tens of thousands of rows, and a
 * plain `<select>` with that many options locks the tab on open.
 */

const OPTION_HEIGHT = 30;

function SelectWidget({ properties, state, setState, fireEvent }: WidgetProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const options = useMemo<ChoiceOption[]>(() => normaliseChoiceOptions(properties), [properties]);
  const dataError = choiceSourceError(properties);

  useEffect(() => {
    if (state.value === undefined || state.value === null || state.value === '') return;
    if (options.length === 0) return;
    if (options.some((option) => option.value === state.value)) return;
    setState({ value: undefined, selectedLabel: undefined });
  }, [options, setState, state.value]);

  const filtered = useMemo(() => {
    if (!search) return options;
    const needle = search.toLowerCase();
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, search]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => OPTION_HEIGHT,
    overscan: 10,
  });

  const selected = options.find((option) => option.value === state.value);
  const placeholder = String(properties.placeholder ?? 'Select…');

  /*
   * The values carry their own typography, and the same style goes on the closed
   * control and on every row of the list. A dropdown whose options are set
   * differently from the thing they land in reads as two controls.
   */
  const valueStyle = fieldControlStyle(properties, 'value');

  return (
    <div className="flex h-full w-full flex-col gap-1">
      <FieldLabel
        text={properties.label}
        icon={properties.labelIcon}
        display={properties.labelDisplay as TabDisplayMode | undefined}
        style={textStyleToCss(properties, 'label')}
      />

      <div className="relative min-h-0 flex-1">
        <button
          type="button"
          disabled={Boolean(properties.disabled)}
          onClick={() => setOpen((previous) => !previous)}
          style={valueStyle}
          className={clsx(
            'no-drag flex h-full w-full items-center justify-between rounded border border-slate-300 bg-white px-2 text-left',
            'focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 focus:outline-none',
            'disabled:bg-slate-50 disabled:text-slate-400',
          )}
        >
          <span
            className={clsx('truncate', !selected && 'text-slate-400')}
          >
            {selected ? selected.label : placeholder}
          </span>
          <span className="ml-2 shrink-0 text-slate-400">▾</span>
        </button>

        {open && (
          <div className="absolute top-full left-0 z-50 mt-1 w-full rounded border border-slate-200 bg-white shadow-lg">
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search"
              className="no-drag w-full border-b border-slate-200 px-2 py-1.5 text-sm outline-none"
            />
            <div ref={listRef} className="max-h-56 overflow-auto pt-3">
              <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const option = filtered[virtualRow.index];
                  if (!option) return null;
                  return (
                    <button
                      key={virtualRow.key}
                      type="button"
                      onClick={() => {
                        setState({ value: option.value, selectedLabel: option.label });
                        fireEvent('onChange', { value: option.value });
                        setOpen(false);
                        setSearch('');
                      }}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: OPTION_HEIGHT,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      className={clsx(
                        'flex items-center px-2 text-left text-sm hover:bg-slate-50',
                        option.value === state.value && 'bg-blue-50 text-blue-700',
                      )}
                    >
                      <span className="truncate" style={valueStyle}>
                        {option.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              {filtered.length === 0 && (
                <div className="px-2 py-3 text-sm text-slate-400">
                  {dataError ?? (options.length === 0 ? emptyChoiceHint(properties) : 'No matches')}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {dataError ? <p className="text-xs text-red-600">{dataError}</p> : null}
    </div>
  );
}

export const selectWidget: RegisteredWidget = {
  component: SelectWidget,
  definition: {
    type: 'select',
    displayName: 'Select',
    category: 'input',
    icon: 'chevron-down',
    defaultLayout: { x: 0, y: 0, w: 4, h: 2 },
    minSize: { w: 2, h: 1 },
    events: [{ key: 'onChange', label: 'On change', payloadKeys: ['value'] }],
    exposedState: [
      { key: 'value', type: 'string', description: 'Selected value' },
      { key: 'selectedLabel', type: 'string', description: 'Selected label' },
    ],
    properties: [
      {
        name: 'Data',
        properties: CHOICE_SOURCE_PROPERTIES,
      },
      {
        name: 'Content',
        properties: [
          ...LABEL_PROPERTIES,
          { key: 'placeholder', label: 'Placeholder', control: 'text', expectedType: 'string', bindable: true, defaultValue: 'Select…' },
        ],
      },
      {
        name: 'Label style',
        properties: textStyleProperties('label'),
      },
      {
        name: 'Value style',
        properties: textStyleProperties('value', { fontSize: 14 }),
      },
      {
        name: 'Behaviour',
        properties: [
          { key: 'disabled', label: 'Disabled', control: 'toggle', expectedType: 'boolean', bindable: true, defaultValue: false },
          { key: 'onChange', label: 'On change', control: 'action_list', expectedType: 'any', bindable: false },
        ],
      },
    ],
  },
};
