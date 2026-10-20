import type { ColumnDefaultKind, ColumnSpec } from '@swiftly/shared';

export const COLUMN_TYPES = [
  'integer',
  'bigint',
  'smallint',
  'numeric',
  'text',
  'varchar(255)',
  'boolean',
  'date',
  'timestamptz',
  'uuid',
  'jsonb',
] as const;

export const DEFAULT_KINDS: { value: ColumnDefaultKind; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'null', label: 'NULL' },
  { value: 'now', label: 'now()' },
  { value: 'uuid', label: 'gen_random_uuid()' },
  { value: 'literal', label: 'Literal' },
];

export function emptyColumn(): ColumnSpec {
  return {
    name: '',
    dataType: 'text',
    nullable: true,
    primaryKey: false,
    unique: false,
    identity: false,
    defaultKind: 'none',
    defaultValue: '',
  };
}

export function idColumn(): ColumnSpec {
  return {
    name: 'id',
    dataType: 'integer',
    nullable: false,
    primaryKey: true,
    unique: false,
    identity: true,
    defaultKind: 'none',
    defaultValue: '',
  };
}

export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function parseCell(raw: string, dataType: string): unknown {
  const type = dataType.toLowerCase();
  if (raw === '') return null;
  if (type === 'boolean' || type === 'bool') {
    if (raw === 'true' || raw === 't' || raw === '1') return true;
    if (raw === 'false' || raw === 'f' || raw === '0') return false;
    return raw;
  }
  if (
    type === 'integer' ||
    type === 'bigint' ||
    type === 'smallint' ||
    type === 'numeric' ||
    type === 'real' ||
    type === 'double precision'
  ) {
    const number = Number(raw);
    return Number.isFinite(number) ? number : raw;
  }
  if (type === 'json' || type === 'jsonb') {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

export function formatError(error: unknown): string {
  if (error && typeof error === 'object' && 'details' in error) {
    const details = (error as { details?: { errors?: { path: string; message: string }[] } })
      .details;
    if (details?.errors?.length) {
      return details.errors.map((entry) => `${entry.path}: ${entry.message}`).join('\n');
    }
  }
  return error instanceof Error ? error.message : String(error);
}
