// Headless config sanity check for CI: parse every config file the portal reads
// (JSON with // and /* */ comments allowed, like the portal does via
// node-json-minify) and fail if any is malformed. Catches config typos before
// they crash a boot. Run: node scripts/check-config.mjs
import fs from 'fs';
import path from 'path';
import jsonMinify from 'node-json-minify';

let checked = 0;
let failed = 0;

function check(file) {
    if (!fs.existsSync(file)) return;
    checked++;
    try {
        JSON.parse(jsonMinify(fs.readFileSync(file, { encoding: 'utf8' })));
        console.log('ok   ' + file);
    } catch (e) {
        failed++;
        console.error('FAIL ' + file + ' — ' + e.message);
    }
}

function checkDir(dir) {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir)
        .filter((f) => path.extname(f) === '.json')
        .sort()
        .forEach((f) => check(path.join(dir, f)));
}

check('config_example.json');
check('config.json');
checkDir('coins');
checkDir('coins/coins-examples');
checkDir('coins/coins-examples-testnet');
checkDir('pool_configs');
checkDir('pool_configs/examples');

console.log('\nparsed ' + checked + ' file(s), ' + failed + ' failed');
if (failed > 0) process.exit(1);
