# Design: Solo / PPS / D-PPS Payment Schemes for zny-nomp

> Status: **IMPLEMENTED** on `develop` — `solo`, `pps` and `dpps` are all live in
> `paymentProcessing.paymentMode` (alongside `prop`/`pplnt`). This is the original
> design; the `file:line` references below predate the code and may have drifted.
> D-PPS rate math lives in `src/ppsLogic.ts` (unit-tested in
> `test/ppsLogic.test.ts`); accrual is in `paymentProcessor.ts` (shared with PPS).

---

## 1. Current architecture (as-built)

### 1.1 Where `paymentMode` / `pplnt` is read — `src/paymentProcessor.ts:111-113`
```ts
var pplntEnabled = processingConfig.paymentMode === 'pplnt' || false;
var pplntTimeQualify = processingConfig.pplnt || 0.51; // 51%
```
This is the **only** consumer of `paymentMode`. `prop` is the implicit default
(`pplntEnabled` stays `false`). No switch — the mode is one boolean threaded
into Step 3.

### 1.2 The reward pipeline (`processPayments`, `paymentProcessor.ts:928-2568`)
`async.waterfall` of five steps:

| Step | Lines | Responsibility |
|---|---|---|
| 1 | 957-1215 | Build `workers` from `coin:balances`, `rounds` from `coin:blocksPending` |
| 2 | 1222-1380 | `gettransaction` per round → `round.category`, `round.reward` |
| 3 | 1389-1973 | Per-round shares + pplnt times → `worker.reward` / `worker.immature` |
| 4 | 1980-2315 | Build/send the `sendmany` RPC; record `coin:payments` |
| 5 | 2320-2544 | Final writes: balances, payouts, immature, move blocks, delete round keys |

Step 1 parses the finder (`paymentProcessor.ts:985`):
```ts
minedby: details[3],   // the FINDER is already here
```
Core proportional distribution (`1906-1933`):
```ts
var percent = parseFloat(worker.roundShares) / totalShares;
var workerRewardTotal = Math.round(reward * percent);
worker.reward = (worker.reward || 0) + workerRewardTotal;
```
pplnt time-qualify (`1782-1878`): per-worker `timePeriod = workerTime/maxTime`;
if `0 < timePeriod < pplntTimeQualify`, shrink that worker's shares.

**Steps 1, 2, 4, 5 are scheme-agnostic.** Per-block schemes only change how
Step 3 turns `round.reward` + shares into `worker.reward`. Solo fits this;
PPS/D-PPS do not (§4).

### 1.3 Share & block recording — `src/shareProcessor.ts`
Valid share accumulates per-share (network-normalized) difficulty (`102-107`):
```ts
['hincrbyfloat', coin + ':shares:roundCurrent', shareData.worker, shareData.difficulty]
```
On a valid block (`138-153`): rename `roundCurrent` → `shares:round<height>`,
then record the pending block **with the finder at index 3**:
```ts
['sadd', coin + ':blocksPending',
 [shareData.blockHash, shareData.txHash, shareData.height, shareData.worker, dateNow].join(':')]
```
**Finding (Solo):** the finder is already persisted — no shareProcessor or
block-format change needed. **Finding (PPS):** `coin:stats.networkDiff` is
already cached (`paymentProcessor.ts:584-596`, refreshed 58s) and per-share diff
is already in `coin:shares:roundCurrent`.

### 1.4 Relevant Redis keys
`coin:shares:roundCurrent` (hash worker→diff), `coin:shares:round<height>`,
`coin:shares:timesCurrent`/`times<height>` (pplnt), `coin:blocksPending`
(member `hash:tx:height:worker:time`), `coin:blocksConfirmed`/`Kicked`,
`coin:balances` (owed/unpaid), `coin:payouts` (lifetime), `coin:immature`,
`coin:payments` (audit zset), `coin:hashrate`, `coin:stats` (networkDiff/Blocks/Hash).

---

## 2. Two families
- **Block-based** (`prop`, `pplnt`, `solo`): money moves only when a block
  matures. Pool carries **zero** liability — it only pays coins it received.
  Slots into the existing waterfall.
- **Share-based** (`pps`, `dpps`): miners are owed per *share*, decoupled from
  block confirmation. The pool **fronts** variance from a float → new accrual
  path + real financial liability.

Refactor: replace the lone boolean near `111-113` with a normalized
`paymentMode ∈ { prop(default), pplnt, solo, pps, dpps }`.

---

## 3. Solo — full block reward to the finder
- **Finder availability:** already in Redis; `round.minedby` populated in Step 1
  (`paymentProcessor.ts:985`). No shareProcessor change.
- **Integration (Step 3):** branch the per-worker distribution loop in both the
  `generate` (`1898-1936`) and `immature` (`1693-1719`) cases. Instead of
  `percent = roundShares/totalShares`, assign the entire post-fee `reward`
  (computed at `1744-1746`) to the finder (credit `round.minedby` as the
  address, mirroring Step 4's `w.split('.')[0]` collapse at `2010-2021`); all
  others get 0. Keep the share-totaling loop (Step 4 / `coin:payments` read
  `totalShares`); only the apportionment changes.
- **Guards unchanged:** "no worker shares" (`1509-1554`), duplicate/orphan
  handling, and the wallet-funds check all stay.
- **Pool fee:** the existing `feeSatoshi` reserve at `1744-1746`; finder gets
  `round.reward - feeSatoshi`. No separate logic.
- **Risk: LOW.** Strictly block-based, no float. Worst case is a keying mistake
  misattributing a block — caught on testnet. **Config:** `"paymentMode":
  "solo"`, no sub-fields. **Effort: S.**

---

## 4. PPS — fixed pay-per-share
```
sharePPS = (blockReward / networkDifficulty) * shareDifficulty
```
paid regardless of blocks found.

- **Why it breaks the model:** the waterfall is block-triggered; PPS owes miners
  continuously, before/independent of any block. Earnings cannot come from
  `shares:round<height>` (only exist on a block) — they must accrue from the
  live `roundCurrent` stream. The pool fronts variance ("luck") from a float.
  Today's "insufficient funds → mark immature" safety valve (`1459-1500`) does
  not protect accrued-but-unbacked balances → **bankruptcy risk**.
- **Data:** per-share diff (have, `shareProcessor.ts:106`), networkDiff (have,
  `coin:stats`), blockReward (**new** — config static `pps.blockReward` for v1,
  or daemon-derived `coinbasevalue`/`getblocksubsidy` later).
- **Accrual (new Step 0 on a timer):** shareProcessor writes a **parallel**
  accumulator `coin:pps:shareBuffer` in the same MULTI as `102-107` (keeping
  `roundCurrent` purely for block accounting); the accrual step snapshots+drains
  it, computes `owed = sharePPS * Σ shareDiff`, and credits **`coin:balances`**
  (the hash Step 4 already pays from). Under PPS, matured block rewards (Step 3
  `generate`) go to the **pool wallet/float**, not miners — this is the
  inversion that keeps PPS solvent on average. The existing `listUnspent` guard
  (`1446-1476`) then acts as the float guard.
- **Redis:** new `coin:pps:shareBuffer`, `coin:pps:liability`, `coin:pps:stats`
  (+ optional `coin:pps:owed`); reuse `coin:balances`. shareProcessor adds one
  gated `hincrbyfloat coin:pps:shareBuffer` line.
- **Risk: HIGH.** Pool assumes all variance. Needs pre-funded float (several ×
  expected block reward), monitoring of `pps:liability`/float ratio via
  `src/metrics.ts`, and a kill-switch (auto-fall-back to prop when float <
  threshold). **Config:** `"paymentMode": "pps"` + `pps: { blockReward,
  minFloat, feePercent }`. **Effort: L.**

---

## 5. D-PPS — dynamic PPS

> **Implemented.** Reuses the entire PPS accrual path (shareBuffer drain + float
> kill-switch); only the per-share rate differs. `rateScalar` and the smoothed
> realized luck are computed in `src/ppsLogic.ts`, persisted to `coin:pps:stats`
> (`rateScalar`/`realizedLuck`/`expectedEma`/`actualEma`), and exposed via
> `/api/metrics` (`nomp_pool_dpps_rate_scalar`, `nomp_pool_dpps_realized_luck`).
> `actualReward` is accrued from matured blocks (Step 3 `generate`) into
> `coin:pps:stats.actualPending`. NOT mainnet-safe until a sustained testnet run.

```
basePPS    = (blockReward / networkDifficulty) * shareDifficulty
realizedLuck(window) = actualRewardReceived / expectedReward   (expected = basePPS·Σ shareDiff)
rateScalar = clamp( smoothed(realizedLuck) * (1 - targetMargin), rateMin, 1.0 )
sharePPS_dynamic = basePPS * rateScalar
```
- `smoothed` = EMA/rolling mean over `smoothingWindow`; `targetMargin` keeps the
  pool slightly solvent on average; `clamp(...,rateMin,1.0)` never pays > full
  PPS and floors payout at `rateMin` (the floor bounds pool downside vs pure PPS).
- Inputs all accruable: `actualRewardReceived` from Step 3 `generate`
  (`1730-1746`), `expectedReward` from the accrual `Σ shareDiff`; store rolling
  luck/rate in `coin:pps:stats`.
- **Config:** `dpps: { blockReward, targetMargin, smoothingWindow, rateMin,
  minFloat }`. **Risk: MEDIUM-HIGH** (auto-throttles on bad luck + `rateMin`
  floor, but still float-exposed). **Effort: L**, built on PPS.

---

## 6. Config schema change
`paymentProcessing.paymentMode` 'prop'|'pplnt' → add 'solo'|'pps'|'dpps'. Update
the `_comment_paymentMode` in every `pool_configs/examples/*` (additive, valid
JSON → `npm run check:config` passes). Add a runtime guard near
`paymentProcessor.ts:111-113` that errors on unknown modes and warns if
`pps`/`dpps` lack `minFloat`. Per CLAUDE.md the keys are additive and default-off
(`prop` stays default), so existing deployments are unaffected.

```jsonc
"paymentProcessing": {
    "paymentMode": "prop",
    "_comment_paymentMode": "prop, pplnt, solo, pps, dpps",
    "pplnt": 0.51,
    "pps":  { "blockReward": 50, "minFloat": 500, "feePercent": 1.0, "accrualInterval": 60 },     // pps only
    "dpps": { "blockReward": 50, "targetMargin": 0.02, "rateMin": 0.5, "smoothingWindow": 100, "minFloat": 500, "accrualInterval": 60 } // dpps only
}
```

---

## 7. Summary

| Scheme | Model | New Redis keys | Pool risk | Effort | Prod-safe? |
|---|---|---|---|---|---|
| Solo | block-based | none (finder already stored) | Low | S | Yes (after testnet keying check) |
| PPS | share-based accrual | pps:shareBuffer, pps:liability, pps:stats | High (fronts variance, bankruptcy) | L | No until float mgmt + monitoring + kill-switch + testnet |
| D-PPS | share-based + dynamic rate | PPS keys + luck/rate fields | Medium-High (bounded by rateMin) | L | No until PPS hardened |

(Existing: prop = block-based no risk; pplnt = block-based + time-weight, no risk.)

## 8. Recommended order
1. **Solo first** — contained Step-3 change, zero new Redis state, zero
   shareProcessor change, no liability. Validates the pluggable-`paymentMode`
   refactor without touching the financial model.
2. **Refactor groundwork** (during Solo) — normalize `paymentMode`, thread it
   into shareProcessor (already receives `poolConfig`) for PPS's later
   `shareBuffer` write. Keep prop/pplnt behavior identical.
3. **PPS — gated.** Accrual step + `pps:*` keys + float guard (reuse
   `listUnspent` `1446-1476`) + metrics + kill-switch. Not on mainnet until
   sustained testnet run, float-sizing guidance, and liability alerting.
4. **D-PPS last** — superset of PPS; only the dynamic-rate controller + luck
   bookkeeping on top.

**Principle:** block-based (Solo) is downside-free and ships incrementally;
share-based (PPS/D-PPS) turn the pool into a counterparty that owes miners money
it may not yet have — keep them behind float management + extensive testnet.
