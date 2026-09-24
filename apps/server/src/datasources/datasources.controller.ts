import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { DatasourcesService } from './datasources.service';
import { PluginRegistry } from '../plugins/plugin.registry';
import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '../common/decorators';
import { PERMISSIONS } from '../common/permissions';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

const createSchema = z.object({
  name: z.string().min(1).max(120),
  pluginId: z.string().min(1),
  workspaceId: z.string().uuid().optional(),
  readOnly: z.boolean().optional(),
  environmentId: z.string().uuid(),
  config: z.record(z.unknown()),
});

const updateConfigSchema = z.object({
  environmentId: z.string().uuid(),
  config: z.record(z.unknown()),
});

@Controller('datasources')
export class DatasourcesController {
  constructor(
    private readonly datasources: DatasourcesService,
    private readonly registry: PluginRegistry,
  ) {}

  /** Catalogue for the "new datasource" picker. */
  @Get('plugins')
  @RequirePermissions(PERMISSIONS.DATASOURCE_VIEW)
  listPlugins() {
    return this.registry.list();
  }

  @Get()
  @RequirePermissions(PERMISSIONS.DATASOURCE_VIEW)
  list(@CurrentUser() user: AuthenticatedUser, @Query('workspaceId') workspaceId?: string) {
    return this.datasources.list(user.organizationId, workspaceId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.DATASOURCE_CREATE)
  create(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(createSchema)) dto: z.infer<typeof createSchema>) {
    return this.datasources.create(user.organizationId, user.id, dto);
  }

  @Put(':id/config')
  @RequirePermissions(PERMISSIONS.DATASOURCE_EDIT)
  updateConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateConfigSchema)) dto: z.infer<typeof updateConfigSchema>,
  ) {
    return this.datasources.updateConfig(
      user.organizationId,
      user.id,
      id,
      dto.environmentId,
      dto.config,
    );
  }

  @Post(':id/test')
  @RequirePermissions(PERMISSIONS.DATASOURCE_VIEW)
  test(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body('environmentId') environmentId: string,
  ) {
    return this.datasources.test(user.organizationId, id, environmentId);
  }

  /** Powers SQL autocomplete and the stored-procedure picker. */
  @Get(':id/schema')
  @RequirePermissions(PERMISSIONS.DATASOURCE_VIEW)
  schema(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('environmentId') environmentId: string,
    @Query('refresh') refresh?: string,
  ) {
    return this.datasources.introspect(
      user.organizationId,
      id,
      environmentId,
      refresh === 'true',
    );
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.DATASOURCE_DELETE)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.datasources.remove(user.organizationId, user.id, id);
  }
}
