import type { AppConfig } from '../api/types.ts';

// Whether to surface the "Tab Stats" nav entry + /tbs page. The page is a
// per-pool comparison table, so it's only useful with more than one pool.
// Operators can force it on/off via branding.showTabStats; when unset we fall
// back to auto (hidden for a single coin). While config is still loading we
// default to hidden so a single-coin site never flashes the entry in.
export function tabStatsEnabled(config: AppConfig | undefined): boolean {
    const flag = config?.branding?.showTabStats;
    if (typeof flag === 'boolean') return flag;
    return Object.keys(config?.pools ?? {}).length > 1;
}
