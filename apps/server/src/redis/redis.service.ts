import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { createHash } from 'node:crypto';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;
  private warnedOffline = false;

  constructor(config: ConfigService) {
    const url = config.getOrThrow<string>('REDIS_URL');
    this.client = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
      // ioredis otherwise retries forever and emits `error` on every attempt,
      // which filled the terminal when the local container was stopped.
      retryStrategy: (times) => Math.min(times * 200, 5_000),
    });
    this.client.on('error', (error) => {
      if (this.warnedOffline) return;
      this.warnedOffline = true;
      const detail = error.message || (error as NodeJS.ErrnoException).code || 'connection failed';
      this.logger.warn(
        `Redis is unreachable (${detail}). Query cache is disabled until it comes back. Start it with: docker compose up -d redis`,
      );
    });
    this.client.on('ready', () => {
      if (this.warnedOffline) {
        this.logger.log('Redis connected');
      }
      this.warnedOffline = false;
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }

  /**
   * Cache reads are best-effort: a Redis outage degrades performance but must never
   * fail a query, so every path here swallows errors and falls through to the source.
   */
  async getJson<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      /* cache write failures are not errors */
    }
  }

  async invalidatePrefix(prefix: string): Promise<void> {
    try {
      const stream = this.client.scanStream({ match: `${prefix}*`, count: 200 });
      for await (const keys of stream) {
        if ((keys as string[]).length > 0) await this.client.del(...(keys as string[]));
      }
    } catch {
      /* ignore */
    }
  }

  /** Cache key for a query result: identity plus a hash of the bound values. */
  static queryCacheKey(
    applicationId: string,
    queryName: string,
    environmentId: string,
    values: unknown[],
  ): string {
    const digest = createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 32);
    return `qc:${applicationId}:${queryName}:${environmentId}:${digest}`;
  }
}
