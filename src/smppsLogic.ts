// Pure, native-import-free helpers for the SMPPS family (SMPPS, ESMPPS). Kept
// separate from paymentProcessor.ts so the allocation math can be unit tested
// without Redis / the stratum stack (same pattern as ppsLogic.ts / pplnsLogic.ts
// / feeRewardLogic.ts). See docs/payment-schemes.md.
//
// SMPPS-family = "Shared Maximum PPS": miners accrue a PPS-style amount per share
// into an OWED ledger, but the pool only ever releases owed->balances up to the
// income it has actually earned (matured block rewards). So credited balances
// never exceed realized income — the pool can run a *debt* (deferred owed) but
// never an unbacked liability, which bounds the bankruptcy risk of plain PPS.
// The two modes differ only in HOW a limited income budget is allocated across
// outstanding debt:
//   - SMPPS  : oldest debt first (FIFO) — recent shares wait when underfunded.
//   - ESMPPS : equalized — every miner gets the same fraction of their owed.

export interface DebtBatch {
    worker: string;
    owed: number;
}

// ESMPPS: split `budget` across the per-worker `owed` map so everyone is paid
// the same fraction of what they are owed (min(1, budget/totalOwed)). Returns
// the paid amounts and any budget left over once all debt is cleared.
export function esmppsAllocate(
    owed: Record<string, number>,
    budget: number
): { paid: Record<string, number>; leftover: number } {
    const b = Number.isFinite(budget) && budget > 0 ? budget : 0;
    let total = 0;
    for (const w in owed) {
        const v = owed[w];
        if (Number.isFinite(v) && v > 0) total += v;
    }
    if (total <= 0 || b <= 0) return { paid: {}, leftover: b };
    const fraction = Math.min(1, b / total);
    const paid: Record<string, number> = {};
    for (const w in owed) {
        const v = owed[w];
        if (Number.isFinite(v) && v > 0) paid[w] = v * fraction;
    }
    const leftover = b >= total ? b - total : 0;
    return { paid, leftover };
}

// SMPPS: pay outstanding debt batches oldest-first (FIFO; `queue[0]` is oldest)
// until `budget` is exhausted. The batch that crosses the budget boundary is
// partially paid (clipped). Returns the paid amounts per worker, the remaining
// debt queue (fully-paid batches dropped, the boundary batch reduced), and any
// leftover budget once all debt is cleared.
export function smppsAllocate(
    queue: DebtBatch[],
    budget: number
): { paid: Record<string, number>; remaining: DebtBatch[]; leftover: number } {
    const paid: Record<string, number> = {};
    const remaining: DebtBatch[] = [];
    let b = Number.isFinite(budget) && budget > 0 ? budget : 0;
    if (!Array.isArray(queue)) return { paid, remaining, leftover: b };
    for (let i = 0; i < queue.length; i++) {
        const batch = queue[i];
        const owed = batch && Number.isFinite(batch.owed) ? batch.owed : 0;
        if (owed <= 0) continue;
        if (b <= 0) {
            // budget spent — carry the rest of the debt forward unchanged
            remaining.push({ worker: batch.worker, owed });
            continue;
        }
        if (owed <= b) {
            paid[batch.worker] = (paid[batch.worker] || 0) + owed;
            b -= owed;
        } else {
            // clip: pay what budget allows, carry the unpaid remainder
            paid[batch.worker] = (paid[batch.worker] || 0) + b;
            remaining.push({ worker: batch.worker, owed: owed - b });
            b = 0;
        }
    }
    return { paid, remaining, leftover: b };
}

// Parse a debt-queue entry "worker:owed" (as stored by the SMPPS accrual) back
// into a DebtBatch, or null if malformed. Last-colon split so a worker name that
// contains a colon still parses (addresses/worker names normally don't).
export function parseDebtEntry(entry: string): DebtBatch | null {
    if (typeof entry !== 'string') return null;
    const idx = entry.lastIndexOf(':');
    if (idx <= 0 || idx === entry.length - 1) return null;
    const worker = entry.slice(0, idx);
    const owed = parseFloat(entry.slice(idx + 1));
    if (!Number.isFinite(owed) || owed <= 0) return null;
    return { worker, owed };
}
