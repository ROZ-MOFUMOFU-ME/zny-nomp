/*
 * Pure profit-switching logic, kept free of heavy/native imports (stratum-pool)
 * so it is unit-testable in isolation. The worker (profitSwitch.js) wires these
 * to daemon RPC, the price feed and the CLI switch path.
 */

/*
 * table: { algo: { coinName: { difficulty, reward, price, ... } } }
 * Score each coin by reward * price / difficulty (proportional to value per
 * unit hashrate within an algorithm — the algo-specific constant cancels) and
 * return the best coin per algo: { algo: { coin, score, scores: {coin:score} } }.
 * Coins lacking a positive price, reward or difficulty are ignored.
 */
export function rankProfitability(table) {
    const out = {};
    Object.keys(table || {}).forEach(function (algo) {
        const coins = table[algo];
        const scores = {};
        let best = null;
        Object.keys(coins).forEach(function (name) {
            const c = coins[name];
            if (!(c.difficulty > 0) || !(c.price > 0) || !(c.reward > 0)) return;
            const score = (c.reward * c.price) / c.difficulty;
            scores[name] = score;
            if (!best || score > best.score) best = { coin: name, score: score };
        });
        if (best)
            out[algo] = { coin: best.coin, score: best.score, scores: scores };
    });
    return out;
}

/*
 * Decide which switches to perform. For each enabled switching entry, switch to
 * its algo's best coin when that coin differs from the current one
 * (currentByAlgo, from proxyState) and beats it by at least `threshold`
 * (score_best >= score_current * threshold). If the current coin can't be
 * scored this cycle, switch to the best available. Returns
 * [{ switchName, algo, coin }].
 */
export function decideSwitches(ranking, currentByAlgo, switching, threshold) {
    const actions = [];
    const cur = currentByAlgo || {};
    Object.keys(switching || {}).forEach(function (switchName) {
        const sw = switching[switchName];
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
