import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getConfig } from '../api/client.ts';
import type { AppConfig, AppConfigPool } from '../api/types.ts';
import { toNum } from '../lib/format.ts';

const code = 'whitespace-nowrap rounded bg-black/5 px-1.5 py-0.5';

// /getting_started — step-by-step mining instructions. Reads GET /api/config so
// the listed coins, stratum host and (auto-switching) ports always match the
// running pool. Numeric config fields may arrive as strings, so values that are
// rendered/compared go through toNum.
export default function GettingStarted() {
    const {
        data: config,
        isLoading,
        isError
    } = useQuery<AppConfig>({ queryKey: ['config'], queryFn: getConfig });

    const [selected, setSelected] = useState<string | null>(null);

    if (isLoading) {
        return <div className="loading">Loading…</div>;
    }
    if (isError || !config) {
        return <div className="error">Failed to load pool configuration.</div>;
    }

    const host = config.stratumHost || 'YOUR_POOL_HOST';
    const pools = config.pools ?? {};
    const poolEntries = Object.entries(pools);

    // The currently selected coin (falls back to nothing if it disappeared).
    const selectedPool: AppConfigPool | undefined = selected
        ? pools[selected]
        : undefined;

    // Auto-switching ports that are actually enabled.
    const switchEntries = Object.entries(config.switching ?? {}).filter(
        ([, s]) => s.enabled === true
    );

    return (
        <div className="space-y-4">
            <h1 className="page-title">
                <i className="fas fa-rocket fa-fw text-accent" /> Getting
                Started
            </h1>

            <div className="card">
                <h2 className="mb-3 text-lg font-bold">How to start mining</h2>
                <ol className="list-decimal space-y-1 pl-5">
                    <li>
                        Get a wallet address for the coin you want to mine — see
                        the <a href="/mining_key">Mining Key</a> page for how
                        your address is used as your mining username.
                    </li>
                    <li>
                        Pick a coin from the list below to see its connection
                        details.
                    </li>
                    <li>
                        Point your miner at the stratum URL shown for that coin
                        and use your wallet address as the username.
                    </li>
                </ol>
                <p className="muted mt-3">
                    Tip: the stratum host is{' '}
                    <code className={code}>{host}</code>. Replace it with the
                    actual pool hostname if it shows a placeholder.
                </p>
            </div>

            <div className="card">
                <h2 className="mb-3 text-lg font-bold">Choose a coin</h2>
                {poolEntries.length === 0 ? (
                    <div className="muted">No pools are configured.</div>
                ) : (
                    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
                        {poolEntries.map(([name, pool]) => {
                            const isActive = name === selected;
                            return (
                                <button
                                    type="button"
                                    key={name}
                                    aria-pressed={isActive}
                                    onClick={() =>
                                        setSelected(isActive ? null : name)
                                    }
                                    className={`rounded-lg border p-3 text-left transition ${
                                        isActive
                                            ? 'border-accent bg-accent/10'
                                            : 'border-black/10 bg-card hover:border-accent/50'
                                    }`}
                                >
                                    <div className="font-semibold">
                                        <i className="fas fa-coins fa-fw text-accent" />{' '}
                                        {pool.coin.name}
                                        {pool.coin.symbol
                                            ? ` (${pool.coin.symbol})`
                                            : ''}
                                    </div>
                                    <div className="text-sm text-muted">
                                        {pool.coin.algorithm ?? 'unknown'}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {selectedPool && (
                <div className="card">
                    <h2 className="mb-3 text-lg font-bold">
                        <i className="fas fa-plug fa-fw text-accent3" />{' '}
                        Connection — {selectedPool.coin.name}
                        {selectedPool.coin.symbol
                            ? ` (${selectedPool.coin.symbol})`
                            : ''}
                    </h2>
                    <div className="mb-3 max-w-md">
                        <div className="flex justify-between border-b border-dashed border-black/10 py-1">
                            <span className="text-muted">Algorithm</span>
                            <span className="font-semibold">
                                {selectedPool.coin.algorithm ?? 'unknown'}
                            </span>
                        </div>
                        <div className="flex justify-between py-1">
                            <span className="text-muted">Username</span>
                            <span className="font-semibold">
                                Your wallet address
                            </span>
                        </div>
                    </div>

                    {Object.keys(selectedPool.ports ?? {}).length === 0 ? (
                        <div className="muted">
                            No stratum ports are configured for this coin.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Port</th>
                                        <th>Stratum URL</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {Object.keys(selectedPool.ports ?? {}).map(
                                        (port) => (
                                            <tr key={port}>
                                                <td className="whitespace-nowrap">
                                                    {port}
                                                </td>
                                                <td>
                                                    <code className={code}>
                                                        stratum+tcp://{host}:
                                                        {port}
                                                    </code>
                                                </td>
                                            </tr>
                                        )
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <p className="muted mt-3">
                        Select the port that matches your hardware/difficulty,
                        then connect with the URL above.
                    </p>
                </div>
            )}

            <div className="card">
                <h2 className="mb-3 text-lg font-bold">
                    <i className="fas fa-shuffle fa-fw text-accent2" />{' '}
                    Coin-Switching Ports
                </h2>
                <p className="muted mb-3">
                    These ports automatically switch to the most profitable coin
                    for a given algorithm — point your miner here to always mine
                    the best-paying coin.
                </p>
                {switchEntries.length === 0 ? (
                    <div className="muted">
                        No coin-switching ports are enabled.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Algorithm</th>
                                    <th>Stratum URL</th>
                                    <th className="text-right">Difficulty</th>
                                </tr>
                            </thead>
                            <tbody>
                                {switchEntries.map(([name, s]) => (
                                    <tr key={name}>
                                        <td className="whitespace-nowrap">
                                            {name}
                                        </td>
                                        <td>{s.algorithm ?? 'unknown'}</td>
                                        <td>
                                            <code className={code}>
                                                stratum+tcp://{host}:{s.port}
                                            </code>
                                        </td>
                                        <td className="text-right">
                                            {toNum(s.diff)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
