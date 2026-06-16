import { useQuery } from '@tanstack/react-query';
import { getPayments, getConfig } from '../api/client.ts';
import type { PoolPayments, PaymentRow, AppConfig } from '../api/types.ts';
import {
    formatCoins,
    formatTime,
    maskAddress,
    toNum,
    explorerUrl
} from '../lib/format.ts';

// Recent payout transactions per pool (GET /api/payments), with explorer tx
// links resolved from the pool's coin.explorer.txURL (GET /api/config).
// Numeric fields from the API may arrive as strings, so everything coerces.
const MAX_ROWS = 50;

function recipientList(amounts: Record<string, number> | undefined): string {
    const entries = Object.entries(amounts ?? {});
    if (entries.length === 0) return '';
    return entries
        .map(([addr, amt]) => `${maskAddress(addr)}: ${formatCoins(amt)}`)
        .join('  ·  ');
}

export default function Payments() {
    const paymentsQuery = useQuery<PoolPayments[]>({
        queryKey: ['payments'],
        queryFn: getPayments
    });
    const configQuery = useQuery<AppConfig>({
        queryKey: ['config'],
        queryFn: getConfig
    });

    if (paymentsQuery.isLoading) {
        return <div className="loading">Loading…</div>;
    }
    if (paymentsQuery.isError || !paymentsQuery.data) {
        return <div className="error">Failed to load payments.</div>;
    }

    const pools = paymentsQuery.data;
    const config = configQuery.data;

    const hasAnyPayments = pools.some(
        (pool) => (pool.payments?.length ?? 0) > 0
    );
    if (pools.length === 0 || !hasAnyPayments) {
        return (
            <div>
                <h1 className="page-title">Payments</h1>
                <div className="muted">No payments yet.</div>
            </div>
        );
    }

    return (
        <div>
            <h1 className="page-title">Payments</h1>
            {pools.map((pool) => {
                const txTemplate =
                    config?.pools?.[pool.name]?.coin?.explorer?.txURL;
                const rows: PaymentRow[] = (pool.payments ?? [])
                    .slice()
                    .sort((a, b) => toNum(b.time) - toNum(a.time))
                    .slice(0, MAX_ROWS);

                return (
                    <div className="card" key={pool.name}>
                        <h2>{pool.name}</h2>
                        {rows.length === 0 ? (
                            <div className="muted">No payments yet.</div>
                        ) : (
                            <table className="data">
                                <thead>
                                    <tr>
                                        <th>Time</th>
                                        <th>Tx</th>
                                        <th className="right">Miners</th>
                                        <th className="right">Shares</th>
                                        <th className="right">Recipients</th>
                                        <th className="right">Total Paid</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((p, i) => {
                                        const url = p.txid
                                            ? explorerUrl(txTemplate, p.txid)
                                            : null;
                                        const recipientCount = Object.keys(
                                            p.amounts ?? {}
                                        ).length;
                                        return (
                                            <tr
                                                key={
                                                    p.txid ??
                                                    `${pool.name}-${p.time}-${i}`
                                                }
                                            >
                                                <td className="nowrap">
                                                    {formatTime(p.time)}
                                                </td>
                                                <td className="nowrap">
                                                    {p.txid ? (
                                                        url ? (
                                                            <a
                                                                href={url}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                title={
                                                                    recipientList(
                                                                        p.amounts
                                                                    ) || p.txid
                                                                }
                                                            >
                                                                {p.txid.slice(
                                                                    0,
                                                                    16
                                                                )}
                                                                …
                                                            </a>
                                                        ) : (
                                                            <span
                                                                title={p.txid}
                                                            >
                                                                {p.txid.slice(
                                                                    0,
                                                                    16
                                                                )}
                                                                …
                                                            </span>
                                                        )
                                                    ) : (
                                                        '—'
                                                    )}
                                                </td>
                                                <td className="right">
                                                    {p.miners ?? '—'}
                                                </td>
                                                <td className="right">
                                                    {toNum(p.shares)}
                                                </td>
                                                <td
                                                    className="right"
                                                    title={recipientList(
                                                        p.amounts
                                                    )}
                                                >
                                                    {recipientCount} recipients
                                                </td>
                                                <td className="right nowrap">
                                                    {formatCoins(p.paid)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
