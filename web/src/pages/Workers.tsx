import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveStats } from '../api/useLiveStats.tsx';
import { readableHashRateString, toNum } from '../lib/format.ts';

// Per-pool "Top Miners" overview at /workers, plus an address lookup that jumps
// to the per-worker page (/workers/:address). Numeric fields from the API may be
// strings, so every comparison/derivation goes through toNum.
export default function Workers() {
    const stats = useLiveStats();
    const navigate = useNavigate();
    const [address, setAddress] = useState('');

    function lookup() {
        const value = address.trim();
        if (value) navigate(`/workers/${encodeURIComponent(value)}`);
    }

    return (
        <div>
            <h1 className="page-title">Workers</h1>

            <form
                className="lookup-form"
                onSubmit={(e) => {
                    e.preventDefault();
                    lookup();
                }}
            >
                <input
                    placeholder="Enter your address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                />
                <button className="btn" type="submit">
                    Lookup
                </button>
            </form>

            {stats === null ? (
                <div className="loading">Loading…</div>
            ) : (
                Object.values(stats.pools)
                    .filter((pool) => pool.miners)
                    .map((pool) => {
                        const rows = Object.entries(pool.miners ?? {})
                            .map(([addr, miner]) => {
                                const shares = toNum(miner.shares);
                                const invalid = toNum(miner.invalidshares);
                                const total = shares + invalid;
                                const efficiency =
                                    total > 0
                                        ? ((shares / total) * 100).toFixed(2) +
                                          '%'
                                        : '—';
                                return {
                                    addr,
                                    currRoundShares: toNum(
                                        miner.currRoundShares
                                    ),
                                    efficiency,
                                    hashrate:
                                        miner.hashrateString ||
                                        readableHashRateString(miner.hashrate),
                                    hashrateNum: toNum(miner.hashrate)
                                };
                            })
                            .sort((a, b) => b.hashrateNum - a.hashrateNum)
                            .slice(0, 50);

                        return (
                            <div className="card" key={pool.name}>
                                <h2>
                                    {pool.name}{' '}
                                    <span className="muted">
                                        ({pool.minerCount ?? 0} miners ·{' '}
                                        {pool.workerCount ?? 0} workers)
                                    </span>
                                </h2>
                                <h3>Top Miners</h3>
                                <table className="data">
                                    <thead>
                                        <tr>
                                            <th>Address</th>
                                            <th className="right">
                                                Current-round Shares
                                            </th>
                                            <th className="right">
                                                Efficiency %
                                            </th>
                                            <th className="right">Hashrate</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((row) => (
                                            <tr key={row.addr}>
                                                <td className="nowrap">
                                                    {row.addr}
                                                </td>
                                                <td className="right">
                                                    {row.currRoundShares}
                                                </td>
                                                <td className="right">
                                                    {row.efficiency}
                                                </td>
                                                <td className="right nowrap">
                                                    {row.hashrate}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        );
                    })
            )}
        </div>
    );
}
