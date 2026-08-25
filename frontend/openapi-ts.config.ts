import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: process.env.OPENAPI_INPUT ?? 'http://localhost:8000/api/openapi.json',
  output: 'src/api/client',
  plugins: [
    {
      name: '@hey-api/client-fetch',
      runtimeConfigPath: 'src/api/hey-api.ts',
    },
    '@tanstack/react-query',
  ],
});
