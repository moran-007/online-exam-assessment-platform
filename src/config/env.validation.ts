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

    const activeCredentialKeyVersion = Number(config.CREDENTIAL_ENCRYPTION_ACTIVE_VERSION ?? 1);
    let credentialKeys: unknown;
    try {
      credentialKeys = JSON.parse(String(config.CREDENTIAL_ENCRYPTION_KEYS ?? ''));
    } catch {
      throw new Error('CREDENTIAL_ENCRYPTION_KEYS must be a JSON object in production.');
    }
    if (
      !Number.isInteger(activeCredentialKeyVersion) ||
      activeCredentialKeyVersion <= 0 ||
      !credentialKeys ||
      typeof credentialKeys !== 'object' ||
      Array.isArray(credentialKeys)
    ) {
      throw new Error('A valid active credential encryption key version is required in production.');
    }
    const encodedKey = (credentialKeys as Record<string, unknown>)[String(activeCredentialKeyVersion)];
    if (typeof encodedKey !== 'string' || Buffer.from(encodedKey, 'base64').length !== 32) {
      throw new Error('The active credential encryption key must be a base64-encoded 32-byte value.');
    }

    if (config.SCRATCH_RUNTIME_BASE_URL) {
      const runtimeUrl = new URL(String(config.SCRATCH_RUNTIME_BASE_URL));
      if (runtimeUrl.protocol !== 'https:') throw new Error('SCRATCH_RUNTIME_BASE_URL must use HTTPS in production.');
      if (String(config.SCRATCH_RUNTIME_API_TOKEN ?? '').length < 24) {
        throw new Error('SCRATCH_RUNTIME_API_TOKEN must be at least 24 characters when Scratch runtime is enabled.');
      }
      if (String(config.SCRATCH_CALLBACK_SECRET ?? '').length < 32) {
        throw new Error('SCRATCH_CALLBACK_SECRET must be at least 32 characters when Scratch runtime is enabled.');
      }
    }
  }

  return config;
}
