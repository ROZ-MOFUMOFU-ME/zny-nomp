/*
 * Render the aggregated portal stats object as Prometheus text-format metrics
 * (exposition format 0.0.4). Pure and defensive so it can be unit-tested and
 * never throws on a partial stats object. Served at /api/metrics.
 */

interface MetricSample {
    labels: Record<string, unknown>;
    value: number;
}

interface PoolStat {
    workerCount?: number;
    minerCount?: number;
    hashrate?: number;
    poolStats?: {
        networkHash?: number;
        networkDiff?: number;
        networkBlocks?: number;
        validShares?: number;
        invalidShares?: number;
        [key: string]: unknown;
    };
    blocks?: { pending?: number; confirmed?: number; [key: string]: unknown };
    pps?: {
        mode?: string;
        float?: number;
        paused?: number;
        accruedTotal?: number;
        sharePPS?: number;
    };
    [key: string]: unknown;
}

interface AlgoStat {
    hashrate?: number;
    workers?: number;
    [key: string]: unknown;
}

interface PriceRow {
    price?: number;
    vsCurrency?: string;
    source?: string;
    [key: string]: unknown;
}

export interface MetricsStats {
    pools?: Record<string, PoolStat>;
    algos?: Record<string, AlgoStat>;
    prices?: { prices?: Record<string, PriceRow> };
    time?: number;
    [key: string]: unknown;
}

function escapeLabel(v: unknown): string {
    return String(v)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n');
}

function labelStr(labels?: Record<string, unknown> | null): string {
    const keys = Object.keys(labels || {});
    if (keys.length === 0) return '';
    return (
        '{' +
        keys
            .map(function (k) {
                return (
                    k +
                    '="' +
                    escapeLabel((labels as Record<string, unknown>)[k]) +
                    '"'
                );
            })
            .join(',') +
        '}'
    );
}

function num(v: unknown): number {
    const n = Number(v);
    return isFinite(n) ? n : 0;
}

export function renderMetrics(stats?: MetricsStats | null): string {
    const s = stats || {};
    const pools = s.pools || {};
    const algosObj = s.algos || {};
    const out: string[] = [];

    // Emit a metric block (HELP + TYPE + samples); skip when no samples.
    const metric = function (
        name: string,
        type: string,
        help: string,
        samples?: MetricSample[]
    ): void {
        if (!samples || samples.length === 0) return;
        out.push('# HELP ' + name + ' ' + help);
        out.push('# TYPE ' + name + ' ' + type);
        samples.forEach(function (sm) {
            out.push(name + labelStr(sm.labels) + ' ' + sm.value);
        });
    };

    const poolNames = Object.keys(pools);
    const poolSamples = function (
        pick: (c: PoolStat) => number
    ): MetricSample[] {
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

    // PPS (pay-per-share) health — only for pools actually running pps. `float`
    // is the spendable pool balance read at the last accrual; `paused`=1 means
    // the minFloat kill-switch halted accrual (miners are NOT being credited —
    // alert on this). Skipped entirely for prop/pplnt/solo pools.
    const ppsPools = poolNames.filter(function (p) {
        const pp = pools[p] && pools[p].pps;
        return !!pp && pp.mode === 'pps';
    });
    const ppsSamples = function (
        pick: (pp: NonNullable<PoolStat['pps']>) => number
    ): MetricSample[] {
        return ppsPools.map(function (p): MetricSample {
            return {
                labels: { pool: p },
                value: pick(pools[p].pps as NonNullable<PoolStat['pps']>)
            };
        });
    };
    metric(
        'nomp_pool_pps_float',
        'gauge',
        'Spendable pool balance (float) at the last PPS accrual, in coins',
        ppsSamples(function (pp) {
            return num(pp.float);
        })
    );
    metric(
        'nomp_pool_pps_paused',
        'gauge',
        'PPS accrual paused by the minFloat kill-switch (1=paused, 0=running)',
        ppsSamples(function (pp) {
            return num(pp.paused);
        })
    );
    metric(
        'nomp_pool_pps_accrued_total',
        'gauge',
        'Lifetime total accrued to miners under PPS, in coins',
        ppsSamples(function (pp) {
            return num(pp.accruedTotal);
        })
    );
    metric(
        'nomp_pool_pps_share_value',
        'gauge',
        'Current PPS value of one difficulty unit of work, in coins',
        ppsSamples(function (pp) {
            return num(pp.sharePPS);
        })
    );

    const algoNames = Object.keys(algosObj);
    metric(
        'nomp_algo_hashrate_hps',
        'gauge',
        'Aggregate hashrate per algorithm in H/s',
        algoNames.map(function (a): MetricSample {
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
        algoNames.map(function (a): MetricSample {
            return { labels: { algo: a }, value: num(algosObj[a].workers) };
        })
    );

    const prices = (s.prices && s.prices.prices) || {};
    metric(
        'nomp_price',
        'gauge',
        'Latest coin price from the price feed',
        Object.keys(prices).map(function (sym): MetricSample {
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

    if (s.time)
        metric(
            'nomp_stats_time_seconds',
            'gauge',
            'Unix time of this snapshot',
            [{ labels: {}, value: num(s.time) }]
        );

    return out.join('\n') + '\n';
}
