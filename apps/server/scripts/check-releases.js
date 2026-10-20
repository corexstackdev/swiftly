process.loadEnvFile('.env');
const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const tables = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('application_releases', '_prisma_migrations')",
  );
  console.log('tables', tables.rows);
  const migrations = await client.query(
    'SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at',
  );
  console.log('migrations', migrations.rows);
  const envs = await client.query(
    'SELECT name, "isDefault", "isProduction" FROM environments ORDER BY name',
  );
  console.log('environments', envs.rows);
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
