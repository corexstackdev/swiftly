import type {
  BuilderDefinition,
  BuilderFilter,
  FunctionDefinition,
  QueryDefinition,
  RawSqlDefinition,
  StoredProcedureDefinition,
} from '@swiftly/shared';
import {
  classifyStatement,
  extractBindings,
  DIALECTS,
  SqlBindingError,
  type IdentifierBinding,
  type StatementType,
} from '../sql-binding';

/**
 * Turns any SQL-flavoured query definition into a parameterised statement.
 *
 * All four authoring modes converge here, so raw SQL, a stored procedure call, a
 * function call and the visual builder all go through the same parameter binding
 * path. There is no mode in which a user value is concatenated into SQL.
 */

export type SqlDialect = keyof typeof DIALECTS;

/**
 * Where one bound parameter's value comes from.
 *
 * A builder query mixes the two freely: `WHERE total > {{ Min.value }} LIMIT 50` has
 * one of each. Both become driver-level parameters, but only the expression needs
 * the client to evaluate it — treating a literal as a binding would make the server
 * ask the browser for the value of `50`.
 */
export type ParameterSource =
  | { kind: 'literal'; value: unknown }
  | { kind: 'expression'; text: string };

export interface CompiledStatement {
  sql: string;
  /** Every parameter in placeholder order, literals included. */
  parameters: ParameterSource[];
  /** Just the expressions, in order — what the caller is asked to evaluate. */
  expressions: string[];
  identifierBindings: IdentifierBinding[];
  statementType: StatementType;
  /** Parameter names for procedures, so OUT values can be read back by name. */
  outputParameters: { name: string; typeHint?: string }[];
}

/**
 * Rebuilds the full positional parameter list, interleaving the literals the
 * compiler already knows with the values the caller evaluated.
 */
export function resolveParameters(
  compiled: CompiledStatement,
  evaluated: unknown[],
): unknown[] {
  let cursor = 0;
  return compiled.parameters.map((parameter) =>
    parameter.kind === 'literal' ? parameter.value : evaluated[cursor++],
  );
}

function expressionsOf(parameters: ParameterSource[]): string[] {
  return parameters
    .filter((parameter): parameter is { kind: 'expression'; text: string } =>
      parameter.kind === 'expression',
    )
    .map((parameter) => parameter.text);
}

export function compile(definition: QueryDefinition, dialect: SqlDialect): CompiledStatement {
  switch (definition.kind) {
    case 'raw_sql':
      return compileRawSql(definition, dialect);
    case 'stored_procedure':
      return compileProcedure(definition, dialect);
    case 'function':
      return compileFunction(definition, dialect);
    case 'builder':
      return compileBuilder(definition, dialect);
    default:
      throw new SqlBindingError(
        `Query mode "${(definition as { kind: string }).kind}" is not a SQL mode`,
      );
  }
}

function compileRawSql(definition: RawSqlDefinition, dialect: SqlDialect): CompiledStatement {
  const extracted = extractBindings(
    definition.sql,
    dialect,
    definition.identifierAllowlist ?? [],
  );
  // Everything a raw statement parameterises came out of a `{{ }}`, so every
  // parameter there is an expression.
  const parameters: ParameterSource[] = extracted.expressions.map((text) => ({
    kind: 'expression',
    text,
  }));

  return {
    sql: extracted.sql,
    parameters,
    expressions: extracted.expressions,
    identifierBindings: extracted.identifierBindings,
    statementType: classifyStatement(definition.sql),
    outputParameters: [],
  };
}

function compileProcedure(
  definition: StoredProcedureDefinition,
  dialect: SqlDialect,
): CompiledStatement {
  const target = qualify(definition.schema, definition.procedureName, dialect);
  const parameters: ParameterSource[] = [];
  const outputParameters: { name: string; typeHint?: string }[] = [];
  const placeholders: string[] = [];

  for (const argument of definition.arguments) {
    if (argument.direction === 'out') {
      // Pure OUT parameters are declared, not bound; the driver allocates them.
      outputParameters.push({ name: argument.name, typeHint: argument.typeHint });
      placeholders.push(dialectOutMarker(argument.name, dialect));
      continue;
    }
    if (argument.direction === 'inout') {
      outputParameters.push({ name: argument.name, typeHint: argument.typeHint });
    }
    placeholders.push(DIALECTS[dialect]!.placeholder(parameters.length));
    parameters.push(toParameterSource(argument.value ?? ''));
  }

  const args = placeholders.join(', ');
  const sql =
    dialect === 'mssql'
      ? `EXEC ${target} ${args}`
      : dialect === 'oracle'
        ? `BEGIN ${target}(${args}); END;`
        : `CALL ${target}(${args})`;

  return {
    sql,
    parameters,
    expressions: expressionsOf(parameters),
    identifierBindings: [],
    statementType: 'call',
    outputParameters,
  };
}

function compileFunction(
  definition: FunctionDefinition,
  dialect: SqlDialect,
): CompiledStatement {
  const target = qualify(definition.schema, definition.functionName, dialect);
  const parameters: ParameterSource[] = [];
  const placeholders: string[] = [];

  for (const argument of definition.arguments) {
    placeholders.push(DIALECTS[dialect]!.placeholder(parameters.length));
    parameters.push(toParameterSource(argument.value ?? ''));
  }

  const call = `${target}(${placeholders.join(', ')})`;
  const sql = definition.tableValued
    ? `SELECT * FROM ${call}`
    : dialect === 'oracle'
      ? `SELECT ${call} AS result FROM dual`
      : `SELECT ${call} AS result`;

  return {
    sql,
    parameters,
    expressions: expressionsOf(parameters),
    identifierBindings: [],
    statementType: 'read',
    outputParameters: [],
  };
}

function compileBuilder(
  definition: BuilderDefinition,
  dialect: SqlDialect,
): CompiledStatement {
  const parameters: ParameterSource[] = [];
  const next = () => DIALECTS[dialect]!.placeholder(parameters.length);
  const table = qualify(definition.schema, definition.table, dialect);

  // Builder table and column names come from introspection, not free text, so they
  // are quoted rather than parameterised — but still validated as identifiers.
  assertIdentifier(definition.table);
  if (definition.schema) assertIdentifier(definition.schema);

  let sql: string;
  let statementType: StatementType;

  switch (definition.operation) {
    case 'select': {
      const columns =
        definition.columns && definition.columns.length > 0
          ? definition.columns.map((c) => quoteIdentifier(c, dialect)).join(', ')
          : '*';
      sql = `SELECT ${columns} FROM ${table}`;
      statementType = 'read';
      break;
    }
    case 'insert': {
      const entries = Object.entries(definition.values ?? {});
      if (entries.length === 0) throw new SqlBindingError('Insert requires at least one value');
      const columns = entries.map(([column]) => {
        assertIdentifier(column);
        return quoteIdentifier(column, dialect);
      });
      const values = entries.map(([, value]) => {
        const placeholder = next();
        parameters.push(toParameterSource(value));
        return placeholder;
      });
      sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')})`;
      statementType = 'write';
      break;
    }
    case 'update': {
      const entries = Object.entries(definition.values ?? {});
      if (entries.length === 0) throw new SqlBindingError('Update requires at least one value');
      const assignments = entries.map(([column, value]) => {
        assertIdentifier(column);
        const placeholder = next();
        parameters.push(toParameterSource(value));
        return `${quoteIdentifier(column, dialect)} = ${placeholder}`;
      });
      sql = `UPDATE ${table} SET ${assignments.join(', ')}`;
      statementType = 'write';
      break;
    }
    case 'delete': {
      sql = `DELETE FROM ${table}`;
      statementType = 'write';
      break;
    }
  }

  // A builder update or delete without filters would hit every row; that is almost
  // never what the user meant, so require an explicit filter.
  const filters = definition.filters ?? [];
  if (
    (definition.operation === 'update' || definition.operation === 'delete') &&
    filters.length === 0
  ) {
    throw new SqlBindingError(
      `A builder ${definition.operation} must have at least one filter — ` +
        'an unfiltered statement would affect every row in the table.',
    );
  }

  if (filters.length > 0) {
    const clauses = filters.map((filter, index) => {
      const prefix = index === 0 ? '' : `${(filter.conjunction ?? 'and').toUpperCase()} `;
      return prefix + renderFilter(filter, dialect, next, parameters);
    });
    sql += ` WHERE ${clauses.join(' ')}`;
  }

  if (definition.operation === 'select') {
    if (definition.sort && definition.sort.length > 0) {
      const order = definition.sort.map((s) => {
        assertIdentifier(s.column);
        return `${quoteIdentifier(s.column, dialect)} ${s.direction === 'desc' ? 'DESC' : 'ASC'}`;
      });
      sql += ` ORDER BY ${order.join(', ')}`;
    }
    if (definition.limit) {
      const placeholder = next();
      parameters.push(toParameterSource(definition.limit));
      sql += dialect === 'mssql' ? ` OFFSET 0 ROWS FETCH NEXT ${placeholder} ROWS ONLY` : ` LIMIT ${placeholder}`;
    }
    if (definition.offset && dialect !== 'mssql') {
      const placeholder = next();
      parameters.push(toParameterSource(definition.offset));
      sql += ` OFFSET ${placeholder}`;
    }
  }

  return {
    sql,
    parameters,
    expressions: expressionsOf(parameters),
    identifierBindings: [],
    statementType,
    outputParameters: [],
  };
}

function renderFilter(
  filter: BuilderFilter,
  dialect: SqlDialect,
  next: () => string,
  parameters: ParameterSource[],
): string {
  assertIdentifier(filter.column);
  const column = quoteIdentifier(filter.column, dialect);

  switch (filter.operator) {
    case 'is_null':
      return `${column} IS NULL`;
    case 'is_not_null':
      return `${column} IS NOT NULL`;
    case 'in':
    case 'not_in': {
      // The evaluated value is an array; the driver expands it. Postgres uses
      // `= ANY($n)`, which takes an array parameter directly.
      const placeholder = next();
      parameters.push(toParameterSource(filter.value ?? ''));
      const negate = filter.operator === 'not_in' ? 'NOT ' : '';
      return dialect === 'postgres'
        ? `${negate}(${column} = ANY(${placeholder}))`
        : `${column} ${negate}IN (${placeholder})`;
    }
    default: {
      const placeholder = next();
      parameters.push(toParameterSource(filter.value ?? ''));
      const operator = {
        eq: '=',
        neq: '<>',
        gt: '>',
        gte: '>=',
        lt: '<',
        lte: '<=',
        like: 'LIKE',
        ilike: dialect === 'postgres' ? 'ILIKE' : 'LIKE',
      }[filter.operator];
      return `${column} ${operator} ${placeholder}`;
    }
  }
}

/**
 * Classifies a builder field: `{{ ... }}` is an expression for the caller to
 * evaluate, anything else is a literal the server already has. Numeric-looking
 * literals are coerced, because `LIMIT $1` rejects a text parameter.
 */
function toParameterSource(value: string): ParameterSource {
  const trimmed = value.trim();
  const match = /^\{\{([\s\S]*)\}\}$/.exec(trimmed);
  if (match) return { kind: 'expression', text: match[1]!.trim() };

  if (trimmed !== '' && /^-?\d+(\.\d+)?$/.test(trimmed)) {
    return { kind: 'literal', value: Number(trimmed) };
  }
  return { kind: 'literal', value: trimmed };
}

function qualify(schema: string | undefined, name: string, dialect: SqlDialect): string {
  const quoted = quoteIdentifier(name, dialect);
  return schema ? `${quoteIdentifier(schema, dialect)}.${quoted}` : quoted;
}

function quoteIdentifier(name: string, dialect: SqlDialect): string {
  if (dialect === 'mysql') return `\`${name.replace(/`/g, '``')}\``;
  if (dialect === 'mssql') return `[${name.replace(/]/g, ']]')}]`;
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Identifiers reaching the builder come from introspection, but the request body is
 * still client-supplied, so they are checked before being quoted into SQL.
 */
function assertIdentifier(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_$]{0,126}$/.test(name)) {
    throw new SqlBindingError(`Invalid identifier: ${name}`);
  }
}

function dialectOutMarker(name: string, dialect: SqlDialect): string {
  if (dialect === 'mssql') return `@${name} OUTPUT`;
  if (dialect === 'oracle') return `:${name}`;
  return `NULL`;
}
