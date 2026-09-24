import { PrismaClient } from '@prisma/client';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

// The Prisma CLI loads .env itself; running this through tsx does not, so load it
// here before the client reads DATABASE_URL.
if (!process.env.DATABASE_URL && existsSync('.env')) process.loadEnvFile('.env');
import { SYSTEM_ROLES } from '../src/common/permissions';
import { emptyDsl } from '../src/applications/applications.service';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const prisma = new PrismaClient();

/** Mirrors CryptoService.hashPassword; the seed runs outside the Nest container. */
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$16384$8$1$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function main(): Promise<void> {
  const organization = await prisma.organization.upsert({
    where: { slug: 'acme' },
    update: {},
    create: {
      name: 'Acme Corporation',
      slug: 'acme',
      region: process.env.REGION ?? 'default',
      settings: {},
    },
  });

  // Environments: datasource credentials and publish targets are scoped to these.
  const environments = await Promise.all(
    [
      { name: 'dev', isDefault: true, isProduction: false },
      { name: 'staging', isDefault: false, isProduction: false },
      { name: 'prod', isDefault: false, isProduction: true },
    ].map((env) =>
      prisma.environment.upsert({
        where: { organizationId_name: { organizationId: organization.id, name: env.name } },
        update: {},
        create: { ...env, organizationId: organization.id },
      }),
    ),
  );

  const roles: Record<string, string> = {};
  for (const [name, definition] of Object.entries(SYSTEM_ROLES)) {
    const role = await prisma.role.upsert({
      where: { organizationId_name: { organizationId: organization.id, name } },
      update: { permissions: definition.permissions },
      create: {
        organizationId: organization.id,
        name,
        description: definition.description,
        isSystem: true,
        permissions: definition.permissions,
      },
    });
    roles[name] = role.id;
  }

  // Three accounts that demonstrate the separation of duties: the builder cannot
  // publish, and the reviewer cannot edit.
  const accounts = [
    { email: 'admin@acme.test', name: 'Avery Admin', role: 'Org Admin' },
    { email: 'builder@acme.test', name: 'Blake Builder', role: 'App Builder' },
    { email: 'reviewer@acme.test', name: 'Robin Reviewer', role: 'IT Reviewer' },
  ];

  const users: Record<string, string> = {};
  for (const account of accounts) {
    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: {},
      create: {
        email: account.email,
        name: account.name,
        passwordHash: await hashPassword('Password123!'),
      },
    });
    users[account.email] = user.id;

    await prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
      update: { roleId: roles[account.role]! },
      create: {
        organizationId: organization.id,
        userId: user.id,
        roleId: roles[account.role]!,
      },
    });
  }

  const workspace = await prisma.workspace.upsert({
    where: { organizationId_slug: { organizationId: organization.id, slug: 'operations' } },
    update: {},
    create: { organizationId: organization.id, name: 'Operations', slug: 'operations' },
  });

  const existingApp = await prisma.application.findUnique({
    where: { workspaceId_slug: { workspaceId: workspace.id, slug: 'order-console' } },
  });
  if (!existingApp) {
    await prisma.application.create({
      data: {
        workspaceId: workspace.id,
        name: 'Order Console',
        slug: 'order-console',
        description: 'Starter application',
        createdById: users['builder@acme.test']!,
        draftDsl: emptyDsl('Order Console') as unknown as object,
      },
    });
  }

  console.log('Seed complete');
  console.log(`  Organization : ${organization.name} (${organization.slug})`);
  console.log(`  Environments : ${environments.map((e) => e.name).join(', ')}`);
  console.log('  Accounts     : all use the password "Password123!"');
  for (const account of accounts) {
    console.log(`    ${account.email.padEnd(22)} ${account.role}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
