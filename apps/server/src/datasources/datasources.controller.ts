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

const testConnectionSchema = z.object({
  pluginId: z.string().min(1),
  config: z.record(z.unknown()),
});

const ident = z.string().min(1).max(63).regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

const columnSpecSchema = z.object({
  name: ident,
  dataType: z.string().min(1).max(80),
  nullable: z.boolean().optional(),
  primaryKey: z.boolean().optional(),
  unique: z.boolean().optional(),
  identity: z.boolean().optional(),
  defaultKind: z.enum(['none', 'null', 'now', 'uuid', 'literal']).optional(),
  defaultValue: z.string().max(500).optional(),
});

const envSchema = z.object({ environmentId: z.string().uuid() });

const createNsSchema = envSchema.extend({ name: ident });
const dropNsSchema = envSchema.extend({ name: ident, cascade: z.boolean().optional() });
const createTableSchema = envSchema.extend({
  schema: ident,
  name: ident,
  columns: z.array(columnSpecSchema).min(1).max(80),
});
const tableRefSchema = envSchema.extend({ schema: ident, table: ident });
const renameTableSchema = tableRefSchema.extend({ newName: ident });
const addColumnSchema = tableRefSchema.extend({ column: columnSpecSchema });
const alterColumnSchema = tableRefSchema.extend({
  name: ident,
  patch: z.object({
    dataType: z.string().min(1).max(80).optional(),
    nullable: z.boolean().optional(),
    defaultKind: z.enum(['none', 'null', 'now', 'uuid', 'literal']).optional(),
    defaultValue: z.string().max(500).optional(),
  }),
});
const dropColumnSchema = tableRefSchema.extend({ name: ident });
const renameColumnSchema = tableRefSchema.extend({ name: ident, newName: ident });
const insertRowSchema = tableRefSchema.extend({ values: z.record(z.unknown()) });
const updateRowSchema = tableRefSchema.extend({
  key: z.record(z.unknown()),
  values: z.record(z.unknown()),
});
const deleteRowsSchema = tableRefSchema.extend({
  keys: z.array(z.record(z.unknown())).min(1).max(100),
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

  /** Test host/user/password before a datasource exists. Declared before `:id` routes. */
  @Post('test-connection')
  @RequirePermissions(PERMISSIONS.DATASOURCE_CREATE)
  testConnection(
    @Body(new ZodValidationPipe(testConnectionSchema)) dto: z.infer<typeof testConnectionSchema>,
  ) {
    return this.datasources.testDraft(dto.pluginId, dto.config);
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

  @Post(':id/manage/schemas')
  @RequirePermissions(PERMISSIONS.DATASOURCE_EDIT)
  createSchema(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createNsSchema)) dto: z.infer<typeof createNsSchema>,
  ) {
    return this.datasources.createSchema(user.organizationId, user.id, id, dto.environmentId, dto.name);
  }

  @Post(':id/manage/schemas/drop')
  @RequirePermissions(PERMISSIONS.DATASOURCE_EDIT)
  dropSchema(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(dropNsSchema)) dto: z.infer<typeof dropNsSchema>,
  ) {
    return this.datasources.dropSchema(
      user.organizationId,
      user.id,
      id,
      dto.environmentId,
      dto.name,
      dto.cascade,
    );
  }

  @Post(':id/manage/tables')
  @RequirePermissions(PERMISSIONS.DATASOURCE_EDIT)
  createTable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createTableSchema)) dto: z.infer<typeof createTableSchema>,
  ) {
    return this.datasources.createTable(user.organizationId, user.id, id, dto.environmentId, {
      schema: dto.schema,
      name: dto.name,
      columns: dto.columns,
    });
  }

  @Post(':id/manage/tables/drop')
  @RequirePermissions(PERMISSIONS.DATASOURCE_EDIT)
  dropTable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(tableRefSchema)) dto: z.infer<typeof tableRefSchema>,
  ) {
    return this.datasources.dropTable(
      user.organizationId,
      user.id,
      id,
      dto.environmentId,
      dto.schema,
      dto.table,
    );
  }

  @Post(':id/manage/tables/rename')
  @RequirePermissions(PERMISSIONS.DATASOURCE_EDIT)
  renameTable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(renameTableSchema)) dto: z.infer<typeof renameTableSchema>,
  ) {
    return this.datasources.renameTable(
      user.organizationId,
      user.id,
      id,
      dto.environmentId,
      dto.schema,
      dto.table,
      dto.newName,
    );
  }

  @Post(':id/manage/columns')
  @RequirePermissions(PERMISSIONS.DATASOURCE_EDIT)
  addColumn(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addColumnSchema)) dto: z.infer<typeof addColumnSchema>,
  ) {
    return this.datasources.addColumn(
      user.organizationId,
      user.id,
      id,
      dto.environmentId,
      dto.schema,
      dto.table,
      dto.column,
    );
  }

  @Post(':id/manage/columns/alter')
  @RequirePermissions(PERMISSIONS.DATASOURCE_EDIT)
  alterColumn(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(alterColumnSchema)) dto: z.infer<typeof alterColumnSchema>,
  ) {
    return this.datasources.alterColumn(
      user.organizationId,
      user.id,
      id,
      dto.environmentId,
      dto.schema,
      dto.table,
      dto.name,
      dto.patch,
    );
  }

  @Post(':id/manage/columns/drop')
  @RequirePermissions(PERMISSIONS.DATASOURCE_EDIT)
  dropColumn(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(dropColumnSchema)) dto: z.infer<typeof dropColumnSchema>,
  ) {
    return this.datasources.dropColumn(
      user.organizationId,
      user.id,
      id,
      dto.environmentId,
      dto.schema,
      dto.table,
      dto.name,
    );
  }

  @Post(':id/manage/columns/rename')
  @RequirePermissions(PERMISSIONS.DATASOURCE_EDIT)
  renameColumn(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(renameColumnSchema)) dto: z.infer<typeof renameColumnSchema>,
  ) {
    return this.datasources.renameColumn(
      user.organizationId,
      user.id,
      id,
      dto.environmentId,
      dto.schema,
      dto.table,
      dto.name,
      dto.newName,
    );
  }

  @Get(':id/manage/rows')
  @RequirePermissions(PERMISSIONS.DATASOURCE_VIEW)
  listRows(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('environmentId') environmentId: string,
    @Query('schema') schema: string,
    @Query('table') table: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.datasources.listRows(
      user.organizationId,
      id,
      environmentId,
      schema,
      table,
      Number(limit ?? 50),
      Number(offset ?? 0),
    );
  }

  @Post(':id/manage/rows')
  @RequirePermissions(PERMISSIONS.DATASOURCE_EDIT)
  insertRow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(insertRowSchema)) dto: z.infer<typeof insertRowSchema>,
  ) {
    return this.datasources.insertRow(
      user.organizationId,
      user.id,
      id,
      dto.environmentId,
      dto.schema,
      dto.table,
      dto.values,
    );
  }

  @Post(':id/manage/rows/update')
  @RequirePermissions(PERMISSIONS.DATASOURCE_EDIT)
  updateRow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRowSchema)) dto: z.infer<typeof updateRowSchema>,
  ) {
    return this.datasources.updateRow(
      user.organizationId,
      user.id,
      id,
      dto.environmentId,
      dto.schema,
      dto.table,
      dto.key,
      dto.values,
    );
  }

  @Post(':id/manage/rows/delete')
  @RequirePermissions(PERMISSIONS.DATASOURCE_EDIT)
  deleteRows(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(deleteRowsSchema)) dto: z.infer<typeof deleteRowsSchema>,
  ) {
    return this.datasources.deleteRows(
      user.organizationId,
      user.id,
      id,
      dto.environmentId,
      dto.schema,
      dto.table,
      dto.keys,
    );
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.DATASOURCE_DELETE)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.datasources.remove(user.organizationId, user.id, id);
  }
}
