/*
 * Build a health/readiness summary from the aggregated stats object. Pure and
 * defensive so it can be unit-tested and feed a container/orchestrator probe.
 *
 * "ok" means the stats loop has produced a recent snapshot (the portal is
 * gathering data); "degraded" means no snapshot yet or a stale one (e.g. Redis
 * or the stats cycle is wedged). Served at /api/health.
 */
export function buildHealth(stats, nowMs, uptimeSec, maxStatsAgeSec) {
    stats = stats || {};
    const pools = stats.pools ? Object.keys(stats.pools).length : 0;
    const snapshotTime = typeof stats.time === 'number' ? stats.time : null; // unix seconds
    const nowSec = Math.round(nowMs / 1000);
    const statsAge =
        snapshotTime != null ? Math.max(0, nowSec - snapshotTime) : null;
    const healthy = statsAge != null && statsAge <= (maxStatsAgeSec || 900);
    return {
        status: healthy ? 'ok' : 'degraded',
        uptimeSeconds: Math.round(uptimeSec || 0),
        pools: pools,
        statsAgeSeconds: statsAge,
        time: nowSec
    };
}
