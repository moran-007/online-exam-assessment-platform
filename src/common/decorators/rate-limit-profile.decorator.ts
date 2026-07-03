import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_PROFILE = 'app:rate-limit-profile';
export type RateLimitProfile = 'login' | 'refresh';

export const UseRateLimitProfile = (profile: RateLimitProfile) => SetMetadata(RATE_LIMIT_PROFILE, profile);
