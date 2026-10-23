import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * Environment validation. The process refuses to start on a bad config rather
 * than failing later at the first query — a misconfigured encryption key must
 * never be discovered after credentials have been written with it.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

  /** 32 bytes hex for AES-256-GCM. Generate with `openssl rand -hex 32`. */
  ENCRYPTION_KEY: z
    .string()
    .min(32, 'ENCRYPTION_KEY must be at least 32 characters')
    .transform((value) =>
      /^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : createHash('sha256').update(value).digest('hex'),
    ),

  CLIENT_URL: z.string().url().default('http://localhost:5173'),

  QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  QUERY_MAX_ROWS: z.coerce.number().int().positive().default(10_000),

  REGION: z.string().default('default'),

  /** Seconds. Short-lived; the refresh token carries the session. */
  ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL: z.coerce.number().int().positive().default(2_592_000),
});

export type AppConfig = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): AppConfig {
  const parsed = envSchema.safeParse({
    ...raw,
    CLIENT_URL:
      typeof raw.CLIENT_URL === 'string' && raw.CLIENT_URL.trim() !== ''
        ? raw.CLIENT_URL
        : publicOrigin(raw),
  });
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}

function publicOrigin(raw: Record<string, unknown>): string {
  const renderUrl = raw.RENDER_EXTERNAL_URL;
  if (typeof renderUrl === 'string' && renderUrl.length > 0) return renderUrl.replace(/\/$/, '');
  return 'http://localhost:5173';
}
