import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppConfigServers } from '../api/types.ts';

type PingState = number | 'error' | null;

// Measure round-trip latency to each server's CORS-enabled endpoint, in
// parallel, refreshing on an interval while mounted. Ping state is held here
// (not per-card) so the fastest location can be highlighted across all of them.
function useServerPings(urls: Array<string | undefined>): PingState[] {
    const key = JSON.stringify(urls);
    const [pings, setPings] = useState<PingState[]>([]);
    useEffect(() => {
        const list: Array<string | undefined> = JSON.parse(key);
        let alive = true;
        setPings(list.map(() => null));
        const setAt = (i: number, v: PingState) =>
            setPings((prev) => {
                const next = prev.slice();
                next[i] = v;
                return next;
            });
        const measureAll = () => {
            list.forEach((url, i) => {
                if (!url) return;
                const t0 = performance.now();
                fetch(url, { cache: 'no-store' })
                    .then(() => {
                        if (alive) setAt(i, Math.round(performance.now() - t0));
                    })
                    .catch(() => {
                        if (alive) setAt(i, 'error');
                    });
            });
        };
        measureAll();
        const id = setInterval(measureAll, 10000);
        return () => {
            alive = false;
            clearInterval(id);
        };
    }, [key]);
    return pings;
}

function PingValue({ value }: { value: PingState }) {
    if (value === null || value === undefined)
        return <span className="text-white/60">…</span>;
    if (value === 'error')
        return (
            <span className="text-red-200">
                <i className="fas fa-triangle-exclamation fa-fw" /> —
            </span>
        );
    return <span>{value} ms</span>;
}

export default function ServersSection({
    servers
}: {
    servers: AppConfigServers;
}) {
    const { t } = useTranslation();
    const list = Array.isArray(servers.list) ? servers.list : [];
    const pings = useServerPings(list.map((s) => s.pingUrl));
    if (!list.length) return null;
    // Fastest measured location (only meaningful with 2+ servers).
    let fastest = -1;
    let best = Infinity;
    pings.forEach((p, i) => {
        if (typeof p === 'number' && p < best) {
            best = p;
            fastest = i;
        }
    });
    const showFastest = list.length > 1;
    // Config title overrides; otherwise the translated default.
    const title = servers.title || t('home_servers_title');
    return (
        <section className="mb-5 rounded-xl bg-slate-500 px-5 py-4 text-white">
            <div className="mb-3 text-xl font-bold">{title}</div>
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
                {list.map((s, i) => {
                    const features = Array.isArray(s.features)
                        ? s.features
                        : [];
                    const isFastest = showFastest && i === fastest;
                    return (
                        <div
                            key={i}
                            className={`relative rounded-lg p-4 ${
                                isFastest
                                    ? 'bg-white/20 ring-2 ring-white'
                                    : 'bg-white/10'
                            }`}
                        >
                            {isFastest && (
                                <span className="absolute right-3 top-3 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">
                                    <i className="fas fa-bolt fa-fw" /> Fastest
                                </span>
                            )}
                            {s.region && (
                                <div className="py-0.5">
                                    <i className="fas fa-globe-asia fa-fw" />{' '}
                                    {s.region}
                                </div>
                            )}
                            {s.country && (
                                <div className="py-0.5 font-semibold">
                                    {s.flag && (
                                        <span className={`fi fi-${s.flag}`} />
                                    )}{' '}
                                    {s.country}
                                    {s.city && (
                                        <span className="font-normal text-white/80">
                                            {' · '}
                                            {s.city}
                                        </span>
                                    )}
                                </div>
                            )}
                            {s.uri && (
                                <div className="py-0.5">
                                    <i className="fas fa-plug fa-fw" /> {s.uri}
                                </div>
                            )}
                            {features.map((f, j) => {
                                const text = typeof f === 'string' ? f : f.text;
                                const icon =
                                    typeof f === 'string'
                                        ? 'fas fa-check'
                                        : f.icon || 'fas fa-check';
                                return (
                                    <div className="py-0.5" key={j}>
                                        <i className={`${icon} fa-fw`} /> {text}
                                    </div>
                                );
                            })}
                            {s.pingUrl && (
                                <div className="py-0.5">
                                    <i className="fas fa-stopwatch fa-fw" />{' '}
                                    {t('home_servers_ping')}:{' '}
                                    <PingValue value={pings[i]} />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
