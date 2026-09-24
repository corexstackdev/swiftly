import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ALL_PERMISSIONS, type Permission } from '../common/permissions';
import { parseStringList } from '../common/status';

/**
 * Resolves what a user may do inside an organization, and scopes lookups by org.
 *
 * Every resource lookup goes through here rather than through a bare Prisma call,
 * so tenant isolation is a property of the data layer instead of something each
 * controller has to remember.
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Union of the user's org role and any workspace roles they hold. */
  async resolvePermissions(userId: string, organizationId: string): Promise<Permission[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true, isActive: true },
    });
    if (!user?.isActive) return [];
    if (user.isSuperAdmin) return [...ALL_PERMISSIONS];

    const membership = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { role: { select: { permissions: true } } },
    });
    if (!membership) return [];

    const workspaceRoles = await this.prisma.workspaceMember.findMany({
      where: { userId, workspace: { organizationId } },
      select: { role: { select: { permissions: true } } },
    });

    const granted = new Set<string>(parseStringList(membership.role.permissions));
    for (const wr of workspaceRoles) {
      for (const permission of parseStringList(wr.role.permissions)) granted.add(permission);
    }
    return [...granted] as Permission[];
  }

  /** Throws unless the application exists inside the caller's organization. */
  async assertApplicationInOrg(applicationId: string, organizationId: string): Promise<string> {
    const app = await this.prisma.application.findFirst({
      where: { id: applicationId, workspace: { organizationId } },
      select: { id: true, workspaceId: true },
    });
    if (!app) throw new NotFoundException('Application not found');
    return app.workspaceId;
  }

  async assertWorkspaceInOrg(workspaceId: string, organizationId: string): Promise<void> {
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, organizationId },
      select: { id: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
  }

  async assertDatasourceInOrg(datasourceId: string, organizationId: string): Promise<void> {
    const datasource = await this.prisma.datasource.findFirst({
      where: { id: datasourceId, organizationId },
      select: { id: true },
    });
    if (!datasource) throw new NotFoundException('Datasource not found');
  }

  assertHasPermission(held: Permission[], required: Permission): void {
    if (!held.includes(required)) {
      throw new ForbiddenException(`Missing required permission: ${required}`);
    }
  }
}
