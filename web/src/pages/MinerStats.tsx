import type { ReactNode } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useLiveStats } from '../api/useLiveStats.tsx';
import { getWorkerStats, getConfig } from '../api/client.ts';
import type { WorkerStats, WorkerEntry } from '../api/types.ts';
import {
    readableHashRateString,
    readableLuckTime,
    formatAmount,
    toNum,
    shortTime,
    readableDate
} from '../lib/format.ts';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    CartesianGrid
} from 'recharts';

// Deterministic per-line colours (cycled by worker index) so we don't pull in
// any extra colour dependency.
const LINE_COLORS = [
    '#0eafc7',
    '#b064e1',
    '#10bb9c',
    '#f0a90e',
    '#e1646b',
    '#646be1',
    '#10bb6b',
    '#39a0ed'
];

type MergedRow = { time: number; [worker: string]: number };

// Collapse history (Record<worker, {time,hashrate}[]>) into one dataset keyed by
// time, with a numeric column per worker — recharts wants a unified array.
function mergeHistory(history: WorkerStats['history']): {
    rows: MergedRow[];
    workers: string[];
} {
    const workers = Object.keys(history);
    const byTime = new Map<number, MergedRow>();
    for (const worker of workers) {
        for (const point of history[worker] ?? []) {
            const time = toNum(point.time);
            let row = byTime.get(time);
            if (!row) {
                row = { time };
                byTime.set(time, row);
            }
            row[worker] = toNum(point.hashrate);
        }
    }
    const rows = Array.from(byTime.values()).sort((a, b) => a.time - b.time);
    return { rows, workers };
}

// Mean hashrate of one worker's history series.
function seriesAvg(points: Array<{ hashrate: number }> | undefined): number {
    if (!points || points.length === 0) return 0;
    let sum = 0;
    for (const p of points) sum += toNum(p.hashrate);
    return sum / points.length;
}

// Total average hashrate over the window — mirrors the legacy
// calculateAverageHashrate(null): sum every point, divide by the longest series.
function totalAvg(history: WorkerStats['history']): number {
    let sum = 0;
    let max = 1;
    for (const points of Object.values(history)) {
        if (points.length > max) max = points.length;
        for (const p of points) sum += toNum(p.hashrate);
    }
    return sum / max;
}

// Combined luck across all of a miner's workers (legacy: 1 / Σ(1/luckDays)).
function combinedLuckDays(workers: Record<string, WorkerEntry>): number {
    let inv = 0;
    for (const w of Object.values(workers)) {
        const ld = toNum(w.luckDays);
        if (ld > 0) inv += 1 / ld;
    }
    return inv > 0 ? 1 / inv : 0;
}

// Worker label = the part after the dot (rig name), or "noname".
function workerLabel(key: string): string {
    const parts = key.split('.');
    return parts.length > 1 && parts[1] ? parts[1] : 'noname';
}

function Stat({
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

export default function MinerStats() {
    const { t } = useTranslation();
    const { address } = useParams();
    const live = useLiveStats();

    // Re-key on live?.time so a fresh SSE snapshot triggers a refetch (mirrors
    // the legacy per-tick refresh); refetchInterval is the fallback.
    const { data, isLoading, isError } = useQuery({
        queryKey: ['workerStats', address, live?.time],
        queryFn: () => getWorkerStats(address!),
        enabled: !!address,
        refetchInterval: 60000
    });
    const config = useQuery({ queryKey: ['config'], queryFn: getConfig });

    if (!address) return <div className="error">{t('miner_no_address')}</div>;
    if (isLoading) return <div className="loading">{t('miner_loading')}</div>;
    if (isError || !data || data.result === 'error')
        return <div className="error">{t('miner_no_data')}</div>;

    const { rows, workers } = mergeHistory(data.history);
    const workerEntries: [string, WorkerEntry][] = Object.entries(data.workers);
    // Link the address to the coin's block explorer (first pool that defines an
    // address URL — single-coin pools are unambiguous).
    const explorerAddr = Object.values(config.data?.pools ?? {})
        .map((p) => p.coin?.explorer?.address)
        .find(
            (u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u)
        );

    return (
        <div>
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                <h1 className="m-0 break-all text-2xl font-bold">
                    <i className="fas fa-user fa-fw text-accent" />{' '}
                    {explorerAddr ? (
                        <a
                            href={explorerAddr + address}
                            target="_blank"
                            rel="noreferrer"
                            title={t('miner_view_on_explorer')}
                        >
                            {address}
                        </a>
                    ) : (
                        address
                    )}
                </h1>
                <Link className="text-sm" to="/workers">
                    <i className="fas fa-arrow-left fa-fw" />{' '}
                    {t('miner_back_to_workers')}
                </Link>
            </div>

            {/* Hashrate chart with the headline now/avg/luck readouts. */}
            <div className="card">
                <div className="mb-2 flex flex-wrap items-center gap-x-6 gap-y-1">
                    <span className="font-semibold">{t('miner_hashrate')}</span>
                    <span className="ml-auto text-sm text-muted">
                        <i className="fas fa-gauge-simple-high fa-fw" />{' '}
                        {readableHashRateString(data.totalHash)}{' '}
                        {t('miner_now')}
                    </span>
                    <span className="text-sm text-muted">
                        <i className="fas fa-gauge-simple fa-fw" />{' '}
                        {readableHashRateString(totalAvg(data.history))}{' '}
                        {t('miner_avg')}
                    </span>
                    <span className="text-sm text-muted">
                        <i className="fas fa-clock fa-fw" /> {t('miner_luck')}{' '}
                        {readableLuckTime(combinedLuckDays(data.workers))}
                    </span>
                </div>

                {rows.length > 0 && workers.length > 0 ? (
                    <div className="h-[280px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={rows}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis
                                    dataKey="time"
                                    tickFormatter={(t) => shortTime(t)}
                                    minTickGap={32}
                                    fontSize={11}
                                />
                                <YAxis
                                    tickFormatter={(v) =>
                                        readableHashRateString(v)
                                    }
                                    width={90}
                                    fontSize={11}
                                />
                                <Tooltip
                                    labelFormatter={(t) => readableDate(t)}
                                    formatter={(value) =>
                                        readableHashRateString(value)
                                    }
                                />
                                {workers.map((worker, i) => (
                                    <Line
                                        key={worker}
                                        type="monotone"
                                        dataKey={worker}
                                        name={workerLabel(worker)}
                                        stroke={
                                            LINE_COLORS[i % LINE_COLORS.length]
                                        }
                                        dot={false}
                                        connectNulls
                                        isAnimationActive={false}
                                    />
                                ))}
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <div className="muted">{t('miner_no_history')}</div>
                )}

                <div className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-sm">
                    <span>
                        <i className="fas fa-chart-bar fa-fw text-black/40" />{' '}
                        <span className="text-muted">{t('miner_shares')}:</span>{' '}
                        <span className="font-medium">
                            {toNum(data.totalShares).toFixed(2)}
                        </span>
                    </span>
                    <span>
                        <i className="fas fa-hourglass-half fa-fw text-black/40" />{' '}
                        <span className="text-muted">
                            {t('miner_immature')}:
                        </span>{' '}
                        <span className="font-medium">
                            {formatAmount(data.immature)}
                        </span>
                    </span>
                    <span>
                        <i className="fas fa-wallet fa-fw text-black/40" />{' '}
                        <span className="text-muted">
                            {t('miner_balance')}:
                        </span>{' '}
                        <span className="font-medium">
                            {formatAmount(data.balance)}
                        </span>
                    </span>
                    <span>
                        <i className="fas fa-money-bill fa-fw text-black/40" />{' '}
                        <span className="text-muted">{t('miner_paid')}:</span>{' '}
                        <span className="font-medium">
                            {formatAmount(data.paid)}
                        </span>
                    </span>
                </div>
            </div>

            {/* Per-worker boxes. */}
            <div className="mt-4 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
                {workerEntries.map(([name, w]) => (
                    <div className="card" key={name}>
                        <div className="mb-2 break-all text-lg font-bold">
                            <i className="fas fa-microchip fa-fw text-accent2" />{' '}
                            {workerLabel(name)}
                        </div>
                        <Stat
                            icon="fa-gauge-simple-high"
                            label={t('miner_hashrate_now')}
                            value={
                                w.hashrateString ||
                                readableHashRateString(w.hashrate)
                            }
                        />
                        <Stat
                            icon="fa-gauge-simple"
                            label={t('miner_hashrate_avg')}
                            value={readableHashRateString(
                                seriesAvg(data.history[name])
                            )}
                        />
                        <Stat
                            icon="fa-unlock"
                            label={t('miner_diff')}
                            value={toNum(w.diff)}
                        />
                        <Stat
                            icon="fa-chart-bar"
                            label={t('miner_shares')}
                            value={
                                Math.round(toNum(w.currRoundShares) * 100) / 100
                            }
                        />
                        <Stat
                            icon="fa-clock"
                            label={t('miner_luck')}
                            value={readableLuckTime(w.luckDays)}
                        />
                        <Stat
                            icon="fa-wallet"
                            label={t('miner_balance')}
                            value={formatAmount(w.balance)}
                        />
                        <Stat
                            icon="fa-money-bill"
                            label={t('miner_paid')}
                            value={formatAmount(w.paid)}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}
