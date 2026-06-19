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

| Step | Lines     | Responsibility                                                            |
| ---- | --------- | ------------------------------------------------------------------------- |
| 1    | 957-1215  | Build `workers` from `coin:balances`, `rounds` from `coin:blocksPending`  |
| 2    | 1222-1380 | `gettransaction` per round → `round.category`, `round.reward`             |
| 3    | 1389-1973 | Per-round shares + pplnt times → `worker.reward` / `worker.immature`      |
| 4    | 1980-2315 | Build/send the `sendmany` RPC; record `coin:payments`                     |
| 5    | 2320-2544 | Final writes: balances, payouts, immature, move blocks, delete round keys |

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
[
    'hincrbyfloat',
    coin + ':shares:roundCurrent',
    shareData.worker,
    shareData.difficulty
];
```

On a valid block (`138-153`): rename `roundCurrent` → `shares:round<height>`,
then record the pending block **with the finder at index 3**:

```ts
[
    'sadd',
    coin + ':blocksPending',
    [
        shareData.blockHash,
        shareData.txHash,
        shareData.height,
        shareData.worker,
        dateNow
    ].join(':')
];
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

- **Block-based** (`prop`, `pplnt`, `solo`, `pplns`): money moves only when a
  block matures. Pool carries **zero** liability — it only pays coins it
  received. Slots into the existing waterfall.
- **Share-based** (`pps`, `dpps`, `fpps`): miners are owed per _share_,
  decoupled from block confirmation. The pool **fronts** variance from a float →
  new accrual path + real financial liability.
- **Hybrid** (`ppsplus`): the block _subsidy_ is share-based (PPS accrual,
  float-backed) while the _tx-fee_ portion of each block is block-based
  (distributed PPLNS-style on maturity).
- **Bounded share-based** (`smpps`, `esmpps`): per-share accrual like PPS, but
  releases to balances are **capped at the pool's realized income**, so the pool
  carries deferred _debt_ rather than an unbacked liability — the SMPPS-family
  way of bounding PPS's bankruptcy risk.

Refactor: replace the lone boolean near `111-113` with a normalized
`paymentMode ∈ { prop(default), pplnt, pplns, solo, pps, dpps, fpps, ppsplus, smpps, esmpps }`.

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

## 5b. PPLNS — pay per last N shares (block-based)

> **Implemented** on `develop` as `paymentMode: "pplns"`. Block-based (no float /
> liability, like prop/pplnt/solo). Window/apportionment math is pure and
> unit-tested in `src/pplnsLogic.ts` (`test/pplnsLogic.test.ts`). **Needs a
> sustained testnet run before mainnet** — the keying / window sizing should be
> watched on a real multi-worker pool first.

```
windowDiff = pplnsN * networkDiff
percent(worker) = Σ worker's diff in the last `windowDiff` of shares / windowDiff
worker.reward   = postFeeBlockReward * percent(worker)
```

Each matured block is shared among the contributors to the **last N shares**
before it, where the window N is a multiple of the network difficulty (a "score"
window). Unlike `prop`/`pplnt` the window **slides across round boundaries**, so
it is fed from a rolling share log rather than the per-round
`coin:shares:round<height>` hash.

- **Rolling log (`shareProcessor.ts`):** every valid share `LPUSH`es
  `"worker:diff"` onto `coin:shares:pplnsWindow` (newest first), trimmed to
  `pplns.maxLogLength` entries (default 100000). Additive — `roundCurrent` is
  still maintained for the no-worker-shares guard and orphan merge-back.
- **Block-time snapshot:** on a valid block the log is `COPY`'d (Redis 6.2+,
  `REPLACE`) into `coin:shares:pplnsRound<height>` in the same MULTI, _after_ the
  block-finding share is pushed — so the window is captured at find time, not at
  payment time.
- **Payout (`paymentProcessor.ts`, Step 3):** for each `generate`/`immature`
  round, the snapshot is read (`LRANGE`), parsed, and resolved by
  `pplnsShareTotals(entries, pplnsN * networkDiff)` into a `{ worker -> windowDiff }`
  map that **replaces** the per-round share hash. The existing proportional loop
  (`percent = roundShares / totalShares`) then distributes the full post-fee
  reward unchanged. The snapshot key is deleted with the round keys in Step 5.
- **Window sizing note:** the window uses the _current_ cached `networkDiff`. A
  slightly stale difficulty only shifts _which_ shares fall in the window — the
  full block reward is always distributed proportionally among the window, so
  there is no solvency impact. A block whose snapshot is empty/missing (e.g.
  found before `pplns` was enabled) falls back to its round shares (prop-like)
  rather than being kicked.
- **Risk: LOW** (block-based, no float). **Config:** `"paymentMode": "pplns"` +
  `pplns: { n, maxLogLength }`. **Effort: M.**

---

## 5c. FPPS — full pay-per-share (block subsidy + average tx fees)

> **Implemented** as `paymentMode: "fpps"`. SHARE-BASED — same float /
> kill-switch risk as PPS; reuses the entire PPS accrual path. Fee math is pure
> and unit-tested in `src/feeRewardLogic.ts` (`test/feeRewardLogic.test.ts`).
> **Not mainnet-safe until a sustained testnet run** (as with PPS/D-PPS).

```
feeEma      = EMA over `feeWindow` of per-block tx fees (sampled at maturity)
rewardBasis = blockReward + feeEma
sharePPS    = (rewardBasis / networkDiff) * (1 - feePercent/100) * shareDiff
```

FPPS is PPS whose per-share rate also pays out the pool's **expected transaction
fees**, so a miner's fee earnings don't depend on happening to be active for the
one block that carried a fat fee.

- **Fee sampling (`paymentProcessor.ts`, Step 3 `generate`):** each matured
  block's fee `= round.reward - blockReward` is accumulated into
  `coin:pps:stats` as `feePending` (sum) + `feeBlocksPending` (count).
- **Fee EMA (accruePPS):** each cycle rolls `feeEma = emaNext(feeEma,
feePending/feeBlocksPending, feeWindow)` and clears the pending samples
  (subtracting the snapshot so a mid-cycle block isn't lost — same trick as
  D-PPS `actualPending`). The per-share rate basis becomes `blockReward + feeEma`.
- **Block routing:** as with PPS, the whole matured reward goes to the float
  (it funds the accrual). `feeEma` floors at 0, so a bad sample never cuts the
  subsidy a miner is owed.
- **Risk: HIGH** (share-based, fronts variance). **Config:** `"paymentMode":
"fpps"` + `fpps: { blockReward, feePercent, minFloat, feeWindow, accrualInterval }`.
  **Effort: M** (built on PPS).

---

## 5d. PPS+ — PPS subsidy + PPLNS fees

> **Implemented** as `paymentMode: "ppsplus"`. HYBRID: the block subsidy is
> share-based (PPS accrual, float-backed), the tx-fee portion is block-based
> (PPLNS). Reuses both the PPS accrual path and the PPLNS window path. Fee-split
> math is pure/tested (`ppsPlusFeePart`). **Not mainnet-safe until a sustained
> testnet run** (the subsidy leg carries PPS float risk).

```
subsidy per share = (blockReward / networkDiff) * (1 - feePercent/100) * shareDiff   (PPS accrual)
fee part (per block, satoshi) = gross - blockReward - txfeeReserve                    (ppsPlusFeePart)
fee part distributed PPLNS-style over the last N shares before the block
```

- **Subsidy leg:** identical to PPS — shareProcessor mirrors each share into
  `coin:pps:shareBuffer`, `accruePPS` credits `coin:balances`. The subsidy
  **stays in the wallet** (it is _not_ routed to the float as miner-owed) to back
  this accrual.
- **Fee leg:** shareProcessor also maintains the PPLNS rolling log + per-block
  snapshot (`coin:shares:pplnsWindow` / `pplnsRound<height>`). At maturity the
  fee part replaces the apportioned `reward`, distributed by the PPLNS window
  (`ppsplus.n × networkDiff`). A subsidy-only block (no fees) simply pays 0 from
  the block — the block still confirms (the funds check counts the full reward,
  so it never sticks immature).
- **Risk: MEDIUM-HIGH** (only the subsidy is float-exposed; fees are paid from
  coins actually received). **Config:** `"paymentMode": "ppsplus"` + `ppsplus: {
blockReward, feePercent, minFloat, n, maxLogLength, accrualInterval }`.
  **Effort: M** (PPS + PPLNS).

---

## 5e. SMPPS / ESMPPS — shared-maximum PPS (bounded pool risk)

> **Implemented** as `paymentMode: "smpps"` / `"esmpps"`. Per-share accrual like
> PPS, but balances are released only up to the pool's realized income, so the
> pool never credits more than it has earned (deferred debt, not unbacked
> liability). Allocation math is pure/tested in `src/smppsLogic.ts`
> (`test/smppsLogic.test.ts`). **Not mainnet-safe until a sustained testnet run.**

```
owed(worker)  += (blockReward / networkDiff) * (1 - feePercent/100) * shareDiff   (each cycle)
budget        += matured block reward                                             (Step 3, the income)
release        = allocate(outstanding owed, budget)  ->  credited to coin:balances
```

The key difference from PPS: PPS credits `coin:balances` unconditionally (the
pool fronts variance and can go bankrupt). SMPPS credits an **owed ledger** and
only **releases owed → balances up to `budget`** (income actually received), so
credited balances ≤ income. The pool may owe a backlog when unlucky, but never
pays out money it doesn't have.

- **Accrual (`accrueSMPPS`, separate timer):** drains `coin:pps:shareBuffer`
  into the owed ledger, then releases against `coin:smpps:stats.budget`.
- **Income (`paymentProcessor.ts`, Step 3 `generate`):** each matured block's
  reward is added to `budget` (the block reward is **not** credited to miners
  directly — `percent = 0`, same as PPS routing it to the float). The funds
  check still counts the full reward, so a block never sticks immature.
- **Allocation strategies:**
    - **SMPPS** — oldest debt first (FIFO `coin:smpps:debt` list; the boundary
      batch is clipped). Recent shares wait when the pool is underfunded.
    - **ESMPPS** — equalized (`coin:smpps:owed` hash): every miner is paid the
      same fraction `min(1, budget/Σowed)` of their owed, so a shortfall is
      shared evenly rather than by age.
- **Kill-switch:** the `minFloat` float guard still pauses releases (the budget
  is retained). The budget is decremented by the amount actually paid
  (`hincrbyfloat`, not `hset`) so income arriving mid-cycle is never lost.
- **Risk: LOW–MEDIUM** (bounded by income; the residual risk is just operating
  with a standing debt). **Config:** `"paymentMode": "smpps"|"esmpps"` + `{smpps|
esmpps}: { blockReward, feePercent, minFloat, accrualInterval }`. **Effort: M.**

---

## 6. Config schema change

`paymentProcessing.paymentMode` 'prop'|'pplnt' → add
'solo'|'pplns'|'pps'|'dpps'|'fpps'|'ppsplus'|'smpps'|'esmpps'. Update the `_comment_paymentMode`
in every `pool_configs/examples/*` (additive, valid JSON → `npm run check:config`
passes). A runtime guard near the `paymentMode` parse warns on unknown modes
(and warns if a share-based mode lacks `minFloat`). Per CLAUDE.md the keys are
additive and default-off (`prop` stays default), so existing deployments are
unaffected.

```jsonc
"paymentProcessing": {
    "paymentMode": "prop",
    "_comment_paymentMode": "prop, pplnt, pplns, solo, pps, dpps, fpps, ppsplus",
    "pplnt": 0.51,
    "pplns": { "n": 2, "maxLogLength": 100000 },                                                   // pplns only
    "pps":  { "blockReward": 50, "minFloat": 500, "feePercent": 1.0, "accrualInterval": 60 },     // pps only
    "dpps": { "blockReward": 50, "targetMargin": 0.02, "rateMin": 0.5, "smoothingWindow": 100, "minFloat": 500, "accrualInterval": 60 }, // dpps only
    "fpps": { "blockReward": 50, "feePercent": 1.0, "minFloat": 500, "feeWindow": 100, "accrualInterval": 60 }, // fpps only
    "ppsplus": { "blockReward": 50, "feePercent": 1.0, "minFloat": 500, "n": 2, "maxLogLength": 100000, "accrualInterval": 60 }, // ppsplus only
    "smpps": { "blockReward": 50, "feePercent": 1.0, "minFloat": 500, "accrualInterval": 60 },   // smpps only
    "esmpps": { "blockReward": 50, "feePercent": 1.0, "minFloat": 500, "accrualInterval": 60 }  // esmpps only
}
```

---

## 7. Summary

| Scheme | Model                                          | New Redis keys                            | Pool risk                                   | Effort | Prod-safe?                                               |
| ------ | ---------------------------------------------- | ----------------------------------------- | ------------------------------------------- | ------ | -------------------------------------------------------- |
| Solo   | block-based                                    | none (finder already stored)              | Low                                         | S      | Yes (after testnet keying check)                         |
| PPLNS  | block-based, sliding window                    | shares:pplnsWindow, shares:pplnsRound<h>  | Low (no float)                              | M      | After a sustained testnet run                            |
| PPS    | share-based accrual                            | pps:shareBuffer, pps:liability, pps:stats | High (fronts variance, bankruptcy)          | L      | No until float mgmt + monitoring + kill-switch + testnet |
| D-PPS  | share-based + dynamic rate                     | PPS keys + luck/rate fields               | Medium-High (bounded by rateMin)            | L      | No until PPS hardened                                    |
| FPPS   | share-based (subsidy + fees)                   | PPS keys + fee EMA fields                 | High (fronts variance, like PPS)            | M      | After a sustained testnet run                            |
| PPS+   | hybrid (PPS subsidy + PPLNS fees)              | PPS keys + PPLNS window keys              | Medium-High (only subsidy float-exposed)    | M      | After a sustained testnet run                            |
| SMPPS  | bounded share-based (income-capped, FIFO debt) | smpps:debt, smpps:stats                   | Low-Medium (capped at income; carries debt) | M      | After a sustained testnet run                            |
| ESMPPS | bounded share-based (income-capped, equalized) | smpps:owed, smpps:stats                   | Low-Medium (capped at income; carries debt) | M      | After a sustained testnet run                            |

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
