/* global module */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverage: true,
  coverageDirectory: '<rootDir>/coverage/critical-unit',
  collectCoverageFrom: [
    '<rootDir>/src/modules/ai/ai-provider.gateway.ts',
    '<rootDir>/src/modules/exports/postgres-export-job-queue.ts',
    '<rootDir>/src/modules/uploads/upload-file.validator.ts',
    '<rootDir>/src/observability/metrics.service.ts',
    '<rootDir>/src/security/credential-cipher.service.ts',
    '<rootDir>/src/storage/local-object-storage.ts',
  ],
  coverageThreshold: {
    global: { statements: 80, branches: 70, functions: 70, lines: 80 },
    './src/observability/metrics.service.ts': { branches: 90 },
  },
};
