import { useLiveStats } from '../api/useLiveStats.tsx';
import { readableHashRateString } from '../lib/format.ts';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function Home() {
    const stats = useLiveStats();
    const algos = stats ? Object.entries(stats.algos) : [];
    const pools = stats ? Object.values(stats.pools) : [];

    return (
        <div>
            <section className="home-hero">
                <img className="hero-logo" src="/logo.svg" alt="zny-nomp" />
                <div className="hero-body">
                    <h1 className="hero-title">
                        Welcome to the future of mining
                    </h1>
                    <ul className="hero-bullets">
                        <li>Low fees</li>
                        <li>High performance Node.js backend</li>
                        <li>User friendly mining client</li>
                        <li>Multi-coin / multi-pool</li>
                    </ul>
                </div>
            </section>

            <div className="home-boxes">
                <section className="stat-box algos">
                    <div className="stat-box-header">Global Stats</div>
                    <div className="stat-box-list">
                        {!stats ? (
                            <div className="muted">Loading…</div>
                        ) : algos.length ? (
                            algos.map(([algo, a]) => (
                                <div className="stat-box-item" key={algo}>
                                    <div>
                                        <i className="fas fa-flask fa-fw" />{' '}
                                        {cap(algo)}
                                    </div>
                                    <div>
                                        <i className="fas fa-users fa-fw" />{' '}
                                        {a.workers} Miners
                                    </div>
                                    <div>
                                        <i className="fas fa-gauge-simple-high fa-fw" />{' '}
                                        {a.hashrateString ||
                                            readableHashRateString(a.hashrate)}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="muted">No active algorithms</div>
                        )}
                    </div>
                </section>

                <section className="stat-box pools">
                    <div className="stat-box-header">Pools / Coins</div>
                    <div className="stat-box-list">
                        {!stats ? (
                            <div className="muted">Loading…</div>
                        ) : pools.length ? (
                            pools.map((p) => (
                                <div className="stat-box-item" key={p.name}>
                                    <div>
                                        <i className="fas fa-coins fa-fw" />{' '}
                                        {cap(p.name)}
                                    </div>
                                    <div>
                                        <i className="fas fa-users fa-fw" />{' '}
                                        {p.workerCount ?? 0} Miners
                                    </div>
                                    <div>
                                        <i className="fas fa-gauge-simple-high fa-fw" />{' '}
                                        {p.hashrateString ||
                                            readableHashRateString(p.hashrate)}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="muted">No pools configured</div>
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
}
