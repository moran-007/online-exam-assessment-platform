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
  }

  return config;
}
