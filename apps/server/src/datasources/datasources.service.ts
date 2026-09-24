import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { DbSchema, TestResult } from '@vinodapp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { PluginRegistry } from '../plugins/plugin.registry';
import { AuditService } from '../audit/audit.service';

/** Sent back to the client in place of a stored secret. */
export const SECRET_PLACEHOLDER = '__vinodapp_unchanged__';

export interface UpsertDatasourceInput {
  name: string;
  pluginId: string;
  workspaceId?: string;
  readOnly?: boolean;
  environmentId: string;
  config: Record<string, unknown>;
}

@Injectable()
export class DatasourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly registry: PluginRegistry,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, workspaceId?: string) {
    const datasources = await this.prisma.datasource.findMany({
      where: {
        organizationId,
        ...(workspaceId ? { OR: [{ workspaceId }, { workspaceId: null }] } : {}),
      },
      include: { configs: { select: { environmentId: true, publicConfig: true } } },
      orderBy: { name: 'asc' },
    });

    const usage = await this.countQueryUsage(organizationId);

    // Only the non-secret half of a config ever leaves the server.
    return datasources.map((datasource) => ({
      id: datasource.id,
      name: datasource.name,
      pluginId: datasource.pluginId,
      workspaceId: datasource.workspaceId,
      readOnly: datasource.readOnly,
      environments: datasource.configs.map((config) => ({
        environmentId: config.environmentId,
        config: config.publicConfig,
      })),
      schemaCachedAt: datasource.schemaCachedAt,
      usage: usage.get(datasource.id) ?? { queryCount: 0, applications: [] },
    }));
  }

  /**
   * How many queries reference each datasource, and in which applications.
   *
   * This is what makes "can I safely change or delete this connection?" answerable
   * without a search. Queries live inside the application DSL rather than in their
   * own table, so counting means reading the drafts — acceptable at this scale, and
   * the obvious thing to move to a denormalised index if an org grows large enough
   * for it to show up in the Data section's load time.
   */
  private async countQueryUsage(
    organizationId: string,
  ): Promise<Map<string, { queryCount: number; applications: { id: string; name: string; queryCount: number }[] }>> {
    const applications = await this.prisma.application.findMany({
      where: { workspace: { organizationId } },
      select: { id: true, name: true, draftDsl: true },
    });

    const usage = new Map<
      string,
      { queryCount: number; applications: { id: string; name: string; queryCount: number }[] }
    >();

    for (const application of applications) {
      const dsl = application.draftDsl as { queries?: { datasourceId?: string }[] } | null;
      const counts = new Map<string, number>();

      for (const query of dsl?.queries ?? []) {
        if (!query.datasourceId) continue;
        counts.set(query.datasourceId, (counts.get(query.datasourceId) ?? 0) + 1);
      }

      for (const [datasourceId, count] of counts) {
        const entry = usage.get(datasourceId) ?? { queryCount: 0, applications: [] };
        entry.queryCount += count;
        entry.applications.push({ id: application.id, name: application.name, queryCount: count });
        usage.set(datasourceId, entry);
      }
    }

    return usage;
  }

  async create(organizationId: string, userId: string, input: UpsertDatasourceInput) {
    const plugin = this.registry.get(input.pluginId);
    const parsed = plugin.configSchema.safeParse(input.config);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid datasource configuration',
        errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const { publicConfig, secretConfig } = splitSecrets(
      parsed.data as Record<string, unknown>,
      plugin.secretFields,
    );
    const encrypted = this.crypto.encryptJson(secretConfig);

    const datasource = await this.prisma.datasource.create({
      data: {
        organizationId,
        workspaceId: input.workspaceId ?? null,
        name: input.name,
        pluginId: input.pluginId,
        readOnly: input.readOnly ?? false,
        createdById: userId,
        configs: {
          create: {
            environmentId: input.environmentId,
            publicConfig: publicConfig as object,
            encryptedConfig: encrypted.ciphertext,
            iv: encrypted.iv,
            authTag: encrypted.authTag,
          },
        },
      },
    });

    await this.audit.record({
      organizationId,
      actorId: userId,
      action: 'datasource.create',
      resourceType: 'datasource',
      resourceId: datasource.id,
      metadata: { name: input.name, pluginId: input.pluginId },
    });

    return { id: datasource.id, name: datasource.name, pluginId: datasource.pluginId };
  }

  async updateConfig(
    organizationId: string,
    userId: string,
    datasourceId: string,
    environmentId: string,
    config: Record<string, unknown>,
  ) {
    const datasource = await this.requireDatasource(organizationId, datasourceId);
    const plugin = this.registry.get(datasource.pluginId);

    // Fields the client left as the placeholder keep their stored value, so editing
    // a host does not require the user to retype the password.
    const existing = datasource.configs.find((c) => c.environmentId === environmentId);
    const merged = { ...config };
    if (existing) {
      const storedSecrets = this.crypto.decryptJson<Record<string, unknown>>({
        ciphertext: existing.encryptedConfig,
        iv: existing.iv,
        authTag: existing.authTag,
      });
      for (const field of plugin.secretFields) {
        if (getPath(merged, field) === SECRET_PLACEHOLDER) {
          setPath(merged, field, getPath(storedSecrets, field));
        }
      }
    }

    const parsed = plugin.configSchema.safeParse(merged);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid datasource configuration',
        errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const { publicConfig, secretConfig } = splitSecrets(
      parsed.data as Record<string, unknown>,
      plugin.secretFields,
    );
    const encrypted = this.crypto.encryptJson(secretConfig);

    await this.prisma.datasourceConfig.upsert({
      where: { datasourceId_environmentId: { datasourceId, environmentId } },
      create: {
        datasourceId,
        environmentId,
        publicConfig: publicConfig as object,
        encryptedConfig: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      },
      update: {
        publicConfig: publicConfig as object,
        encryptedConfig: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      },
    });

    // Pooled connections hold the old credentials; drop them.
    await plugin.dispose?.(datasourceId);

    await this.audit.record({
      organizationId,
      actorId: userId,
      action: 'datasource.update',
      resourceType: 'datasource',
      resourceId: datasourceId,
      metadata: { environmentId },
    });

    return { ok: true };
  }

  /** Decrypts and merges a datasource's config. Server-side callers only. */
  async resolveConfig(
    organizationId: string,
    datasourceId: string,
    environmentId: string,
  ): Promise<{ pluginId: string; config: Record<string, unknown>; readOnly: boolean }> {
    const datasource = await this.requireDatasource(organizationId, datasourceId);
    const stored = datasource.configs.find((c) => c.environmentId === environmentId);
    if (!stored) {
      throw new NotFoundException(
        `Datasource "${datasource.name}" has no configuration for this environment`,
      );
    }

    const secrets = this.crypto.decryptJson<Record<string, unknown>>({
      ciphertext: stored.encryptedConfig,
      iv: stored.iv,
      authTag: stored.authTag,
    });

    return {
      pluginId: datasource.pluginId,
      readOnly: datasource.readOnly,
      config: deepMerge(stored.publicConfig as Record<string, unknown>, secrets),
    };
  }

  async test(
    organizationId: string,
    datasourceId: string,
    environmentId: string,
  ): Promise<TestResult> {
    const resolved = await this.resolveConfig(organizationId, datasourceId, environmentId);
    const plugin = this.registry.get(resolved.pluginId);
    return plugin.test(resolved.config as never);
  }

  async introspect(
    organizationId: string,
    datasourceId: string,
    environmentId: string,
    refresh = false,
  ): Promise<DbSchema> {
    const datasource = await this.requireDatasource(organizationId, datasourceId);

    const cacheAge = datasource.schemaCachedAt
      ? Date.now() - datasource.schemaCachedAt.getTime()
      : Infinity;
    if (!refresh && datasource.schemaCache && cacheAge < 15 * 60 * 1000) {
      return datasource.schemaCache as unknown as DbSchema;
    }

    const resolved = await this.resolveConfig(organizationId, datasourceId, environmentId);
    const plugin = this.registry.get(resolved.pluginId);
    if (!plugin.introspect) {
      throw new BadRequestException(`${plugin.name} does not support schema introspection`);
    }

    const schema = await plugin.introspect(resolved.config as never);
    await this.prisma.datasource.update({
      where: { id: datasourceId },
      data: { schemaCache: schema as unknown as object, schemaCachedAt: new Date() },
    });
    return schema;
  }

  async remove(organizationId: string, userId: string, datasourceId: string) {
    const datasource = await this.requireDatasource(organizationId, datasourceId);
    await this.registry.get(datasource.pluginId).dispose?.(datasourceId);
    await this.prisma.datasource.delete({ where: { id: datasourceId } });
    await this.audit.record({
      organizationId,
      actorId: userId,
      action: 'datasource.delete',
      resourceType: 'datasource',
      resourceId: datasourceId,
      metadata: { name: datasource.name },
    });
    return { ok: true };
  }

  private async requireDatasource(organizationId: string, datasourceId: string) {
    const datasource = await this.prisma.datasource.findFirst({
      where: { id: datasourceId, organizationId },
      include: { configs: true },
    });
    if (!datasource) throw new NotFoundException('Datasource not found');
    return datasource;
  }
}

/* ------------------------------------------------------------------ *
 * Config helpers — secret fields use dot paths, e.g. 'auth.clientSecret'
 * ------------------------------------------------------------------ */

function splitSecrets(
  config: Record<string, unknown>,
  secretFields: string[],
): { publicConfig: Record<string, unknown>; secretConfig: Record<string, unknown> } {
  const publicConfig = structuredClone(config);
  const secretConfig: Record<string, unknown> = {};

  for (const field of secretFields) {
    const value = getPath(publicConfig, field);
    if (value === undefined) continue;
    setPath(secretConfig, field, value);
    deletePath(publicConfig, field);
  }
  return { publicConfig, secretConfig };
}

function getPath(object: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, object);
}

function setPath(object: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let cursor = object;
  for (const key of keys.slice(0, -1)) {
    if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]!] = value;
}

function deletePath(object: Record<string, unknown>, path: string): void {
  const keys = path.split('.');
  let cursor = object;
  for (const key of keys.slice(0, -1)) {
    if (typeof cursor[key] !== 'object' || cursor[key] === null) return;
    cursor = cursor[key] as Record<string, unknown>;
  }
  delete cursor[keys[keys.length - 1]!];
}

function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const existing = result[key];
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      existing !== null &&
      typeof existing === 'object' &&
      !Array.isArray(existing)
    ) {
      result[key] = deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}
