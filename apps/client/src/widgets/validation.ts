import type { ValidationRule } from '@vinodapp/shared';

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
      return Number(text) < Number(expected) ? `Must be at least ${expected}` : null;

    case 'max':
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
