import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/generated/**',
      '**/dev-dist/**',
      '.claude/**',
      'scripts/design-research/out/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'warn',
    },
  },

  // Browser surfaces.
  {
    files: ['apps/pos/**/*.{ts,tsx}', 'apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },

  // Node surfaces: the API, and every config file that runs in Node.
  {
    files: ['apps/api/**/*.ts', 'scripts/**/*.ts', '**/*.config.{ts,mts,mjs}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
