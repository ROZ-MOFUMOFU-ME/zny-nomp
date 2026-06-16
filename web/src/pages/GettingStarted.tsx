import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getConfig } from '../api/client.ts';
import type { AppConfig, AppConfigPool } from '../api/types.ts';
import { toNum } from '../lib/format.ts';

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
        <div>
            <h1 className="page-title">Getting Started</h1>

            <div className="card">
                <h2>How to start mining</h2>
                <ol>
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
                <p className="muted">
                    Tip: the stratum host is{' '}
                    <code className="nowrap">{host}</code>. Replace it with the
                    actual pool hostname if it shows a placeholder.
                </p>
            </div>

            <div className="card">
                <h2>Choose a coin</h2>
                {poolEntries.length === 0 ? (
                    <div className="muted">No pools are configured.</div>
                ) : (
                    <div className="grid grid-3">
                        {poolEntries.map(([name, pool]) => {
                            const isActive = name === selected;
                            return (
                                <button
                                    type="button"
                                    key={name}
                                    className="btn"
                                    aria-pressed={isActive}
                                    onClick={() =>
                                        setSelected(isActive ? null : name)
                                    }
                                >
                                    <span className="stat">
                                        <span className="label">
                                            {pool.coin.name}
                                            {pool.coin.symbol
                                                ? ` (${pool.coin.symbol})`
                                                : ''}
                                        </span>
                                        <span className="value muted">
                                            {pool.coin.algorithm ?? 'unknown'}
                                        </span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {selectedPool && (
                <div className="card">
                    <h2>
                        Connection — {selectedPool.coin.name}
                        {selectedPool.coin.symbol
                            ? ` (${selectedPool.coin.symbol})`
                            : ''}
                    </h2>
                    <div className="stat">
                        <span className="label">Algorithm</span>
                        <span className="value">
                            {selectedPool.coin.algorithm ?? 'unknown'}
                        </span>
                    </div>
                    <div className="stat">
                        <span className="label">Username</span>
                        <span className="value">Your wallet address</span>
                    </div>

                    {Object.keys(selectedPool.ports ?? {}).length === 0 ? (
                        <div className="muted">
                            No stratum ports are configured for this coin.
                        </div>
                    ) : (
                        <table className="data">
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
                                            <td className="nowrap">{port}</td>
                                            <td>
                                                <code className="nowrap">
                                                    stratum+tcp://{host}:{port}
                                                </code>
                                            </td>
                                        </tr>
                                    )
                                )}
                            </tbody>
                        </table>
                    )}
                    <p className="muted">
                        Select the port that matches your hardware/difficulty,
                        then connect with the URL above.
                    </p>
                </div>
            )}

            <div className="card">
                <h2>Coin-Switching Ports</h2>
                <p className="muted">
                    These ports automatically switch to the most profitable coin
                    for a given algorithm — point your miner here to always mine
                    the best-paying coin.
                </p>
                {switchEntries.length === 0 ? (
                    <div className="muted">
                        No coin-switching ports are enabled.
                    </div>
                ) : (
                    <table className="data">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Algorithm</th>
                                <th>Stratum URL</th>
                                <th>Difficulty</th>
                            </tr>
                        </thead>
                        <tbody>
                            {switchEntries.map(([name, s]) => (
                                <tr key={name}>
                                    <td className="nowrap">{name}</td>
                                    <td>{s.algorithm ?? 'unknown'}</td>
                                    <td>
                                        <code className="nowrap">
                                            stratum+tcp://{host}:{s.port}
                                        </code>
                                    </td>
                                    <td>{toNum(s.diff)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
