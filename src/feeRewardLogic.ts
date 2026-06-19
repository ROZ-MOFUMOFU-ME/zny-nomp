// Pure, native-import-free helpers for the transaction-fee handling in the
// PPS-family extensions FPPS and PPS+. Kept separate from paymentProcessor.ts so
// the fee math can be unit tested without Redis / the stratum stack (same
// pattern as ppsLogic.ts / pplnsLogic.ts). See docs/payment-schemes.md.
//
// Both schemes build on the existing PPS accrual:
//   - FPPS pays a per-share rate over (blockReward + smoothed avg tx fee), so
//     miners get an even share of expected fees regardless of which block
//     carried them. The fee EMA is rolled from per-cycle samples in accruePPS.
//   - PPS+ pays the block *subsidy* via PPS accrual and distributes each matured
//     block's *tx-fee* portion PPLNS-style. ppsPlusFeePart isolates that portion.

// Average tx fee per block from a cycle's accumulated pending fee and block
// count. <= 0 / non-finite count -> 0 (no sample this cycle).
export function avgFeePerBlock(feePending: number, feeBlocks: number): number {
    if (!(feeBlocks > 0) || !Number.isFinite(feeBlocks)) return 0;
    const pending = Number.isFinite(feePending) ? Math.max(feePending, 0) : 0;
    return pending / feeBlocks;
}

// FPPS effective per-block reward basis = block subsidy + smoothed avg tx fee.
// Negative / non-finite inputs are floored at 0 so a bad EMA never reduces the
// subsidy a miner is owed.
export function fppsEffectiveReward(
    blockReward: number,
    feeEma: number
): number {
    const base = Number.isFinite(blockReward) ? Math.max(blockReward, 0) : 0;
    const fee = Number.isFinite(feeEma) ? Math.max(feeEma, 0) : 0;
    return base + fee;
}

// PPS+ tx-fee portion of a matured block, in satoshi: the coinbase the pool
// received (gross) minus the fixed block subsidy and the payout tx-fee reserve.
// This is the amount distributed PPLNS-style to recent shares; the subsidy stays
// in the wallet to back the PPS accrual. Never negative.
export function ppsPlusFeePart(
    grossSat: number,
    subsidySat: number,
    txfeeSat: number
): number {
    const gross = Number.isFinite(grossSat) ? grossSat : 0;
    const subsidy = Number.isFinite(subsidySat) ? Math.max(subsidySat, 0) : 0;
    const txfee = Number.isFinite(txfeeSat) ? Math.max(txfeeSat, 0) : 0;
    return Math.max(0, gross - subsidy - txfee);
}
