// Untracked helper for running this worktree's frontend next to the main
// dev stack: serves on 5199 and proxies /api to the dev backend so the
// backend's CORS allowlist (5173/3000) doesn't need changing.
import { mergeConfig } from 'vite';
import baseConfig from './vite.config';

export default mergeConfig(baseConfig, {
  server: {
    port: 5199,
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
});
