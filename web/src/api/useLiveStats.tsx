import {
    createContext,
    useContext,
    useEffect,
    useState,
    type ReactNode
} from 'react';
import type { Stats } from './types.ts';
import { subscribeLiveStats } from './client.ts';

const LiveStatsContext = createContext<Stats | null>(null);

// One EventSource for the whole app; pages read the live stats from context.
export function LiveStatsProvider({ children }: { children: ReactNode }) {
    const [stats, setStats] = useState<Stats | null>(null);
    useEffect(() => subscribeLiveStats(setStats), []);
    return (
        <LiveStatsContext.Provider value={stats}>
            {children}
        </LiveStatsContext.Provider>
    );
}

export function useLiveStats(): Stats | null {
    return useContext(LiveStatsContext);
}
