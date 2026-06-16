import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveStats } from '../api/useLiveStats.tsx';
import { readableHashRateString, toNum } from '../lib/format.ts';

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

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
                className="mb-5 flex flex-wrap gap-2"
                onSubmit={(e) => {
                    e.preventDefault();
                    lookup();
                }}
            >
                <input
                    className="field min-w-[260px] flex-1"
                    placeholder="Enter your address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                />
                <button className="btn" type="submit">
                    <i className="fas fa-magnifying-glass fa-fw" /> Lookup
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
                            <section className="mb-6" key={pool.name}>
                                <h2 className="mb-2 text-xl font-bold">
                                    <i className="fas fa-coins fa-fw text-accent" />{' '}
                                    {cap(pool.name)}{' '}
                                    <span className="text-sm font-normal text-muted">
                                        ({pool.minerCount ?? 0} miners ·{' '}
                                        {pool.workerCount ?? 0} workers)
                                    </span>
                                </h2>
                                <div className="overflow-x-auto">
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Address</th>
                                                <th className="text-right">
                                                    Current-round Shares
                                                </th>
                                                <th className="text-right">
                                                    Efficiency %
                                                </th>
                                                <th className="text-right">
                                                    Hashrate
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rows.map((row) => (
                                                <tr key={row.addr}>
                                                    <td className="break-all">
                                                        <Link
                                                            to={`/workers/${encodeURIComponent(
                                                                row.addr
                                                            )}`}
                                                        >
                                                            {row.addr}
                                                        </Link>
                                                    </td>
                                                    <td className="text-right">
                                                        {row.currRoundShares}
                                                    </td>
                                                    <td className="text-right">
                                                        {row.efficiency}
                                                    </td>
                                                    <td className="whitespace-nowrap text-right">
                                                        {row.hashrate}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </section>
                        );
                    })
            )}
        </div>
    );
}
