import { Body, Controller, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { QueriesService } from './queries.service';
import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

const executeSchema = z.object({
  source: z.enum(['draft', 'published']).default('draft'),
  environmentId: z.string().uuid(),
  /** Evaluated binding values, keyed by expression text. */
  bindings: z.record(z.unknown()).default({}),
});

const runDefinitionSchema = z.object({
  datasourceId: z.string().uuid(),
  environmentId: z.string().uuid(),
  definition: z.object({ kind: z.string() }).passthrough(),
  bindings: z.record(z.unknown()).default({}),
});

@Controller('applications/:applicationId/queries')
export class QueriesController {
  constructor(private readonly queries: QueriesService) {}

  @Post(':queryName/execute')
  @RequirePermissions(PERMISSIONS.QUERY_RUN)
  execute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId') applicationId: string,
    @Param('queryName') queryName: string,
    @Body(new ZodValidationPipe(executeSchema)) dto: z.infer<typeof executeSchema>,
  ) {
    return this.queries.execute({
      organizationId: user.organizationId,
      userId: user.id,
      permissions: user.permissions,
      applicationId,
      queryName,
      source: dto.source,
      environmentId: dto.environmentId,
      bindings: dto.bindings,
    });
  }

  /** The query editor's Run button, for a definition not yet saved to the DSL. */
  @Post('run')
  @RequirePermissions(PERMISSIONS.QUERY_RUN, PERMISSIONS.APP_EDIT)
  run(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(runDefinitionSchema)) dto: z.infer<typeof runDefinitionSchema>,
  ) {
    return this.queries.executeDraftDefinition({
      organizationId: user.organizationId,
      userId: user.id,
      permissions: user.permissions,
      datasourceId: dto.datasourceId,
      environmentId: dto.environmentId,
      definition: dto.definition as never,
      bindings: dto.bindings,
    });
  }
}
