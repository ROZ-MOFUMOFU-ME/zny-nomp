// Pure, native-import-free helpers for the PPLNS (Pay Per Last N Shares)
// payment scheme. Kept separate from paymentProcessor.ts so the window/
// apportionment math can be unit tested without spinning up Redis / the stratum
// stack (same pattern as ppsLogic.ts / profitSwitchLogic.ts / statsUtil.ts).
// See docs/payment-schemes.md.
//
// PPLNS rewards each matured block among the miners who contributed to the last
// N shares *before* the block, where the window N is expressed as a multiple of
// the network difficulty (a "score" window): windowDiff = pplnsN * networkDiff.
// Unlike prop/pplnt the window slides across round boundaries, so it is fed from
// a rolling share log (coin:shares:pplnsWindow) rather than the per-round
// coin:shares:round<height> hash.

export interface PplnsShare {
    worker: string;
    diff: number;
}

// Select the PPLNS window from a share log ordered NEWEST-FIRST. Walk from the
// newest share backward, accumulating difficulty until the running sum reaches
// `windowDiff`. The share that would cross the boundary is *clipped* so the
// window sums to exactly `windowDiff` (the standard score-window approach — it
// keeps the per-block payout basis constant regardless of share granularity).
//
// Edge cases:
//   - windowDiff <= 0 / non-finite        -> empty window (nothing to pay)
//   - available difficulty < windowDiff   -> the whole (unclipped) log is used
//     (a young pool / quiet period simply pays out of what it has)
// Shares with a non-finite or non-positive diff are skipped.
export function selectPplnsWindow(
    shares: PplnsShare[],
    windowDiff: number
): PplnsShare[] {
    if (!Array.isArray(shares) || !(windowDiff > 0)) return [];
    const out: PplnsShare[] = [];
    let acc = 0;
    for (let i = 0; i < shares.length; i++) {
        const s = shares[i];
        const diff = s && Number.isFinite(s.diff) ? s.diff : 0;
        if (diff <= 0) continue;
        const remaining = windowDiff - acc;
        if (diff < remaining) {
            out.push({ worker: s.worker, diff });
            acc += diff;
        } else {
            // this share crosses the window boundary — clip it and stop
            out.push({ worker: s.worker, diff: remaining });
            acc = windowDiff;
            break;
        }
    }
    return out;
}

// Sum the (possibly clipped) window difficulty per worker. Returns the totals
// map and the total difficulty actually covered (<= windowDiff). Worker keys are
// kept verbatim (e.g. "address.rig1"), matching coin:shares:round<height>.
export function pplnsShareTotals(
    shares: PplnsShare[],
    windowDiff: number
): { totals: Record<string, number>; totalDiff: number } {
    const window = selectPplnsWindow(shares, windowDiff);
    const totals: Record<string, number> = {};
    let totalDiff = 0;
    for (const s of window) {
        totals[s.worker] = (totals[s.worker] || 0) + s.diff;
        totalDiff += s.diff;
    }
    return { totals, totalDiff };
}

// Per-worker fraction of the PPLNS window (each in [0,1], summing to 1 when the
// window is non-empty). Drop-in replacement for prop's
// `roundShares / totalShares`: paymentProcessor multiplies each fraction by the
// post-fee block reward. Returns {} when there is nothing to pay.
export function pplnsPercents(
    shares: PplnsShare[],
    windowDiff: number
): Record<string, number> {
    const { totals, totalDiff } = pplnsShareTotals(shares, windowDiff);
    if (!(totalDiff > 0)) return {};
    const out: Record<string, number> = {};
    for (const worker in totals) {
        out[worker] = totals[worker] / totalDiff;
    }
    return out;
}

// Parse a rolling-log entry "worker:diff" (as stored by shareProcessor) back
// into a PplnsShare, or null if malformed. The worker field may itself contain
// no colons (addresses/worker names don't), so a simple last-colon split is safe
// and also tolerates a worker that happens to contain one.
export function parsePplnsEntry(entry: string): PplnsShare | null {
    if (typeof entry !== 'string') return null;
    const idx = entry.lastIndexOf(':');
    if (idx <= 0 || idx === entry.length - 1) return null;
    const worker = entry.slice(0, idx);
    const diff = parseFloat(entry.slice(idx + 1));
    if (!Number.isFinite(diff) || diff <= 0) return null;
    return { worker, diff };
}
