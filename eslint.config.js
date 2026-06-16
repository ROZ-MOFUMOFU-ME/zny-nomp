import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default [
    {
        // Entry point only (the rest of src/ is covered by `tsc --noEmit` + prettier).
        files: ['src/init.ts'],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                ecmaVersion: 2022,
                sourceType: 'module'
            },
            globals: {
                // Node.js globals
                console: 'readonly',
                process: 'readonly',
                Buffer: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                module: 'readonly',
                require: 'readonly',
                exports: 'readonly',
                global: 'readonly',
                setImmediate: 'readonly',
                clearImmediate: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly'
            }
        },
        plugins: {
            '@typescript-eslint': tseslint.plugin
        },
        rules: {
            ...js.configs.recommended.rules,
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
            'no-undef': 'off', // TS handles name resolution
            'no-redeclare': 'error'
        }
    },
    {
        ignores: [
            'node_modules/**',
            '*.min.js',
            'dist/**',
            'build/**',
            'newrelic_agent.log',
            'pool_configs/**',
            'scripts/**',
            'web/**',
            '*.log',
            'logs/**',
            'config.json',
            'config_example.json'
        ]
    },
    prettier
];
