import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLiveStats } from '../api/useLiveStats.tsx';
import { readableHashRateString, toNum } from '../lib/format.ts';

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Per-pool "Top Miners" overview at /workers, plus an address lookup that jumps
// to the per-worker page (/workers/:address). Numeric fields from the API may be
// strings, so every comparison/derivation goes through toNum.
export default function Workers() {
    const { t } = useTranslation();
    const stats = useLiveStats();
    const navigate = useNavigate();
    const [address, setAddress] = useState('');

    function lookup() {
        const value = address.trim();
        if (value) navigate(`/workers/${encodeURIComponent(value)}`);
    }

    return (
        <div>
            <h1 className="page-title">{t('work_title')}</h1>

            <form
                className="mb-5 flex flex-wrap gap-2"
                onSubmit={(e) => {
                    e.preventDefault();
                    lookup();
                }}
            >
                <input
                    className="field min-w-[260px] flex-1"
                    placeholder={t('work_address_placeholder')}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                />
                <button className="btn" type="submit">
                    <i className="fas fa-magnifying-glass fa-fw" />{' '}
                    {t('work_lookup')}
                </button>
            </form>

            {stats === null ? (
                <div className="loading">{t('work_loading')}</div>
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
                                        {t('work_miner_worker_counts', {
                                            miners: pool.minerCount ?? 0,
                                            workers: pool.workerCount ?? 0
                                        })}
                                    </span>
                                </h2>
                                <div className="overflow-x-auto">
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>{t('work_th_address')}</th>
                                                <th className="text-right">
                                                    {t('work_th_curr_shares')}
                                                </th>
                                                <th className="text-right">
                                                    {t('work_th_efficiency')}
                                                </th>
                                                <th className="text-right">
                                                    {t('work_th_hashrate')}
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
