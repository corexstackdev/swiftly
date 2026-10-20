import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  RequestTimeoutException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  queriesOnPage,
  type ApplicationDsl,
  type EvaluatedBindings,
  type ExecutionContext as PluginExecutionContext,
  type QueryEntity,
  type QueryResult,
} from '@swiftly/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PluginRegistry } from '../plugins/plugin.registry';
import { DatasourcesService } from '../datasources/datasources.service';
import { AuditService } from '../audit/audit.service';
import { RedisService } from '../redis/redis.service';
import { PERMISSIONS, type Permission } from '../common/permissions';

export interface ExecuteQueryInput {
  organizationId: string;
  /** Absent when a published app is running without a Swiftly session. */
  userId?: string;
  permissions: Permission[];
  applicationId: string;
  queryName: string;
  /** Current page, used when two pages each have a query of this name. */
  pageId?: string;
  /** Draft is the editor and preview; published is what end users run. */
  source: 'draft' | 'published';
  /**
   * Public hosted URLs (published and preview) run the stored DSL without a
   * Swiftly session, so `query:write` is not required.
   */
  publicRuntime?: boolean;
  environmentId: string;
  /**
   * Evaluated binding values, keyed by the expression text. The client evaluates
   * bindings because it holds the widget state; the server looks up only the
   * expressions its own `prepare` produced, so a client cannot introduce one.
   */
  bindings: Record<string, unknown>;
}

@Injectable()
export class QueriesService {
  private readonly logger = new Logger(QueriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PluginRegistry,
    private readonly datasources: DatasourcesService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async execute(input: ExecuteQueryInput): Promise<QueryResult> {
    const dsl = await this.loadDsl(
      input.organizationId,
      input.applicationId,
      input.source,
      input.environmentId,
    );

    // The statement always comes from the stored DSL. The request supplies values
    // only — it can never supply SQL, a datasource id, or a target host.
    const query = resolveQuery(dsl, input.queryName, input.pageId);
    if (!query) {
      throw new NotFoundException(`Query "${input.queryName}" not found in this application`);
    }

    const resolved = await this.datasources.resolveConfig(
      input.organizationId,
      query.datasourceId,
      input.environmentId,
    );
    const plugin = this.registry.get(resolved.pluginId);
    const prepared = plugin.prepare(query.definition as never);

    this.assertWriteAllowed(
      prepared.statementType,
      resolved.readOnly,
      input.permissions,
      query,
      input.publicRuntime === true,
    );

    const bindings = this.collectBindings(prepared.expressions, prepared.identifierExpressions, input.bindings);

    const cacheable =
      query.settings.cache?.enabled === true && prepared.statementType === 'read';
    const cacheKey = RedisService.queryCacheKey(
      input.applicationId,
      query.name,
      input.environmentId,
      bindings.values,
    );

    if (cacheable) {
      const hit = await this.redis.getJson<QueryResult>(cacheKey);
      if (hit) return { ...hit, messages: [...(hit.messages ?? []), 'Served from cache'] };
    }

    const timeoutMs = Math.min(
      query.settings.timeoutMs || this.config.get<number>('QUERY_TIMEOUT_MS', 30_000),
      this.config.get<number>('QUERY_TIMEOUT_MS', 30_000),
    );
    const maxRows = Math.min(
      query.settings.maxRows || this.config.get<number>('QUERY_MAX_ROWS', 10_000),
      this.config.get<number>('QUERY_MAX_ROWS', 10_000),
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const ctx: PluginExecutionContext = {
      datasourceId: query.datasourceId,
      organizationId: input.organizationId,
      userId: input.userId ?? '',
      environment: input.environmentId,
      timeoutMs,
      maxRows,
      // A read statement on a datasource with a replica opens read-only, which is a
      // real safety net: an accidental write fails at the database, not in our parser.
      readOnly: resolved.readOnly || prepared.statementType === 'read',
      sessionVariables: {
        'app.user_id': input.userId ?? '',
        'app.organization_id': input.organizationId,
      },
      signal: controller.signal,
    };

    const started = Date.now();
    try {
      const result = await plugin.execute(resolved.config as never, prepared, bindings, ctx);

      if (cacheable && query.settings.cache) {
        await this.redis.setJson(cacheKey, result, query.settings.cache.ttlSeconds);
      }

      // Reads are high-volume; auditing every one would drown the log. Writes and
      // calls change state, so those are always recorded.
      if (prepared.statementType !== 'read') {
        await this.audit.record({
          organizationId: input.organizationId,
          actorId: input.userId,
          action: 'query.execute',
          resourceType: 'query',
          resourceId: `${input.applicationId}:${query.name}`,
          metadata: {
            statementType: prepared.statementType,
            datasourceId: query.datasourceId,
            environmentId: input.environmentId,
            affectedRows: result.affectedRows,
            durationMs: result.durationMs,
          },
        });
      }

      return result;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new RequestTimeoutException(
          `Query "${query.name}" exceeded its ${timeoutMs}ms timeout`,
        );
      }
      this.logger.warn(
        `Query ${query.name} failed after ${Date.now() - started}ms: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Query execution failed',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** Runs a query straight from an unsaved definition, for the query editor's Run button. */
  async executeDraftDefinition(input: {
    organizationId: string;
    userId: string;
    permissions: Permission[];
    datasourceId: string;
    environmentId: string;
    definition: QueryEntity['definition'];
    bindings: Record<string, unknown>;
  }): Promise<QueryResult> {
    const resolved = await this.datasources.resolveConfig(
      input.organizationId,
      input.datasourceId,
      input.environmentId,
    );
    const plugin = this.registry.get(resolved.pluginId);
    const prepared = plugin.prepare(input.definition as never);

    if (prepared.statementType !== 'read' && !input.permissions.includes(PERMISSIONS.QUERY_WRITE)) {
      throw new ForbiddenException(
        'This statement modifies data and requires the query:write permission',
      );
    }
    if (resolved.readOnly && prepared.statementType !== 'read') {
      throw new ForbiddenException('This datasource is configured read-only');
    }

    const bindings = this.collectBindings(
      prepared.expressions,
      prepared.identifierExpressions,
      input.bindings,
    );

    const timeoutMs = this.config.get<number>('QUERY_TIMEOUT_MS', 30_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await plugin.execute(resolved.config as never, prepared, bindings, {
        datasourceId: input.datasourceId,
        organizationId: input.organizationId,
        userId: input.userId,
        environment: input.environmentId,
        timeoutMs,
        maxRows: this.config.get<number>('QUERY_MAX_ROWS', 10_000),
        readOnly: resolved.readOnly || prepared.statementType === 'read',
        sessionVariables: {
          'app.user_id': input.userId,
          'app.organization_id': input.organizationId,
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new RequestTimeoutException(`Query exceeded its ${timeoutMs}ms timeout`);
      }
      this.logger.warn(
        `Draft query failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Query execution failed',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private assertWriteAllowed(
    statementType: string,
    datasourceReadOnly: boolean,
    permissions: Permission[],
    query: QueryEntity,
    publicRuntime: boolean,
  ): void {
    if (statementType === 'read') return;

    if (datasourceReadOnly) {
      throw new ForbiddenException(
        `Query "${query.name}" modifies data, but its datasource is read-only`,
      );
    }
    if (statementType === 'ddl' && !permissions.includes(PERMISSIONS.QUERY_RAW_UNSAFE)) {
      throw new ForbiddenException(
        `Query "${query.name}" contains a schema-changing statement, which requires ` +
          'the query:raw_unsafe permission',
      );
    }
    if (publicRuntime) return;
    if (!permissions.includes(PERMISSIONS.QUERY_WRITE)) {
      throw new ForbiddenException(
        `Query "${query.name}" modifies data and requires the query:write permission`,
      );
    }
  }

  /**
   * Looks up a value for every expression the plugin asked for. Expressions the
   * client sent that the plugin did not ask for are ignored rather than trusted.
   */
  private collectBindings(
    expressions: string[],
    identifierExpressions: string[],
    supplied: Record<string, unknown>,
  ): EvaluatedBindings {
    const lookup = (expression: string): unknown => {
      const key = Object.keys(supplied).find((k) => normalise(k) === normalise(expression));
      if (key === undefined) {
        throw new BadRequestException(
          `No value supplied for binding {{ ${expression} }}. ` +
            'The client must evaluate every binding the query declares.',
        );
      }
      return supplied[key];
    };

    return {
      values: expressions.map(lookup),
      identifierValues: identifierExpressions.map((expression) => String(lookup(expression))),
    };
  }

  private async loadDsl(
    organizationId: string,
    applicationId: string,
    source: 'draft' | 'published',
    environmentId: string,
  ): Promise<ApplicationDsl> {
    const application = await this.prisma.application.findFirst({
      where: { id: applicationId, workspace: { organizationId } },
      include: {
        publishedVersion: true,
        releases: { include: { version: true } },
      },
    });
    if (!application) throw new NotFoundException('Application not found');

    if (source === 'published') {
      const release = application.releases.find(
        (entry) => entry.environmentId === environmentId,
      );
      if (!release) {
        throw new NotFoundException('This application has not been published to this environment');
      }
      return release.version.dsl as unknown as ApplicationDsl;
    }
    return application.draftDsl as unknown as ApplicationDsl;
  }
}

function normalise(expression: string): string {
  return expression.trim().replace(/\s+/g, ' ');
}

function resolveQuery(
  dsl: ApplicationDsl,
  queryName: string,
  pageId?: string,
): QueryEntity | undefined {
  if (pageId) {
    return queriesOnPage(dsl.queries, pageId).find((query) => query.name === queryName);
  }
  return (
    dsl.queries.find((query) => query.name === queryName && !query.pageId) ??
    dsl.queries.find((query) => query.name === queryName)
  );
}
