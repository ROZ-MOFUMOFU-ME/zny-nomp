import {
    createContext,
    useContext,
    useEffect,
    useState,
    type ReactNode
} from 'react';
import type { Stats } from './types.ts';
import { getStats, subscribeLiveStats } from './client.ts';

const LiveStatsContext = createContext<Stats | null>(null);

// One EventSource for the whole app; pages read the live stats from context.
// The /api/live_stats feed only pushes on the portal's updateInterval, so seed
// immediately from /api/stats for first paint, then let live updates take over.
export function LiveStatsProvider({ children }: { children: ReactNode }) {
    const [stats, setStats] = useState<Stats | null>(null);
    useEffect(() => {
        let alive = true;
        getStats()
            .then((s) => {
                if (alive && s) setStats((prev) => prev ?? s);
            })
            .catch(() => {});
        const unsub = subscribeLiveStats((s) => {
            if (alive) setStats(s);
        });
        return () => {
            alive = false;
            unsub();
        };
    }, []);
    return (
        <LiveStatsContext.Provider value={stats}>
            {children}
        </LiveStatsContext.Provider>
    );
}

export function useLiveStats(): Stats | null {
    return useContext(LiveStatsContext);
}
