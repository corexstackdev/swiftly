import type { PoolClient } from 'pg';
import type {
  ColumnMetadata,
  ColumnPatch,
  ColumnSpec,
  CreateTableInput,
  SchemaAdmin,
  TableRowsPage,
} from '@swiftly/shared';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

const BASE_TYPES = new Set([
  'smallint',
  'integer',
  'bigint',
  'real',
  'double precision',
  'numeric',
  'text',
  'varchar',
  'character varying',
  'char',
  'character',
  'boolean',
  'date',
  'time',
  'timestamp',
  'timestamptz',
  'timestamp with time zone',
  'timestamp without time zone',
  'uuid',
  'json',
  'jsonb',
  'bytea',
]);

const SIZED_TYPE =
  /^(varchar|character varying|char|character|numeric|decimal)\(\d+(,\d+)?\)$/;

export function createPostgresSchemaAdmin<TConfig>(
  withClient: <T>(config: TConfig, work: (client: PoolClient) => Promise<T>) => Promise<T>,
): SchemaAdmin<TConfig> {
  const run = <T>(config: TConfig, work: (client: PoolClient) => Promise<T>): Promise<T> =>
    withClient(config, work).catch((error) => {
      throw new Error(describeAdminError(error));
    });

  return {
    createSchema: (config, name) => run(config, (client) => createSchema(client, name)),
    dropSchema: (config, name, cascade) =>
      run(config, (client) => dropSchema(client, name, cascade)),
    createTable: (config, input) => run(config, (client) => createTable(client, input)),
    dropTable: (config, schema, table) =>
      run(config, (client) => dropTable(client, schema, table)),
    renameTable: (config, schema, table, newName) =>
      run(config, (client) => renameTable(client, schema, table, newName)),
    addColumn: (config, schema, table, column) =>
      run(config, (client) => addColumn(client, schema, table, column)),
    alterColumn: (config, schema, table, name, patch) =>
      run(config, (client) => alterColumn(client, schema, table, name, patch)),
    dropColumn: (config, schema, table, name) =>
      run(config, (client) => dropColumn(client, schema, table, name)),
    renameColumn: (config, schema, table, name, newName) =>
      run(config, (client) => renameColumn(client, schema, table, name, newName)),
    listRows: (config, schema, table, options) =>
      run(config, (client) => listRows(client, schema, table, options)),
    insertRow: (config, schema, table, values) =>
      run(config, (client) => insertRow(client, schema, table, values)),
    updateRow: (config, schema, table, key, values) =>
      run(config, (client) => updateRow(client, schema, table, key, values)),
    deleteRows: (config, schema, table, keys) =>
      run(config, (client) => deleteRows(client, schema, table, keys)),
  };
}

async function createSchema(client: PoolClient, name: string): Promise<void> {
  assertSchemaName(name, { allowPublic: false });
  await client.query(`CREATE SCHEMA ${q(name)}`);
}

async function dropSchema(client: PoolClient, name: string, cascade?: boolean): Promise<void> {
  assertSchemaName(name, { allowPublic: false });
  await client.query(`DROP SCHEMA ${q(name)}${cascade ? ' CASCADE' : ' RESTRICT'}`);
}

async function createTable(client: PoolClient, input: CreateTableInput): Promise<void> {
  assertSchemaName(input.schema);
  assertIdent(input.name);
  if (input.columns.length === 0) {
    throw new Error('A table needs at least one column');
  }

  const definitions = input.columns.map(columnSql);
  const primary = input.columns.filter((column) => column.primaryKey).map((column) => q(column.name));
  if (primary.length > 0) {
    definitions.push(`PRIMARY KEY (${primary.join(', ')})`);
  }

  await client.query(
    `CREATE TABLE ${qualify(input.schema, input.name)} (\n  ${definitions.join(',\n  ')}\n)`,
  );
}

async function dropTable(client: PoolClient, schema: string, table: string): Promise<void> {
  await client.query(`DROP TABLE ${qualify(schema, table)}`);
}

async function renameTable(
  client: PoolClient,
  schema: string,
  table: string,
  newName: string,
): Promise<void> {
  assertIdent(newName);
  await client.query(`ALTER TABLE ${qualify(schema, table)} RENAME TO ${q(newName)}`);
}

async function addColumn(
  client: PoolClient,
  schema: string,
  table: string,
  column: ColumnSpec,
): Promise<void> {
  await client.query(`ALTER TABLE ${qualify(schema, table)} ADD COLUMN ${columnSql(column)}`);
}

async function alterColumn(
  client: PoolClient,
  schema: string,
  table: string,
  name: string,
  patch: ColumnPatch,
): Promise<void> {
  assertIdent(name);
  const target = qualify(schema, table);
  const column = q(name);
  const actions: string[] = [];

  if (patch.dataType) {
    actions.push(`ALTER COLUMN ${column} TYPE ${parseDataType(patch.dataType)}`);
  }
  if (patch.nullable === true) {
    actions.push(`ALTER COLUMN ${column} DROP NOT NULL`);
  } else if (patch.nullable === false) {
    actions.push(`ALTER COLUMN ${column} SET NOT NULL`);
  }
  if (patch.defaultKind === 'none') {
    actions.push(`ALTER COLUMN ${column} DROP DEFAULT`);
  } else if (patch.defaultKind) {
    const sql = defaultSql({ defaultKind: patch.defaultKind, defaultValue: patch.defaultValue });
    if (sql) actions.push(`ALTER COLUMN ${column} ${sql}`);
  }

  if (actions.length === 0) return;
  await client.query(`ALTER TABLE ${target} ${actions.join(', ')}`);
}

async function dropColumn(
  client: PoolClient,
  schema: string,
  table: string,
  name: string,
): Promise<void> {
  assertIdent(name);
  await client.query(`ALTER TABLE ${qualify(schema, table)} DROP COLUMN ${q(name)}`);
}

async function renameColumn(
  client: PoolClient,
  schema: string,
  table: string,
  name: string,
  newName: string,
): Promise<void> {
  assertIdent(name);
  assertIdent(newName);
  await client.query(
    `ALTER TABLE ${qualify(schema, table)} RENAME COLUMN ${q(name)} TO ${q(newName)}`,
  );
}

async function listRows(
  client: PoolClient,
  schema: string,
  table: string,
  options: { limit: number; offset: number },
): Promise<TableRowsPage> {
  const started = Date.now();
  const columns = await describeTable(client, schema, table);
  const limit = Math.min(Math.max(1, Math.floor(options.limit)), 200);
  const offset = Math.max(0, Math.floor(options.offset));
  const target = qualify(schema, table);

  const [countResult, dataResult] = await Promise.all([
    client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${target}`),
    client.query<Record<string, unknown>>(
      `SELECT * FROM ${target} ORDER BY 1 LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
  ]);

  return {
    columns,
    rows: dataResult.rows.map(serializeRow),
    totalRows: Number(countResult.rows[0]?.count ?? 0),
    durationMs: Date.now() - started,
  };
}

async function insertRow(
  client: PoolClient,
  schema: string,
  table: string,
  values: Record<string, unknown>,
): Promise<void> {
  const columns = await describeTable(client, schema, table);
  const known = new Set(columns.map((column) => column.name));
  const entries = Object.entries(values).filter(([name, value]) => {
    if (!known.has(name)) return false;
    const meta = columns.find((column) => column.name === name);
    if (meta?.isIdentity && (value === null || value === undefined || value === '')) return false;
    return true;
  });

  if (entries.length === 0) {
    const identityOnly = columns.every((column) => column.isIdentity);
    if (!identityOnly) throw new Error('No values to insert');
    await client.query(`INSERT INTO ${qualify(schema, table)} DEFAULT VALUES`);
    return;
  }

  const names = entries.map(([name]) => {
    assertIdent(name);
    return q(name);
  });
  const placeholders = entries.map((_, index) => `$${index + 1}`);
  await client.query(
    `INSERT INTO ${qualify(schema, table)} (${names.join(', ')}) VALUES (${placeholders.join(', ')})`,
    entries.map(([, value]) => normalizeValue(value)),
  );
}

async function updateRow(
  client: PoolClient,
  schema: string,
  table: string,
  key: Record<string, unknown>,
  values: Record<string, unknown>,
): Promise<void> {
  const columns = await describeTable(client, schema, table);
  const primary = columns.filter((column) => column.isPrimaryKey);
  if (primary.length === 0) {
    throw new Error('This table has no primary key, so rows cannot be updated from here');
  }

  const assignments: string[] = [];
  const params: unknown[] = [];
  for (const [name, value] of Object.entries(values)) {
    if (!columns.some((column) => column.name === name)) continue;
    if (primary.some((column) => column.name === name)) continue;
    assertIdent(name);
    params.push(normalizeValue(value));
    assignments.push(`${q(name)} = $${params.length}`);
  }
  if (assignments.length === 0) return;

  const where = primaryKeyWhere(primary, key, params);
  const result = await client.query(
    `UPDATE ${qualify(schema, table)} SET ${assignments.join(', ')} WHERE ${where}`,
    params,
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new Error('No row matched that primary key');
  }
}

async function deleteRows(
  client: PoolClient,
  schema: string,
  table: string,
  keys: Record<string, unknown>[],
): Promise<void> {
  if (keys.length === 0) return;
  const columns = await describeTable(client, schema, table);
  const primary = columns.filter((column) => column.isPrimaryKey);
  if (primary.length === 0) {
    throw new Error('This table has no primary key, so rows cannot be deleted from here');
  }

  for (const key of keys) {
    const params: unknown[] = [];
    const where = primaryKeyWhere(primary, key, params);
    await client.query(`DELETE FROM ${qualify(schema, table)} WHERE ${where}`, params);
  }
}

export async function describeTable(
  client: PoolClient,
  schema: string,
  table: string,
): Promise<ColumnMetadata[]> {
  assertSchemaName(schema);
  assertIdent(table);
  const result = await client.query<{
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
    is_identity: string;
    is_primary_key: boolean;
  }>(
    `SELECT c.column_name,
            CASE
              WHEN c.character_maximum_length IS NOT NULL
                   AND c.data_type IN ('character varying', 'character')
                THEN c.data_type || '(' || c.character_maximum_length || ')'
              WHEN c.data_type IN ('numeric', 'decimal') AND c.numeric_precision IS NOT NULL
                THEN c.data_type || '(' || c.numeric_precision
                     || COALESCE(', ' || c.numeric_scale, '') || ')'
              ELSE c.data_type
            END AS data_type,
            c.is_nullable,
            c.column_default,
            c.is_identity,
            EXISTS (
              SELECT 1
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON kcu.constraint_name = tc.constraint_name
                 AND kcu.table_schema = tc.table_schema
               WHERE tc.constraint_type = 'PRIMARY KEY'
                 AND tc.table_schema = c.table_schema
                 AND tc.table_name = c.table_name
                 AND kcu.column_name = c.column_name
            ) AS is_primary_key
       FROM information_schema.columns c
      WHERE c.table_schema = $1 AND c.table_name = $2
      ORDER BY c.ordinal_position`,
    [schema, table],
  );

  if (result.rows.length === 0) {
    throw new Error(`Table ${schema}.${table} was not found`);
  }

  return result.rows.map((row) => ({
    name: row.column_name,
    dataType: row.data_type,
    nullable: row.is_nullable === 'YES',
    isPrimaryKey: row.is_primary_key,
    isIdentity: row.is_identity === 'YES' || isSerialDefault(row.column_default),
    hasDefault: row.column_default !== null,
    defaultValue: row.column_default,
  }));
}

function columnSql(column: ColumnSpec): string {
  assertIdent(column.name);
  const type = column.identity
    ? `${identityType(column.dataType)} GENERATED BY DEFAULT AS IDENTITY`
    : parseDataType(column.dataType);
  const parts = [q(column.name), type];
  if (column.nullable === false || column.identity || column.primaryKey) {
    parts.push('NOT NULL');
  }
  const defaults = defaultSql(column);
  if (defaults) parts.push(defaults);
  if (column.unique) parts.push('UNIQUE');
  return parts.join(' ');
}

function defaultSql(column: Pick<ColumnSpec, 'defaultKind' | 'defaultValue'>): string {
  switch (column.defaultKind) {
    case 'null':
      return 'DEFAULT NULL';
    case 'now':
      return 'DEFAULT now()';
    case 'uuid':
      return 'DEFAULT gen_random_uuid()';
    case 'literal':
      if (column.defaultValue === undefined || column.defaultValue === '') return '';
      return `DEFAULT ${sqlLiteral(column.defaultValue)}`;
    default:
      return '';
  }
}

function identityType(raw: string): string {
  const type = parseDataType(raw || 'integer');
  if (type === 'smallint' || type === 'integer' || type === 'bigint') return type;
  return 'integer';
}

function parseDataType(raw: string): string {
  const type = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!type) throw new Error('Column type is required');
  const compact = type.replace(/\s*,\s*/g, ',').replace(/\s*\(\s*/g, '(').replace(/\s*\)\s*/g, ')');
  if (BASE_TYPES.has(type) || BASE_TYPES.has(compact)) return type;
  if (SIZED_TYPE.test(compact)) return compact;
  throw new Error(`Unsupported column type: ${raw}`);
}

function sqlLiteral(value: string): string {
  const trimmed = value.trim();
  if (trimmed === 'true' || trimmed === 'false') return trimmed;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  return `'${trimmed.replace(/'/g, "''")}'`;
}

function primaryKeyWhere(
  primary: ColumnMetadata[],
  key: Record<string, unknown>,
  params: unknown[],
): string {
  return primary
    .map((column) => {
      if (!(column.name in key)) {
        throw new Error(`Primary key column "${column.name}" is required`);
      }
      params.push(normalizeValue(key[column.name]));
      return `${q(column.name)} = $${params.length}`;
    })
    .join(' AND ');
}

function normalizeValue(value: unknown): unknown {
  if (value === '') return null;
  return value;
}

function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) next[key] = value.toISOString();
    else if (typeof value === 'bigint') next[key] = value.toString();
    else if (Buffer.isBuffer(value)) next[key] = value.toString('base64');
    else next[key] = value;
  }
  return next;
}

function isSerialDefault(value: string | null): boolean {
  return typeof value === 'string' && value.startsWith('nextval(');
}

function qualify(schema: string, table: string): string {
  assertSchemaName(schema);
  assertIdent(table);
  return `${q(schema)}.${q(table)}`;
}

function assertSchemaName(name: string, options?: { allowPublic?: boolean }): void {
  assertIdent(name);
  const lower = name.toLowerCase();
  if (lower.startsWith('pg_') || lower === 'information_schema') {
    throw new Error('System schemas cannot be modified');
  }
  if (options?.allowPublic === false && lower === 'public') {
    throw new Error('The public schema cannot be created or dropped from here');
  }
}

function assertIdent(name: string): void {
  if (!IDENT.test(name)) {
    throw new Error(
      `Invalid name "${name}". Use letters, numbers and underscore, starting with a letter or underscore.`,
    );
  }
}

function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function describeAdminError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/permission denied for schema/i.test(message)) {
    return `${message}. The connected database user needs CREATE on that schema (PostgreSQL 15+ no longer grants it on public by default).`;
  }
  if (/permission denied for database/i.test(message)) {
    return `${message}. The connected database user needs permission to create schemas in this database.`;
  }
  if (/must be owner/i.test(message)) {
    return `${message}. Only the owner of the table can change its structure.`;
  }
  return message;
}
