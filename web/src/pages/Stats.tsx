import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    CartesianGrid,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    Legend
} from 'recharts';
import { useLiveStats } from '../api/useLiveStats.tsx';
import { getPoolHistory, getConfig } from '../api/client.ts';
import type { PoolEntry } from '../api/types.ts';
import {
    toNum,
    readableHashRateString,
    readableLuckTime,
    readableDate,
    shortTime,
    parseBlockString,
    explorerUrl,
    formatPrice
} from '../lib/format.ts';

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const COLORS = [
    '#0eafc7',
    '#b064e1',
    '#10bb9c',
    '#f0a90e',
    '#e1646b',
    '#646be1',
    '#10bb6b',
    '#bb1090',
    '#39a0ed',
    '#e07b39'
];

function Row({
    icon,
    label,
    value
}: {
    icon: string;
    label: string;
    value: ReactNode;
}) {
    return (
        <div className="whitespace-nowrap py-0.5 text-sm">
            <i className={`fas ${icon} fa-fw text-black/40`} />{' '}
            <span className="text-muted">{label}:</span>{' '}
            <span className="font-medium">{value}</span>
        </div>
    );
}

function PoolBlocks({
    pool,
    blockURL
}: {
    pool: PoolEntry;
    blockURL?: string;
}) {
    const { t } = useTranslation();
    const pending = pool.pending?.blocks ?? [];
    const confirms = pool.pending?.confirms ?? {};
    const confirmed = (pool.confirmed?.blocks ?? []).slice(0, 8);
    const ps = pool.poolStats ?? {};

    const render = (raw: string, paid: boolean) => {
        const b = parseBlockString(raw);
        const href = blockURL ? explorerUrl(blockURL, b.blockHash) : null;
        const conf = confirms[b.blockHash];
        const status = paid ? (
            <span className="font-semibold text-green-600">
                {t('stats_paid')}
            </span>
        ) : conf != null ? (
            <span className="font-semibold text-red-600">
                {t('stats_conf_of_100', { conf })}
            </span>
        ) : (
            <span className="font-semibold text-red-600">
                {t('stats_pending_status')}
            </span>
        );
        return (
            <div
                key={(paid ? 'c' : 'p') + b.blockHash + b.height}
                className="rounded-md bg-black/5 px-3 py-2 text-sm"
            >
                <div className="flex flex-wrap items-center gap-x-3">
                    <span>
                        <i className="fas fa-bars fa-fw text-black/40" />{' '}
                        <span className="text-muted">
                            {t('stats_block_label')}
                        </span>{' '}
                        {href ? (
                            <a href={href} target="_blank" rel="noreferrer">
                                {b.height}
                            </a>
                        ) : (
                            b.height
                        )}
                    </span>
                    {b.time && (
                        <span className="text-muted">
                            {readableDate(b.time)}
                        </span>
                    )}
                    <span className="ml-auto">{status}</span>
                </div>
                <div className="mt-1">
                    <i className="fas fa-gavel fa-fw text-black/40" />{' '}
                    <span className="text-muted">{t('stats_mined_by')}</span>{' '}
                    <Link to={`/workers/${b.worker.split('.')[0]}`}>
                        {b.worker}
                    </Link>
                </div>
            </div>
        );
    };

    return (
        <div className="card mt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-lg font-bold">
                    {t('stats_blocks_found', { name: cap(pool.name) })}
                </span>
                <span className="text-sm text-muted">
                    <i className="fas fa-bars fa-fw" />{' '}
                    {t('stats_blocks_count', { count: toNum(ps.validBlocks) })}
                    &nbsp;&nbsp;
                    <i className="fas fa-money-bill fa-fw" />{' '}
                    {t('stats_paid_label')} {toNum(ps.totalPaid).toFixed(8)}{' '}
                    {pool.symbol}
                </span>
            </div>
            <div className="space-y-2">
                {pending.length || confirmed.length ? (
                    <>
                        {pending.map((b) => render(b, false))}
                        {confirmed.map((b) => render(b, true))}
                    </>
                ) : (
                    <div className="muted">{t('stats_no_blocks')}</div>
                )}
            </div>
        </div>
    );
}

function FindersPie({ pool }: { pool: PoolEntry }) {
    const { t } = useTranslation();
    const blocks = [
        ...(pool.pending?.blocks ?? []),
        ...(pool.confirmed?.blocks ?? [])
    ];
    const byWorker: Record<string, number> = {};
    for (const raw of blocks) {
        const w = parseBlockString(raw).worker;
        if (w) byWorker[w] = (byWorker[w] ?? 0) + 1;
    }
    const data = Object.entries(byWorker).map(([name, value]) => ({
        name,
        value
    }));
    if (!data.length) return null;
    return (
        <div className="card mt-4">
            <div className="mb-2 text-center font-semibold">
                {t('stats_finders', { count: blocks.length })}
            </div>
            <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={data}
                            dataKey="value"
                            nameKey="name"
                            outerRadius={120}
                            label={(e: any) => String(e.name).slice(0, 8)}
                        >
                            {data.map((_, i) => (
                                <Cell
                                    key={i}
                                    fill={COLORS[i % COLORS.length]}
                                />
                            ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

export default function Stats() {
    const { t } = useTranslation();
    const stats = useLiveStats();
    const historyQuery = useQuery({
        queryKey: ['poolHistory'],
        queryFn: getPoolHistory
    });
    const configQuery = useQuery({ queryKey: ['config'], queryFn: getConfig });

    if (!stats) return <div className="loading">{t('stats_loading')}</div>;

    const poolNames = Object.keys(stats.pools);
    const history = historyQuery.data ?? [];
    const hashData = history.map((pt) => {
        const row: any = { time: pt.time };
        for (const n of poolNames) row[n] = pt.pools[n]?.hashrate ?? 0;
        return row;
    });
    const pendData = history.map((pt) => {
        const row: any = { time: pt.time };
        for (const n of poolNames) row[n] = pt.pools[n]?.blocks?.pending ?? 0;
        return row;
    });
    const prices = stats.prices?.prices ?? {};
    const priceSyms = Object.keys(prices);

    return (
        <div>
            <h1 className="page-title">{t('stats_title')}</h1>

            <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
                <div className="card">
                    <div className="mb-2 text-center font-semibold">
                        {t('stats_historical_hashrate')}
                    </div>
                    <div className="h-[280px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={hashData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis
                                    dataKey="time"
                                    tickFormatter={shortTime}
                                    fontSize={11}
                                />
                                <YAxis
                                    width={70}
                                    fontSize={11}
                                    tickFormatter={(v: number) =>
                                        readableHashRateString(v)
                                    }
                                />
                                <Tooltip
                                    formatter={(v: any) =>
                                        readableHashRateString(v)
                                    }
                                    labelFormatter={(t: any) => readableDate(t)}
                                />
                                {poolNames.map((n, i) => (
                                    <Line
                                        key={n}
                                        type="monotone"
                                        dataKey={n}
                                        stroke={COLORS[i % COLORS.length]}
                                        dot={false}
                                        isAnimationActive={false}
                                    />
                                ))}
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
                <div className="card">
                    <div className="mb-2 text-center font-semibold">
                        {t('stats_pending_blocks')}
                    </div>
                    <div className="h-[280px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={pendData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis
                                    dataKey="time"
                                    tickFormatter={shortTime}
                                    fontSize={11}
                                />
                                <YAxis
                                    width={40}
                                    fontSize={11}
                                    allowDecimals={false}
                                />
                                <Tooltip
                                    labelFormatter={(t: any) => readableDate(t)}
                                />
                                {poolNames.map((n, i) => (
                                    <Line
                                        key={n}
                                        type="monotone"
                                        dataKey={n}
                                        stroke={COLORS[i % COLORS.length]}
                                        dot={false}
                                        isAnimationActive={false}
                                    />
                                ))}
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {priceSyms.length > 0 && (
                <div className="card mt-4">
                    <div className="mb-2 font-semibold">
                        <i className="fas fa-coins fa-fw" />{' '}
                        {t('stats_live_prices')}
                        {stats.prices?.updated && (
                            <span className="ml-2 text-xs text-muted">
                                {t('stats_updated', {
                                    time: readableDate(stats.prices.updated)
                                })}
                            </span>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-x-8 gap-y-2">
                        {priceSyms.map((sym) => {
                            const p = prices[sym];
                            return (
                                <div key={sym}>
                                    <span className="font-bold">{sym}</span>{' '}
                                    {formatPrice(p.price)}{' '}
                                    {(p.vsCurrency || '').toUpperCase()}
                                    <span className="ml-1 text-xs text-muted">
                                        {t('stats_via', { source: p.source })}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {Object.values(stats.pools).map((pool) => {
                const ps = pool.poolStats ?? {};
                const share =
                    toNum(pool.hashrate) > 0 && toNum(ps.networkHash) > 0
                        ? (
                              (toNum(pool.hashrate) / toNum(ps.networkHash)) *
                              100
                          ).toFixed(5)
                        : '0';
                const blockURL =
                    configQuery.data?.pools?.[pool.name]?.coin?.explorer
                        ?.blockURL;
                return (
                    <section key={pool.name} className="mt-6">
                        <h2 className="mb-3 text-xl font-bold">
                            {cap(pool.name)}{' '}
                            <span className="text-sm font-normal text-muted">
                                [{pool.symbol}] · {cap(pool.algorithm ?? '')}
                            </span>
                        </h2>
                        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
                            <div className="card">
                                <div className="mb-2 font-semibold text-accent2">
                                    <i className="fas fa-server fa-fw" />{' '}
                                    {t('stats_pool_stats')}
                                </div>
                                <Row
                                    icon="fa-users"
                                    label={t('stats_miners')}
                                    value={pool.minerCount ?? 0}
                                />
                                <Row
                                    icon="fa-gears"
                                    label={t('stats_workers')}
                                    value={pool.workerCount ?? 0}
                                />
                                <Row
                                    icon="fa-gauge-simple-high"
                                    label={t('stats_hashrate')}
                                    value={
                                        pool.hashrateString ||
                                        readableHashRateString(pool.hashrate)
                                    }
                                />
                                <Row
                                    icon="fa-clock"
                                    label={t('stats_luck')}
                                    value={readableLuckTime(pool.luckDays)}
                                />
                                <Row
                                    icon="fa-chart-pie"
                                    label={t('stats_pool_share')}
                                    value={`${share} %`}
                                />
                            </div>
                            <div className="card">
                                <div className="mb-2 font-semibold text-accent3">
                                    <i className="fas fa-globe fa-fw" />{' '}
                                    {t('stats_network_stats')}
                                </div>
                                <Row
                                    icon="fa-bars"
                                    label={t('stats_block_height')}
                                    value={toNum(ps.networkBlocks)}
                                />
                                <Row
                                    icon="fa-gauge-simple-high"
                                    label={t('stats_network_hs')}
                                    value={
                                        ps.networkHashString ||
                                        readableHashRateString(ps.networkHash)
                                    }
                                />
                                <Row
                                    icon="fa-unlock"
                                    label={t('stats_difficulty')}
                                    value={toNum(ps.networkDiff).toFixed(8)}
                                />
                                <Row
                                    icon="fa-signal"
                                    label={t('stats_connections')}
                                    value={toNum(ps.networkConnections)}
                                />
                                <Row
                                    icon="fa-code-fork"
                                    label={t('stats_daemon')}
                                    value={ps.networkVersion || '—'}
                                />
                                <Row
                                    icon="fa-flask"
                                    label={t('stats_algorithm')}
                                    value={cap(pool.algorithm ?? '')}
                                />
                            </div>
                            <div className="card">
                                <div className="mb-2 font-semibold text-accent">
                                    <i className="fas fa-cubes fa-fw" />{' '}
                                    {t('stats_block_stats')}
                                </div>
                                <Row
                                    icon="fa-cubes"
                                    label={t('stats_total_blocks')}
                                    value={toNum(ps.validBlocks)}
                                />
                                <Row
                                    icon="fa-hourglass-half"
                                    label={t('stats_pending')}
                                    value={pool.blocks?.pending ?? 0}
                                />
                                <Row
                                    icon="fa-gavel"
                                    label={t('stats_confirmed')}
                                    value={pool.blocks?.confirmed ?? 0}
                                />
                                <Row
                                    icon="fa-square-xmark"
                                    label={t('stats_orphaned')}
                                    value={pool.blocks?.orphaned ?? 0}
                                />
                                <Row
                                    icon="fa-square-check"
                                    label={t('stats_valid_shares')}
                                    value={toNum(ps.validShares)}
                                />
                                <Row
                                    icon="fa-square-minus"
                                    label={t('stats_invalid_shares')}
                                    value={toNum(ps.invalidShares)}
                                />
                            </div>
                        </div>

                        <PoolBlocks pool={pool} blockURL={blockURL} />
                        <FindersPie pool={pool} />
                    </section>
                );
            })}
        </div>
    );
}
