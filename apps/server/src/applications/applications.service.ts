import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type { ApplicationDsl } from '@swiftly/shared';
import { DSL_VERSION } from '@swiftly/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, workspaceId?: string) {
    const applications = await this.prisma.application.findMany({
      where: {
        workspace: { organizationId },
        ...(workspaceId ? { workspaceId } : {}),
      },
      select: {
        id: true,
        name: true,
        slug: true,
        icon: true,
        description: true,
        status: true,
        updatedAt: true,
        workspaceId: true,
        publishedVersionId: true,
        createdBy: { select: { id: true, name: true } },
        releases: {
          select: {
            environmentId: true,
            publishedAt: true,
            environment: { select: { name: true, isProduction: true } },
            version: { select: { versionNumber: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return applications.map(({ releases, ...application }) => ({
      ...application,
      releases: presentReleases(releases),
    }));
  }

  async get(organizationId: string, applicationId: string) {
    const application = await this.prisma.application.findFirst({
      where: { id: applicationId, workspace: { organizationId } },
      include: {
        publishedVersion: { select: { id: true, versionNumber: true, publishedAt: true } },
        workspace: { select: { slug: true } },
        releases: {
          select: {
            environmentId: true,
            publishedAt: true,
            environment: { select: { name: true, isProduction: true } },
            version: { select: { versionNumber: true } },
          },
        },
      },
    });
    if (!application) throw new NotFoundException('Application not found');
    const { releases, ...rest } = application;
    return { ...rest, releases: presentReleases(releases) };
  }

  async create(
    organizationId: string,
    userId: string,
    input: { workspaceId: string; name: string; slug: string; description?: string },
  ) {
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: input.workspaceId, organizationId },
      select: { id: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const application = await this.prisma.application.create({
      data: {
        workspaceId: input.workspaceId,
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        createdById: userId,
        draftDsl: emptyDsl(input.name) as unknown as object,
      },
    });

    await this.audit.record({
      organizationId,
      actorId: userId,
      action: 'application.create',
      resourceType: 'application',
      resourceId: application.id,
      metadata: { name: input.name },
    });

    return application;
  }

  /**
   * Saves the editor's draft. `expectedRevision` implements optimistic concurrency:
   * two builders with the same app open cannot silently overwrite each other — the
   * second save is rejected and the client reconciles.
   */
  async saveDraft(
    organizationId: string,
    userId: string,
    applicationId: string,
    dsl: ApplicationDsl,
    expectedRevision: number,
  ) {
    const application = await this.prisma.application.findFirst({
      where: { id: applicationId, workspace: { organizationId } },
      select: { id: true, draftRevision: true },
    });
    if (!application) throw new NotFoundException('Application not found');

    if (application.draftRevision !== expectedRevision) {
      throw new HttpException(
        {
          statusCode: HttpStatus.CONFLICT,
          message:
            'This application was changed by someone else since you loaded it. ' +
            'Reload to get the latest version before saving.',
          currentRevision: application.draftRevision,
          yourRevision: expectedRevision,
        },
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.application.update({
      where: { id: applicationId },
      data: {
        draftDsl: dsl as unknown as object,
        draftRevision: { increment: 1 },
        name: dsl.name,
      },
      select: { draftRevision: true, updatedAt: true },
    });

    return { revision: updated.draftRevision, updatedAt: updated.updatedAt };
  }

  async remove(organizationId: string, userId: string, applicationId: string) {
    const application = await this.prisma.application.findFirst({
      where: { id: applicationId, workspace: { organizationId } },
      select: { id: true, name: true },
    });
    if (!application) throw new NotFoundException('Application not found');

    await this.prisma.application.delete({ where: { id: applicationId } });
    await this.audit.record({
      organizationId,
      actorId: userId,
      action: 'application.delete',
      resourceType: 'application',
      resourceId: applicationId,
      metadata: { name: application.name },
    });
    return { ok: true };
  }
}

/** A new application starts with one empty page and a sidebar pointing at it. */
export function emptyDsl(name: string): ApplicationDsl {
  const pageId = 'page_home';
  return {
    dslVersion: DSL_VERSION,
    appId: '',
    name,
    pages: [
      {
        id: pageId,
        name: 'Home',
        slug: '',
        isDefault: true,
        widgets: [],
      },
    ],
    queries: [],
    jsObjects: [],
    navigation: {
      style: 'sidebar',
      title: name,
      items: [
        {
          id: 'nav_home',
          label: 'Home',
          icon: 'home',
          target: { kind: 'page', pageId },
        },
      ],
    },
    theme: {
      primaryColor: '#2563eb',
      borderRadius: '6px',
      fontFamily: 'Inter, system-ui, sans-serif',
      density: 'comfortable',
      mode: 'light',
    },
    appState: {},
  };
}

const ENV_ORDER: Record<string, number> = {
  dev: 0,
  test: 1,
  stage: 2,
  staging: 2,
  production: 3,
  prod: 3,
};

function presentReleases(
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
