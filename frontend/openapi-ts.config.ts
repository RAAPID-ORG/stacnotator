import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: 'http://localhost:8000/api/openapi.json',
  output: 'app/api/client',
    plugins: [
        {
        name: '@hey-api/client-fetch',
        runtimeConfigPath: 'app/api/hey-api.ts', 
        },
    ],
});