// Unit tests for the pure PPLNS window / apportionment logic.
// Run: node --test test/pplnsLogic.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    selectPplnsWindow,
    pplnsShareTotals,
    pplnsPercents,
    parsePplnsEntry
} from '../src/pplnsLogic.ts';

const close = (a: number, b: number, eps = 1e-9) =>
    assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

// newest-first share log helper
const log = (...pairs: Array<[string, number]>) =>
    pairs.map(([worker, diff]) => ({ worker, diff }));

test('selectPplnsWindow: clips the boundary share to fill exactly windowDiff', () => {
    const shares = log(['a', 4], ['b', 4], ['a', 4]); // newest-first, total 12
    const w = selectPplnsWindow(shares, 10);
    // takes a:4, b:4, then 2 of the last a:4 to reach 10
    assert.deepEqual(w, [
        { worker: 'a', diff: 4 },
        { worker: 'b', diff: 4 },
        { worker: 'a', diff: 2 }
    ]);
    assert.equal(
        w.reduce((s, x) => s + x.diff, 0),
        10
    );
});

test('selectPplnsWindow: short log uses everything unclipped', () => {
    const shares = log(['a', 3], ['b', 2]); // total 5 < window 10
    assert.deepEqual(selectPplnsWindow(shares, 10), shares);
});

test('selectPplnsWindow: exact fit takes whole shares, no extra', () => {
    const shares = log(['a', 5], ['b', 5], ['c', 5]);
    const w = selectPplnsWindow(shares, 10);
    assert.deepEqual(w, [
        { worker: 'a', diff: 5 },
        { worker: 'b', diff: 5 }
    ]);
});

test('selectPplnsWindow: invalid window / inputs -> empty', () => {
    assert.deepEqual(selectPplnsWindow(log(['a', 5]), 0), []);
    assert.deepEqual(selectPplnsWindow(log(['a', 5]), -1), []);
    assert.deepEqual(selectPplnsWindow(log(['a', 5]), NaN), []);
    assert.deepEqual(selectPplnsWindow([], 10), []);
    assert.deepEqual(selectPplnsWindow(null as any, 10), []);
});

test('selectPplnsWindow: skips non-positive / non-finite diffs', () => {
    const shares = [
        { worker: 'a', diff: 4 },
        { worker: 'b', diff: 0 },
        { worker: 'c', diff: NaN as any },
        { worker: 'd', diff: -3 },
        { worker: 'e', diff: 4 }
    ];
    const w = selectPplnsWindow(shares, 10);
    assert.deepEqual(w, [
        { worker: 'a', diff: 4 },
        { worker: 'e', diff: 4 }
    ]);
});

test('pplnsShareTotals: aggregates the clipped window per worker', () => {
    const shares = log(['a', 4], ['b', 4], ['a', 4]);
    const { totals, totalDiff } = pplnsShareTotals(shares, 10);
    assert.equal(totalDiff, 10);
    close(totals.a, 6); // 4 + clipped 2
    close(totals.b, 4);
});

test('pplnsPercents: fractions sum to 1 and match share weight', () => {
    const shares = log(['a', 4], ['b', 4], ['a', 4]);
    const p = pplnsPercents(shares, 10);
    close(p.a, 0.6);
    close(p.b, 0.4);
    close(p.a + p.b, 1.0);
});

test('pplnsPercents: keeps full worker key (address.rig)', () => {
    const shares = log(['Xaddr.rig1', 3], ['Xaddr.rig2', 1]);
    const p = pplnsPercents(shares, 4);
    close(p['Xaddr.rig1'], 0.75);
    close(p['Xaddr.rig2'], 0.25);
});

test('pplnsPercents: nothing to pay -> empty map', () => {
    assert.deepEqual(pplnsPercents([], 10), {});
    assert.deepEqual(pplnsPercents(log(['a', 5]), 0), {});
});

test('parsePplnsEntry: round-trips worker:diff', () => {
    assert.deepEqual(parsePplnsEntry('addr.rig1:2.5'), {
        worker: 'addr.rig1',
        diff: 2.5
    });
    assert.deepEqual(parsePplnsEntry('addr:1'), { worker: 'addr', diff: 1 });
});

test('parsePplnsEntry: rejects malformed / non-positive', () => {
    assert.equal(parsePplnsEntry('nodiff'), null);
    assert.equal(parsePplnsEntry(':5'), null);
    assert.equal(parsePplnsEntry('addr:'), null);
    assert.equal(parsePplnsEntry('addr:0'), null);
    assert.equal(parsePplnsEntry('addr:-2'), null);
    assert.equal(parsePplnsEntry('addr:abc'), null);
    assert.equal(parsePplnsEntry(123 as any), null);
});
