import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  // Global ignores
  { ignores: ['dist/', 'build/', '.react-router/', 'src/api/client/'] },

  // Base JS rules
  js.configs.recommended,

  // TypeScript rules
  ...tseslint.configs.recommended,

  // React hooks
  {
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },

  // React refresh (Vite HMR)
  {
    plugins: { 'react-refresh': reactRefresh },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Project-specific rules
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'error',
    },
  },

  // errorHandler is the single approved console.error site; everywhere else
  // must route through handleError so logs share one shape.
  {
    files: ['src/shared/utils/errorHandler.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // Files that export both components and hooks/utilities (standard React patterns)
  {
    files: ['src/app/providers/AuthProvider.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },

  // The annotation feature is layered: core (pure logic) -> stores -> panels,
  // over an engine that knows maps and canvases but nothing about campaigns.
  // Outside the feature, only its page is importable.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/features/annotation/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '~/features/annotation/*',
                '!~/features/annotation/pages',
                '!~/features/annotation/pages/*',
              ],
              message:
                'Import the annotation feature through ~/features/annotation/pages/AnnotationPage.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/features/annotation/engine/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '~/features/annotation/core/*',
                '~/features/annotation/stores*',
                '~/features/annotation/panels/*',
                '~/features/annotation/pages/*',
              ],
              message: 'The engine is app-agnostic: it may not depend on campaign concepts.',
            },
          ],
        },
      ],
    },
  },

  // Prettier must be last - disables conflicting rules
  eslintConfigPrettier
);
