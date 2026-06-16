import type {
    Stats,
    PoolHistoryPoint,
    WorkerStats,
    PricesPayload,
    AppConfig,
    PoolPayments
} from './types.ts';

async function getJson<T>(url: string): Promise<T> {
    const resp = await fetch(url, { headers: { accept: 'application/json' } });
    if (!resp.ok) throw new Error('HTTP ' + resp.status + ' for ' + url);
    return resp.json() as Promise<T>;
}

export const getStats = () => getJson<Stats>('/api/stats');
export const getPoolHistory = () =>
    getJson<PoolHistoryPoint[]>('/api/pool_stats');
export const getBlocks = () => getJson<Record<string, string>>('/api/blocks');
export const getPayments = () => getJson<PoolPayments[]>('/api/payments');
export const getPrices = () => getJson<PricesPayload>('/api/prices');
export const getConfig = () => getJson<AppConfig>('/api/config');

// /api/worker_stats takes the address as the RAW query string (?ADDRESS),
// not ?addr= — see libs/api.ts (req.url.split('?')[1]).
export const getWorkerStats = (address: string) =>
    getJson<WorkerStats>('/api/worker_stats?' + encodeURIComponent(address));

export async function adminPools(
    password: string
): Promise<{ result?: unknown; error?: string }> {
    const resp = await fetch('/api/admin/pools', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password })
    });
    return resp.json();
}

// Single Server-Sent-Events channel: the full live stats object (with prices,
// pending/confirmed blocks, payments, miners) pushed every updateInterval.
export function subscribeLiveStats(
    onMessage: (stats: Stats) => void
): () => void {
    const es = new EventSource('/api/live_stats');
    es.onmessage = (ev) => {
        try {
            onMessage(JSON.parse(ev.data));
        } catch {
            // ignore a malformed frame
        }
    };
    return () => es.close();
}
