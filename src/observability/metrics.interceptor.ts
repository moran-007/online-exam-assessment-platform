import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

type HttpRequest = {
  method?: string;
  baseUrl?: string;
  route?: { path?: string };
};

type HttpResponse = { statusCode?: number };

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<HttpRequest>();
    const response = context.switchToHttp().getResponse<HttpResponse>();
    const startedAt = process.hrtime.bigint();
    let recorded = false;

    const record = (statusCode: number) => {
      if (recorded) return;
      recorded = true;
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
      const route = `${request.baseUrl ?? ''}${request.route?.path ?? 'unmatched'}` || 'unmatched';
      this.metrics.recordHttp(request.method ?? 'UNKNOWN', route, statusCode, durationSeconds);
    };

    return next.handle().pipe(
      tap({
        next: () => record(response.statusCode ?? 200),
        error: (error: unknown) => record(error instanceof HttpException ? error.getStatus() : 500),
      }),
    );
  }
}
