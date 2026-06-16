import { useTranslation } from 'react-i18next';
import { useLiveStats } from '../api/useLiveStats.tsx';
import { readableHashRateString, toNum } from '../lib/format.ts';

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export default function TabStats() {
    const { t } = useTranslation();
    const stats = useLiveStats();
    if (!stats) return <div className="loading">{t('tab_loading')}</div>;
    const pools = Object.values(stats.pools);
    return (
        <div>
            <h1 className="page-title">
                <i className="fas fa-table fa-fw text-accent" />{' '}
                {t('tab_title')}
            </h1>
            <div className="overflow-x-auto">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>{t('tab_th_pool')}</th>
                            <th>{t('tab_th_algo')}</th>
                            <th className="text-right">
                                {t('tab_th_workers')}
                            </th>
                            <th className="text-right">{t('tab_th_valid')}</th>
                            <th className="text-right">
                                {t('tab_th_invalid')}
                            </th>
                            <th className="text-right">{t('tab_th_blocks')}</th>
                            <th className="text-right">
                                {t('tab_th_pending')}
                            </th>
                            <th className="text-right">
                                {t('tab_th_confirmed')}
                            </th>
                            <th className="text-right">
                                {t('tab_th_orphaned')}
                            </th>
                            <th className="text-right">
                                {t('tab_th_hashrate')}
                            </th>
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
