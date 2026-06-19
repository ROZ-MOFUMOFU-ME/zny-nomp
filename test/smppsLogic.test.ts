// Unit tests for the pure SMPPS / ESMPPS allocation logic.
// Run: node --test test/smppsLogic.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    esmppsAllocate,
    smppsAllocate,
    parseDebtEntry
} from '../src/smppsLogic.ts';

const close = (a: number, b: number, eps = 1e-9) =>
    assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

test('esmppsAllocate: budget covers all -> full pay + leftover', () => {
    const { paid, leftover } = esmppsAllocate({ a: 30, b: 20 }, 60);
    close(paid.a, 30);
    close(paid.b, 20);
    close(leftover, 10);
});

test('esmppsAllocate: shortfall shared equally by fraction', () => {
    const { paid, leftover } = esmppsAllocate({ a: 30, b: 10 }, 20); // total 40, frac 0.5
    close(paid.a, 15);
    close(paid.b, 5);
    close(leftover, 0);
});

test('esmppsAllocate: no budget / no owed -> nothing', () => {
    assert.deepEqual(esmppsAllocate({ a: 10 }, 0), { paid: {}, leftover: 0 });
    assert.deepEqual(esmppsAllocate({}, 50), { paid: {}, leftover: 50 });
    assert.deepEqual(esmppsAllocate({ a: -5 }, 50), { paid: {}, leftover: 50 });
});

test('smppsAllocate: FIFO pays oldest first, clips the boundary batch', () => {
    const queue = [
        { worker: 'a', owed: 4 },
        { worker: 'b', owed: 4 },
        { worker: 'c', owed: 4 }
    ];
    const { paid, remaining, leftover } = smppsAllocate(queue, 10);
    close(paid.a, 4);
    close(paid.b, 4);
    close(paid.c, 2); // clipped
    assert.deepEqual(remaining, [{ worker: 'c', owed: 2 }]);
    close(leftover, 0);
});

test('smppsAllocate: budget exhausted carries the rest forward', () => {
    const queue = [
        { worker: 'a', owed: 5 },
        { worker: 'b', owed: 5 }
    ];
    const { paid, remaining, leftover } = smppsAllocate(queue, 3);
    close(paid.a, 3);
    assert.equal(paid.b, undefined);
    assert.deepEqual(remaining, [
        { worker: 'a', owed: 2 },
        { worker: 'b', owed: 5 }
    ]);
    close(leftover, 0);
});

test('smppsAllocate: surplus clears all debt, returns leftover', () => {
    const queue = [
        { worker: 'a', owed: 2 },
        { worker: 'a', owed: 3 }
    ];
    const { paid, remaining, leftover } = smppsAllocate(queue, 10);
    close(paid.a, 5); // same worker across batches accumulates
    assert.deepEqual(remaining, []);
    close(leftover, 5);
});

test('smppsAllocate: empty / no budget', () => {
    assert.deepEqual(smppsAllocate([], 10), {
        paid: {},
        remaining: [],
        leftover: 10
    });
    const r = smppsAllocate([{ worker: 'a', owed: 5 }], 0);
    assert.deepEqual(r.paid, {});
    assert.deepEqual(r.remaining, [{ worker: 'a', owed: 5 }]);
});

test('parseDebtEntry: round-trips and rejects malformed', () => {
    assert.deepEqual(parseDebtEntry('addr.rig1:2.5'), {
        worker: 'addr.rig1',
        owed: 2.5
    });
    assert.equal(parseDebtEntry('addr:0'), null);
    assert.equal(parseDebtEntry('addr:'), null);
    assert.equal(parseDebtEntry(':5'), null);
    assert.equal(parseDebtEntry('nope'), null);
});
