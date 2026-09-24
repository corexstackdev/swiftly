import { Global, Module } from '@nestjs/common';
import { PluginRegistry } from './plugin.registry';
import { PostgresPlugin } from './postgres/postgres.plugin';
import { MysqlPlugin } from './mysql/mysql.plugin';
import { RestPlugin } from './rest/rest.plugin';

@Global()
@Module({
  providers: [PostgresPlugin, MysqlPlugin, RestPlugin, PluginRegistry],
  exports: [PluginRegistry],
})
export class PluginsModule {}
