import { Body, Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

const createSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/),
});

@Controller()
export class WorkspacesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('workspaces')
  @RequirePermissions(PERMISSIONS.WORKSPACE_VIEW)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.prisma.workspace.findMany({
      where: { organizationId: user.organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        _count: { select: { applications: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  @Post('workspaces')
  @RequirePermissions(PERMISSIONS.WORKSPACE_CREATE)
  create(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(createSchema)) dto: z.infer<typeof createSchema>) {
    return this.prisma.workspace.create({
      data: { organizationId: user.organizationId, name: dto.name, slug: dto.slug },
    });
  }

  /** Environments drive which datasource credentials a query runs against. */
  @Get('environments')
  @RequirePermissions(PERMISSIONS.WORKSPACE_VIEW)
  environments(@CurrentUser() user: AuthenticatedUser) {
    return this.prisma.environment.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { isProduction: 'asc' },
    });
  }
}
