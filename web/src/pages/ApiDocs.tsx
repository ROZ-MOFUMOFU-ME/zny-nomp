const ENDPOINTS: Array<{ path: string; desc: string }> = [
    { path: '/api/stats', desc: 'Aggregated pool/algo stats snapshot (JSON).' },
    {
        path: '/api/live_stats',
        desc: 'Server-Sent-Events stream of the full live stats object.'
    },
    {
        path: '/api/pool_stats',
        desc: 'Historical per-pool hashrate / block series.'
    },
    { path: '/api/blocks', desc: 'All pending + confirmed blocks.' },
    { path: '/api/payments', desc: 'Recent payments per pool.' },
    {
        path: '/api/worker_stats?ADDRESS',
        desc: 'Per-miner stats (address as the raw query string).'
    },
    { path: '/api/prices', desc: 'Latest coin prices from the price feed.' },
    { path: '/api/metrics', desc: 'Prometheus exposition metrics.' },
    { path: '/api/health', desc: 'Health check (200 ok / 503 degraded).' },
    { path: '/api/config', desc: 'Public runtime config for the frontend.' }
];

export default function ApiDocs() {
    return (
        <div>
            <h1 className="page-title">
                <i className="fas fa-code fa-fw text-accent" /> API
            </h1>
            <p className="muted mb-4">
                The pool exposes a JSON API. All endpoints are read-only GETs
                (except the password-gated admin API).
            </p>
            <div className="overflow-x-auto">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Endpoint</th>
                            <th>Description</th>
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
                                <td>{e.desc}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
