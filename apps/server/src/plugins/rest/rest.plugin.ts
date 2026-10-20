import { Injectable, Logger } from '@nestjs/common';
import { request } from 'undici';
import { z } from 'zod';
import type {
  ConfigFieldDefinition,
  ConfigSchema,
  ApiDefinition,
  DatasourcePlugin,
  EvaluatedBindings,
  ExecutionContext,
  PreparedQuery,
  QueryResult,
  TestResult,
} from '@swiftly/shared';
import { assertUrlAllowed, type SsrfPolicy } from './ssrf-guard';

const authSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('basic'), username: z.string(), password: z.string() }),
  z.object({ type: z.literal('bearer'), token: z.string() }),
  z.object({
    type: z.literal('api_key'),
    key: z.string(),
    value: z.string(),
    in: z.enum(['header', 'query']),
  }),
  z.object({
    type: z.literal('oauth2_client_credentials'),
    tokenUrl: z.string().url(),
    clientId: z.string(),
    clientSecret: z.string(),
    scope: z.string().optional(),
  }),
]);

const configSchema = z.object({
  baseUrl: z.string().url(),
  auth: authSchema.default({ type: 'none' }),
  defaultHeaders: z.record(z.string()).default({}),
  /** Administrator-granted exceptions to the private-network block. */
  allowedPrivateHosts: z.array(z.string()).default([]),
  timeoutMs: z.coerce.number().int().positive().default(30_000),
});

type RestConfig = z.infer<typeof configSchema>;

/** A string split into literal chunks and the expressions between them. */
interface Template {
  parts: string[];
  /** Index into the global expression list for each gap between parts. */
  slots: number[];
}

interface RestPayload {
  method: string;
  path: Template;
  queryParams: { key: Template; value: Template }[];
  headers: { key: string; value: Template }[];
  body: { kind: 'none' } | { kind: 'text'; template: Template; contentType: string };
  protocol: 'rest' | 'graphql' | 'soap';
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

@Injectable()
export class RestPlugin implements DatasourcePlugin<RestConfig, ApiDefinition> {
  readonly id = 'rest';
  readonly name = 'REST API';
  readonly category = 'api' as const;
  readonly configSchema = configSchema;
  readonly secretFields = ['auth.password', 'auth.token', 'auth.value', 'auth.clientSecret'];
  readonly configFields: ConfigFieldDefinition[] = [
    { key: 'baseUrl', label: 'Base URL', control: 'text', required: true, placeholder: 'https://api.acme.com/v1', section: 'Connection' },
    {
      key: 'auth.type', label: 'Authentication', control: 'select', defaultValue: 'none', section: 'Authentication',
      options: [
        { label: 'None', value: 'none' },
        { label: 'Basic', value: 'basic' },
        { label: 'Bearer token', value: 'bearer' },
        { label: 'API key', value: 'api_key' },
        { label: 'OAuth 2.0 client credentials', value: 'oauth2_client_credentials' },
      ],
    },
    { key: 'auth.username', label: 'Username', control: 'text', section: 'Authentication', visibleWhen: { key: 'auth.type', equals: 'basic' } },
    { key: 'auth.password', label: 'Password', control: 'password', secret: true, section: 'Authentication', visibleWhen: { key: 'auth.type', equals: 'basic' } },
    { key: 'auth.token', label: 'Token', control: 'password', secret: true, section: 'Authentication', visibleWhen: { key: 'auth.type', equals: 'bearer' } },
    { key: 'auth.key', label: 'Key name', control: 'text', section: 'Authentication', visibleWhen: { key: 'auth.type', equals: 'api_key' } },
    { key: 'auth.value', label: 'Key value', control: 'password', secret: true, section: 'Authentication', visibleWhen: { key: 'auth.type', equals: 'api_key' } },
    {
      key: 'auth.in', label: 'Send key in', control: 'select', defaultValue: 'header', section: 'Authentication',
      options: [{ label: 'Header', value: 'header' }, { label: 'Query string', value: 'query' }],
      visibleWhen: { key: 'auth.type', equals: 'api_key' },
    },
    { key: 'auth.tokenUrl', label: 'Token URL', control: 'text', section: 'Authentication', visibleWhen: { key: 'auth.type', equals: 'oauth2_client_credentials' } },
    { key: 'auth.clientId', label: 'Client ID', control: 'text', section: 'Authentication', visibleWhen: { key: 'auth.type', equals: 'oauth2_client_credentials' } },
    { key: 'auth.clientSecret', label: 'Client secret', control: 'password', secret: true, section: 'Authentication', visibleWhen: { key: 'auth.type', equals: 'oauth2_client_credentials' } },
    { key: 'auth.scope', label: 'Scope', control: 'text', section: 'Authentication', visibleWhen: { key: 'auth.type', equals: 'oauth2_client_credentials' } },
    {
      key: 'allowedPrivateHosts', label: 'Allowed private hosts', control: 'textarea', section: 'Security',
      helpText: 'One host per line. Required to reach an internal API, because private addresses are blocked by default.',
    },
    { key: 'timeoutMs', label: 'Timeout (ms)', control: 'number', defaultValue: 30000, section: 'Advanced' },
  ];

  readonly querySchema = z.any() as unknown as ConfigSchema<ApiDefinition>;

  readonly capabilities = {
    rawSql: false,
    storedProcedures: false,
    functions: false,
    visualBuilder: false,
    transactions: false,
    multiStatement: false,
    introspection: false,
    readOnlyConnections: false,
    pagination: true,
    schemaAdmin: false,
  };

  private readonly logger = new Logger(RestPlugin.name);
  private readonly tokenCache = new Map<string, CachedToken>();

  async test(config: RestConfig): Promise<TestResult> {
    const started = Date.now();
    try {
      const url = await assertUrlAllowed(config.baseUrl, this.policy(config));
      const response = await request(url.toString(), {
        method: 'GET',
        headers: config.defaultHeaders,
        headersTimeout: 8000,
      });
      await response.body.dump();
      return {
        ok: response.statusCode < 500,
        message: `Reached ${url.host} (HTTP ${response.statusCode})`,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - started,
      };
    }
  }

  prepare(query: ApiDefinition): PreparedQuery {
    const expressions: string[] = [];
    const take = (text: string) => parseTemplate(text, expressions);

    const payload: RestPayload = {
      method: query.method,
      protocol: query.protocol,
      path: take(query.path),
      queryParams: (query.queryParams ?? [])
        .filter((entry) => entry.enabled)
        .map((entry) => ({ key: take(entry.key), value: take(entry.value) })),
      headers: (query.headers ?? [])
        .filter((entry) => entry.enabled)
        .map((entry) => ({ key: entry.key, value: take(entry.value) })),
      body: this.prepareBody(query, take),
    };

    return {
      payload,
      expressions,
      identifierExpressions: [],
      // GET and HEAD read; everything else may change remote state and needs
      // the write permission, same rule as a SQL statement.
      statementType: query.method === 'GET' || query.method === 'HEAD' ? 'read' : 'write',
      outputParameters: [],
    };
  }

  async execute(
    config: RestConfig,
    prepared: PreparedQuery,
    bindings: EvaluatedBindings,
    ctx: ExecutionContext,
  ): Promise<QueryResult> {
    const payload = prepared.payload as RestPayload;
    const started = Date.now();
    const render = (template: Template) => renderTemplate(template, bindings.values);

    const url = new URL(render(payload.path), ensureTrailingSlash(config.baseUrl));
    for (const param of payload.queryParams) {
      url.searchParams.append(render(param.key), render(param.value));
    }

    const headers: Record<string, string> = { ...config.defaultHeaders };
    for (const header of payload.headers) {
      headers[header.key] = render(header.value);
    }
    await this.applyAuth(config, url, headers);

    let body: string | undefined;
    if (payload.body.kind === 'text') {
      body = render(payload.body.template);
      headers['content-type'] = payload.body.contentType;
    }

    // Checked after the URL is fully rendered — a binding could have changed the host.
    const checked = await assertUrlAllowed(url.toString(), this.policy(config));

    const response = await request(checked.toString(), {
      method: payload.method as 'GET',
      headers,
      body,
      signal: ctx.signal,
      headersTimeout: Math.min(config.timeoutMs, ctx.timeoutMs),
      bodyTimeout: Math.min(config.timeoutMs, ctx.timeoutMs),
      // undici does not follow redirects unless asked, which is what we want: a
      // 302 to a private address would bypass the SSRF check performed above.
    });

    const contentType = String(response.headers['content-type'] ?? '');
    const text = await response.body.text();
    const parsed = contentType.includes('json') ? safeJsonParse(text) : text;

    return {
      rows: toRows(parsed, ctx.maxRows),
      truncated: Array.isArray(parsed) && parsed.length > ctx.maxRows,
      durationMs: Date.now() - started,
      messages:
        response.statusCode >= 400
          ? [`Upstream responded with HTTP ${response.statusCode}`]
          : undefined,
    };
  }

  private prepareBody(
    query: ApiDefinition,
    take: (text: string) => Template,
  ): RestPayload['body'] {
    const body = query.body;
    if (!body || body.type === 'none') return { kind: 'none' };

    switch (body.type) {
      case 'json':
        return { kind: 'text', template: take(body.content), contentType: 'application/json' };
      case 'raw':
        return { kind: 'text', template: take(body.content), contentType: body.contentType };
      case 'graphql':
        return {
          kind: 'text',
          template: take(
            JSON.stringify({ query: '__DOC__', variables: '__VARS__' })
              .replace('"__DOC__"', JSON.stringify(body.document))
              .replace('"__VARS__"', body.variables || '{}'),
          ),
          contentType: 'application/json',
        };
      case 'form_urlencoded': {
        const encoded = body.entries
          .filter((entry) => entry.enabled)
          .map((entry) => `${encodeURIComponent(entry.key)}=${entry.value}`)
          .join('&');
        return {
          kind: 'text',
          template: take(encoded),
          contentType: 'application/x-www-form-urlencoded',
        };
      }
      default:
        return { kind: 'none' };
    }
  }

  private async applyAuth(
    config: RestConfig,
    url: URL,
    headers: Record<string, string>,
  ): Promise<void> {
    const auth = config.auth;
    switch (auth.type) {
      case 'basic':
        headers.authorization = `Basic ${Buffer.from(
          `${auth.username}:${auth.password}`,
        ).toString('base64')}`;
        break;
      case 'bearer':
        headers.authorization = `Bearer ${auth.token}`;
        break;
      case 'api_key':
        if (auth.in === 'header') headers[auth.key] = auth.value;
        else url.searchParams.set(auth.key, auth.value);
        break;
      case 'oauth2_client_credentials':
        headers.authorization = `Bearer ${await this.clientCredentialsToken(auth)}`;
        break;
      case 'none':
        break;
    }
  }

  private async clientCredentialsToken(auth: {
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    scope?: string;
  }): Promise<string> {
    const cacheKey = `${auth.tokenUrl}|${auth.clientId}|${auth.scope ?? ''}`;
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

    const form = new URLSearchParams({ grant_type: 'client_credentials' });
    if (auth.scope) form.set('scope', auth.scope);

    const response = await request(auth.tokenUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(
          `${auth.clientId}:${auth.clientSecret}`,
        ).toString('base64')}`,
      },
      body: form.toString(),
    });

    const payload = (await response.body.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!payload.access_token) {
      throw new Error('Token endpoint did not return an access_token');
    }

    this.tokenCache.set(cacheKey, {
      token: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    });
    return payload.access_token;
  }

  private policy(config: RestConfig): SsrfPolicy {
    return { allowedPrivateHosts: config.allowedPrivateHosts };
  }
}

/* ------------------------------------------------------------------ *
 * Template helpers
 * ------------------------------------------------------------------ */

function parseTemplate(text: string, expressions: string[]): Template {
  const parts: string[] = [];
  const slots: number[] = [];
  let cursor = 0;

  const pattern = /\{\{([\s\S]*?)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    parts.push(text.slice(cursor, match.index));
    slots.push(expressions.length);
    expressions.push(match[1]!.trim());
    cursor = match.index + match[0].length;
  }
  parts.push(text.slice(cursor));
  return { parts, slots };
}

function renderTemplate(template: Template, values: unknown[]): string {
  let out = template.parts[0] ?? '';
  template.slots.forEach((slot, index) => {
    out += stringify(values[slot]);
    out += template.parts[index + 1] ?? '';
  });
  return out;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Normalises any JSON shape into rows so table widgets can bind to it directly. */
function toRows(payload: unknown, maxRows: number): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.slice(0, maxRows).map((item) =>
      item !== null && typeof item === 'object'
        ? (item as Record<string, unknown>)
        : { value: item },
    );
  }
  if (payload !== null && typeof payload === 'object') {
    return [payload as Record<string, unknown>];
  }
  return [{ value: payload }];
}
