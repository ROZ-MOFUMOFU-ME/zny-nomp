import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { getConfig } from '../api/client.ts';
import type { AppConfig, AppConfigPool, AppConfigPort } from '../api/types.ts';
import { toNum } from '../lib/format.ts';

const code =
    'whitespace-nowrap rounded bg-black/5 dark:bg-white/5 px-1.5 py-0.5';

// /getting_started — step-by-step mining instructions. Reads GET /api/config so
// the listed coins, stratum host and (auto-switching) ports always match the
// running pool. Numeric config fields may arrive as strings, so values that are
// rendered/compared go through toNum.
export default function GettingStarted() {
    const { t } = useTranslation();
    const {
        data: config,
        isLoading,
        isError
    } = useQuery<AppConfig>({ queryKey: ['config'], queryFn: getConfig });

    const [selected, setSelected] = useState<string | null>(null);

    if (isLoading) {
        return <div className="loading">{t('gs_loading')}</div>;
    }
    if (isError || !config) {
        return <div className="error">{t('gs_load_failed')}</div>;
    }

    const host = config.stratumHost || 'YOUR_POOL_HOST';
    const pools = config.pools ?? {};
    const poolEntries = Object.entries(pools);

    // The currently selected coin (falls back to nothing if it disappeared).
    const selectedPool: AppConfigPool | undefined = selected
        ? pools[selected]
        : undefined;

    // Normalize the selected coin's mining-software links ({name,url} or a bare
    // URL string), keeping only safe http(s) URLs.
    const miningTools = (selectedPool?.coin.miningTools ?? [])
        .map((t) =>
            typeof t === 'string'
                ? { url: t, name: t }
                : { url: t.url, name: t.name || t.url }
        )
        .filter(
            (t) => typeof t.url === 'string' && /^https?:\/\//i.test(t.url)
        );

    // Auto-switching ports that are actually enabled.
    const switchEntries = Object.entries(config.switching ?? {}).filter(
        ([, s]) => s.enabled === true
    );

    return (
        <div className="space-y-4">
            <h1 className="page-title">
                <i className="fas fa-rocket fa-fw text-accent" />{' '}
                {t('gs_title')}
            </h1>

            <div className="card">
                <h2 className="mb-3 text-lg font-bold">
                    {t('gs_how_to_start')}
                </h2>
                <ol className="list-decimal space-y-1 pl-5">
                    <li>{t('gs_step_address')}</li>
                    <li>{t('gs_step_pick')}</li>
                    <li>{t('gs_step_connect')}</li>
                </ol>
                <p className="muted mt-3">
                    {t('gs_tip_host_before')}{' '}
                    <code className={code}>{host}</code>{' '}
                    {t('gs_tip_host_after')}
                </p>
            </div>

            <div className="card">
                <h2 className="mb-3 text-lg font-bold">
                    {t('gs_choose_coin')}
                </h2>
                {poolEntries.length === 0 ? (
                    <div className="muted">{t('gs_no_pools')}</div>
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
                                            : 'border-line bg-card hover:border-accent/50'
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
                        {t('gs_connection', { coin: selectedPool.coin.name })}
                        {selectedPool.coin.symbol
                            ? ` (${selectedPool.coin.symbol})`
                            : ''}
                    </h2>
                    <div className="mb-3 max-w-md">
                        <div className="flex justify-between border-b border-dashed border-line py-1">
                            <span className="text-muted">
                                {t('gs_algorithm')}
                            </span>
                            <span className="font-semibold">
                                {selectedPool.coin.algorithm ?? 'unknown'}
                            </span>
                        </div>
                        <div className="flex justify-between py-1">
                            <span className="text-muted">
                                {t('gs_username')}
                            </span>
                            <span className="font-semibold">
                                {t('gs_your_wallet_address')}
                            </span>
                        </div>
                    </div>

                    {Object.keys(selectedPool.ports ?? {}).length === 0 ? (
                        <div className="muted">{t('gs_no_stratum_ports')}</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>{t('gs_port')}</th>
                                        <th>{t('gs_stratum_url')}</th>
                                        <th className="text-right">
                                            {t('gs_difficulty')}
                                        </th>
                                        <th className="whitespace-nowrap">
                                            {t('gs_vardiff')}
                                        </th>
                                        <th className="text-center">
                                            {t('gs_tls')}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {Object.entries(
                                        selectedPool.ports ?? {}
                                    ).map(([port, raw]) => {
                                        const p = (raw ?? {}) as AppConfigPort;
                                        const vd = p.varDiff;
                                        const hasVd =
                                            vd != null &&
                                            vd.minDiff != null &&
                                            vd.maxDiff != null;
                                        return (
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
                                                <td className="text-right">
                                                    {p.diff != null
                                                        ? toNum(p.diff)
                                                        : '—'}
                                                </td>
                                                <td className="whitespace-nowrap">
                                                    {hasVd
                                                        ? `${toNum(vd.minDiff)} – ${toNum(vd.maxDiff)}`
                                                        : '—'}
                                                </td>
                                                <td className="text-center">
                                                    {p.tls ? (
                                                        <i className="fas fa-lock text-green-600" />
                                                    ) : (
                                                        <span className="text-muted">
                                                            —
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <p className="muted mt-3">{t('gs_port_hint')}</p>

                    {selectedPool.getwork?.ports &&
                        Object.keys(selectedPool.getwork.ports).length > 0 && (
                            <div className="mt-4 border-t border-line pt-3">
                                <div className="mb-1 font-semibold">
                                    <i className="fas fa-plug fa-fw text-accent" />{' '}
                                    {t('gs_getwork_title')}
                                </div>
                                <p className="muted mb-2">
                                    {t('gs_getwork_desc')}
                                </p>
                                <div className="overflow-x-auto">
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>{t('gs_port')}</th>
                                                <th>{t('gs_getwork_url')}</th>
                                                <th className="text-right">
                                                    {t('gs_difficulty')}
                                                </th>
                                                <th className="whitespace-nowrap">
                                                    {t('gs_vardiff')}
                                                </th>
                                                <th className="text-center">
                                                    {t('gs_tls')}
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {Object.entries(
                                                selectedPool.getwork.ports
                                            ).map(([port, raw]) => {
                                                const p = (raw ??
                                                    {}) as AppConfigPort;
                                                const vd = p.varDiff;
                                                const hasVd =
                                                    vd != null &&
                                                    vd.minDiff != null &&
                                                    vd.maxDiff != null;
                                                const scheme = p.tls
                                                    ? 'https'
                                                    : 'http';
                                                return (
                                                    <tr key={port}>
                                                        <td className="whitespace-nowrap">
                                                            {port}
                                                        </td>
                                                        <td>
                                                            <code
                                                                className={code}
                                                            >
                                                                {scheme}://
                                                                {host}:{port}
                                                            </code>
                                                        </td>
                                                        <td className="text-right">
                                                            {p.diff != null
                                                                ? toNum(p.diff)
                                                                : '—'}
                                                        </td>
                                                        <td className="whitespace-nowrap">
                                                            {hasVd
                                                                ? `${toNum(vd.minDiff)} – ${toNum(vd.maxDiff)}`
                                                                : '—'}
                                                        </td>
                                                        <td className="text-center">
                                                            {p.tls ? (
                                                                <i className="fas fa-lock text-green-600" />
                                                            ) : (
                                                                <span className="text-muted">
                                                                    —
                                                                </span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                <p className="muted mt-3">
                                    {t('gs_getwork_cmd_hint')}
                                </p>
                            </div>
                        )}

                    {miningTools.length > 0 && (
                        <div className="mt-4 border-t border-line pt-3">
                            <div className="mb-1 font-semibold">
                                <i className="fas fa-download fa-fw text-accent" />{' '}
                                {t('gs_mining_software')}
                            </div>
                            <ul className="list-disc space-y-1 pl-5">
                                {miningTools.map((t, i) => (
                                    <li key={i}>
                                        <a
                                            href={t.url}
                                            target="_blank"
                                            rel="noreferrer"
                                        >
                                            {t.name}
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}

            {switchEntries.length > 0 && (
                <div className="card">
                    <h2 className="mb-3 text-lg font-bold">
                        <i className="fas fa-shuffle fa-fw text-accent2" />{' '}
                        {t('gs_switching_ports')}
                    </h2>
                    <p className="muted mb-3">{t('gs_switching_desc')}</p>
                    <div className="overflow-x-auto">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>{t('gs_name')}</th>
                                    <th>{t('gs_algorithm')}</th>
                                    <th>{t('gs_stratum_url')}</th>
                                    <th className="text-right">
                                        {t('gs_difficulty')}
                                    </th>
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
                </div>
            )}
        </div>
    );
}
