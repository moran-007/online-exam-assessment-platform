import { defineConfig } from 'orval';

export default defineConfig({
  platform: {
    input: './docs/openapi.json',
    output: {
      mode: 'tags-split',
      target: './frontend/src/api/generated/endpoints.ts',
      schemas: './frontend/src/api/generated/models',
      client: 'fetch',
      clean: true,
      override: {
        mutator: {
          path: './frontend/src/api/generated-mutator.ts',
          name: 'apiMutator',
        },
      },
    },
  },
});
