import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { AppModule } from './app.module';
import { DomainExceptionFilter } from './common/filters/domain-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 16 * 1024 * 1024, trustProxy: true }),
  );

  const config = app.get(ConfigService);
  const clientUrl = config.get<string>('CLIENT_URL', 'http://localhost:5173');

  // Tokens are JWTs, already signed with SESSION_SECRET. Passing that secret
  // here would make @fastify/cookie try to unsign them as its own HMAC cookies.
  await app.register(cookie);
  await app.register(helmet, {
    // Published apps render tenant-authored content; the runtime sets its own CSP
    // per response, so the global default stays off here.
    contentSecurityPolicy: false,
  });
  await app.register(cors, {
    origin: [clientUrl],
    credentials: true,
  });

  app.setGlobalPrefix('api');
  // No global ValidationPipe: request bodies are validated with ZodValidationPipe
  // per route, using the same Zod schemas datasource plugins already declare.
  app.useGlobalFilters(new DomainExceptionFilter());
  app.enableShutdownHooks();

  await serveClient(app);

  const port = config.get<number>('PORT', 3001);
  await app.listen({ port, host: '0.0.0.0' });

  new Logger('Bootstrap').log(`Server listening on http://localhost:${port}/api`);
}

/** In production the editor is the same origin as `/api`, so auth cookies stay first-party. */
async function serveClient(app: NestFastifyApplication): Promise<void> {
  const clientDist = join(__dirname, '..', '..', 'client', 'dist');
  if (!existsSync(join(clientDist, 'index.html'))) return;

  // Nest's listen() always installs a 404 handler, so we cannot call
  // setNotFoundHandler here. Static files get exact routes; SPA paths use GET /*.
  await app.register(fastifyStatic, {
    root: clientDist,
    prefix: '/',
    wildcard: false,
    index: false,
    decorateReply: true,
  });

  const fastify = app.getHttpAdapter().getInstance();
  const sendIndex = (
    _request: unknown,
    reply: { sendFile: (file: string) => unknown },
  ) => reply.sendFile('index.html');

  fastify.get('/', sendIndex);
  fastify.get('/*', (request, reply) => {
    const url = request.raw.url ?? '';
    if (url.startsWith('/api')) {
      return reply.status(404).send({ statusCode: 404, message: 'Not Found' });
    }
    return reply.sendFile('index.html');
  });
}

void bootstrap();
