import { Injectable, NotFoundException } from '@nestjs/common';
import type { DatasourcePlugin } from '@swiftly/shared';
import { PostgresPlugin } from './postgres/postgres.plugin';
import { MysqlPlugin } from './mysql/mysql.plugin';
import { RestPlugin } from './rest/rest.plugin';

/**
 * Plugin lookup. Adding an integration means writing the plugin and listing it in
 * the constructor — nothing else in the codebase changes, which is the extensibility
 * property the architecture commits to.
 */
@Injectable()
export class PluginRegistry {
  private readonly plugins = new Map<string, DatasourcePlugin<never, never>>();

  constructor(postgres: PostgresPlugin, mysql: MysqlPlugin, rest: RestPlugin) {
    for (const plugin of [postgres, mysql, rest]) {
      this.plugins.set(plugin.id, plugin as unknown as DatasourcePlugin<never, never>);
    }
  }

  get(pluginId: string): DatasourcePlugin<never, never> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new NotFoundException(`Unknown datasource plugin: ${pluginId}`);
    return plugin;
  }

  /**
   * Catalogue for the "new datasource" picker. `configFields` drives the generated
   * connection form on the client, so adding a plugin adds its form with it.
   */
  list() {
    return [...this.plugins.values()].map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      category: plugin.category,
      capabilities: plugin.capabilities,
      secretFields: plugin.secretFields,
      configFields: plugin.configFields,
    }));
  }
}
