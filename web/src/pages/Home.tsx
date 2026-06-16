import { useLiveStats } from '../api/useLiveStats.tsx';
import { readableHashRateString } from '../lib/format.ts';

export default function Home() {
    const stats = useLiveStats();
    return (
        <div>
            <h1 className="page-title">zny-nomp</h1>
            <div className="grid grid-2">
                <div className="card">
                    <h2>Global Stats (per algorithm)</h2>
                    {stats ? (
                        Object.entries(stats.algos).map(([algo, a]) => (
                            <div className="stat" key={algo}>
                                <span className="label">{algo}</span>
                                <span className="value">
                                    {a.workers} miners ·{' '}
                                    {a.hashrateString ||
                                        readableHashRateString(a.hashrate)}
                                </span>
                            </div>
                        ))
                    ) : (
                        <div className="muted">Loading…</div>
                    )}
                </div>
                <div className="card">
                    <h2>Pools / Coins</h2>
                    {stats ? (
                        Object.values(stats.pools).map((p) => (
                            <div className="stat" key={p.name}>
                                <span className="label">{p.name}</span>
                                <span className="value">
                                    {p.workerCount ?? 0} miners ·{' '}
                                    {p.hashrateString ||
                                        readableHashRateString(p.hashrate)}
                                </span>
                            </div>
                        ))
                    ) : (
                        <div className="muted">Loading…</div>
                    )}
                </div>
            </div>
        </div>
    );
}
