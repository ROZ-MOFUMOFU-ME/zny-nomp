// Unit tests for the pure D-PPS / PPS rate logic.
// Run: node --test test/ppsLogic.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    dppsRateScalar,
    emaNext,
    realizedLuck,
    basePPS
} from '../src/ppsLogic.ts';

const close = (a: number, b: number, eps = 1e-9) =>
    assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

test('dppsRateScalar: neutral luck pays (1 - targetMargin)', () => {
    close(dppsRateScalar(1.0, 0.02, 0.5), 0.98);
    close(dppsRateScalar(1.0, 0, 0.5), 1.0);
});

test('dppsRateScalar: good luck is capped at full PPS (1.0)', () => {
    assert.equal(dppsRateScalar(2.0, 0.02, 0.5), 1.0);
    assert.equal(dppsRateScalar(1.5, 0.0, 0.5), 1.0);
});

test('dppsRateScalar: bad luck is floored at rateMin', () => {
    assert.equal(dppsRateScalar(0.3, 0.02, 0.5), 0.5); // 0.294 -> floor
    assert.equal(dppsRateScalar(0.0, 0.02, 0.5), 0.5);
    assert.equal(dppsRateScalar(-5, 0.02, 0.5), 0.5); // negative -> floor
});

test('dppsRateScalar: scales linearly between floor and cap', () => {
    // luck 0.8, margin 0 -> 0.8 (between rateMin 0.5 and 1.0)
    close(dppsRateScalar(0.8, 0, 0.5), 0.8);
    // luck 0.6, rateMin 0.8 -> floored to 0.8
    assert.equal(dppsRateScalar(0.6, 0, 0.8), 0.8);
});

test('dppsRateScalar: clamps out-of-range margin / rateMin / NaN', () => {
    assert.equal(dppsRateScalar(1.0, 1.5, 0.5), 0.5); // margin>1 -> margin 1 -> raw 0 -> floor
    close(dppsRateScalar(1.0, -0.1, 0.5), 1.0); // margin<0 -> 0
    assert.equal(dppsRateScalar(1.0, 0, 1.5), 1.0); // rateMin>1 -> 1
    assert.equal(dppsRateScalar(NaN, 0.02, 0.5), 0.5); // NaN luck -> floor
    close(dppsRateScalar(1.0, NaN, 0.5), 1.0); // NaN margin -> margin 0 -> raw 1.0
});

test('emaNext: alpha = 1/window', () => {
    assert.equal(emaNext(0, 10, 1), 10); // window 1 tracks latest
    assert.equal(emaNext(10, 20, 2), 15); // 10 + (20-10)/2
    close(emaNext(100, 0, 100), 99); // slow decay
    assert.equal(emaNext(5, 5, 7), 5); // steady -> unchanged
});

test('emaNext: guards window<1 and non-finite inputs', () => {
    assert.equal(emaNext(5, 10, 0), 10); // window<1 -> 1
    assert.equal(emaNext(5, 10, -3), 10);
    assert.equal(emaNext(NaN, 10, 2), 5); // prev NaN -> 0; 0+(10-0)/2
    assert.equal(emaNext(4, NaN, 2), 2); // sample NaN -> 0; 4+(0-4)/2
});

test('realizedLuck: ratio of smoothed flows, neutral until data', () => {
    assert.equal(realizedLuck(0, 0), 1.0); // no expected yet -> neutral
    assert.equal(realizedLuck(5, 0), 1.0); // expected 0 -> neutral
    assert.equal(realizedLuck(5, 10), 0.5);
    assert.equal(realizedLuck(10, 10), 1.0);
    assert.equal(realizedLuck(15, 10), 1.5);
    assert.equal(realizedLuck(0, 10), 0.0); // received nothing
});

test('integration: rate converges toward (1 - margin) under fair luck', () => {
    // Each cycle the pool does `expectedFlow` of work and (on average) receives
    // the same in matured block reward. EMAs of both flows converge equal ->
    // realized luck -> 1.0 -> rateScalar -> (1 - margin).
    let expEma = 0;
    let actEma = 0;
    const window = 50;
    for (let i = 0; i < 500; i++) {
        expEma = emaNext(expEma, 100, window);
        actEma = emaNext(actEma, 100, window); // fair: receives what it owes
    }
    close(realizedLuck(actEma, expEma), 1.0, 1e-6);
    close(dppsRateScalar(realizedLuck(actEma, expEma), 0.02, 0.5), 0.98, 1e-6);
});

test('integration: sustained bad luck drives the rate to the floor', () => {
    // The pool keeps doing work but receives only 30% of expected -> luck ~0.3
    // -> rateScalar floored at rateMin.
    let expEma = 0;
    let actEma = 0;
    const window = 50;
    for (let i = 0; i < 500; i++) {
        expEma = emaNext(expEma, 100, window);
        actEma = emaNext(actEma, 30, window);
    }
    close(realizedLuck(actEma, expEma), 0.3, 1e-6);
    assert.equal(dppsRateScalar(realizedLuck(actEma, expEma), 0.02, 0.5), 0.5);
});

test('basePPS: scales raw networkDiff by the algo multiplier (the bug it fixes)', () => {
    // bellcoin-like: reward 1.25, raw daemon diff 0.000061, yespower mult 65536
    // -> stratum networkDiff ~4 -> basePPS ~0.3125 (NOT 1.25/0.000061 = 20480)
    close(basePPS(1.25, 0.00006103515625, 65536), 0.3125, 1e-6);
    // sha256d / quark (multiplier 1): unchanged
    close(basePPS(1.25, 4, 1), 0.3125);
});

test('basePPS: guards non-positive / non-finite -> 0', () => {
    assert.equal(basePPS(1, 0, 65536), 0); // zero diff
    assert.equal(basePPS(1, -1, 65536), 0);
    assert.equal(basePPS(-1, 4, 1), 0); // negative reward
    assert.equal(basePPS(NaN, 4, 1), 0);
    assert.equal(basePPS(1, 4, 0), 0); // zero multiplier
});
