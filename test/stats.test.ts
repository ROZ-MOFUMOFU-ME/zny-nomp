// Unit tests for the pure helpers extracted from libs/stats.js.
// Run: node --test test/stats.test.ts
//
// These lock the original stats.js behaviour so the extraction into
// libs/statsUtil.ts stays a behaviour-preserving refactor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    sortProperties,
    sortObjectByProperty,
    roundTo,
    readableSeconds,
    readableHashRateString,
    sortBlocks,
    sortWorkersByHashrate
} from '../src/statsUtil.ts';

test('roundTo rounds to the requested decimal digits', () => {
    // default digits === 0
    assert.equal(roundTo(2.5), 3);
    assert.equal(roundTo(2.4), 2);
    assert.equal(roundTo(5), 5);
    assert.equal(roundTo(1.23456789, 4), 1.2346);
    // the .toFixed(11) guard fixes the classic binary-float rounding cases
    assert.equal(roundTo(1.005, 2), 1.01);
    assert.equal(roundTo(0.1 + 0.2, 1), 0.3);
});

test('readableSeconds formats durations down to the largest non-zero unit', () => {
    assert.equal(readableSeconds(0), '0s');
    assert.equal(readableSeconds(5), '5s');
    assert.equal(readableSeconds(59), '59s');
    assert.equal(readableSeconds(60), '1m 0s');
    assert.equal(readableSeconds(65), '1m 5s');
    assert.equal(readableSeconds(3600), '1h 0m 0s');
    assert.equal(readableSeconds(3661), '1h 1m 1s');
    assert.equal(readableSeconds(86400), '1d 0h 0m 0s');
    assert.equal(readableSeconds(90061), '1d 1h 1m 1s');
    // rounds fractional seconds first
    assert.equal(readableSeconds(3599.6), '1h 0m 0s');
});

test('readableHashRateString preserves the original MH/s formatting', () => {
    // below the display threshold (input * 1e6 < 1e6, i.e. input < 1)
    assert.equal(readableHashRateString(0), '0 H/s');
    assert.equal(readableHashRateString(0.5), '0 H/s');
    // at/above the threshold the original logic scales input * 1e6
    assert.equal(readableHashRateString(1), '1.00 H/s');
    assert.equal(readableHashRateString(1.5), '1.50 H/s');
    assert.equal(readableHashRateString(2), '2.00 H/s');
    assert.equal(readableHashRateString(5000), '5.00 KH/s');
});

test('sortBlocks orders block keys by height descending', () => {
    // keys are "address:txhash:height[:...]"
    assert.equal(sortBlocks('a:b:100', 'a:b:50'), -1);
    assert.equal(sortBlocks('a:b:50', 'a:b:100'), 1);
    assert.equal(sortBlocks('a:b:100', 'x:y:100'), 0);
    const sorted = ['x:y:1', 'x:y:3', 'x:y:2'].sort(sortBlocks);
    assert.deepEqual(sorted, ['x:y:3', 'x:y:2', 'x:y:1']);
});

test('sortWorkersByHashrate orders workers by ascending hashrate', () => {
    assert.equal(sortWorkersByHashrate({ hashrate: 1 }, { hashrate: 2 }), -1);
    assert.equal(sortWorkersByHashrate({ hashrate: 2 }, { hashrate: 1 }), 1);
    assert.equal(sortWorkersByHashrate({ hashrate: 5 }, { hashrate: 5 }), 0);
    const sorted = [{ hashrate: 3 }, { hashrate: 1 }, { hashrate: 2 }].sort(
        sortWorkersByHashrate
    );
    assert.deepEqual(
        sorted.map((w) => w.hashrate),
        [1, 2, 3]
    );
});

test('sortProperties sorts numerically and as case-insensitive text', () => {
    const numeric = sortProperties(
        { a: { v: 3 }, b: { v: 1 }, c: { v: 2 } },
        'v',
        true,
        false
    );
    assert.deepEqual(
        numeric.map((e) => e[0]),
        ['b', 'c', 'a']
    );

    const numericReversed = sortProperties(
        { a: { v: 3 }, b: { v: 1 }, c: { v: 2 } },
        'v',
        true,
        true
    );
    assert.deepEqual(
        numericReversed.map((e) => e[0]),
        ['a', 'c', 'b']
    );

    // string compare is case-insensitive: 'alice' sorts before 'Bob'
    const text = sortProperties(
        { x: { name: 'Bob' }, y: { name: 'alice' } },
        'name',
        false,
        false
    );
    assert.deepEqual(
        text.map((e) => e[0]),
        ['y', 'x']
    );
});

test('sortObjectByProperty rebuilds the object in sorted key order', () => {
    // miners: by shares, numeric, descending (as stats.js sorts miners)
    const miners = sortObjectByProperty(
        { a: { shares: 1 }, b: { shares: 3 }, c: { shares: 2 } },
        'shares',
        true,
        true
    );
    assert.deepEqual(Object.keys(miners), ['b', 'c', 'a']);
    // values are carried over unchanged
    assert.deepEqual(miners.b, { shares: 3 });

    // pools/workers: by name, alphabetical
    const pools = sortObjectByProperty(
        { zeny: { name: 'zeny' }, koto: { name: 'koto' } },
        'name',
        false,
        false
    );
    assert.deepEqual(Object.keys(pools), ['koto', 'zeny']);
});
