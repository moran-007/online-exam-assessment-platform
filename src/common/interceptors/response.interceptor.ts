import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { map, Observable } from 'rxjs';

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, T | ApiResponse<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<T | ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        if (data instanceof StreamableFile) {
          return data;
        }

        if (data && typeof data === 'object' && 'code' in data && 'message' in data) {
          return data as unknown as ApiResponse<T>;
        }

        return {
          code: 0,
          message: 'ok',
          data,
        };
      }),
    );
  }
}
