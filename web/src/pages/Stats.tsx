import { useLiveStats } from '../api/useLiveStats.tsx';
import { getPoolHistory, getConfig } from '../api/client.ts';
import { useQuery } from '@tanstack/react-query';
import type { PoolEntry, PoolHistoryPoint, AppConfig } from '../api/types.ts';
import {
    toNum,
    readableHashRateString,
    parseBlockString,
    formatTime,
    explorerUrl
} from '../lib/format.ts';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    CartesianGrid,
    PieChart,
    Pie,
    Cell
} from 'recharts';

// Small fixed palette reused across the per-pool line charts and pies.
const PALETTE = [
    '#0eafc7',
    '#b064e1',
    '#10bb9c',
    '#f06350',
    '#f5a623',
    '#4a90d9',
    '#7ed321',
    '#bd10e0'
];

const CONFIRMED_LIMIT = 25;

// A row for recharts: { time, <poolName>: hashrate, ... } merged across pools.
type ChartRow = Record<string, number>;

function shortTime(unixSeconds: number): string {
    const d = new Date(unixSeconds * 1000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Flatten PoolHistoryPoint[] into recharts rows + the set of pool names seen.
function buildHistoryRows(history: PoolHistoryPoint[]): {
    poolNames: string[];
    hashrateRows: ChartRow[];
    pendingRows: ChartRow[];
} {
    const poolNameSet = new Set<string>();
    const hashrateRows: ChartRow[] = [];
    const pendingRows: ChartRow[] = [];
    for (const point of history) {
        const hashRow: ChartRow = { time: point.time };
        const pendingRow: ChartRow = { time: point.time };
        for (const [poolName, p] of Object.entries(point.pools)) {
            poolNameSet.add(poolName);
            hashRow[poolName] = toNum(p.hashrate);
            pendingRow[poolName] = toNum(p.blocks?.pending);
        }
        hashrateRows.push(hashRow);
        pendingRows.push(pendingRow);
    }
    return {
        poolNames: Array.from(poolNameSet),
        hashrateRows,
        pendingRows
    };
}

function HistoryCharts() {
    const { data, isLoading, isError } = useQuery({
        queryKey: ['poolHistory'],
        queryFn: getPoolHistory
    });

    if (isLoading) return <div className="loading">Loading history…</div>;
    if (isError || !data)
        return <div className="error">Failed to load pool history.</div>;
    if (data.length === 0)
        return <div className="muted">No history data yet.</div>;

    const { poolNames, hashrateRows, pendingRows } = buildHistoryRows(data);

    return (
        <div className="grid grid-2">
            <div className="card">
                <h2>Pool Hashrate (history)</h2>
                <div className="chart-wrap">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={hashrateRows}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                                dataKey="time"
                                tickFormatter={shortTime}
                                minTickGap={24}
                            />
                            <YAxis
                                tickFormatter={(v: number) =>
                                    readableHashRateString(v)
                                }
                                width={80}
                            />
                            <Tooltip
                                labelFormatter={(v: number) => formatTime(v)}
                                formatter={(v: number, name: string) => [
                                    readableHashRateString(v),
                                    name
                                ]}
                            />
                            {poolNames.map((poolName, i) => (
                                <Line
                                    key={poolName}
                                    type="monotone"
                                    dataKey={poolName}
                                    stroke={PALETTE[i % PALETTE.length]}
                                    dot={false}
                                    isAnimationActive={false}
                                />
                            ))}
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="card">
                <h2>Pending Blocks (history)</h2>
                <div className="chart-wrap">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={pendingRows}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                                dataKey="time"
                                tickFormatter={shortTime}
                                minTickGap={24}
                            />
                            <YAxis allowDecimals={false} width={40} />
                            <Tooltip
                                labelFormatter={(v: number) => formatTime(v)}
                            />
                            {poolNames.map((poolName, i) => (
                                <Line
                                    key={poolName}
                                    type="monotone"
                                    dataKey={poolName}
                                    stroke={PALETTE[i % PALETTE.length]}
                                    dot={false}
                                    isAnimationActive={false}
                                />
                            ))}
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}

function LivePrices({
    stats
}: {
    stats: NonNullable<ReturnType<typeof useLiveStats>>;
}) {
    const prices = stats.prices?.prices;
    if (!prices) return null;
    const entries = Object.entries(prices);
    if (entries.length === 0) return null;

    return (
        <div className="card">
            <h2>Live Prices</h2>
            <table className="data">
                <thead>
                    <tr>
                        <th>Symbol</th>
                        <th className="right">Price</th>
                        <th>Currency</th>
                        <th>Source</th>
                    </tr>
                </thead>
                <tbody>
                    {entries.map(([symbol, row]) => (
                        <tr key={symbol}>
                            <td className="nowrap">{symbol}</td>
                            <td className="right">{row.price}</td>
                            <td>{row.vsCurrency.toUpperCase()}</td>
                            <td>{row.source}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function PoolCard({ pool }: { pool: PoolEntry }) {
    const ps = pool.poolStats;
    const networkHash =
        ps?.networkHashString || readableHashRateString(ps?.networkHash);
    return (
        <div className="card">
            <h2>{pool.name}</h2>

            <h3>Pool</h3>
            <div className="stat">
                <span className="label">Miners</span>
                <span className="value">{pool.minerCount ?? 0}</span>
            </div>
            <div className="stat">
                <span className="label">Workers</span>
                <span className="value">{pool.workerCount ?? 0}</span>
            </div>
            <div className="stat">
                <span className="label">Hashrate</span>
                <span className="value">
                    {pool.hashrateString ||
                        readableHashRateString(pool.hashrate)}
                </span>
            </div>

            <h3>Network</h3>
            <div className="stat">
                <span className="label">Block height</span>
                <span className="value">{toNum(ps?.networkBlocks)}</span>
            </div>
            <div className="stat">
                <span className="label">Network hashrate</span>
                <span className="value">{networkHash}</span>
            </div>
            <div className="stat">
                <span className="label">Difficulty</span>
                <span className="value">{toNum(ps?.networkDiff)}</span>
            </div>
            <div className="stat">
                <span className="label">Connections</span>
                <span className="value">{toNum(ps?.networkConnections)}</span>
            </div>

            <h3>Blocks</h3>
            <div className="stat">
                <span className="label">Pending</span>
                <span className="value">{pool.blocks?.pending ?? 0}</span>
            </div>
            <div className="stat">
                <span className="label">Confirmed</span>
                <span className="value">{pool.blocks?.confirmed ?? 0}</span>
            </div>
            <div className="stat">
                <span className="label">Orphaned</span>
                <span className="value">{pool.blocks?.orphaned ?? 0}</span>
            </div>
        </div>
    );
}

function BlockRow({
    raw,
    state,
    blockURL
}: {
    raw: string;
    state: string;
    blockURL?: string;
}) {
    const b = parseBlockString(raw);
    const linkValue = b.hash || b.height;
    const url = explorerUrl(blockURL, linkValue);
    return (
        <tr>
            <td className="nowrap">
                {url ? (
                    <a href={url} target="_blank" rel="noreferrer">
                        {b.height}
                    </a>
                ) : (
                    b.height
                )}
            </td>
            <td>{state}</td>
            <td>{b.worker}</td>
            <td className="nowrap">{formatTime(b.time)}</td>
        </tr>
    );
}

function BlocksFound({
    pool,
    config
}: {
    pool: PoolEntry;
    config: AppConfig | undefined;
}) {
    const pending = pool.pending?.blocks ?? [];
    const confirmed = (pool.confirmed?.blocks ?? []).slice(0, CONFIRMED_LIMIT);
    if (pending.length === 0 && confirmed.length === 0) return null;

    const blockURL = config?.pools?.[pool.name]?.coin.explorer?.blockURL;

    return (
        <div className="card">
            <h3>Blocks Found — {pool.name}</h3>
            <table className="data">
                <thead>
                    <tr>
                        <th>Height</th>
                        <th>State</th>
                        <th>Worker</th>
                        <th>Time</th>
                    </tr>
                </thead>
                <tbody>
                    {pending.map((raw, i) => (
                        <BlockRow
                            key={'pending-' + i}
                            raw={raw}
                            state="pending"
                            blockURL={blockURL}
                        />
                    ))}
                    {confirmed.map((raw, i) => (
                        <BlockRow
                            key={'confirmed-' + i}
                            raw={raw}
                            state="confirmed"
                            blockURL={blockURL}
                        />
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function FindersPie({ pool }: { pool: PoolEntry }) {
    const pending = pool.pending?.blocks ?? [];
    if (pending.length === 0) return null;

    const counts: Record<string, number> = {};
    for (const raw of pending) {
        const worker = parseBlockString(raw).worker || 'unknown';
        counts[worker] = (counts[worker] ?? 0) + 1;
    }
    const data = Object.entries(counts).map(([worker, value]) => ({
        name: worker,
        value
    }));

    return (
        <div className="card">
            <h3>Pending Finders — {pool.name}</h3>
            <div className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={data}
                            dataKey="value"
                            nameKey="name"
                            outerRadius="80%"
                            label
                        >
                            {data.map((entry, i) => (
                                <Cell
                                    key={entry.name}
                                    fill={PALETTE[i % PALETTE.length]}
                                />
                            ))}
                        </Pie>
                        <Tooltip />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

export default function Stats() {
    const stats = useLiveStats();
    const { data: config } = useQuery({
        queryKey: ['config'],
        queryFn: getConfig
    });

    if (!stats) return <div className="loading">Loading…</div>;

    const pools = Object.values(stats.pools);

    return (
        <div>
            <h1 className="page-title">Pool Stats</h1>

            <HistoryCharts />

            <LivePrices stats={stats} />

            <h2>Pools</h2>
            <div className="grid grid-2">
                {pools.map((pool) => (
                    <PoolCard key={pool.name} pool={pool} />
                ))}
            </div>

            <h2>Blocks Found</h2>
            {pools.map((pool) => (
                <BlocksFound key={pool.name} pool={pool} config={config} />
            ))}

            <h2>Pending Finders</h2>
            <div className="grid grid-2">
                {pools.map((pool) => (
                    <FindersPie key={pool.name} pool={pool} />
                ))}
            </div>
        </div>
    );
}
