import { useQuery } from '@tanstack/react-query';
import { useLiveStats } from '../api/useLiveStats.tsx';
import { getAnnouncement } from '../api/client.ts';
import { readableHashRateString } from '../lib/format.ts';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const line = 'whitespace-nowrap py-0.5';
const item = 'min-w-[150px] rounded-lg bg-white/15 px-3.5 py-2';

export default function Home() {
    const stats = useLiveStats();
    const algos = stats ? Object.entries(stats.algos) : [];
    const pools = stats ? Object.values(stats.pools) : [];
    const announcement = useQuery({
        queryKey: ['announcement'],
        queryFn: getAnnouncement
    });
    const note = announcement.data?.announcement?.trim();

    return (
        <div>
            {note && (
                <section className="mb-5 rounded-xl border-l-4 border-accent bg-accent/10 px-5 py-4">
                    <div className="mb-1 font-bold text-accent">
                        <i className="fas fa-bullhorn fa-fw" /> Announcement
                    </div>
                    <div className="whitespace-pre-wrap text-sm">{note}</div>
                </section>
            )}
            <section className="mb-5 flex flex-wrap items-center gap-6 rounded-xl bg-accent px-8 py-7 text-white">
                <img
                    src="/logo.svg"
                    alt="zny-nomp"
                    className="h-auto w-[200px] max-w-[40%]"
                />
                <div className="flex-1 basis-80">
                    <h1 className="mb-3 text-4xl font-bold">
                        Welcome to the future of mining
                    </h1>
                    <ul className="m-0 list-none p-0 text-lg leading-loose [&>li]:before:mr-2.5 [&>li]:before:opacity-80 [&>li]:before:content-['✦']">
                        <li>Low fees</li>
                        <li>High performance Node.js backend</li>
                        <li>User friendly mining client</li>
                        <li>Multi-coin / multi-pool</li>
                    </ul>
                </div>
            </section>

            <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
                <section className="rounded-xl bg-accent2 px-5 py-4 text-white">
                    <div className="mb-3 text-xl font-bold">Global Stats</div>
                    <div className="flex flex-wrap gap-x-6 gap-y-2.5">
                        {!stats ? (
                            <div className="text-white/80">Loading…</div>
                        ) : algos.length ? (
                            algos.map(([algo, a]) => (
                                <div className={item} key={algo}>
                                    <div className={line}>
                                        <i className="fas fa-flask fa-fw" />{' '}
                                        {cap(algo)}
                                    </div>
                                    <div className={line}>
                                        <i className="fas fa-users fa-fw" />{' '}
                                        {a.workers} Miners
                                    </div>
                                    <div className={line}>
                                        <i className="fas fa-gauge-simple-high fa-fw" />{' '}
                                        {a.hashrateString ||
                                            readableHashRateString(a.hashrate)}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="text-white/80">
                                No active algorithms
                            </div>
                        )}
                    </div>
                </section>

                <section className="rounded-xl bg-accent3 px-5 py-4 text-white">
                    <div className="mb-3 text-xl font-bold">Pools / Coins</div>
                    <div className="flex flex-wrap gap-x-6 gap-y-2.5">
                        {!stats ? (
                            <div className="text-white/80">Loading…</div>
                        ) : pools.length ? (
                            pools.map((p) => (
                                <div className={item} key={p.name}>
                                    <div className={line}>
                                        <i className="fas fa-coins fa-fw" />{' '}
                                        {cap(p.name)}
                                    </div>
                                    <div className={line}>
                                        <i className="fas fa-users fa-fw" />{' '}
                                        {p.workerCount ?? 0} Miners
                                    </div>
                                    <div className={line}>
                                        <i className="fas fa-gauge-simple-high fa-fw" />{' '}
                                        {p.hashrateString ||
                                            readableHashRateString(p.hashrate)}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="text-white/80">
                                No pools configured
                            </div>
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
}
