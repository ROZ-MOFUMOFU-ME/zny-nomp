import { useLiveStats } from '../api/useLiveStats.tsx';
import { readableHashRateString, toNum } from '../lib/format.ts';

export default function TabStats() {
    const stats = useLiveStats();
    if (!stats) return <div className="loading">Loading…</div>;
    const pools = Object.values(stats.pools);
    return (
        <div>
            <h1 className="page-title">Tab Stats</h1>
            <table className="data">
                <thead>
                    <tr>
                        <th>Pool</th>
                        <th>Algo</th>
                        <th>Workers</th>
                        <th>Valid</th>
                        <th>Invalid</th>
                        <th>Blocks</th>
                        <th>Pending</th>
                        <th>Confirmed</th>
                        <th>Orphaned</th>
                        <th>Hashrate</th>
                    </tr>
                </thead>
                <tbody>
                    {pools.map((p) => (
                        <tr key={p.name}>
                            <td>{p.name}</td>
                            <td>{p.algorithm}</td>
                            <td>
                                {p.workerCount ??
                                    Object.keys(p.workers || {}).length}
                            </td>
                            <td>{toNum(p.poolStats?.validShares)}</td>
                            <td>{toNum(p.poolStats?.invalidShares)}</td>
                            <td>{toNum(p.poolStats?.validBlocks)}</td>
                            <td>{p.blocks?.pending ?? 0}</td>
                            <td>{p.blocks?.confirmed ?? 0}</td>
                            <td>{p.blocks?.orphaned ?? 0}</td>
                            <td className="nowrap">
                                {p.hashrateString ||
                                    readableHashRateString(p.hashrate)}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
