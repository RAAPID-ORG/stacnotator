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

  // Files that export both components and helpers those components' callers
  // need. Splitting them would put a one-function file next to every panel.
  {
    files: [
      'src/features/annotation/components/FormFields.tsx',
      'src/features/annotation/panels/ImageryWindow/ImageryWindow.tsx',
      'src/features/annotation/panels/MainMap/MainMap.tsx',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },

  // Outside the annotation feature, only its page is importable.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/features/annotation/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['~/features/annotation/*', '!~/features/annotation/AnnotationPage'],
              message:
                'Import the annotation feature through ~/features/annotation/AnnotationPage.',
            },
          ],
        },
      ],
    },
  },

  // campaign/ is what a campaign is made of - imagery catalog, labels, tasks -
  // as plain data and functions. Keeping it free of React, OpenLayers and the
  // stores is what makes it testable without any of them.
  {
    files: ['src/features/annotation/campaign/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/stores/*',
                '**/panels/*',
                '**/chrome/*',
                '**/map/*',
                '**/canvas/*',
                'react',
                'ol',
                'ol/*',
                'zustand',
              ],
              message: 'campaign/ is pure: no React, no OpenLayers, no stores.',
            },
          ],
        },
      ],
    },
  },

  // Prettier must be last - disables conflicting rules
  eslintConfigPrettier
);
