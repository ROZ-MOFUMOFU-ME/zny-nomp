import js from '@eslint/js';
import prettier from 'eslint-config-prettier';

export default [
    js.configs.recommended,
    {
        files: ['init.js'], // Only lint init.js
        languageOptions: {
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
                clearInterval: 'readonly',
                // Browser globals for website files
                window: 'readonly',
                document: 'readonly',
                navigator: 'readonly',
                // jQuery and other common libraries
                $: 'readonly',
                jQuery: 'readonly',
                d3: 'readonly',
                nv: 'readonly'
            }
        },
        rules: {
            'no-var': 'error',
            'prefer-const': 'error',
            'no-unused-vars': [
                'warn',
                {
                    varsIgnorePattern: '^_',
                    argsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_'
                }
            ],
            'no-undef': 'off', // Disable for now as many legacy globals
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
            'libs/**',
            'scripts/**',
            'website/**',
            '*.log',
            'logs/**',
            'config.json',
            'config_example.json'
        ]
    },
    prettier
];
