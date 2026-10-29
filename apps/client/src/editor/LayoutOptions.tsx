import type { ReactNode } from 'react';
import clsx from 'clsx';
import {
  APP_LAYOUTS,
  PAGE_LAYOUTS,
  type AppLayoutId,
  type PageLayoutId,
} from '@swiftly/shared';

/**
 * Visual pickers for app chrome and page structure.
 *
 * A dropdown labelled "Style" did not show what the app would look like, and
 * new apps used to arrive with a sidebar already decided. These cards are the
 * choice itself — the same pictures on create, on an empty canvas, and in
 * page properties.
 */

type PickerSize = 'sm' | 'md';

export function AppLayoutPicker({
  value,
  onChange,
  size = 'md',
}: {
  value: AppLayoutId;
  onChange: (id: AppLayoutId) => void;
  size?: PickerSize;
}) {
  return (
    <div className={gridClass(size)}>
      {APP_LAYOUTS.map((layout) => (
        <LayoutCard
          key={layout.id}
          selected={value === layout.id}
          label={layout.label}
          description={layout.description}
          size={size}
          onSelect={() => onChange(layout.id)}
          preview={<AppChromePreview style={layout.id} />}
        />
      ))}
    </div>
  );
}

export function PageLayoutPicker({
  value,
  onSelect,
  size = 'md',
  includeBlank = true,
}: {
  value?: PageLayoutId;
  onSelect: (id: PageLayoutId) => void;
  size?: PickerSize;
  includeBlank?: boolean;
}) {
  const layouts = includeBlank
    ? PAGE_LAYOUTS
    : PAGE_LAYOUTS.filter((layout) => layout.id !== 'blank');

  return (
    <div className={gridClass(size)}>
      {layouts.map((layout) => (
        <LayoutCard
          key={layout.id}
          selected={value === layout.id}
          label={layout.label}
          description={layout.description}
          size={size}
          onSelect={() => onSelect(layout.id)}
          preview={<PageLayoutPreview layout={layout.id} />}
        />
      ))}
    </div>
  );
}

/** Compact chrome switcher for the editor header. */
export function AppLayoutToggle({
  value,
  onChange,
}: {
  value: AppLayoutId;
  onChange: (id: AppLayoutId) => void;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-0.5 rounded border border-slate-200 p-0.5"
      role="radiogroup"
      aria-label="App layout"
    >
      {APP_LAYOUTS.map((layout) => (
        <button
          key={layout.id}
          type="button"
          role="radio"
          aria-checked={value === layout.id}
          title={layout.label}
          onClick={() => onChange(layout.id)}
          className={clsx(
            'flex h-7 w-8 items-center justify-center rounded',
            value === layout.id
              ? 'bg-blue-50 text-blue-700'
              : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600',
          )}
        >
          <AppChromeGlyph style={layout.id} />
        </button>
      ))}
    </div>
  );
}

function LayoutCard({
  selected,
  label,
  description,
  size,
  onSelect,
  preview,
}: {
  selected: boolean;
  label: string;
  description: string;
  size: PickerSize;
  onSelect: () => void;
  preview: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={clsx(
        'flex flex-col overflow-hidden rounded-lg border bg-white text-left transition-colors',
        selected
          ? 'border-blue-500 ring-2 ring-blue-500/20'
          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
      )}
    >
      <div
        className={clsx(
          'pointer-events-none border-b border-slate-100 bg-slate-50',
          size === 'sm' ? 'h-14 p-1.5' : 'h-[4.5rem] p-2',
        )}
      >
        {preview}
      </div>
      <span className={clsx('px-2 pt-1.5 text-xs font-medium text-slate-800', size === 'sm' && 'pb-1.5')}>
        {label}
      </span>
      {size !== 'sm' && (
        <span className="px-2 pt-0.5 pb-2 text-[11px] leading-snug text-slate-400">{description}</span>
      )}
    </button>
  );
}

function gridClass(size: PickerSize): string {
  return size === 'sm' ? 'grid grid-cols-3 gap-1.5' : 'grid grid-cols-3 gap-2';
}

function AppChromePreview({ style }: { style: AppLayoutId }) {
  return (
    <div className="flex h-full overflow-hidden rounded-sm border border-slate-200 bg-white">
      {style === 'sidebar' && <div className="w-[22%] bg-slate-800" />}
      <div className="flex min-w-0 flex-1 flex-col">
        {style === 'topbar' && <div className="h-[22%] bg-slate-800" />}
        <div className="min-h-0 flex-1 bg-slate-100 p-1">
          <div className="h-full rounded-[2px] bg-white" />
        </div>
      </div>
    </div>
  );
}

function AppChromeGlyph({ style }: { style: AppLayoutId }) {
  return (
    <span className="flex h-3.5 w-4 overflow-hidden rounded-[2px] border border-current" aria-hidden="true">
      {style === 'sidebar' && <span className="w-[30%] bg-current" />}
      <span className="flex min-w-0 flex-1 flex-col">
        {style === 'topbar' && <span className="h-[30%] bg-current" />}
        <span className="min-h-0 flex-1" />
      </span>
    </span>
  );
}

function PageLayoutPreview({ layout }: { layout: PageLayoutId }) {
  if (layout === 'blank') {
    return (
      <div className="h-full rounded-sm border border-dashed border-slate-300 bg-white" />
    );
  }

  if (layout === 'navbar') {
    return (
      <div className="flex h-full flex-col overflow-hidden rounded-sm border border-slate-200 bg-white">
        <div className="h-[28%] bg-slate-800" />
        <div className="flex flex-1 flex-col gap-1 p-1.5">
          <div className="h-1.5 w-1/2 rounded-sm bg-slate-200" />
          <div className="h-1 w-2/3 rounded-sm bg-slate-100" />
        </div>
      </div>
    );
  }

  if (layout === 'dashboard') {
    return (
      <div className="flex h-full flex-col gap-1 overflow-hidden rounded-sm border border-slate-200 bg-white p-1.5">
        <div className="h-1.5 w-1/2 rounded-sm bg-slate-200" />
        <div className="grid min-h-0 flex-1 grid-cols-3 gap-1">
          <div className="rounded-[2px] border border-slate-200 bg-slate-50" />
          <div className="rounded-[2px] border border-slate-200 bg-slate-50" />
          <div className="rounded-[2px] border border-slate-200 bg-slate-50" />
        </div>
      </div>
    );
  }

  if (layout === 'columns') {
    return (
      <div className="flex h-full flex-col gap-1 overflow-hidden rounded-sm border border-slate-200 bg-white p-1.5">
        <div className="h-1.5 w-1/2 rounded-sm bg-slate-200" />
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-1">
          <div className="rounded-[2px] border border-slate-200 bg-slate-50" />
          <div className="rounded-[2px] border border-slate-200 bg-slate-50" />
        </div>
      </div>
    );
  }

  if (layout === 'form') {
    return (
      <div className="flex h-full flex-col gap-1 overflow-hidden rounded-sm border border-slate-200 bg-white p-1.5">
        <div className="h-1.5 w-1/3 rounded-sm bg-slate-200" />
        <div className="h-2 rounded-[2px] border border-slate-200 bg-slate-50" />
        <div className="h-2 rounded-[2px] border border-slate-200 bg-slate-50" />
        <div className="h-1.5 w-8 rounded-[2px] bg-blue-500/70" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-sm border border-slate-200 bg-white">
      <div className="flex gap-1 border-b border-slate-200 px-1.5 pt-1">
        <div className="h-2 w-8 rounded-t-[2px] bg-slate-200" />
        <div className="h-2 w-8 rounded-t-[2px] bg-slate-100" />
      </div>
      <div className="min-h-0 flex-1 p-1.5">
        <div className="h-1.5 w-2/3 rounded-sm bg-slate-100" />
      </div>
    </div>
  );
}
