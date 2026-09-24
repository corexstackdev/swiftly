import { useMemo } from 'react';
import type { ConfigFieldDefinition } from '@/lib/api';
import { SECRET_PLACEHOLDER } from '@/lib/api';

/**
 * The connection form, generated from the plugin's `configFields`.
 *
 * Adding a datasource type adds its form with it — nothing here knows what a
 * Postgres connection looks like. Secrets that were never retyped are submitted as
 * a sentinel the server swaps for the stored value, so editing a host does not
 * require re-entering a password the user may not have.
 */

export function DatasourceForm({
  fields,
  value,
  onChange,
  isExisting,
}: {
  fields: ConfigFieldDefinition[];
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** Editing rather than creating: stored secrets show as masked, not empty. */
  isExisting: boolean;
}) {
  const sections = useMemo(() => {
    const order: string[] = [];
    const grouped = new Map<string, ConfigFieldDefinition[]>();

    for (const field of fields) {
      const name = field.section ?? 'Connection';
      if (!grouped.has(name)) {
        grouped.set(name, []);
        order.push(name);
      }
      grouped.get(name)!.push(field);
    }
    return order.map((name) => ({ name, fields: grouped.get(name)! }));
  }, [fields]);

  const set = (key: string, next: unknown): void => {
    const draft = structuredClone(value);
    setPath(draft, key, next);
    onChange(draft);
  };

  return (
    <div className="flex flex-col gap-5">
      {sections.map((section) => {
        const visible = section.fields.filter((field) => isVisible(field, value));
        if (visible.length === 0) return null;

        return (
          <section key={section.name}>
            <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
              {section.name}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {visible.map((field) => (
                <Field
                  key={field.key}
                  field={field}
                  value={getPath(value, field.key)}
                  isExisting={isExisting}
                  onChange={(next) => set(field.key, next)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Field({
  field,
  value,
  isExisting,
  onChange,
}: {
  field: ConfigFieldDefinition;
  value: unknown;
  isExisting: boolean;
  onChange: (value: unknown) => void;
}) {
  const inputClass =
    'w-full rounded border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20';

  const wide = field.control === 'textarea';

  return (
    <label className={wide ? 'sm:col-span-2' : undefined}>
      <span className="mb-1 block text-xs font-medium text-slate-600">
        {field.label}
        {field.required && <span className="text-red-500"> *</span>}
      </span>

      {field.control === 'select' ? (
        <select
          value={String(value ?? field.defaultValue ?? '')}
          onChange={(event) => onChange(event.target.value)}
          className={inputClass}
        >
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.control === 'toggle' ? (
        <input
          type="checkbox"
          checked={Boolean(value ?? field.defaultValue)}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 accent-blue-600"
        />
      ) : field.control === 'textarea' ? (
        <textarea
          rows={3}
          value={toInputValue(value, field, isExisting)}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={`${inputClass} resize-y font-mono text-xs`}
          spellCheck={false}
        />
      ) : (
        <input
          type={field.control === 'password' ? 'password' : field.control === 'number' ? 'number' : 'text'}
          value={toInputValue(value, field, isExisting)}
          placeholder={field.placeholder}
          autoComplete={field.secret ? 'new-password' : 'off'}
          onChange={(event) =>
            onChange(
              field.control === 'number'
                ? event.target.value === ''
                  ? undefined
                  : Number(event.target.value)
                : event.target.value,
            )
          }
          className={inputClass}
        />
      )}

      {field.helpText && (
        <span className="mt-1 block text-[11px] text-slate-400">{field.helpText}</span>
      )}
      {field.secret && isExisting && value === SECRET_PLACEHOLDER && (
        <span className="mt-1 block text-[11px] text-slate-400">
          Stored. Leave as-is to keep it, or type to replace.
        </span>
      )}
    </label>
  );
}

function toInputValue(
  value: unknown,
  field: ConfigFieldDefinition,
  isExisting: boolean,
): string {
  if (value !== undefined && value !== null) return String(value);
  if (field.secret && isExisting) return SECRET_PLACEHOLDER;
  if (field.defaultValue !== undefined) return String(field.defaultValue);
  return '';
}

function isVisible(field: ConfigFieldDefinition, value: Record<string, unknown>): boolean {
  if (!field.visibleWhen) return true;
  const actual = getPath(value, field.visibleWhen.key);
  // Fall back to the referenced field's own default, so a form that has not been
  // touched yet still shows the fields its default selection implies.
  return actual === undefined
    ? field.visibleWhen.equals === undefined
    : actual === field.visibleWhen.equals;
}

/** Builds the initial config object from the plugin's declared defaults. */
export function defaultConfig(fields: ConfigFieldDefinition[]): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.defaultValue !== undefined) setPath(config, field.key, field.defaultValue);
  }
  return config;
}

/** Masks stored secrets so the form can show that a value exists without revealing it. */
export function withMaskedSecrets(
  fields: ConfigFieldDefinition[],
  config: Record<string, unknown>,
): Record<string, unknown> {
  const masked = structuredClone(config);
  for (const field of fields) {
    if (field.secret) setPath(masked, field.key, SECRET_PLACEHOLDER);
  }
  return masked;
}

export function getPath(object: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, object);
}

export function setPath(object: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let cursor = object;
  for (const key of keys.slice(0, -1)) {
    if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]!] = value;
}
