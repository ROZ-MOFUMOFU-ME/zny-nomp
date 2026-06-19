// Validates that every config file the portal reads is parseable JSON (with //
// and /* */ comments, like the portal via node-json-minify), catching typos
// before boot. Run standalone via `npm run check:config` and as part of
// `npm run test:unit`. Replaces the old scripts/check-config.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import jsonMinify from 'node-json-minify';

const SINGLE = ['config_example.json', 'config.json'];
const DIRS = [
    'coins',
    'coins/coins-examples',
    'coins/coins-examples-testnet',
    'pool_configs',
    'pool_configs/examples'
];

const files: string[] = [];
for (const f of SINGLE) if (fs.existsSync(f)) files.push(f);
for (const dir of DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) {
        if (path.extname(f) === '.json') files.push(path.join(dir, f));
    }
}

for (const file of files) {
    test(`config parses: ${file}`, () => {
        assert.doesNotThrow(function () {
            JSON.parse(jsonMinify(fs.readFileSync(file, 'utf8')));
        }, `${file} is not valid JSON`);
    });
}
