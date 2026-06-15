// Unit tests for the health/readiness summary.
// Run: node --test test/health.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHealth } from '../libs/health.ts';

test('buildHealth: ok on a fresh snapshot', () => {
    const h = buildHealth(
        { time: 1000, pools: { a: {}, b: {} } },
        1000000,
        50,
        900
    );
    assert.equal(h.status, 'ok');
    assert.equal(h.pools, 2);
    assert.equal(h.statsAgeSeconds, 0);
    assert.equal(h.uptimeSeconds, 50);
    assert.equal(h.time, 1000);
});

test('buildHealth: degraded when there is no snapshot yet', () => {
    const h = buildHealth({}, 1000000, 5, 900);
    assert.equal(h.status, 'degraded');
    assert.equal(h.pools, 0);
    assert.equal(h.statsAgeSeconds, null);
});

test('buildHealth: degraded when the snapshot is stale', () => {
    // now 2000s, snapshot at 1000s => age 1000 > max 900
    const h = buildHealth({ time: 1000, pools: {} }, 2000000, 10, 900);
    assert.equal(h.status, 'degraded');
    assert.equal(h.statsAgeSeconds, 1000);
});

test('buildHealth: rounds uptime and is safe on no args', () => {
    assert.equal(
        buildHealth({ time: 1000 }, 1000000, 123.7, 900).uptimeSeconds,
        124
    );
    assert.doesNotThrow(function () {
        buildHealth();
    });
    assert.equal(buildHealth().status, 'degraded');
});
