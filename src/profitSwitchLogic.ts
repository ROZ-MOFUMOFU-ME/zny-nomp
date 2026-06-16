/*
 * Pure profit-switching logic, kept free of heavy/native imports (stratum-pool)
 * so it is unit-testable in isolation. The worker (profitSwitch.js) wires these
 * to daemon RPC, the price feed and the CLI switch path.
 */

export interface CoinStats {
    difficulty?: number | null;
    reward?: number | null;
    price?: number | null;
    [key: string]: unknown;
}

/** table: { algo: { coinName: CoinStats } } */
export type ProfitTable = Record<string, Record<string, CoinStats>>;

export interface AlgoRanking {
    coin: string;
    score: number;
    scores: Record<string, number>;
}

export type Ranking = Record<string, AlgoRanking>;

export interface SwitchEntry {
    enabled?: boolean;
    algorithm: string;
    [key: string]: unknown;
}

export interface SwitchAction {
    switchName: string;
    algo: string;
    coin: string;
}

/*
 * Score each coin by reward * price / difficulty (proportional to value per
 * unit hashrate within an algorithm — the algo-specific constant cancels) and
 * return the best coin per algo. Coins lacking a positive price, reward or
 * difficulty are ignored.
 */
export function rankProfitability(table?: ProfitTable | null): Ranking {
    const out: Ranking = {};
    const t = table || {};
    for (const algo of Object.keys(t)) {
        const coins = t[algo];
        const scores: Record<string, number> = {};
        let best: { coin: string; score: number } | null = null;
        for (const name of Object.keys(coins)) {
            const c = coins[name];
            const { difficulty, reward, price } = c;
            if (typeof difficulty !== 'number' || !(difficulty > 0)) continue;
            if (typeof price !== 'number' || !(price > 0)) continue;
            if (typeof reward !== 'number' || !(reward > 0)) continue;
            const score = (reward * price) / difficulty;
            scores[name] = score;
            if (!best || score > best.score) best = { coin: name, score };
        }
        if (best) out[algo] = { coin: best.coin, score: best.score, scores };
    }
    return out;
}

/*
 * Decide which switches to perform. For each enabled switching entry, switch to
 * its algo's best coin when that coin differs from the current one
 * (currentByAlgo, from proxyState) and beats it by at least `threshold`
 * (score_best >= score_current * threshold). If the current coin can't be
 * scored this cycle, switch to the best available.
 */
export function decideSwitches(
    ranking: Ranking,
    currentByAlgo?: Record<string, string> | null,
    switching?: Record<string, SwitchEntry> | null,
    threshold?: number
): SwitchAction[] {
    const actions: SwitchAction[] = [];
    const cur = currentByAlgo || {};
    const sws = switching || {};
    Object.keys(sws).forEach(function (switchName) {
        const sw = sws[switchName];
        if (!sw || !sw.enabled) return;
        const r = ranking[sw.algorithm];
        if (!r) return;
        const current = cur[sw.algorithm];
        if (current && current === r.coin) return; // already optimal
        if (current && r.scores[current] !== undefined) {
            // require a clear margin over the current coin to avoid flapping
            if (!(r.score >= r.scores[current] * (threshold || 1))) return;
        }
        actions.push({
            switchName: switchName,
            algo: sw.algorithm,
            coin: r.coin
        });
    });
    return actions;
}
