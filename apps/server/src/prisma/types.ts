import type { Environment, PrismaClient } from '@prisma/client';

/**
 * Interactive-transaction client. Named so callback params stay typed when
 * Prisma's `$transaction` generic does not infer (TS7006 under noImplicitAny).
 */
export type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;

export type EnvRecord = Pick<Environment, 'id' | 'name' | 'isProduction' | 'isDefault'>;

export type ReleaseWithEnvironment = {
  environmentId: string;
  publishedAt: Date;
  environment: { name: string; isProduction: boolean };
  version: { versionNumber: number };
};
