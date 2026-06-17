import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// Flat config for the Vite + React + TypeScript SPA. Type-aware correctness is
// covered by `tsc --noEmit` (npm run typecheck) and formatting by Prettier, so
// ESLint here focuses on lint-only rules. Mirrors the root eslint.config.js.
export default tseslint.config(
    { ignores: ['dist/**', 'node_modules/**'] },
    {
        files: ['src/**/*.{ts,tsx}'],
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            parserOptions: {
                ecmaFeatures: { jsx: true }
            }
        },
        rules: {
            'no-var': 'error',
            'prefer-const': 'error',
            // core no-unused-vars is not TS-aware; use the typescript-eslint one
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    varsIgnorePattern: '^_',
                    argsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_'
                }
            ],
            // TS handles name resolution (browser/Node globals, JSX runtime)
            'no-undef': 'off',
            // some SPA code uses `any` for recharts/Redis-shaped data; surface
            // it as a warning rather than failing the build (tsc is the gate)
            '@typescript-eslint/no-explicit-any': 'warn'
        }
    },
    prettier
);
