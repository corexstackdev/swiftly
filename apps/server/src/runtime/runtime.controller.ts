import { Controller, ForbiddenException, Get, NotFoundException, Param } from '@nestjs/common';
import type { ApplicationDsl } from '@swiftly/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';

/**
 * Serves published applications to end users.
 *
 * This endpoint returns the frozen version's DSL, never the draft, so what a user
 * receives is exactly what IT approved. Page-level permissions are enforced here
 * rather than by hiding navigation items, because a hidden page must not be a
 * reachable page.
 */
@Controller('runtime')
export class RuntimeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('apps/:workspaceSlug/:appSlug')
  @RequirePermissions(PERMISSIONS.APP_VIEW)
  async load(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('appSlug') appSlug: string,
  ) {
    const application = await this.prisma.application.findFirst({
      where: {
        slug: appSlug,
        workspace: { slug: workspaceSlug, organizationId: user.organizationId },
      },
      include: { publishedVersion: true, workspace: { select: { id: true, slug: true } } },
    });

    if (!application) throw new NotFoundException('Application not found');
    if (!application.publishedVersion) {
      throw new NotFoundException('This application has not been published yet');
    }

    const dsl = application.publishedVersion.dsl as unknown as ApplicationDsl;

    // Strip pages the caller may not open, and any nav item pointing at them.
    const permitted = dsl.pages.filter((page) =>
      (page.requiredPermissions ?? []).every((permission) =>
        user.permissions.includes(permission as never),
      ),
    );
    if (permitted.length === 0) {
      throw new ForbiddenException('You do not have access to any page in this application');
    }

    const permittedIds = new Set(permitted.map((page) => page.id));

    return {
      applicationId: application.id,
      name: application.name,
      versionNumber: application.publishedVersion.versionNumber,
      publishedAt: application.publishedVersion.publishedAt,
      dsl: {
        ...dsl,
        pages: permitted,
        navigation: {
          ...dsl.navigation,
          items: filterNav(dsl.navigation?.items ?? [], permittedIds),
        },
      },
    };
  }
}

function filterNav<T extends { target: { kind: string; pageId?: string }; children?: T[] }>(
  items: T[],
  permittedPageIds: Set<string>,
): T[] {
  return items
    .filter(
      (item) => item.target.kind !== 'page' || permittedPageIds.has(item.target.pageId ?? ''),
    )
    .map((item) => ({
      ...item,
      children: item.children ? filterNav(item.children, permittedPageIds) : undefined,
    }));
}
