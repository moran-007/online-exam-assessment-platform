import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerRequest,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { RATE_LIMIT_PROFILE, RateLimitProfile } from '../decorators/rate-limit-profile.decorator';

@Injectable()
export class ConfiguredThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    private readonly config: ConfigService,
  ) {
    super(options, storage, reflector);
  }

  protected handleRequest(request: ThrottlerRequest) {
    const profile = this.reflector.getAllAndOverride<RateLimitProfile | undefined>(RATE_LIMIT_PROFILE, [
      request.context.getHandler(),
      request.context.getClass(),
    ]);
    if (!profile) return super.handleRequest(request);

    const prefix = profile === 'login' ? 'login' : 'refresh';
    const limit = this.config.get<number>(`rateLimit.${prefix}Max`) ?? (profile === 'login' ? 5 : 30);
    const ttl = this.config.get<number>(`rateLimit.${prefix}TtlMs`) ?? 600_000;
    return super.handleRequest({ ...request, limit, ttl, blockDuration: ttl });
  }
}
