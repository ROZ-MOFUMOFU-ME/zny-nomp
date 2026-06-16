import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useLiveStats } from '../api/useLiveStats.tsx';
import { getWorkerStats } from '../api/client.ts';
import type { WorkerStats, WorkerEntry } from '../api/types.ts';
import {
    readableHashRateString,
    readableLuckTime,
    formatCoins,
    toNum,
    formatTime
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
    '#4f9dff',
    '#ff7a59',
    '#41c7a9',
    '#d98cff',
    '#ffc247',
    '#7ed957',
    '#ff6b9d',
    '#5bc0eb'
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

export default function MinerStats() {
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

    if (!address) return <div className="error">No address.</div>;
    if (isLoading) return <div className="loading">Loading…</div>;
    if (isError || !data || data.result === 'error')
        return <div className="error">No data for this address.</div>;

    const { rows, workers } = mergeHistory(data.history);
    const workerEntries: [string, WorkerEntry][] = Object.entries(data.workers);

    return (
        <div>
            <h1 className="page-title">{address}</h1>
            <p>
                <Link to="/workers">← Back to workers</Link>
            </p>

            <div className="card">
                <h2>Totals</h2>
                <div className="stat">
                    <span className="label">Total hashrate</span>
                    <span className="value">
                        {readableHashRateString(data.totalHash)}
                    </span>
                </div>
                <div className="stat">
                    <span className="label">Total shares</span>
                    <span className="value">{data.totalShares}</span>
                </div>
                <div className="stat">
                    <span className="label">Immature</span>
                    <span className="value">{formatCoins(data.immature)}</span>
                </div>
                <div className="stat">
                    <span className="label">Balance</span>
                    <span className="value">{formatCoins(data.balance)}</span>
                </div>
                <div className="stat">
                    <span className="label">Paid</span>
                    <span className="value">{formatCoins(data.paid)}</span>
                </div>
            </div>

            <div className="card">
                <h2>Worker hashrate</h2>
                {rows.length > 0 && workers.length > 0 ? (
                    <div className="chart-wrap">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={rows}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis
                                    dataKey="time"
                                    tickFormatter={(t) => formatTime(t)}
                                    minTickGap={32}
                                />
                                <YAxis
                                    tickFormatter={(v) =>
                                        readableHashRateString(v)
                                    }
                                    width={90}
                                />
                                <Tooltip
                                    labelFormatter={(t) => formatTime(t)}
                                    formatter={(value: number | string) =>
                                        readableHashRateString(value)
                                    }
                                />
                                {workers.map((worker, i) => (
                                    <Line
                                        key={worker}
                                        type="monotone"
                                        dataKey={worker}
                                        name={worker}
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
                    <div className="muted">No history yet</div>
                )}
            </div>

            <div className="grid grid-2">
                {workerEntries.map(([name, w]) => (
                    <div className="card" key={name}>
                        <h2>{name}</h2>
                        <div className="stat">
                            <span className="label">Hashrate</span>
                            <span className="value">
                                {w.hashrateString ||
                                    readableHashRateString(w.hashrate)}
                            </span>
                        </div>
                        <div className="stat">
                            <span className="label">Round shares</span>
                            <span className="value">
                                {toNum(w.currRoundShares)}
                            </span>
                        </div>
                        <div className="stat">
                            <span className="label">Luck</span>
                            <span className="value">
                                {readableLuckTime(w.luckDays)}
                            </span>
                        </div>
                        <div className="stat">
                            <span className="label">Balance</span>
                            <span className="value">
                                {formatCoins(toNum(w.balance))}
                            </span>
                        </div>
                        <div className="stat">
                            <span className="label">Paid</span>
                            <span className="value">
                                {formatCoins(toNum(w.paid))}
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
