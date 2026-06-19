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
    walletBalance?: number | null;
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
        rateScalar?: number;
        realizedLuck?: number;
    };
    smpps?: {
        mode?: string;
        budget?: number;
        paidTotal?: number;
        paused?: number;
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
    // Pool spendable wallet balance — only for pools running the optional
    // balanceLog module (walletBalance is null/absent otherwise).
    metric(
        'nomp_pool_wallet_balance',
        'gauge',
        'Pool spendable wallet balance in coins (balanceLog module)',
        poolNames
            .filter(function (p) {
                return pools[p] && pools[p].walletBalance != null;
            })
            .map(function (p): MetricSample {
                return {
                    labels: { pool: p },
                    value: num(pools[p].walletBalance)
                };
            })
    );

    // Share-based accrual health — for pools running a pps-family mode (pps,
    // dpps, fpps, ppsplus all accrue via the same coin:pps:stats path). `float`
    // is the spendable pool balance read at the last accrual; `paused`=1 means
    // the minFloat kill-switch halted accrual (miners are NOT being credited —
    // alert on this). Skipped for prop/pplnt/solo/pplns pools.
    const ppsModes = ['pps', 'dpps', 'fpps', 'ppsplus'];
    const ppsPools = poolNames.filter(function (p) {
        const pp = pools[p] && pools[p].pps;
        return !!pp && ppsModes.indexOf(pp.mode || '') !== -1;
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
    // D-PPS only: the dynamic rate scalar (basePPS multiplier in [rateMin, 1.0])
    // and the smoothed realized luck driving it. Emitted only for dpps pools.
    const dppsPools = ppsPools.filter(function (p) {
        const pp = pools[p].pps;
        return !!pp && pp.mode === 'dpps';
    });
    const dppsSamples = function (
        pick: (pp: NonNullable<PoolStat['pps']>) => number
    ): MetricSample[] {
        return dppsPools.map(function (p): MetricSample {
            return {
                labels: { pool: p },
                value: pick(pools[p].pps as NonNullable<PoolStat['pps']>)
            };
        });
    };
    metric(
        'nomp_pool_dpps_rate_scalar',
        'gauge',
        'D-PPS dynamic per-share rate scalar at the last accrual (1.0 = full PPS, floored at rateMin)',
        dppsSamples(function (pp) {
            return num(pp.rateScalar);
        })
    );
    metric(
        'nomp_pool_dpps_realized_luck',
        'gauge',
        'D-PPS smoothed realized luck (actualReward EMA / expectedReward EMA; < 1 = pool running underwater)',
        dppsSamples(function (pp) {
            return num(pp.realizedLuck);
        })
    );

    // SMPPS family (smpps / esmpps): income-capped release. `budget` is realized
    // income not yet released to miners; `paidTotal` is lifetime released;
    // `paused`=1 means the minFloat kill-switch halted releases.
    const smppsModes = ['smpps', 'esmpps'];
    const smppsPools = poolNames.filter(function (p) {
        const sp = pools[p] && pools[p].smpps;
        return !!sp && smppsModes.indexOf(sp.mode || '') !== -1;
    });
    const smppsSamples = function (
        pick: (sp: NonNullable<PoolStat['smpps']>) => number
    ): MetricSample[] {
        return smppsPools.map(function (p): MetricSample {
            return {
                labels: { pool: p },
                value: pick(pools[p].smpps as NonNullable<PoolStat['smpps']>)
            };
        });
    };
    metric(
        'nomp_pool_smpps_budget',
        'gauge',
        'SMPPS realized income not yet released to miners (release is capped at this), in coins',
        smppsSamples(function (sp) {
            return num(sp.budget);
        })
    );
    metric(
        'nomp_pool_smpps_paid_total',
        'gauge',
        'Lifetime total released to miners under SMPPS/ESMPPS, in coins',
        smppsSamples(function (sp) {
            return num(sp.paidTotal);
        })
    );
    metric(
        'nomp_pool_smpps_paused',
        'gauge',
        'SMPPS release paused by the minFloat kill-switch (1=paused, 0=running)',
        smppsSamples(function (sp) {
            return num(sp.paused);
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
