import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ApplicationsService } from './applications.service';
import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

const createSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Slug may contain lowercase letters, digits and hyphens'),
  description: z.string().max(500).optional(),
});

const saveDraftSchema = z.object({
  dsl: z.object({}).passthrough(),
  expectedRevision: z.number().int().min(0),
});

@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.APP_VIEW)
  list(@CurrentUser() user: AuthenticatedUser, @Query('workspaceId') workspaceId?: string) {
    return this.applications.list(user.organizationId, workspaceId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.APP_VIEW)
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.applications.get(user.organizationId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.APP_CREATE)
  create(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(createSchema)) dto: z.infer<typeof createSchema>) {
    return this.applications.create(user.organizationId, user.id, dto);
  }

  @Put(':id/draft')
  @RequirePermissions(PERMISSIONS.APP_EDIT)
  saveDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(saveDraftSchema)) dto: z.infer<typeof saveDraftSchema>,
  ) {
    return this.applications.saveDraft(
      user.organizationId,
      user.id,
      id,
      dto.dsl as never,
      dto.expectedRevision,
    );
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.APP_DELETE)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.applications.remove(user.organizationId, user.id, id);
  }
}
