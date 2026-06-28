export default () => ({
  appName: process.env.APP_NAME ?? 'online-exam-assessment-platform',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  swaggerEnabled: (process.env.SWAGGER_ENABLED ?? 'true') === 'true',
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'change_me_access_secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'change_me_refresh_secret',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
});
