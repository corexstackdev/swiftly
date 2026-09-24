import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import type { RegisteredWidget, WidgetProps } from './types';
import { formatValue, type ValueFormat } from './formatValue';
import { textStyleProperties, textStyleToCss } from './textStyle';
import { spacingToCss } from '@/editor/SpacingEditor';

/**
 * Text.
 *
 * The most-used widget in any internal tool, and almost never used to show a
 * literal: it shows a value that came out of a query. So the work here is mostly
 * about what happens between the value and the screen — formatting it, saying
 * something sensible when it is absent, and keeping it readable when it is
 * longer than the box it was given.
 *
 * It publishes what it displays as `{{ Name.text }}`. A label that reads
 * "Ordered 21 Sept 2026" is worth reusing in a tooltip or a notification without
 * building the same string twice.
 *
 * Markdown and HTML are deliberately not here. Half a markdown renderer is worse
 * than none, and raw HTML from a binding is stored XSS the moment the value
 * comes from a table someone else can write to.
 */

const VARIANTS: Record<string, string> = {
  heading: 'text-xl font-semibold text-slate-900',
  subheading: 'text-base font-medium text-slate-700',
  body: 'text-sm text-slate-700',
  caption: 'text-xs text-slate-500',
};

const JUSTIFY: Record<string, string> = {
  top: 'justify-start',
  middle: 'justify-center',
  bottom: 'justify-end',
};

function TextWidget({ properties, state, setState, fireEvent, isDesignMode }: WidgetProps) {
  const [copied, setCopied] = useState(false);

  const text = useMemo(
    () =>
      formatValue(properties.text, {
        format: properties.format as ValueFormat | undefined,
        decimals: properties.decimals as number | undefined,
        currency: properties.currency as string | undefined,
        dateStyle: properties.dateStyle as 'short' | 'medium' | 'long' | undefined,
        emptyText: properties.emptyText as string | undefined,
        prefix: properties.prefix as string | undefined,
        suffix: properties.suffix as string | undefined,
      }),
    [
      properties.text,
      properties.format,
      properties.decimals,
      properties.currency,
      properties.dateStyle,
      properties.emptyText,
      properties.prefix,
      properties.suffix,
    ],
  );

  /*
   * Published so other widgets can bind to what is on screen rather than
   * rebuilding it. Guarded by a comparison: writing on every render would
   * re-render the page on every render.
   */
  useEffect(() => {
    if (state.text !== text) setState({ text });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, state.text]);

  const actions = properties.onClick;
  const clickable = Array.isArray(actions) && actions.length > 0;

  const noWrap = properties.wrap === false;
  const maxLines = Number(properties.maxLines);
  // Clamping counts lines, so it only means anything while lines can wrap.
  const clamped = !noWrap && Number.isFinite(maxLines) && maxLines > 0;

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard access can be refused outright; saying nothing is better than
      // claiming a copy that did not happen.
    }
  };

  return (
    <div
      className={clsx('group/text relative flex h-full w-full flex-col', JUSTIFY[String(properties.verticalAlign ?? 'top')])}
      style={{
        background: String(properties.background ?? 'transparent'),
        padding: spacingToCss(properties.padding, 0),
        borderRadius: Number(properties.borderRadius ?? 0),
      }}
    >
      <div
        title={properties.tooltip ? String(properties.tooltip) : undefined}
        onClick={() => {
          // Suppressed on the canvas: clicking a widget there selects it, and an
          // action that ran while designing would be a side effect nobody asked
          // for.
          if (!isDesignMode && clickable) fireEvent('onClick', { text });
        }}
        className={clsx(
          'w-full min-h-0',
          VARIANTS[String(properties.variant ?? 'body')] ?? VARIANTS.body,
          /*
           * One overflow rule, chosen once. Setting `overflow-auto` alongside
           * `truncate` left the winner to stylesheet order rather than intent,
           * and auto won — so a line that was meant to end in an ellipsis got a
           * horizontal scrollbar instead.
           */
          noWrap
            ? 'truncate'
            : clsx(
                'break-words whitespace-pre-wrap',
                clamped ? 'overflow-hidden' : 'overflow-auto',
              ),
          clickable && !isDesignMode && 'cursor-pointer hover:underline',
        )}
        style={{
          textAlign: properties.align as 'left' | 'center' | 'right' | undefined,
          ...textStyleToCss(properties, 'text'),
          ...(clamped
            ? {
                // The line clamp needs all three to take effect, and it only
                // applies when wrapping is on — a single truncated line already
                // has its own rule above.
                display: '-webkit-box',
                WebkitLineClamp: maxLines,
                WebkitBoxOrient: 'vertical' as const,
              }
            : {}),
        }}
      >
        {text}
      </div>

      {Boolean(properties.copyable) && text !== '' && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (!isDesignMode) void copy();
          }}
          title={`Copy “${text}”`}
          className="absolute top-0 right-0 rounded bg-white/90 px-1 text-[10px] text-slate-400 opacity-0 transition-opacity group-hover/text:opacity-100 hover:text-slate-700"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      )}
    </div>
  );
}


export const textWidget: RegisteredWidget = {
  component: TextWidget,
  definition: {
    type: 'text',
    displayName: 'Text',
    category: 'display',
    icon: 'type',
    defaultLayout: { x: 0, y: 0, w: 6, h: 2 },
    minSize: { w: 2, h: 1 },
    events: [{ key: 'onClick', label: 'On click', payloadKeys: ['text'] }],
    exposedState: [
      { key: 'text', type: 'string', description: 'What is on screen, formatted' },
    ],
    properties: [
      {
        name: 'Content',
        properties: [
          {
            key: 'text',
            label: 'Text',
            control: 'textarea',
            expectedType: 'any',
            bindable: true,
            defaultValue: 'Text',
          },
          {
            key: 'format',
            label: 'Format as',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'plain',
            options: [
              { value: 'plain', label: 'Plain text' },
              { value: 'number', label: 'Number' },
              { value: 'currency', label: 'Currency' },
              { value: 'percent', label: 'Percentage' },
              { value: 'date', label: 'Date' },
              { value: 'datetime', label: 'Date and time' },
              { value: 'time', label: 'Time' },
              { value: 'relative', label: 'Relative time' },
            ],
            helpText: 'A value that will not convert is shown as it came.',
          },
          {
            key: 'decimals',
            label: 'Decimal places',
            control: 'number',
            expectedType: 'number',
            bindable: false,
            helpText: 'Blank follows the locale.',
            visibleWhen: { key: 'format', oneOf: ['number', 'currency', 'percent'] },
          },
          {
            key: 'currency',
            label: 'Currency code',
            control: 'text',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'EUR',
            helpText: 'Three letters, e.g. EUR, USD, INR.',
            visibleWhen: { key: 'format', equals: 'currency' },
          },
          {
            key: 'dateStyle',
            label: 'Date length',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'medium',
            options: [
              { value: 'short', label: 'Short — 21/09/26' },
              { value: 'medium', label: 'Medium — 21 Sept 2026' },
              { value: 'long', label: 'Long — 21 September 2026' },
            ],
            visibleWhen: { key: 'format', oneOf: ['date', 'datetime', 'time'] },
          },
          {
            key: 'prefix',
            label: 'Prefix',
            control: 'text',
            expectedType: 'string',
            bindable: true,
            helpText: 'Dropped when the value is empty.',
          },
          {
            key: 'suffix',
            label: 'Suffix',
            control: 'text',
            expectedType: 'string',
            bindable: true,
          },
          {
            key: 'emptyText',
            label: 'When empty, show',
            control: 'text',
            expectedType: 'string',
            bindable: false,
            helpText: 'An em dash reads better than a blank space in a table of values.',
          },
        ],
      },
      {
        name: 'Layout',
        properties: [
          {
            key: 'variant',
            label: 'Preset',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'body',
            options: [
              { value: 'heading', label: 'Heading' },
              { value: 'subheading', label: 'Subheading' },
              { value: 'body', label: 'Body' },
              { value: 'caption', label: 'Caption' },
            ],
            helpText: 'A starting point. Text style below overrides it.',
          },
          {
            key: 'align',
            label: 'Align',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'left',
            options: [
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Centre' },
              { value: 'right', label: 'Right' },
            ],
          },
          {
            key: 'verticalAlign',
            label: 'Vertical align',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'top',
            options: [
              { value: 'top', label: 'Top' },
              { value: 'middle', label: 'Middle' },
              { value: 'bottom', label: 'Bottom' },
            ],
          },
          {
            key: 'wrap',
            label: 'Wrap lines',
            control: 'toggle',
            expectedType: 'boolean',
            bindable: false,
            defaultValue: true,
            helpText: 'Off truncates to one line with an ellipsis.',
          },
          {
            key: 'maxLines',
            label: 'Maximum lines',
            control: 'number',
            expectedType: 'number',
            bindable: false,
            helpText: 'Blank scrolls instead of clamping.',
            visibleWhen: { key: 'wrap', equals: true },
          },
          {
            key: 'padding',
            label: 'Padding',
            control: 'spacing',
            expectedType: 'any',
            bindable: false,
            defaultValue: 0,
          },
        ],
      },
      {
        name: 'Text style',
        properties: textStyleProperties('text'),
      },
      {
        name: 'Background',
        properties: [
          {
            key: 'background',
            label: 'Background',
            control: 'color',
            expectedType: 'string',
            bindable: true,
            defaultValue: 'transparent',
          },
          {
            key: 'borderRadius',
            label: 'Corner radius',
            control: 'number',
            expectedType: 'number',
            bindable: false,
            defaultValue: 0,
          },
        ],
      },
      {
        name: 'Behaviour',
        properties: [
          {
            key: 'tooltip',
            label: 'Tooltip',
            control: 'text',
            expectedType: 'string',
            bindable: true,
            helpText: 'Shown on hover. Useful when the text itself is clamped.',
          },
          {
            key: 'copyable',
            label: 'Copy button',
            control: 'toggle',
            expectedType: 'boolean',
            bindable: false,
            defaultValue: false,
            helpText: 'Appears on hover. For order numbers and ids people retype.',
          },
          {
            key: 'onClick',
            label: 'On click',
            control: 'action_list',
            expectedType: 'any',
            bindable: false,
          },
        ],
      },
    ],
  },
};
