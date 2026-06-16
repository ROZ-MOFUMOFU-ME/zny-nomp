import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useLiveStats } from '../api/useLiveStats.tsx';
import { getPayments, getConfig } from '../api/client.ts';
import type { PoolPayments, PaymentRow, AppConfig } from '../api/types.ts';
import {
    formatAmount,
    readableDate,
    maskAddress,
    toNum,
    explorerUrl
} from '../lib/format.ts';

// Recent payout transactions per pool. Rows come from GET /api/payments (the
// only endpoint that carries the `payments` array — /api/stats strips it); the
// per-pool header (block count / total paid / symbol) and explorer tx links are
// resolved from live stats + GET /api/config.
const MAX_ROWS = 100;
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function blocksText(blocks: PaymentRow['blocks']): string {
    if (Array.isArray(blocks)) return blocks.join(', ');
    if (blocks == null) return '—';
    return String(blocks);
}

export default function Payments() {
    const { t } = useTranslation();
    const live = useLiveStats();
    const paymentsQuery = useQuery<PoolPayments[]>({
        queryKey: ['payments'],
        queryFn: getPayments,
        refetchInterval: 60000
    });
    const configQuery = useQuery<AppConfig>({
        queryKey: ['config'],
        queryFn: getConfig
    });

    if (paymentsQuery.isLoading) {
        return <div className="loading">{t('pay_loading')}</div>;
    }
    if (paymentsQuery.isError || !paymentsQuery.data) {
        return <div className="error">{t('pay_load_failed')}</div>;
    }

    const pools = paymentsQuery.data;
    const config = configQuery.data;
    const hasAnyPayments = pools.some(
        (pool) => (pool.payments?.length ?? 0) > 0
    );

    if (pools.length === 0 || !hasAnyPayments) {
        return (
            <div>
                <h1 className="page-title">{t('pay_title')}</h1>
                <div className="muted">{t('pay_none_yet')}</div>
            </div>
        );
    }

    return (
        <div>
            <h1 className="page-title">{t('pay_title')}</h1>
            {pools.map((pool) => {
                const rows: PaymentRow[] = (pool.payments ?? [])
                    .slice()
                    .sort((a, b) => toNum(b.time) - toNum(a.time))
                    .slice(0, MAX_ROWS);
                if (rows.length === 0) return null;

                const livePool = live?.pools?.[pool.name];
                const symbol =
                    livePool?.symbol ||
                    config?.pools?.[pool.name]?.coin?.symbol ||
                    '';
                const txTemplate =
                    config?.pools?.[pool.name]?.coin?.explorer?.txURL;
                const ps = livePool?.poolStats ?? {};

                return (
                    <section key={pool.name} className="mb-6">
                        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                            <h2 className="m-0 text-xl font-bold">
                                <i className="fas fa-money-bill-transfer fa-fw text-accent3" />{' '}
                                {t('pay_pool_heading', {
                                    pool: cap(pool.name)
                                })}
                            </h2>
                            <span className="text-sm text-muted">
                                <i className="fas fa-cubes fa-fw" />{' '}
                                {t('pay_blocks_count', {
                                    count: toNum(ps.validBlocks)
                                })}{' '}
                                &nbsp;&nbsp;
                                <i className="fas fa-money-bill fa-fw" />{' '}
                                {t('pay_paid_label')}{' '}
                                {formatAmount(ps.totalPaid)} {symbol}
                            </span>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>{t('pay_th_blocks')}</th>
                                        <th>{t('pay_th_time')}</th>
                                        <th className="text-right">
                                            {t('pay_th_miners')}
                                        </th>
                                        <th className="text-right">
                                            {t('pay_th_shares')}
                                        </th>
                                        <th>{t('pay_th_payment_amount')}</th>
                                        <th className="text-right">
                                            {t('pay_th_total_payment_amount')}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((p, i) => {
                                        const txUrl = p.txid
                                            ? explorerUrl(txTemplate, p.txid)
                                            : null;
                                        const text = blocksText(p.blocks);
                                        const recipients = Object.entries(
                                            p.amounts ?? {}
                                        );
                                        return (
                                            <tr
                                                key={
                                                    p.txid ??
                                                    `${pool.name}-${p.time}-${i}`
                                                }
                                            >
                                                <td className="max-w-[22rem] break-all">
                                                    {txUrl ? (
                                                        <a
                                                            href={txUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            title={t(
                                                                'pay_view_transaction'
                                                            )}
                                                        >
                                                            {text}
                                                        </a>
                                                    ) : (
                                                        text
                                                    )}
                                                </td>
                                                <td className="whitespace-nowrap">
                                                    {readableDate(p.time)}
                                                </td>
                                                <td className="text-right">
                                                    {p.miners ?? '—'}
                                                </td>
                                                <td className="text-right">
                                                    {Math.round(
                                                        toNum(p.shares)
                                                    )}
                                                </td>
                                                <td className="text-sm">
                                                    {recipients.length === 0
                                                        ? '—'
                                                        : recipients.map(
                                                              ([addr, amt]) => (
                                                                  <Fragment
                                                                      key={addr}
                                                                  >
                                                                      {maskAddress(
                                                                          addr
                                                                      )}
                                                                      ：
                                                                      <span className="text-danger">
                                                                          {formatAmount(
                                                                              amt
                                                                          )}
                                                                      </span>{' '}
                                                                      {symbol}
                                                                      <br />
                                                                  </Fragment>
                                                              )
                                                          )}
                                                </td>
                                                <td className="whitespace-nowrap text-right font-medium">
                                                    {formatAmount(p.paid)}{' '}
                                                    {symbol}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </section>
                );
            })}
        </div>
    );
}
