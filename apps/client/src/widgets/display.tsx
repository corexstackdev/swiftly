import clsx from 'clsx';
import type { RegisteredWidget, WidgetProps } from './types';
import { IconGlyph, hasIcon } from '@/icons/IconGlyph';

/**
 * Read-only display widgets.
 *
 * All of these are bindable end to end: a stats box reads a number out of a query
 * result, a progress bar reads a percentage, an image reads a URL. None of them
 * hold state, so none expose any.
 */

/* ------------------------------------------------------------------ *
 * Stats box
 * ------------------------------------------------------------------ */

function StatsBoxWidget({ properties }: WidgetProps) {
  const change = properties.change === undefined ? null : Number(properties.change);
  const improving = change !== null && (properties.invertChange ? change < 0 : change > 0);

  return (
    <div className="flex h-full w-full items-center gap-3 overflow-hidden rounded border border-slate-200 bg-white px-3 py-2">
      {hasIcon(properties.icon) ? (
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100"
          style={{ color: String(properties.iconColor ?? '#475569') }}
        >
          <IconGlyph name={properties.icon} size={20} />
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
      <span className="truncate text-xs text-slate-500">{String(properties.label ?? '')}</span>

      <span className="truncate text-2xl font-semibold tabular-nums text-slate-900">
        {formatValue(properties.value, properties)}
      </span>

      {change !== null && !Number.isNaN(change) && (
        <span
          className={clsx(
            'flex items-center gap-1 text-xs tabular-nums',
            improving ? 'text-green-600' : 'text-red-600',
          )}
        >
          {change > 0 ? '↗' : change < 0 ? '↘' : '→'}
          {Math.abs(change)}
          {properties.changeSuffix ? String(properties.changeSuffix) : '%'}
          {properties.changeLabel ? (
            <span className="text-slate-400">{String(properties.changeLabel)}</span>
          ) : null}
        </span>
      )}
      </div>
    </div>
  );
}

function formatValue(value: unknown, properties: Record<string, unknown>): string {
  if (value === undefined || value === null || value === '') return '—';

  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);

  const decimals = properties.decimals === undefined ? undefined : Number(properties.decimals);
  const formatted = numeric.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals ?? 2,
  });

  return `${properties.prefix ? String(properties.prefix) : ''}${formatted}${
    properties.suffix ? String(properties.suffix) : ''
  }`;
}

export const statsBoxWidget: RegisteredWidget = {
  component: StatsBoxWidget,
  definition: {
    type: 'stats_box',
    displayName: 'Stats Box',
    category: 'display',
    icon: 'stats',
    defaultLayout: { x: 0, y: 0, w: 5, h: 4 },
    minSize: { w: 3, h: 3 },
    events: [],
    exposedState: [],
    properties: [
      {
        name: 'Content',
        properties: [
          { key: 'label', label: 'Label', control: 'text', expectedType: 'string', bindable: true, defaultValue: 'Total' },
          { key: 'icon', label: 'Icon', control: 'icon', expectedType: 'string', bindable: true },
          { key: 'iconColor', label: 'Icon colour', control: 'color', expectedType: 'string', bindable: false, defaultValue: '#475569' },
          {
            key: 'value',
            label: 'Value',
            control: 'code',
            expectedType: 'any',
            bindable: true,
            helpText: 'e.g. {{ GetOrders.data.length }}',
          },
          { key: 'prefix', label: 'Prefix', control: 'text', expectedType: 'string', bindable: true },
          { key: 'suffix', label: 'Suffix', control: 'text', expectedType: 'string', bindable: true },
          { key: 'decimals', label: 'Decimals', control: 'number', expectedType: 'number', bindable: false },
        ],
      },
      {
        name: 'Change',
        properties: [
          { key: 'change', label: 'Change', control: 'code', expectedType: 'number', bindable: true, helpText: 'A number; positive shows as up' },
          { key: 'changeSuffix', label: 'Change unit', control: 'text', expectedType: 'string', bindable: false, defaultValue: '%' },
          { key: 'changeLabel', label: 'Change caption', control: 'text', expectedType: 'string', bindable: true },
          {
            key: 'invertChange',
            label: 'Down is good',
            control: 'toggle',
            expectedType: 'boolean',
            bindable: false,
            defaultValue: false,
            helpText: 'For metrics where a fall is an improvement, like error rate',
          },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * Progress
 * ------------------------------------------------------------------ */

function ProgressWidget({ properties }: WidgetProps) {
  const value = Number(properties.value ?? 0);
  const max = Number(properties.max ?? 100);
  const percent = max === 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));

  return (
    <div className="flex h-full w-full flex-col justify-center gap-1">
      {properties.label ? (
        <span className="truncate text-xs font-medium text-slate-600">
          {String(properties.label)}
        </span>
      ) : null}

      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-blue-600 transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>

      {properties.showValue !== false && (
        <span className="text-xs tabular-nums text-slate-500">{percent.toFixed(0)}%</span>
      )}
    </div>
  );
}

export const progressWidget: RegisteredWidget = {
  component: ProgressWidget,
  definition: {
    type: 'progress',
    displayName: 'Progress',
    category: 'display',
    icon: 'progress',
    defaultLayout: { x: 0, y: 0, w: 6, h: 3 },
    minSize: { w: 3, h: 2 },
    events: [],
    exposedState: [],
    properties: [
      {
        name: 'Content',
        properties: [
          { key: 'label', label: 'Label', control: 'text', expectedType: 'string', bindable: true },
          { key: 'value', label: 'Value', control: 'code', expectedType: 'number', bindable: true, defaultValue: 0 },
          { key: 'max', label: 'Maximum', control: 'number', expectedType: 'number', bindable: true, defaultValue: 100 },
          { key: 'showValue', label: 'Show percentage', control: 'toggle', expectedType: 'boolean', bindable: false, defaultValue: true },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * Rating
 * ------------------------------------------------------------------ */

function RatingWidget({ properties, state, setState, fireEvent, isDesignMode }: WidgetProps) {
  const max = Number(properties.max ?? 5);
  const readOnly = properties.readOnly !== false;
  const value = Number(state.value ?? properties.value ?? 0);

  return (
    <div className="flex h-full w-full items-center gap-0.5">
      {Array.from({ length: max }, (_, index) => {
        const filled = index < Math.round(value);
        return (
          <button
            key={index}
            type="button"
            disabled={readOnly || isDesignMode}
            aria-label={`${index + 1} of ${max}`}
            onClick={() => {
              setState({ value: index + 1 });
              fireEvent('onChange', { value: index + 1 });
            }}
            className={clsx(
              'text-lg leading-none',
              filled ? 'text-amber-400' : 'text-slate-300',
              !readOnly && !isDesignMode && 'cursor-pointer hover:text-amber-500',
            )}
          >
            ★
          </button>
        );
      })}

      {properties.showValue ? (
        <span className="ml-1.5 text-xs tabular-nums text-slate-500">{value.toFixed(1)}</span>
      ) : null}
    </div>
  );
}

export const ratingWidget: RegisteredWidget = {
  component: RatingWidget,
  definition: {
    type: 'rating',
    displayName: 'Rating',
    category: 'display',
    icon: 'star',
    defaultLayout: { x: 0, y: 0, w: 4, h: 2 },
    minSize: { w: 2, h: 1 },
    events: [{ key: 'onChange', label: 'On change', payloadKeys: ['value'] }],
    exposedState: [{ key: 'value', type: 'number', description: 'Selected rating' }],
    properties: [
      {
        name: 'Content',
        properties: [
          { key: 'value', label: 'Value', control: 'code', expectedType: 'number', bindable: true, defaultValue: 0 },
          { key: 'max', label: 'Stars', control: 'number', expectedType: 'number', bindable: false, defaultValue: 5 },
          { key: 'showValue', label: 'Show number', control: 'toggle', expectedType: 'boolean', bindable: false, defaultValue: false },
        ],
      },
      {
        name: 'Behaviour',
        properties: [
          { key: 'readOnly', label: 'Read only', control: 'toggle', expectedType: 'boolean', bindable: false, defaultValue: true },
          { key: 'onChange', label: 'On change', control: 'action_list', expectedType: 'any', bindable: false },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * Image
 * ------------------------------------------------------------------ */

function ImageWidget({ properties }: WidgetProps) {
  const url = properties.url ? String(properties.url) : '';

  if (!url) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400">
        Bind an image URL
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={String(properties.altText ?? '')}
      className="h-full w-full rounded"
      style={{ objectFit: (properties.fit as 'cover' | 'contain' | 'fill') ?? 'contain' }}
      // A broken URL in a published app should look deliberate, not like a crash.
      onError={(event) => {
        event.currentTarget.style.visibility = 'hidden';
      }}
    />
  );
}

export const imageWidget: RegisteredWidget = {
  component: ImageWidget,
  definition: {
    type: 'image',
    displayName: 'Image',
    category: 'media',
    icon: 'image',
    defaultLayout: { x: 0, y: 0, w: 6, h: 6 },
    minSize: { w: 2, h: 2 },
    events: [],
    exposedState: [],
    properties: [
      {
        name: 'Content',
        properties: [
          { key: 'url', label: 'Image URL', control: 'text', expectedType: 'string', bindable: true, helpText: 'e.g. {{ Table1.selectedRow.avatar }}' },
          { key: 'altText', label: 'Alt text', control: 'text', expectedType: 'string', bindable: true, helpText: 'Read aloud by screen readers' },
          { key: 'fit', label: 'Fit', control: 'select', expectedType: 'string', bindable: false, defaultValue: 'contain' },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * Divider
 * ------------------------------------------------------------------ */

function DividerWidget({ properties }: WidgetProps) {
  const vertical = properties.orientation === 'vertical';

  if (properties.label) {
    return (
      <div className="flex h-full w-full items-center gap-2">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="shrink-0 text-xs text-slate-400">{String(properties.label)}</span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center">
      <span className={clsx('bg-slate-200', vertical ? 'h-full w-px' : 'h-px w-full')} />
    </div>
  );
}

export const dividerWidget: RegisteredWidget = {
  component: DividerWidget,
  definition: {
    type: 'divider',
    displayName: 'Divider',
    category: 'layout',
    icon: 'divider',
    defaultLayout: { x: 0, y: 0, w: 12, h: 1 },
    minSize: { w: 1, h: 1 },
    events: [],
    exposedState: [],
    properties: [
      {
        name: 'Appearance',
        properties: [
          { key: 'label', label: 'Label', control: 'text', expectedType: 'string', bindable: true },
          { key: 'orientation', label: 'Orientation', control: 'select', expectedType: 'string', bindable: false, defaultValue: 'horizontal' },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------ *
 * Iframe
 * ------------------------------------------------------------------ */

function IframeWidget({ properties, isDesignMode }: WidgetProps) {
  const url = properties.url ? String(properties.url) : '';

  if (!url) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400">
        Bind a URL to embed
      </div>
    );
  }

  if (isDesignMode) {
    // Embedded pages run their own scripts and can steal focus mid-drag, so the
    // canvas shows a placeholder and the real frame loads in preview.
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 rounded border border-slate-300 bg-slate-50 text-xs text-slate-500">
        <span>Embedded page</span>
        <span className="max-w-full truncate px-2 text-[11px] text-slate-400">{url}</span>
      </div>
    );
  }

  return (
    <iframe
      src={url}
      title={String(properties.title ?? 'Embedded content')}
      className="h-full w-full rounded border border-slate-200"
      // The embedded page is third-party: deny same-origin access to us outright.
      sandbox="allow-scripts allow-forms allow-popups"
      referrerPolicy="no-referrer"
    />
  );
}

/* ------------------------------------------------------------------ *
 * Icon
 * ------------------------------------------------------------------ */

const ICON_ALIGN: Record<string, string> = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end',
};

function IconWidget({ properties }: WidgetProps) {
  const size = Math.max(12, Number(properties.size ?? 24) || 24);
  return (
    <div
      className={clsx(
        'flex h-full w-full items-center',
        ICON_ALIGN[String(properties.align ?? 'center')] ?? ICON_ALIGN.center,
      )}
      style={{ color: String(properties.color ?? '#334155') }}
      title={properties.tooltip ? String(properties.tooltip) : undefined}
    >
      <IconGlyph name={properties.icon} size={size} />
    </div>
  );
}

export const iconWidget: RegisteredWidget = {
  component: IconWidget,
  definition: {
    type: 'icon',
    displayName: 'Icon',
    category: 'display',
    icon: 'star',
    defaultLayout: { x: 0, y: 0, w: 2, h: 2 },
    minSize: { w: 1, h: 1 },
    events: [],
    exposedState: [],
    properties: [
      {
        name: 'Content',
        properties: [
          {
            key: 'icon',
            label: 'Icon',
            control: 'icon',
            expectedType: 'string',
            bindable: true,
            defaultValue: 'FiStar',
          },
          {
            key: 'size',
            label: 'Size',
            control: 'number',
            expectedType: 'number',
            bindable: false,
            defaultValue: 24,
          },
          {
            key: 'color',
            label: 'Colour',
            control: 'color',
            expectedType: 'string',
            bindable: false,
            defaultValue: '#334155',
          },
          {
            key: 'align',
            label: 'Align',
            control: 'select',
            expectedType: 'string',
            bindable: false,
            defaultValue: 'center',
            options: [
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Centre' },
              { value: 'right', label: 'Right' },
            ],
          },
          {
            key: 'tooltip',
            label: 'Tooltip',
            control: 'text',
            expectedType: 'string',
            bindable: true,
          },
        ],
      },
    ],
  },
};

export const iframeWidget: RegisteredWidget = {
  component: IframeWidget,
  definition: {
    type: 'iframe',
    displayName: 'Iframe',
    category: 'display',
    icon: 'code',
    defaultLayout: { x: 0, y: 0, w: 12, h: 10 },
    minSize: { w: 3, h: 3 },
    events: [],
    exposedState: [],
    properties: [
      {
        name: 'Content',
        properties: [
          { key: 'url', label: 'URL', control: 'text', expectedType: 'string', bindable: true },
          { key: 'title', label: 'Title', control: 'text', expectedType: 'string', bindable: true, helpText: 'Describes the frame to screen readers' },
        ],
      },
    ],
  },
};
