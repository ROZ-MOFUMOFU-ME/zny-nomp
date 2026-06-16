import { useLiveStats } from '../api/useLiveStats.tsx';
import { readableHashRateString, toNum } from '../lib/format.ts';

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export default function TabStats() {
    const stats = useLiveStats();
    if (!stats) return <div className="loading">Loading…</div>;
    const pools = Object.values(stats.pools);
    return (
        <div>
            <h1 className="page-title">
                <i className="fas fa-table fa-fw text-accent" /> Tab Stats
            </h1>
            <div className="overflow-x-auto">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Pool</th>
                            <th>Algo</th>
                            <th className="text-right">Workers</th>
                            <th className="text-right">Valid</th>
                            <th className="text-right">Invalid</th>
                            <th className="text-right">Blocks</th>
                            <th className="text-right">Pending</th>
                            <th className="text-right">Confirmed</th>
                            <th className="text-right">Orphaned</th>
                            <th className="text-right">Hashrate</th>
                        </tr>
                    </thead>
                    <tbody>
                        {pools.map((p) => (
                            <tr key={p.name}>
                                <td className="font-medium">{cap(p.name)}</td>
                                <td>{cap(p.algorithm ?? '')}</td>
                                <td className="text-right">
                                    {p.workerCount ??
                                        Object.keys(p.workers || {}).length}
                                </td>
                                <td className="text-right">
                                    {toNum(p.poolStats?.validShares)}
                                </td>
                                <td className="text-right">
                                    {toNum(p.poolStats?.invalidShares)}
                                </td>
                                <td className="text-right">
                                    {toNum(p.poolStats?.validBlocks)}
                                </td>
                                <td className="text-right">
                                    {p.blocks?.pending ?? 0}
                                </td>
                                <td className="text-right">
                                    {p.blocks?.confirmed ?? 0}
                                </td>
                                <td className="text-right">
                                    {p.blocks?.orphaned ?? 0}
                                </td>
                                <td className="whitespace-nowrap text-right">
                                    {p.hashrateString ||
                                        readableHashRateString(p.hashrate)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
