// Unit tests for the pure profit-switching logic.
// Run: node --test test/profitSwitch.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    rankProfitability,
    decideSwitches
} from '../libs/profitSwitchLogic.js';

test('rankProfitability scores reward*price/difficulty and picks the best', () => {
    const table = {
        scrypt: {
            coinA: { reward: 50, price: 2, difficulty: 100 }, // 1.0
            coinB: { reward: 25, price: 10, difficulty: 200 } // 1.25
        }
    };
    const r = rankProfitability(table);
    assert.equal(r.scrypt.coin, 'coinB');
    assert.equal(r.scrypt.scores.coinA, 1.0);
    assert.equal(r.scrypt.scores.coinB, 1.25);
    assert.equal(r.scrypt.score, 1.25);
});

test('rankProfitability skips coins with no price / reward / difficulty', () => {
    const table = {
        x11: {
            good: { reward: 10, price: 1, difficulty: 5 }, // 2.0
            noPrice: { reward: 10, price: null, difficulty: 5 },
            zeroDiff: { reward: 10, price: 1, difficulty: 0 },
            zeroReward: { reward: 0, price: 1, difficulty: 5 }
        }
    };
    const r = rankProfitability(table);
    assert.deepEqual(Object.keys(r.x11.scores), ['good']);
    assert.equal(r.x11.coin, 'good');
});

test('rankProfitability handles each algo independently', () => {
    const r = rankProfitability({
        scrypt: { a: { reward: 1, price: 1, difficulty: 1 } },
        sha256: { b: { reward: 2, price: 2, difficulty: 1 } }
    });
    assert.equal(r.scrypt.coin, 'a');
    assert.equal(r.sha256.coin, 'b');
});

const ranking = {
    scrypt: { coin: 'coinB', score: 1.25, scores: { coinA: 1.0, coinB: 1.25 } }
};
const switching = {
    s1: { enabled: true, algorithm: 'scrypt' },
    s2: { enabled: false, algorithm: 'scrypt' },
    s3: { enabled: true, algorithm: 'sha256' } // no ranking -> ignored
};

test('decideSwitches switches when best beats current by the threshold', () => {
    const actions = decideSwitches(
        ranking,
        { scrypt: 'coinA' },
        switching,
        1.05
    );
    assert.deepEqual(actions, [
        { switchName: 's1', algo: 'scrypt', coin: 'coinB' }
    ]);
});

test('decideSwitches does nothing when already on the best coin', () => {
    assert.deepEqual(
        decideSwitches(ranking, { scrypt: 'coinB' }, switching, 1.05),
        []
    );
});

test('decideSwitches respects the threshold margin (no flapping)', () => {
    // best 1.25 vs current 1.0 -> 1.25x; threshold 1.3 not met
    assert.deepEqual(
        decideSwitches(ranking, { scrypt: 'coinA' }, switching, 1.3),
        []
    );
});

test('decideSwitches switches when the current coin cannot be scored', () => {
    const actions = decideSwitches(
        ranking,
        { scrypt: 'coinGone' },
        switching,
        1.3
    );
    assert.deepEqual(actions, [
        { switchName: 's1', algo: 'scrypt', coin: 'coinB' }
    ]);
});

test('decideSwitches ignores disabled entries and algos with no ranking', () => {
    // only s1 (scrypt, enabled) can act; s2 disabled, s3 has no scrypt... sha256 unranked
    const actions = decideSwitches(ranking, {}, switching, 1.0);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].switchName, 's1');
});
