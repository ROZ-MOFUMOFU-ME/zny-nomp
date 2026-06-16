import { useTranslation } from 'react-i18next';

const ENDPOINTS: Array<{ path: string; descKey: string }> = [
    { path: '/api/stats', descKey: 'apidoc_desc_stats' },
    {
        path: '/api/live_stats',
        descKey: 'apidoc_desc_live_stats'
    },
    {
        path: '/api/pool_stats',
        descKey: 'apidoc_desc_pool_stats'
    },
    { path: '/api/blocks', descKey: 'apidoc_desc_blocks' },
    { path: '/api/payments', descKey: 'apidoc_desc_payments' },
    {
        path: '/api/worker_stats?ADDRESS',
        descKey: 'apidoc_desc_worker_stats'
    },
    { path: '/api/prices', descKey: 'apidoc_desc_prices' },
    { path: '/api/metrics', descKey: 'apidoc_desc_metrics' },
    { path: '/api/health', descKey: 'apidoc_desc_health' },
    { path: '/api/config', descKey: 'apidoc_desc_config' }
];

export default function ApiDocs() {
    const { t } = useTranslation();
    return (
        <div>
            <h1 className="page-title">
                <i className="fas fa-code fa-fw text-accent" /> API
            </h1>
            <p className="muted mb-4">{t('apidoc_intro')}</p>
            <div className="overflow-x-auto">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>{t('apidoc_th_endpoint')}</th>
                            <th>{t('apidoc_th_description')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {ENDPOINTS.map((e) => (
                            <tr key={e.path}>
                                <td className="whitespace-nowrap">
                                    <a href={e.path}>
                                        <code className="rounded bg-black/5 px-1.5 py-0.5">
                                            {e.path}
                                        </code>
                                    </a>
                                </td>
                                <td>{t(e.descKey)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
