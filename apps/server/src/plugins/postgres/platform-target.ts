/**
 * The PostgreSQL connector is for tenant databases only. The URL Swiftly itself
 * uses (`DATABASE_URL`) must never be offered as a queryable datasource.
 */

export const PLATFORM_POSTGRES_BLOCKED_MESSAGE =
  'The PostgreSQL connector cannot use this database. Connect it to a different PostgreSQL database.';

export interface PostgresTarget {
  host: string;
  port: number;
  database: string;
}

export function parsePostgresUrl(url: string): PostgresTarget | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname || !parsed.pathname) return null;
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, '')).split('/')[0] ?? '';
    if (!database) return null;
    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 5432,
      database,
    };
  } catch {
    return null;
  }
}

export function samePostgresTarget(left: PostgresTarget, right: PostgresTarget): boolean {
  return (
    normalizeHost(left.host) === normalizeHost(right.host) &&
    Number(left.port) === Number(right.port) &&
    left.database.toLowerCase() === right.database.toLowerCase()
  );
}

export function isPlatformPostgresTarget(
  config: { host: string; port: number; database: string; replicaHost?: string },
  databaseUrl: string,
): boolean {
  const platform = parsePostgresUrl(databaseUrl);
  if (!platform) return false;

  const primary: PostgresTarget = {
    host: config.host,
    port: config.port,
    database: config.database,
  };
  if (samePostgresTarget(primary, platform)) return true;

  if (config.replicaHost) {
    return samePostgresTarget({ ...primary, host: config.replicaHost }, platform);
  }
  return false;
}

function normalizeHost(host: string): string {
  const value = host.trim().toLowerCase();
  if (value === '127.0.0.1' || value === '::1' || value === '0.0.0.0' || value === '[::1]') {
    return 'localhost';
  }
  return value;
}
