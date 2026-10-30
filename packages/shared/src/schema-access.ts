/** Structured when a datasource can see a schema but is not allowed to use it. */
export const SCHEMA_ACCESS_CODE = 'SCHEMA_ACCESS';

export interface SchemaAccessHint {
  code: typeof SCHEMA_ACCESS_CODE;
  schema: string;
  dbUser: string;
  owner?: string;
  sql: string;
  message: string;
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function postgresSchemaGrantSql(schema: string, dbUser: string): string {
  const s = quoteIdent(schema);
  const u = quoteIdent(dbUser);
  return [
    `-- Run as a database admin, or as the user who owns ${schema}`,
    `GRANT USAGE, CREATE ON SCHEMA ${s} TO ${u};`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${s} TO ${u};`,
    `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${s} TO ${u};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${u};`,
  ].join('\n');
}

export function mysqlSchemaGrantSql(database: string, dbUser: string): string {
  const db = database.replace(/`/g, '``');
  const user = dbUser.replace(/'/g, "''");
  return [
    `-- Run as a MySQL admin`,
    `GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX ON \`${db}\`.* TO '${user}'@'%';`,
    `FLUSH PRIVILEGES;`,
  ].join('\n');
}

export function schemaAccessPayload(input: {
  schema: string;
  dbUser: string;
  owner?: string;
  pluginId?: string;
}): SchemaAccessHint {
  const sql =
    input.pluginId === 'mysql'
      ? mysqlSchemaGrantSql(input.schema, input.dbUser)
      : postgresSchemaGrantSql(input.schema, input.dbUser);
  return {
    code: SCHEMA_ACCESS_CODE,
    schema: input.schema,
    dbUser: input.dbUser,
    owner: input.owner,
    sql,
    message: `This connection (${input.dbUser}) is not allowed to use schema “${input.schema}”.`,
  };
}

export function parsePermissionDeniedSchema(message: string): string | null {
  const match = message.match(/permission denied for schema\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/i);
  return match?.[1] ?? null;
}

export function isPermissionDenied(message: string): boolean {
  return /permission denied/i.test(message) || /access denied for user/i.test(message);
}
