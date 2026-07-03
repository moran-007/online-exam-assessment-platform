export function validateEnv(config: Record<string, unknown>) {
  const nodeEnv = String(config.NODE_ENV ?? 'development');
  const accessSecret = String(config.JWT_ACCESS_SECRET ?? '');
  const refreshSecret = String(config.JWT_REFRESH_SECRET ?? '');

  if (nodeEnv === 'production') {
    if (!config.DATABASE_URL) {
      throw new Error('DATABASE_URL is required in production.');
    }

    if (
      accessSecret.length < 32 ||
      refreshSecret.length < 32 ||
      accessSecret === 'change_me_access_secret' ||
      refreshSecret === 'change_me_refresh_secret'
    ) {
      throw new Error('JWT secrets must be changed and at least 32 characters in production.');
    }

    const assetSecret = String(config.ASSET_URL_SECRET ?? '');
    if (assetSecret.length < 32 || assetSecret === accessSecret || assetSecret === refreshSecret) {
      throw new Error('ASSET_URL_SECRET must be unique and at least 32 characters in production.');
    }

    const corsOrigins = String(config.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    if (!corsOrigins.length || corsOrigins.some((origin) => origin === '*' || /localhost|127\.0\.0\.1/i.test(origin))) {
      throw new Error('CORS_ORIGINS must contain explicit production origins and cannot use wildcard or localhost.');
    }
    for (const origin of corsOrigins) {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
        throw new Error(`Invalid CORS origin: ${origin}`);
      }
    }
  }

  return config;
}
