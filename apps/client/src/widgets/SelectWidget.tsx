import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { fieldErrorClass, fieldSurfaceClass } from './fieldChrome';

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
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, maxHeight: 224 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const options = useMemo<ChoiceOption[]>(() => normaliseChoiceOptions(properties), [properties]);
  const dataError = choiceSourceError(properties);

  const close = (): void => {
    setOpen(false);
    setSearch('');
  };

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

  useLayoutEffect(() => {
    if (!open) return;

    const place = (): void => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const gap = 4;
      const edge = 8;
      const searchBar = 37;
      const spaceBelow = window.innerHeight - rect.bottom - gap - edge;
      const spaceAbove = rect.top - gap - edge;
      const flip = spaceBelow < 120 && spaceAbove > spaceBelow;
      const available = Math.max(96, flip ? spaceAbove : spaceBelow);
      const maxHeight = Math.min(224, available);
      const estimated = searchBar + Math.min(maxHeight, Math.max(OPTION_HEIGHT, filtered.length * OPTION_HEIGHT));
      const menuHeight = menuRef.current?.offsetHeight || estimated;
      let top = flip ? rect.top - menuHeight - gap : rect.bottom + gap;
      let left = rect.left;
      const width = Math.max(rect.width, 160);
      if (left + width > window.innerWidth - edge) left = Math.max(edge, window.innerWidth - width - edge);
      if (left < edge) left = edge;
      if (top < edge) top = edge;
      if (top + menuHeight > window.innerHeight - edge) {
        top = Math.max(edge, window.innerHeight - menuHeight - edge);
      }
      setPos({ top, left, width, maxHeight });
    };

    place();
    virtualizer.measure();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, filtered.length, search, virtualizer]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const selected = options.find((option) => option.value === state.value);
  const placeholder = String(properties.placeholder ?? 'Select…');

  /*
   * The values carry their own typography, and the same style goes on the closed
   * control and on every row of the list. A dropdown whose options are set
   * differently from the thing they land in reads as two controls.
   */
  const valueStyle = fieldControlStyle(properties, 'value');

  const menu =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            role="listbox"
            className="no-drag fixed z-[200] overflow-hidden rounded-xl border border-slate-200/80 bg-white/95 shadow-xl shadow-slate-900/10 ring-1 ring-black/5 backdrop-blur"
            style={{ top: pos.top, left: pos.left, width: pos.width }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="relative border-b border-slate-100">
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400"
              >
                <circle cx="5" cy="5" r="3.25" stroke="currentColor" strokeWidth="1.4" />
                <path d="M7.4 7.4 10 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <input
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search"
                className="no-drag w-full bg-transparent py-2 pr-2 pl-8 text-sm outline-none placeholder:text-slate-400"
              />
            </div>
            <div ref={listRef} className="overflow-auto pt-1" style={{ maxHeight: pos.maxHeight }}>
              <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const option = filtered[virtualRow.index];
                  if (!option) return null;
                  return (
                    <button
                      key={virtualRow.key}
                      type="button"
                      role="option"
                      aria-selected={option.value === state.value}
                      onClick={() => {
                        setState({ value: option.value, selectedLabel: option.label });
                        fireEvent('onChange', { value: option.value });
                        close();
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
                        'flex items-center gap-2 px-2.5 text-left text-sm',
                        option.value === state.value
                          ? 'bg-blue-50 font-medium text-blue-700'
                          : 'text-slate-700 hover:bg-slate-50',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate" style={valueStyle}>
                        {option.label}
                      </span>
                      {option.value === state.value && (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0">
                          <path
                            d="M2.5 6.2 4.8 8.4 9.5 3.5"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
              {filtered.length === 0 && (
                <div className="px-3 py-4 text-center text-sm text-slate-400">
                  {dataError ?? (options.length === 0 ? emptyChoiceHint(properties) : 'No matches')}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

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
          ref={triggerRef}
          type="button"
          disabled={Boolean(properties.disabled)}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => {
            if (open) {
              close();
              return;
            }
            const rect = triggerRef.current?.getBoundingClientRect();
            if (rect) {
              setPos({
                top: rect.bottom + 4,
                left: rect.left,
                width: Math.max(rect.width, 160),
                maxHeight: 224,
              });
            }
            setOpen(true);
          }}
          style={valueStyle}
          className={clsx(
            'flex h-full w-full items-center justify-between text-left',
            fieldSurfaceClass(Boolean(dataError)),
          )}
        >
          <span className={clsx('truncate', !selected && 'text-slate-400')}>
            {selected ? selected.label : placeholder}
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
            className={clsx(
              'ml-2 shrink-0 text-slate-400 transition-transform duration-150',
              open && 'rotate-180',
            )}
          >
            <path
              d="M2.5 4.5 6 8 9.5 4.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {menu}
      </div>
      {dataError ? <p className={fieldErrorClass}>{dataError}</p> : null}
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
