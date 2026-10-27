import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { VersionStatus } from '../common/status';
import { queriesOnPage, type ApplicationDsl } from '@swiftly/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { EnvRecord, PrismaTx, ReleaseWithEnvironment } from '../prisma/types';
import { AuditService } from '../audit/audit.service';
import { PERMISSIONS, type Permission } from '../common/permissions';

/**
 * Publishing snapshots the current draft onto the environments the builder
 * selected. Each environment keeps its own datasource credentials.
 */
@Injectable()
export class PublishService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async publishToEnvironments(
    organizationId: string,
    userId: string,
    permissions: Permission[],
    applicationId: string,
    environmentIds: string[],
  ) {
    this.requirePublishPermission(permissions);

    const application = await this.requireApplication(organizationId, applicationId);
    if (application.status === 'ARCHIVED') {
      throw new BadRequestException('An archived application cannot be published');
    }

    const uniqueIds = [...new Set(environmentIds)];
    const environments: EnvRecord[] = await this.prisma.environment.findMany({
      where: { organizationId, id: { in: uniqueIds } },
    });
    if (environments.length !== uniqueIds.length) {
      throw new BadRequestException('One or more environments are unknown');
    }

    const dsl = application.draftDsl as unknown as ApplicationDsl;
    this.validateDsl(dsl);

    const latest = await this.prisma.applicationVersion.findFirst({
      where: { applicationId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });

    const now = new Date();
    const names = presentPublishReleases(
      environments.map((environment) => ({
        environmentId: environment.id,
        environmentName: environment.name,
        isProduction: environment.isProduction,
        versionNumber: 0,
        publishedAt: now,
      })),
    )
      .map((environment) => environment.environmentName)
      .join(', ');

    const version = await this.prisma.$transaction(async (tx: PrismaTx) => {
      const created = await tx.applicationVersion.create({
        data: {
          applicationId,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
          status: VersionStatus.PUBLISHED,
          dsl: dsl as unknown as object,
          changeNote: `Published to ${names}`,
          submittedById: userId,
          submittedAt: now,
          reviewedById: userId,
          reviewedAt: now,
          publishedAt: now,
        },
      });

      for (const environment of environments) {
        await tx.applicationRelease.upsert({
          where: {
            applicationId_environmentId: { applicationId, environmentId: environment.id },
          },
          create: {
            applicationId,
            environmentId: environment.id,
            versionId: created.id,
            publishedAt: now,
          },
          update: { versionId: created.id, publishedAt: now },
        });
      }

      await tx.application.update({
        where: { id: applicationId },
        data: {
          status: 'PUBLISHED',
          publishedVersionId: created.id,
        },
      });

      return created;
    });

    const releases: ReleaseWithEnvironment[] = await this.prisma.applicationRelease.findMany({
      where: { applicationId },
      include: {
        environment: { select: { name: true, isProduction: true } },
        version: { select: { versionNumber: true } },
      },
    });

    await this.audit.record({
      organizationId,
      actorId: userId,
      action: 'application.publish',
      resourceType: 'application_version',
      resourceId: version.id,
      metadata: {
        applicationId,
        versionNumber: version.versionNumber,
        environmentIds: environments.map((environment) => environment.id),
        environmentNames: names,
      },
    });

    return {
      id: version.id,
      versionNumber: version.versionNumber,
      releases: presentPublishReleases(
        releases.map((release) => ({
          environmentId: release.environmentId,
          environmentName: release.environment.name,
          isProduction: release.environment.isProduction,
          versionNumber: release.version.versionNumber,
          publishedAt: release.publishedAt,
        })),
      ),
    };
  }

  async submit(
    organizationId: string,
    userId: string,
    applicationId: string,
    changeNote?: string,
  ) {
    const application = await this.requireApplication(organizationId, applicationId);

    const pending = await this.prisma.applicationVersion.findFirst({
      where: { applicationId, status: VersionStatus.PENDING_REVIEW },
      select: { id: true, versionNumber: true },
    });
    if (pending) {
      throw new BadRequestException(
        `Version ${pending.versionNumber} is already awaiting review. ` +
          'Withdraw it before submitting another.',
      );
    }

    const dsl = application.draftDsl as unknown as ApplicationDsl;
    this.validateDsl(dsl);

    const latest = await this.prisma.applicationVersion.findFirst({
      where: { applicationId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });

    const version = await this.prisma.applicationVersion.create({
      data: {
        applicationId,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        status: VersionStatus.PENDING_REVIEW,
        dsl: dsl as unknown as object,
        changeNote: changeNote ?? null,
        submittedById: userId,
      },
    });

    await this.audit.record({
      organizationId,
      actorId: userId,
      action: 'application.submit',
      resourceType: 'application_version',
      resourceId: version.id,
      metadata: { applicationId, versionNumber: version.versionNumber, changeNote },
    });

    return version;
  }

  /** Reviewer queue: everything waiting on IT across the organization. */
  async listPendingReviews(organizationId: string) {
    return this.prisma.applicationVersion.findMany({
      where: {
        status: VersionStatus.PENDING_REVIEW,
        application: { workspace: { organizationId } },
      },
      select: {
        id: true,
        versionNumber: true,
        changeNote: true,
        submittedAt: true,
        submittedBy: { select: { id: true, name: true, email: true } },
        application: { select: { id: true, name: true, workspaceId: true } },
      },
      orderBy: { submittedAt: 'asc' },
    });
  }

  /**
   * What changed against the currently published version. Reviewers need a diff, not
   * a wall of JSON, so this summarises at the level of pages, widgets and queries.
   */
  async diff(organizationId: string, versionId: string) {
    const version = await this.requireVersion(organizationId, versionId);
    const application = await this.prisma.application.findUniqueOrThrow({
      where: { id: version.applicationId },
      include: { publishedVersion: true },
    });

    const next = version.dsl as unknown as ApplicationDsl;
    const current = application.publishedVersion
      ? (application.publishedVersion.dsl as unknown as ApplicationDsl)
      : null;

    return {
      versionNumber: version.versionNumber,
      comparedTo: application.publishedVersion?.versionNumber ?? null,
      pages: diffNamed(current?.pages ?? [], next.pages, (p) => p.name),
      queries: diffNamed(current?.queries ?? [], next.queries, (q) => q.name),
      widgetCount: {
        before: countWidgets(current),
        after: countWidgets(next),
      },
      datasourcesUsed: [...new Set(next.queries.map((q) => q.datasourceId))],
    };
  }

  async approve(
    organizationId: string,
    userId: string,
    permissions: Permission[],
    versionId: string,
    notes?: string,
  ) {
    this.requirePublishPermission(permissions);
    const version = await this.requireVersion(organizationId, versionId);

    if (version.status !== VersionStatus.PENDING_REVIEW) {
      throw new BadRequestException(`Version is ${version.status}, not awaiting review`);
    }
    if (version.submittedById === userId) {
      throw new ForbiddenException(
        'A version cannot be approved by the person who submitted it',
      );
    }

    const updated = await this.prisma.applicationVersion.update({
      where: { id: versionId },
      data: {
        status: VersionStatus.APPROVED,
        reviewedById: userId,
        reviewedAt: new Date(),
        reviewNotes: notes ?? null,
      },
    });

    await this.audit.record({
      organizationId,
      actorId: userId,
      action: 'application.approve',
      resourceType: 'application_version',
      resourceId: versionId,
      metadata: { applicationId: version.applicationId, versionNumber: version.versionNumber, notes },
    });

    return updated;
  }

  async reject(
    organizationId: string,
    userId: string,
    permissions: Permission[],
    versionId: string,
    reason: string,
  ) {
    this.requirePublishPermission(permissions);
    const version = await this.requireVersion(organizationId, versionId);

    if (version.status !== VersionStatus.PENDING_REVIEW) {
      throw new BadRequestException(`Version is ${version.status}, not awaiting review`);
    }

    const updated = await this.prisma.applicationVersion.update({
      where: { id: versionId },
      data: {
        status: VersionStatus.REJECTED,
        reviewedById: userId,
        reviewedAt: new Date(),
        reviewNotes: reason,
      },
    });

    await this.audit.record({
      organizationId,
      actorId: userId,
      action: 'application.reject',
      resourceType: 'application_version',
      resourceId: versionId,
      metadata: { applicationId: version.applicationId, reason },
    });

    return updated;
  }

  /** Deploy flips a pointer — no rebuild, so rollback is instant. */
  async deploy(
    organizationId: string,
    userId: string,
    permissions: Permission[],
    versionId: string,
  ) {
    this.requirePublishPermission(permissions);
    const version = await this.requireVersion(organizationId, versionId);

    if (version.status !== VersionStatus.APPROVED) {
      throw new BadRequestException('Only an approved version can be deployed');
    }

    const result = await this.prisma.$transaction(async (tx: PrismaTx) => {
      const application = await tx.application.findUniqueOrThrow({
        where: { id: version.applicationId },
        select: {
          publishedVersionId: true,
          workspace: { select: { organizationId: true } },
        },
      });

      if (application.publishedVersionId) {
        await tx.applicationVersion.update({
          where: { id: application.publishedVersionId },
          data: { status: VersionStatus.ARCHIVED },
        });
      }

      const publishedAt = new Date();
      await tx.applicationVersion.update({
        where: { id: versionId },
        data: { status: VersionStatus.PUBLISHED, publishedAt },
      });

      const production = await tx.environment.findFirst({
        where: { organizationId: application.workspace.organizationId, isProduction: true },
      });
      if (production) {
        await tx.applicationRelease.upsert({
          where: {
            applicationId_environmentId: {
              applicationId: version.applicationId,
              environmentId: production.id,
            },
          },
          create: {
            applicationId: version.applicationId,
            environmentId: production.id,
            versionId,
            publishedAt,
          },
          update: { versionId, publishedAt },
        });
      }

      return tx.application.update({
        where: { id: version.applicationId },
        data: { publishedVersionId: versionId, status: 'PUBLISHED' },
        select: { id: true, publishedVersionId: true },
      });
    });

    await this.audit.record({
      organizationId,
      actorId: userId,
      action: 'application.publish',
      resourceType: 'application_version',
      resourceId: versionId,
      metadata: { applicationId: version.applicationId, versionNumber: version.versionNumber },
    });

    return result;
  }

  async rollback(
    organizationId: string,
    userId: string,
    permissions: Permission[],
    applicationId: string,
    targetVersionId: string,
  ) {
    this.requirePublishPermission(permissions);
    await this.requireApplication(organizationId, applicationId);

    const target = await this.prisma.applicationVersion.findFirst({
      where: { id: targetVersionId, applicationId },
    });
    if (!target) throw new NotFoundException('Target version not found');

    await this.prisma.$transaction(async (tx: PrismaTx) => {
      const application = await tx.application.findUniqueOrThrow({
        where: { id: applicationId },
        select: {
          publishedVersionId: true,
          workspace: { select: { organizationId: true } },
        },
      });
      if (application.publishedVersionId) {
        await tx.applicationVersion.update({
          where: { id: application.publishedVersionId },
          data: { status: VersionStatus.ROLLED_BACK },
        });
      }
      const publishedAt = new Date();
      await tx.applicationVersion.update({
        where: { id: targetVersionId },
        data: { status: VersionStatus.PUBLISHED, publishedAt },
      });
      const production = await tx.environment.findFirst({
        where: { organizationId: application.workspace.organizationId, isProduction: true },
      });
      if (production) {
        await tx.applicationRelease.upsert({
          where: {
            applicationId_environmentId: { applicationId, environmentId: production.id },
          },
          create: {
            applicationId,
            environmentId: production.id,
            versionId: targetVersionId,
            publishedAt,
          },
          update: { versionId: targetVersionId, publishedAt },
        });
      }
      await tx.application.update({
        where: { id: applicationId },
        data: { publishedVersionId: targetVersionId },
      });
    });

    await this.audit.record({
      organizationId,
      actorId: userId,
      action: 'application.rollback',
      resourceType: 'application_version',
      resourceId: targetVersionId,
      metadata: { applicationId, toVersion: target.versionNumber },
    });

    return { ok: true, publishedVersionId: targetVersionId };
  }

  async listVersions(organizationId: string, applicationId: string) {
    await this.requireApplication(organizationId, applicationId);
    return this.prisma.applicationVersion.findMany({
      where: { applicationId },
      select: {
        id: true,
        versionNumber: true,
        status: true,
        changeNote: true,
        submittedAt: true,
        publishedAt: true,
        reviewNotes: true,
        submittedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
      orderBy: { versionNumber: 'desc' },
    });
  }

  private requirePublishPermission(permissions: Permission[]): void {
    if (!permissions.includes(PERMISSIONS.APP_PUBLISH)) {
      throw new ForbiddenException('Publishing requires the app:publish permission');
    }
  }

  private validateDsl(dsl: ApplicationDsl): void {
    const problems: string[] = [];

    if (!dsl.pages || dsl.pages.length === 0) problems.push('The application has no pages');
    if (dsl.pages && !dsl.pages.some((page) => page.isDefault)) {
      problems.push('No page is marked as the default landing page');
    }

    const pageIds = new Set(dsl.pages?.map((page) => page.id) ?? []);
    for (const item of flattenNav(dsl.navigation?.items ?? [])) {
      if (item.target.kind === 'page' && !pageIds.has(item.target.pageId)) {
        problems.push(`Navigation item "${item.label}" points at a page that no longer exists`);
      }
    }

    for (const query of dsl.queries ?? []) {
      if (!query.datasourceId) problems.push(`Query "${query.name}" has no datasource`);
      if (query.pageId && !pageIds.has(query.pageId)) {
        problems.push(`Query "${query.name}" belongs to a page that no longer exists`);
      }
    }
    for (const page of dsl.pages ?? []) {
      const visibleNames = new Set<string>();
      for (const query of queriesOnPage(dsl.queries, page.id)) {
        if (visibleNames.has(query.name)) {
          problems.push(`Duplicate query name "${query.name}" on page "${page.name}"`);
        }
        visibleNames.add(query.name);
      }
    }

    if (problems.length > 0) {
      throw new BadRequestException({
        message: 'This application cannot be published yet',
        errors: problems,
      });
    }
  }

  private async requireApplication(organizationId: string, applicationId: string) {
    const application = await this.prisma.application.findFirst({
      where: { id: applicationId, workspace: { organizationId } },
    });
    if (!application) throw new NotFoundException('Application not found');
    return application;
  }

  private async requireVersion(organizationId: string, versionId: string) {
    const version = await this.prisma.applicationVersion.findFirst({
      where: { id: versionId, application: { workspace: { organizationId } } },
    });
    if (!version) throw new NotFoundException('Version not found');
    return version;
  }
}

/* ------------------------------------------------------------------ *
 * Diff helpers
 * ------------------------------------------------------------------ */

function diffNamed<T>(before: T[], after: T[], nameOf: (item: T) => string) {
  const beforeMap = new Map(before.map((item) => [nameOf(item), item]));
  const afterMap = new Map(after.map((item) => [nameOf(item), item]));

  const added = [...afterMap.keys()].filter((name) => !beforeMap.has(name));
  const removed = [...beforeMap.keys()].filter((name) => !afterMap.has(name));
  const changed = [...afterMap.entries()]
    .filter(([name, item]) => {
      const previous = beforeMap.get(name);
      return previous && JSON.stringify(previous) !== JSON.stringify(item);
    })
    .map(([name]) => name);

  return { added, removed, changed };
}

function countWidgets(dsl: ApplicationDsl | null): number {
  if (!dsl) return 0;
  const walk = (widgets: { children?: unknown[] }[]): number =>
    widgets.reduce(
      (total, widget) =>
        total + 1 + walk((widget.children ?? []) as { children?: unknown[] }[]),
      0,
    );
  return dsl.pages.reduce((total, page) => total + walk(page.widgets), 0);
}

function flattenNav(
  items: { label: string; target: { kind: string; pageId?: string }; children?: unknown[] }[],
): { label: string; target: { kind: string; pageId: string } }[] {
  const out: { label: string; target: { kind: string; pageId: string } }[] = [];
  for (const item of items) {
    if (item.target.kind === 'page' && item.target.pageId) {
      out.push({ label: item.label, target: { kind: 'page', pageId: item.target.pageId } });
    }
    out.push(...flattenNav((item.children ?? []) as typeof items));
  }
  return out;
}

const ENV_ORDER: Record<string, number> = {
  dev: 0,
  test: 1,
  stage: 2,
  staging: 2,
  production: 3,
  prod: 3,
};

function presentPublishReleases(
  releases: {
    environmentId: string;
    environmentName: string;
    isProduction: boolean;
    versionNumber: number;
    publishedAt: Date;
  }[],
) {
  return [...releases].sort(
    (left, right) =>
      (ENV_ORDER[left.environmentName] ?? 50) - (ENV_ORDER[right.environmentName] ?? 50) ||
      left.environmentName.localeCompare(right.environmentName),
  );
}
