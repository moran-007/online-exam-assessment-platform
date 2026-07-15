function trustProxyValue() {
  const value = process.env.TRUST_PROXY ?? (process.env.NODE_ENV === 'production' ? '1' : 'loopback');
  return /^\d+$/.test(value) ? Number(value) : value;
}

export default () => ({
  appName: process.env.APP_NAME ?? 'online-exam-assessment-platform',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  swaggerEnabled:
    (process.env.SWAGGER_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
  trustProxy: trustProxyValue(),
  logLevel: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  logPretty: (process.env.LOG_PRETTY ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
  uploadsDir: process.env.UPLOADS_DIR ?? 'uploads',
  credentialEncryption: {
    activeVersion: Number(process.env.CREDENTIAL_ENCRYPTION_ACTIVE_VERSION ?? 1),
    keys: process.env.CREDENTIAL_ENCRYPTION_KEYS ?? '',
  },
  rateLimit: {
    ttlMs: Number(process.env.RATE_LIMIT_TTL_MS ?? 60_000),
    max: Number(process.env.RATE_LIMIT_MAX ?? 120),
    loginTtlMs: Number(process.env.LOGIN_RATE_LIMIT_TTL_MS ?? 600_000),
    loginMax: Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 5),
    refreshTtlMs: Number(process.env.REFRESH_RATE_LIMIT_TTL_MS ?? 600_000),
    refreshMax: Number(process.env.REFRESH_RATE_LIMIT_MAX ?? 30),
  },
  assets: {
    signingSecret: process.env.ASSET_URL_SECRET ?? process.env.JWT_ACCESS_SECRET ?? 'change_me_asset_secret',
    signedUrlExpiresIn: process.env.ASSET_URL_EXPIRES_IN ?? '5m',
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'change_me_access_secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'change_me_refresh_secret',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    sessionExpiresIn: process.env.JWT_SESSION_EXPIRES_IN ?? '8h',
    rememberExpiresIn: process.env.JWT_REMEMBER_EXPIRES_IN ?? process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
    idleExpiresIn: process.env.JWT_IDLE_EXPIRES_IN ?? '30m',
  },
});
