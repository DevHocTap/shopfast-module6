// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'eslint.config.mjs', 'jest*.config.ts'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Read configuration through ConfigService (src/infra/config).',
        },
      ],
    },
  },
  {
    // The config layer is the only place allowed to read process.env.
    files: [
      'src/infra/config/**/*.ts',
      'src/infra/database/data-source.ts',
      'src/infra/database/seeds/**/*.ts',
      'test/**/*.ts',
    ],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    // Test doubles: async mocks without await and loosely typed fakes are fine here.
    files: ['**/*.spec.ts', 'test/**/*.ts', 'src/**/testing/**/*.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
);
