/*
 * Render the aggregated portal stats object as Prometheus text-format metrics
 * (exposition format 0.0.4). Pure and defensive so it can be unit-tested and
 * never throws on a partial stats object. Served at /api/metrics.
 */

function escapeLabel(v) {
    return String(v)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n');
}

function labelStr(labels) {
    const keys = Object.keys(labels || {});
    if (keys.length === 0) return '';
    return (
        '{' +
        keys
            .map(function (k) {
                return k + '="' + escapeLabel(labels[k]) + '"';
            })
            .join(',') +
        '}'
    );
}

function num(v) {
    const n = Number(v);
    return isFinite(n) ? n : 0;
}

export function renderMetrics(stats) {
    stats = stats || {};
    const pools = stats.pools || {};
    const algosObj = stats.algos || {};
    const out = [];

    // Emit a metric block (HELP + TYPE + samples); skip when no samples.
    const metric = function (name, type, help, samples) {
        if (!samples || samples.length === 0) return;
        out.push('# HELP ' + name + ' ' + help);
        out.push('# TYPE ' + name + ' ' + type);
        samples.forEach(function (s) {
            out.push(name + labelStr(s.labels) + ' ' + s.value);
        });
    };

    const poolNames = Object.keys(pools);
    const poolSamples = function (pick) {
        return poolNames.map(function (p) {
            return { labels: { pool: p }, value: pick(pools[p]) };
        });
    };

    metric(
        'nomp_pool_workers',
        'gauge',
        'Connected workers per pool',
        poolSamples(function (c) {
            return num(c.workerCount);
        })
    );
    metric(
        'nomp_pool_miners',
        'gauge',
        'Connected miners per pool',
        poolSamples(function (c) {
            return num(c.minerCount);
        })
    );
    metric(
        'nomp_pool_hashrate_hps',
        'gauge',
        'Pool hashrate in H/s',
        poolSamples(function (c) {
            return num(c.hashrate) * 1e6;
        })
    );
    metric(
        'nomp_pool_network_hashrate_hps',
        'gauge',
        'Network hashrate in H/s',
        poolSamples(function (c) {
            return num(c.poolStats && c.poolStats.networkHash);
        })
    );
    metric(
        'nomp_pool_network_difficulty',
        'gauge',
        'Network difficulty',
        poolSamples(function (c) {
            return num(c.poolStats && c.poolStats.networkDiff);
        })
    );
    metric(
        'nomp_pool_network_blocks',
        'gauge',
        'Network block height',
        poolSamples(function (c) {
            return num(c.poolStats && c.poolStats.networkBlocks);
        })
    );
    metric(
        'nomp_pool_valid_shares',
        'gauge',
        'Valid shares in the current round',
        poolSamples(function (c) {
            return num(c.poolStats && c.poolStats.validShares);
        })
    );
    metric(
        'nomp_pool_invalid_shares',
        'gauge',
        'Invalid shares in the current round',
        poolSamples(function (c) {
            return num(c.poolStats && c.poolStats.invalidShares);
        })
    );
    metric(
        'nomp_pool_blocks_pending',
        'gauge',
        'Pending (unconfirmed) blocks',
        poolSamples(function (c) {
            return num(c.blocks && c.blocks.pending);
        })
    );
    metric(
        'nomp_pool_blocks_confirmed',
        'gauge',
        'Confirmed blocks',
        poolSamples(function (c) {
            return num(c.blocks && c.blocks.confirmed);
        })
    );

    const algoNames = Object.keys(algosObj);
    metric(
        'nomp_algo_hashrate_hps',
        'gauge',
        'Aggregate hashrate per algorithm in H/s',
        algoNames.map(function (a) {
            return {
                labels: { algo: a },
                value: num(algosObj[a].hashrate) * 1e6
            };
        })
    );
    metric(
        'nomp_algo_workers',
        'gauge',
        'Workers per algorithm',
        algoNames.map(function (a) {
            return { labels: { algo: a }, value: num(algosObj[a].workers) };
        })
    );

    const prices = (stats.prices && stats.prices.prices) || {};
    metric(
        'nomp_price',
        'gauge',
        'Latest coin price from the price feed',
        Object.keys(prices).map(function (sym) {
            const p = prices[sym];
            return {
                labels: {
                    symbol: sym,
                    currency: (p.vsCurrency || '').toUpperCase(),
                    source: p.source || ''
                },
                value: num(p.price)
            };
        })
    );

    if (stats.time)
        metric(
            'nomp_stats_time_seconds',
            'gauge',
            'Unix time of this snapshot',
            [{ labels: {}, value: num(stats.time) }]
        );

    return out.join('\n') + '\n';
}
