import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { SqlBindingError } from '../../plugins/sql-binding';
import { SsrfBlockedError } from '../../plugins/rest/ssrf-guard';

/**
 * Maps domain errors onto HTTP responses.
 *
 * A binding or SSRF rejection is a message to the person building the app — it says
 * exactly what to change. Letting those surface as a generic 500 would throw away
 * the only useful part, so they are translated to 400 with their text intact.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      void reply.status(exception.getStatus()).send(
        typeof response === 'string'
          ? { statusCode: exception.getStatus(), message: response }
          : response,
      );
      return;
    }

    if (exception instanceof SqlBindingError) {
      void reply.status(HttpStatus.BAD_REQUEST).send({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Invalid query binding',
        message: exception.message,
      });
      return;
    }

    if (exception instanceof SsrfBlockedError) {
      void reply.status(HttpStatus.BAD_REQUEST).send({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Blocked request',
        message: exception.message,
      });
      return;
    }

    // Anything reaching here is a genuine bug: log it with the stack, and tell the
    // caller nothing beyond the fact that it failed.
    this.logger.error(
      exception instanceof Error ? exception.stack ?? exception.message : String(exception),
    );
    void reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}
