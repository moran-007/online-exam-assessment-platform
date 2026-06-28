import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

const statusCodeMap = new Map<number, number>([
  [HttpStatus.BAD_REQUEST, 40000],
  [HttpStatus.FORBIDDEN, 40001],
  [HttpStatus.UNAUTHORIZED, 40002],
  [HttpStatus.NOT_FOUND, 40004],
  [HttpStatus.CONFLICT, 40005],
]);

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const body = exception instanceof HttpException ? exception.getResponse() : undefined;
    const explicitCode = this.getExplicitCode(body);

    response.status(status).json({
      code: explicitCode ?? statusCodeMap.get(status) ?? 50000,
      message: this.getMessage(body, exception),
      data: null,
    });
  }

  private getExplicitCode(body: unknown): number | undefined {
    if (body && typeof body === 'object' && 'code' in body) {
      const value = (body as { code?: unknown }).code;
      return typeof value === 'number' ? value : undefined;
    }

    return undefined;
  }

  private getMessage(body: unknown, exception: unknown): string {
    if (body && typeof body === 'object' && 'message' in body) {
      const message = (body as { message?: unknown }).message;
      return Array.isArray(message) ? message.join('; ') : String(message);
    }

    if (typeof body === 'string') {
      return body;
    }

    if (exception instanceof Error) {
      return exception.message || '系统错误';
    }

    return '系统错误';
  }
}
