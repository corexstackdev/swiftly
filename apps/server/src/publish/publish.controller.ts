import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { PublishService } from './publish.service';
import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

const submitSchema = z.object({ changeNote: z.string().max(1000).optional() });
const publishSchema = z.object({
  environmentIds: z.array(z.string().uuid()).min(1, 'Select at least one environment'),
});
const reviewSchema = z.object({ notes: z.string().max(2000).optional() });
const rejectSchema = z.object({ reason: z.string().min(1).max(2000) });
const rollbackSchema = z.object({ targetVersionId: z.string().uuid() });

@Controller()
export class PublishController {
  constructor(private readonly publish: PublishService) {}

  @Post('applications/:id/publish')
  @RequirePermissions(PERMISSIONS.APP_PUBLISH)
  publishToEnvironment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(publishSchema)) dto: z.infer<typeof publishSchema>,
  ) {
    return this.publish.publishToEnvironments(
      user.organizationId,
      user.id,
      user.permissions,
      id,
      dto.environmentIds,
    );
  }

  @Post('applications/:id/submit')
  @RequirePermissions(PERMISSIONS.APP_SUBMIT)
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(submitSchema)) dto: z.infer<typeof submitSchema>,
  ) {
    return this.publish.submit(user.organizationId, user.id, id, dto.changeNote);
  }

  @Get('applications/:id/versions')
  @RequirePermissions(PERMISSIONS.APP_VIEW)
  versions(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.publish.listVersions(user.organizationId, id);
  }

  /** IT reviewer queue. */
  @Get('reviews')
  @RequirePermissions(PERMISSIONS.APP_PUBLISH)
  pending(@CurrentUser() user: AuthenticatedUser) {
    return this.publish.listPendingReviews(user.organizationId);
  }

  @Get('reviews/:versionId/diff')
  @RequirePermissions(PERMISSIONS.APP_PUBLISH)
  diff(@CurrentUser() user: AuthenticatedUser, @Param('versionId') versionId: string) {
    return this.publish.diff(user.organizationId, versionId);
  }

  @Post('reviews/:versionId/approve')
  @RequirePermissions(PERMISSIONS.APP_PUBLISH)
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('versionId') versionId: string,
    @Body(new ZodValidationPipe(reviewSchema)) dto: z.infer<typeof reviewSchema>,
  ) {
    return this.publish.approve(
      user.organizationId,
      user.id,
      user.permissions,
      versionId,
      dto.notes,
    );
  }

  @Post('reviews/:versionId/reject')
  @RequirePermissions(PERMISSIONS.APP_PUBLISH)
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('versionId') versionId: string,
    @Body(new ZodValidationPipe(rejectSchema)) dto: z.infer<typeof rejectSchema>,
  ) {
    return this.publish.reject(
      user.organizationId,
      user.id,
      user.permissions,
      versionId,
      dto.reason,
    );
  }

  @Post('reviews/:versionId/deploy')
  @RequirePermissions(PERMISSIONS.APP_PUBLISH)
  deploy(@CurrentUser() user: AuthenticatedUser, @Param('versionId') versionId: string) {
    return this.publish.deploy(user.organizationId, user.id, user.permissions, versionId);
  }

  @Post('applications/:id/rollback')
  @RequirePermissions(PERMISSIONS.APP_PUBLISH)
  rollback(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rollbackSchema)) dto: z.infer<typeof rollbackSchema>,
  ) {
    return this.publish.rollback(
      user.organizationId,
      user.id,
      user.permissions,
      id,
      dto.targetVersionId,
    );
  }
}
