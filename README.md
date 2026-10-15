# Swiftly

Build business apps without code. Swiftly is an enterprise low-code platform where
users visually build applications, connect to databases, configure APIs, test them in
preview, and submit them for IT-gated publication.

Built on React and Node.js. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the
design, the stack decisions and what is and is not implemented yet.

## Getting started

Requires Node 22+, pnpm 10+, PostgreSQL, and Redis. The bundled Redis listens on
`localhost:6409`:

```bash
docker compose up -d redis
```

The platform's own store is PostgreSQL. Create a local database named `swiftlydb`
and point `DATABASE_URL` at it (see `.env.example`). Docker Postgres is optional
if you already run PostgreSQL locally.

```bash
pnpm install
```

Optional: a sample database to point datasources at while developing. Any Postgres or
MySQL you already have will do; this is one way to get one:

```bash
docker compose up -d sample-db
```

Create your `.env` from the template and generate the two secrets it needs:

```bash
cp .env.example .env && cp .env.example apps/server/.env
```

`SESSION_SECRET` needs at least 32 characters and `ENCRYPTION_KEY` exactly 64 hex
characters — the server refuses to start otherwise, rather than discovering a bad key
after credentials have been written with it:

```bash
node -e "const c=require('crypto');console.log('SESSION_SECRET='+c.randomBytes(48).toString('hex'));console.log('ENCRYPTION_KEY='+c.randomBytes(32).toString('hex'))"
```

Create the schema and seed an organization with three accounts:

```bash
pnpm --filter @swiftly/server db:migrate && pnpm --filter @swiftly/server db:seed
```

Run both apps:

```bash
pnpm dev
```

The editor is at http://localhost:5173 and the API at http://localhost:3001/api.

### Seeded accounts

All use the password `Password123!`. They demonstrate the separation of duties the
publish workflow depends on:

| Account | Role | Can |
|---|---|---|
| `admin@acme.test` | Org Admin | everything |
| `builder@acme.test` | App Builder | build and submit, **not** publish |
| `reviewer@acme.test` | IT Reviewer | review and publish, **not** edit |

## Layout

```
apps/
  server/          NestJS API — auth, tenancy, datasource plugins, query execution, publishing
    prisma/        Data model and seed
    src/plugins/   One folder per integration; add one and nothing else changes
  client/          React editor and published-app runtime
    src/evaluation/  Binding parser, dependency graph, evaluation worker
    src/widgets/     Widget registry — built-ins and custom components use one contract
    src/editor/      Canvas, palette, property panel, query editor
    src/runtime/     Renderer shared by design, preview and published modes
packages/
  shared/          The DSL, plugin and widget contracts both sides compile against
docs/
  ARCHITECTURE.md
```

## Ports

Redis uses a non-default port so it does not collide with anything already running
on the machine. The platform database is your local PostgreSQL (`swiftlydb` on 5432).

| Service | Port |
|---|---|
| Client | 5173 |
| API | 3001 |
| PostgreSQL (platform, `swiftlydb`) | 5432 |
| Redis | 6409 |
| Postgres (sample data, optional Docker) | 5453 |

## Two things worth knowing before changing anything

**Query text always comes from the server's stored DSL, never from the request.** The
client sends evaluated binding *values* only. It cannot supply SQL, a datasource id, or
a target host. See `apps/server/src/queries/queries.service.ts`.

**Bindings are never interpolated into SQL.** The statement is scanned, each `{{ }}` is
replaced with the dialect's parameter placeholder, and values are passed to the driver
as bound parameters. A binding landing where a table or column name goes is rejected
unless the query declares an allowlist. See `apps/server/src/plugins/sql-binding.ts`.
