// Unit tests for the Prometheus metrics renderer.
// Run: node --test test/metrics.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMetrics } from '../libs/metrics.js';

const sample = {
    time: 1700000000,
    pools: {
        monacoin: {
            name: 'monacoin',
            workerCount: 3,
            minerCount: 2,
            hashrate: 1.5, // MH/s
            poolStats: {
                networkHash: 5000000000,
                networkDiff: 1234.5,
                networkBlocks: 100,
                validShares: 10,
                invalidShares: 1
            },
            blocks: { pending: 2, confirmed: 50 }
        }
    },
    algos: { lyra2rev2: { hashrate: 1.5, workers: 3 } },
    prices: {
        prices: {
            MONA: { price: 0.07, vsCurrency: 'usd', source: 'coingecko' }
        }
    }
};

test('renderMetrics emits HELP/TYPE and labelled samples', () => {
    const out = renderMetrics(sample);
    assert.match(out, /# HELP nomp_pool_workers /);
    assert.match(out, /# TYPE nomp_pool_workers gauge/);
    assert.ok(out.includes('nomp_pool_workers{pool="monacoin"} 3'));
    assert.ok(out.includes('nomp_pool_miners{pool="monacoin"} 2'));
    // hashrate MH/s -> H/s
    assert.ok(out.includes('nomp_pool_hashrate_hps{pool="monacoin"} 1500000'));
    assert.ok(
        out.includes('nomp_pool_network_difficulty{pool="monacoin"} 1234.5')
    );
    assert.ok(out.includes('nomp_pool_blocks_pending{pool="monacoin"} 2'));
    assert.ok(out.includes('nomp_pool_blocks_confirmed{pool="monacoin"} 50'));
});

test('renderMetrics includes algo and price series', () => {
    const out = renderMetrics(sample);
    assert.ok(out.includes('nomp_algo_hashrate_hps{algo="lyra2rev2"} 1500000'));
    assert.ok(out.includes('nomp_algo_workers{algo="lyra2rev2"} 3'));
    assert.ok(
        out.includes(
            'nomp_price{symbol="MONA",currency="USD",source="coingecko"} 0.07'
        )
    );
    assert.ok(out.includes('nomp_stats_time_seconds 1700000000'));
});

test('renderMetrics escapes label values', () => {
    const out = renderMetrics({
        prices: {
            prices: { X: { price: 1, vsCurrency: 'usd', source: 'a"b' } }
        }
    });
    assert.ok(out.includes('source="a\\"b"'));
});

test('renderMetrics coerces missing numbers to 0', () => {
    const out = renderMetrics({
        pools: { x: { poolStats: {}, blocks: {} } }
    });
    assert.ok(out.includes('nomp_pool_workers{pool="x"} 0'));
    assert.ok(out.includes('nomp_pool_hashrate_hps{pool="x"} 0'));
});

test('renderMetrics is safe on empty/partial input', () => {
    assert.doesNotThrow(function () {
        renderMetrics();
    });
    assert.equal(renderMetrics({}).trim(), '');
    // a block with no samples emits no HELP/TYPE noise
    assert.ok(!renderMetrics({}).includes('# TYPE'));
});
