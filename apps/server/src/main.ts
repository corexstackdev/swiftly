import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { AppModule } from './app.module';
import { DomainExceptionFilter } from './common/filters/domain-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 16 * 1024 * 1024 }),
  );

  const config = app.get(ConfigService);
  const clientUrl = config.get<string>('CLIENT_URL', 'http://localhost:5173');

  await app.register(cookie, { secret: config.getOrThrow<string>('SESSION_SECRET') });
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

  const port = config.get<number>('PORT', 3001);
  await app.listen({ port, host: '0.0.0.0' });

  new Logger('Bootstrap').log(`Server listening on http://localhost:${port}/api`);
}

void bootstrap();
