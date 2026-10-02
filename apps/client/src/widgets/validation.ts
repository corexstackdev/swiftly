import type { ValidationRule } from '@swiftly/shared';

/**
 * Declarative validation, evaluated client-side for inline feedback.
 *
 * These results are advisory. Any query consuming a validated input re-checks the
 * same rules server-side, because a published app's browser is as untrusted as any
 * other client.
 */

export interface ValidationOutcome {
  isValid: boolean;
  errors: string[];
}

export function validate(value: unknown, rules: ValidationRule[]): ValidationOutcome {
  const errors: string[] = [];

  for (const rule of rules) {
    // `appliesWhen` is pre-evaluated by the binding engine, so by the time a rule
    // reaches here the flag is a plain boolean.
    if (rule.appliesWhen !== undefined && !truthy(rule.appliesWhen)) continue;
    const failure = check(value, rule);
    if (failure) errors.push(rule.message || failure);
  }

  return { isValid: errors.length === 0, errors };
}

function check(value: unknown, rule: ValidationRule): string | null {
  const text = value === null || value === undefined ? '' : String(value);
  const expected = rule.value ?? '';

  switch (rule.kind) {
    case 'required':
      return text.trim().length === 0 ? 'This field is required' : null;

    case 'minLength':
      return text.length < Number(expected) ? `Must be at least ${expected} characters` : null;

    case 'maxLength':
      return text.length > Number(expected) ? `Must be at most ${expected} characters` : null;

    case 'min':
      if (text.trim() === '') return null;
      return Number(text) < Number(expected) ? `Must be at least ${expected}` : null;

    case 'max':
      if (text.trim() === '') return null;
      return Number(text) > Number(expected) ? `Must be at most ${expected}` : null;

    case 'numeric':
      return text !== '' && Number.isNaN(Number(text)) ? 'Must be a number' : null;

    case 'integer':
      return text !== '' && !Number.isInteger(Number(text)) ? 'Must be a whole number' : null;

    case 'email':
      // Deliberately permissive: the only authoritative test of an address is
      // sending to it, and a strict pattern rejects valid addresses.
      return text !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
        ? 'Must be a valid email address'
        : null;

    case 'url':
      if (text === '') return null;
      try {
        new URL(text);
        return null;
      } catch {
        return 'Must be a valid URL';
      }

    case 'regex':
      try {
        return text !== '' && !new RegExp(String(expected)).test(text)
          ? 'Does not match the required format'
          : null;
      } catch {
        return 'The validation pattern itself is invalid';
      }

    case 'matchesField':
      return text !== String(expected) ? 'Values do not match' : null;

    case 'custom':
      // The expression was evaluated by the binding engine; a falsy result fails.
      return truthy(expected) ? null : 'Failed validation';

    case 'asyncQuery':
      // Resolved by the host, which debounces the query and writes the outcome
      // back into widget state before this runs.
      return null;

    default:
      return null;
  }
}

function truthy(value: unknown): boolean {
  return value !== false && value !== 'false' && value !== '' && value !== null && value !== undefined && value !== 0;
}

/** A finite number from a property or a rule, or undefined when unset. */
export function numberBound(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
}

/**
 * Validation rules plus the Range min/max on Number Input.
 *
 * Those bounds used to live only as HTML attributes, which do not stop someone
 * typing 6 into a field whose minimum is 10. Folding them into the same rules
 * the rest of the form already reads is what makes Submit and the red message
 * agree with the panel.
 */
export function mergeFieldRules(properties: Record<string, unknown>): ValidationRule[] {
  const rules = [...((properties.validation as ValidationRule[] | undefined) ?? [])];
  const min = numberBound(properties.min);
  const max = numberBound(properties.max);
  if (min !== undefined && !rules.some((rule) => rule.kind === 'min')) {
    rules.push({ kind: 'min', value: min, message: `Must be at least ${min}` });
  }
  if (max !== undefined && !rules.some((rule) => rule.kind === 'max')) {
    rules.push({ kind: 'max', value: max, message: `Must be at most ${max}` });
  }
  return rules;
}

export function fieldBounds(properties: Record<string, unknown>): { min?: number; max?: number } {
  let min = numberBound(properties.min);
  let max = numberBound(properties.max);
  for (const rule of (properties.validation as ValidationRule[] | undefined) ?? []) {
    if (rule.kind === 'min' && min === undefined) min = numberBound(rule.value);
    if (rule.kind === 'max' && max === undefined) max = numberBound(rule.value);
  }
  return { min, max };
}

/** Clamp a number onto the field's min/max. Used on blur so typing 16 is still possible. */
export function clampToBounds(value: unknown, properties: Record<string, unknown>): unknown {
  if (value === undefined || value === null || value === '') return value;
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  const { min, max } = fieldBounds(properties);
  let next = number;
  if (min !== undefined && next < min) next = min;
  if (max !== undefined && next > max) next = max;
  return next;
}

/** Required waits for blur; range and format errors show as soon as there is a value. */
export function showFieldError(
  outcome: ValidationOutcome,
  options: { touched: boolean; value: unknown },
): boolean {
  if (outcome.isValid) return false;
  if (options.touched) return true;
  const text = options.value == null ? '' : String(options.value);
  return text.trim() !== '';
}
