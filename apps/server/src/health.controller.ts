import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';
import { Public } from './common/decorators';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get()
  async check() {
    const [database, cache] = await Promise.all([
      this.prisma
        .$queryRaw`SELECT 1`.then(() => 'up' as const)
        .catch(() => 'down' as const),
      this.redis.client
        .ping()
        .then(() => 'up' as const)
        .catch(() => 'down' as const),
    ]);

    return {
      status: database === 'up' && cache === 'up' ? 'ok' : 'degraded',
      region: this.config.get<string>('REGION'),
      checks: { database, cache },
      timestamp: new Date().toISOString(),
    };
  }
}
