import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import type { ApplicationDsl } from '@swiftly/shared';
import { PrismaService } from '../prisma/prisma.service';
import { QueriesService } from '../queries/queries.service';
import { Public } from '../common/decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

const executePublicSchema = z.object({
  pageId: z.string().optional(),
  environmentId: z.string().uuid().optional(),
  bindings: z.record(z.unknown()).default({}),
});

/**
 * Serves running applications as public hosted tools — no Swiftly login.
 *
 * `/preview` is the current draft, so a builder can copy that URL and treat it
 * like a deployed app. Published URLs are `/app/:workspace/:slug` for production
 * and `/app/:workspace/:slug/:environment` for named environments (dev, test,
 * stage, production). The statement for a query always comes from the stored DSL.
 */
@Controller('runtime')
export class RuntimeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queries: QueriesService,
  ) {}

  @Public()
  @Get('apps/:workspaceSlug/:appSlug/preview')
  async preview(
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('appSlug') appSlug: string,
    @Query('environmentId') environmentId?: string,
  ) {
    const { application, environment } = await this.appContext(workspaceSlug, appSlug, {
      requestedEnvironmentId: environmentId,
    });
    return this.presentDraft(application, environment?.id ?? '');
  }

  @Public()
  @Get('applications/:applicationId/preview')
  async previewById(
    @Param('applicationId') applicationId: string,
    @Query('environmentId') environmentId?: string,
  ) {
    const application = await this.prisma.application.findFirst({
      where: { id: applicationId },
      include: { workspace: { select: { slug: true, organizationId: true } } },
    });
    if (!application) throw new NotFoundException('Application not found');
    const environment = await this.pickEnvironment(
      application.workspace.organizationId,
      environmentId,
    );
    return this.presentDraft(application, environment?.id ?? '');
  }

  @Public()
  @Get('apps/:workspaceSlug/:appSlug/:environmentName')
  async loadNamed(
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('appSlug') appSlug: string,
    @Param('environmentName') environmentName: string,
  ) {
    if (environmentName === 'preview' || environmentName === 'queries') {
      throw new NotFoundException('Application not found');
    }
    const { application, environment, version } = await this.publishedContext(
      workspaceSlug,
      appSlug,
      { environmentName },
    );
    return this.presentPublished(application, environment, version);
  }

  @Public()
  @Get('apps/:workspaceSlug/:appSlug')
  async load(
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('appSlug') appSlug: string,
    @Query('environmentId') environmentId?: string,
  ) {
    const { application, environment, version } = await this.publishedContext(
      workspaceSlug,
      appSlug,
      { environmentId },
    );
    return this.presentPublished(application, environment, version);
  }

  @Public()
  @Post('apps/:workspaceSlug/:appSlug/preview/queries/:queryName/execute')
  async executePreview(
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('appSlug') appSlug: string,
    @Param('queryName') queryName: string,
    @Body(new ZodValidationPipe(executePublicSchema)) dto: z.infer<typeof executePublicSchema>,
  ) {
    const { application, environment } = await this.appContext(workspaceSlug, appSlug, {
      requestedEnvironmentId: dto.environmentId,
    });
    if (!environment) {
      throw new NotFoundException('This application has no environment to run queries against');
    }

    return this.queries.execute({
      organizationId: application.workspace.organizationId,
      applicationId: application.id,
      queryName,
      pageId: dto.pageId,
      source: 'draft',
      publicRuntime: true,
      environmentId: environment.id,
      bindings: dto.bindings,
      permissions: [],
    });
  }

  @Public()
  @Post('apps/:workspaceSlug/:appSlug/queries/:queryName/execute')
  async executePublished(
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('appSlug') appSlug: string,
    @Param('queryName') queryName: string,
    @Body(new ZodValidationPipe(executePublicSchema)) dto: z.infer<typeof executePublicSchema>,
  ) {
    const { application, environment } = await this.publishedContext(workspaceSlug, appSlug, {
      environmentId: dto.environmentId,
    });

    return this.queries.execute({
      organizationId: application.workspace.organizationId,
      applicationId: application.id,
      queryName,
      pageId: dto.pageId,
      source: 'published',
      publicRuntime: true,
      environmentId: environment.id,
      bindings: dto.bindings,
      permissions: [],
    });
  }

  private presentPublished(
    application: {
      id: string;
      name: string;
      slug: string;
      workspace: { slug: string };
      releases: {
        environmentId: string;
        publishedAt: Date;
        environment: { name: string; isProduction: boolean };
        version: { versionNumber: number };
      }[];
    },
    environment: { id: string; name: string },
    version: { versionNumber: number; publishedAt: Date | null; dsl: unknown },
  ) {
    return {
      applicationId: application.id,
      name: application.name,
      workspaceSlug: application.workspace.slug,
      appSlug: application.slug,
      versionNumber: version.versionNumber,
      publishedAt: version.publishedAt,
      environmentId: environment.id,
      environmentName: environment.name,
      releases: presentRuntimeReleases(application.releases),
      dsl: version.dsl as unknown as ApplicationDsl,
    };
  }

  private presentDraft(
    application: {
      id: string;
      name: string;
      slug: string;
      draftDsl: unknown;
      workspace: { slug: string };
    },
    environmentId: string,
  ) {
    return {
      applicationId: application.id,
      name: application.name,
      workspaceSlug: application.workspace.slug,
      appSlug: application.slug,
      environmentId,
      dsl: application.draftDsl as unknown as ApplicationDsl,
    };
  }

  private async appContext(
    workspaceSlug: string,
    appSlug: string,
    options: { requestedEnvironmentId?: string; productionFirst?: boolean } = {},
  ) {
    const application = await this.prisma.application.findFirst({
      where: {
        slug: appSlug,
        workspace: { slug: workspaceSlug },
      },
      include: {
        publishedVersion: true,
        workspace: { select: { slug: true, organizationId: true } },
      },
    });
    if (!application) throw new NotFoundException('Application not found');

    const environment = await this.pickEnvironment(
      application.workspace.organizationId,
      options.requestedEnvironmentId,
      options.productionFirst === true,
    );

    return { application, environment };
  }

  private async publishedContext(
    workspaceSlug: string,
    appSlug: string,
    requested: { environmentId?: string; environmentName?: string } = {},
  ) {
    const application = await this.prisma.application.findFirst({
      where: {
        slug: appSlug,
        workspace: { slug: workspaceSlug },
      },
      include: {
        publishedVersion: true,
        releases: { include: { version: true, environment: true } },
        workspace: { select: { slug: true, organizationId: true } },
      },
    });
    if (!application) throw new NotFoundException('Application not found');

    const environments = await this.prisma.environment.findMany({
      where: { organizationId: application.workspace.organizationId },
    });

    const requestedEnvironment = requested.environmentName
      ? environments.find(
          (entry) => entry.name.toLowerCase() === requested.environmentName!.toLowerCase(),
        )
      : requested.environmentId
        ? environments.find((entry) => entry.id === requested.environmentId)
        : undefined;

    if (requested.environmentName || requested.environmentId) {
      if (!requestedEnvironment) throw new NotFoundException('Unknown environment');
      const release = application.releases.find(
        (entry) => entry.environmentId === requestedEnvironment.id,
      );
      if (!release) {
        throw new NotFoundException(
          `This application has not been published to ${requestedEnvironment.name}`,
        );
      }
      return { application, environment: requestedEnvironment, version: release.version };
    }

    const production = environments.find((entry) => entry.isProduction);
    const productionRelease = production
      ? application.releases.find((entry) => entry.environmentId === production.id)
      : undefined;
    if (productionRelease) {
      return {
        application,
        environment: productionRelease.environment,
        version: productionRelease.version,
      };
    }

    const release = [...application.releases].sort(
      (left, right) => right.publishedAt.getTime() - left.publishedAt.getTime(),
    )[0];

    if (release) {
      return { application, environment: release.environment, version: release.version };
    }

    if (application.publishedVersion) {
      const environment =
        environments.find((entry) => entry.isDefault) ??
        environments.find((entry) => entry.isProduction) ??
        environments[0];
      if (!environment) {
        throw new NotFoundException('This application has no environment to run against');
      }
      return { application, environment, version: application.publishedVersion };
    }

    throw new NotFoundException('This application has not been published yet');
  }

  private async pickEnvironment(
    organizationId: string,
    requestedId?: string,
    productionFirst = false,
  ) {
    const [environments, configs] = await Promise.all([
      this.prisma.environment.findMany({ where: { organizationId } }),
      this.prisma.datasourceConfig.findMany({
        where: { datasource: { organizationId } },
        select: { environmentId: true },
      }),
    ]);
    const configured = new Set(configs.map((entry) => entry.environmentId));
    const requested = requestedId
      ? environments.find((entry) => entry.id === requestedId)
      : undefined;

    if (productionFirst) {
      return (
        environments.find((entry) => entry.isProduction && configured.has(entry.id)) ??
        requested ??
        environments.find((entry) => entry.isDefault && configured.has(entry.id)) ??
        environments.find((entry) => configured.has(entry.id)) ??
        environments.find((entry) => entry.isProduction) ??
        environments.find((entry) => entry.isDefault) ??
        environments[0] ??
        null
      );
    }

    return (
      requested ??
      environments.find((entry) => entry.isDefault && configured.has(entry.id)) ??
      environments.find((entry) => configured.has(entry.id)) ??
      environments.find((entry) => entry.isDefault) ??
      environments[0] ??
      null
    );
  }
}

const ENV_ORDER: Record<string, number> = {
  dev: 0,
  test: 1,
  stage: 2,
  staging: 2,
  production: 3,
  prod: 3,
};

function presentRuntimeReleases(
  releases: {
    environmentId: string;
    publishedAt: Date;
    environment: { name: string; isProduction: boolean };
    version: { versionNumber: number };
  }[],
) {
  return [...releases]
    .map((release) => ({
      environmentId: release.environmentId,
      environmentName: release.environment.name,
      isProduction: release.environment.isProduction,
      versionNumber: release.version.versionNumber,
      publishedAt: release.publishedAt,
    }))
    .sort(
      (left, right) =>
        (ENV_ORDER[left.environmentName] ?? 50) - (ENV_ORDER[right.environmentName] ?? 50) ||
        left.environmentName.localeCompare(right.environmentName),
    );
}
