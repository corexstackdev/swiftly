import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';

import { validateEnv } from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { AuditModule } from './audit/audit.module';
import { PluginsModule } from './plugins/plugins.module';
import { AuthModule } from './auth/auth.module';
import { ApplicationsModule } from './applications/applications.module';
import { DatasourcesModule } from './datasources/datasources.module';
import { QueriesModule } from './queries/queries.module';
import { PublishModule } from './publish/publish.module';
import { WorkspacesController } from './workspaces/workspaces.controller';
import { RuntimeController } from './runtime/runtime.controller';
import { HealthController } from './health.controller';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    RedisModule,
    CryptoModule,
    AuditModule,
    PluginsModule,
    AuthModule,
    ApplicationsModule,
    DatasourcesModule,
    QueriesModule,
    PublishModule,
  ],
  controllers: [HealthController, WorkspacesController, RuntimeController],
  providers: [
    // Authentication is on by default; routes opt out with @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
