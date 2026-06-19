// Pure, native-import-free helpers for the share-based payment schemes (PPS and
// D-PPS). Kept separate from paymentProcessor.ts so the rate math can be unit
// tested without spinning up Redis / the stratum stack (same pattern as
// profitSwitchLogic.ts / statsUtil.ts). See docs/payment-schemes.md §4–5.

// D-PPS dynamic per-share rate scalar.
//   rateScalar = clamp( realizedLuck * (1 - targetMargin), rateMin, 1.0 )
// The (1 - targetMargin) factor keeps the pool slightly solvent on average; the
// clamp never pays more than full PPS (1.0) and floors payout at rateMin so the
// pool's downside vs. pure PPS is bounded. A non-finite or non-positive luck
// (no data / garbage) collapses to the rateMin floor (most conservative).
export function dppsRateScalar(
    realizedLuck: number,
    targetMargin: number,
    rateMin: number
): number {
    const margin = clamp(
        Number.isFinite(targetMargin) ? targetMargin : 0,
        0,
        1
    );
    const floor = clamp(Number.isFinite(rateMin) ? rateMin : 0, 0, 1);
    const luck =
        Number.isFinite(realizedLuck) && realizedLuck > 0 ? realizedLuck : 0;
    return clamp(luck * (1 - margin), floor, 1.0);
}

// EMA step with smoothing factor alpha = 1 / window (window in accrual cycles).
// next = prev + (sample - prev) / window. window < 1 is treated as 1 (the EMA
// then just tracks the latest sample). Non-finite inputs are treated as 0.
export function emaNext(prev: number, sample: number, window: number): number {
    const w = Math.max(Number.isFinite(window) ? window : 1, 1);
    const p = Number.isFinite(prev) ? prev : 0;
    const s = Number.isFinite(sample) ? sample : 0;
    return p + (s - p) / w;
}

// realizedLuck = smoothed(actualRewardFlow) / smoothed(expectedRewardFlow).
// Until any expected work has been observed there is no luck signal, so return
// 1.0 (neutral) — the rate scalar then sits at (1 - targetMargin).
export function realizedLuck(actualEma: number, expectedEma: number): number {
    if (!(expectedEma > 0)) return 1.0;
    const l = actualEma / expectedEma;
    return Number.isFinite(l) && l >= 0 ? l : 1.0;
}

// Value of one stratum-difficulty unit of work, in coins:
//   basePPS = reward / (rawNetworkDiff * algoMultiplier)
// `rawNetworkDiff` is the daemon getmininginfo difficulty cached in
// coin:stats.networkDiff; multiplying by the algo multiplier puts it on the
// SAME (stratum) scale as the accumulated shareData.difficulty. Skipping the
// multiplier over-credits by the multiplier on non-sha256 algos (e.g. 65536x on
// yespower/yescrypt) — see docs/payment-schemes.md §4. Returns 0 for a
// non-positive / non-finite effective difficulty or reward (callers then accrue
// nothing rather than NaN/Infinity).
export function basePPS(
    reward: number,
    rawNetworkDiff: number,
    algoMultiplier: number
): number {
    const eff = rawNetworkDiff * algoMultiplier;
    if (!Number.isFinite(reward) || reward < 0) return 0;
    if (!Number.isFinite(eff) || eff <= 0) return 0;
    return reward / eff;
}

function clamp(x: number, lo: number, hi: number): number {
    return Math.min(Math.max(x, lo), hi);
}
