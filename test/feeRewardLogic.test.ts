// Unit tests for the pure FPPS / PPS+ fee math.
// Run: node --test test/feeRewardLogic.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    avgFeePerBlock,
    fppsEffectiveReward,
    ppsPlusFeePart
} from '../src/feeRewardLogic.ts';

const close = (a: number, b: number, eps = 1e-9) =>
    assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

test('avgFeePerBlock: pending / blocks', () => {
    close(avgFeePerBlock(1.5, 3), 0.5);
    close(avgFeePerBlock(0, 5), 0);
});

test('avgFeePerBlock: no blocks / bad input -> 0', () => {
    assert.equal(avgFeePerBlock(2, 0), 0);
    assert.equal(avgFeePerBlock(2, -1), 0);
    assert.equal(avgFeePerBlock(2, NaN), 0);
    assert.equal(avgFeePerBlock(-5, 2), 0); // negative pending floored
});

test('fppsEffectiveReward: subsidy + smoothed fee', () => {
    close(fppsEffectiveReward(50, 0.4), 50.4);
    close(fppsEffectiveReward(50, 0), 50);
});

test('fppsEffectiveReward: floors negative / NaN at 0', () => {
    close(fppsEffectiveReward(50, -1), 50); // bad fee EMA never cuts subsidy
    close(fppsEffectiveReward(-10, 2), 2); // bad subsidy floored
    close(fppsEffectiveReward(NaN, NaN), 0);
});

test('ppsPlusFeePart: gross - subsidy - txfee', () => {
    assert.equal(ppsPlusFeePart(1000, 600, 10), 390);
    assert.equal(ppsPlusFeePart(625000000, 625000000, 0), 0); // pure subsidy block
});

test('ppsPlusFeePart: never negative; clamps bad inputs', () => {
    assert.equal(ppsPlusFeePart(500, 600, 0), 0); // subsidy > gross
    assert.equal(ppsPlusFeePart(500, 600, 50), 0);
    assert.equal(ppsPlusFeePart(1000, -5, -5), 1000); // negative subsidy/txfee -> 0
    assert.equal(ppsPlusFeePart(NaN as any, 10, 10), 0);
});
