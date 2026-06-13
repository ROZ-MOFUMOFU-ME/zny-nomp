# Roadmap

This portal is the top of a three-repo stack developed together:

- **zny-nomp** (this repo) — the mining portal (ESM, Node 20+)
- [node-stratum-pool](https://github.com/ROZ-MOFUMOFU-ME/node-stratum-pool) — the Stratum poolserver library
- [node-multi-hashing](https://github.com/ROZ-MOFUMOFU-ME/node-multi-hashing) — the native hashing addon

Each sibling repo has its own `ROADMAP.md`. This document tracks the portal
and the stack as a whole.

## Current state

- Runs on Node 20–24 (ESM) with the node-redis v6 client (Redis 6.2+).
- CI green on GitHub Actions and CircleCI (Node 20/22/24).
- **Mining + payout verified**: BitZeny, Koto, Monacoin, Bellcoin,
  Sugarchain, KumaCoin.
- **In progress** (pool_configs enabled but not production-ready):
  - VIPSTARCOIN — verified end-to-end on regtest; mainnet config still has
    placeholder address/RPC credentials and needs a payout run.
  - Yenten — developer-fee coinbase output is implemented and source-verified
    against yenten 6.1, but untested against a live mainnet daemon.
  - Susucoin — the coin daemon does not build yet; on hold.

## Known issues & limitations

- **No real test suite** — `npm test` just boots `init.js`; there is no unit
  coverage for share/payment/stats Redis logic.
- **LICENSE is the unfilled MIT template** — the year and copyright holder
  placeholders are still present.
- **Frontend** uses `dot` templates; there is no modern SPA (an experimental
  Next.js rewrite once lived on a `dev2` branch but was dropped).
- **Profit switching** has no live price source — the exchange-price API
  modules (Bittrex/Poloniex/etc.) were removed during the ESM migration.
- **MySQL path** (MPOS compatibility) still uses the legacy `mysql` package.

> KumaCoin's DNS seeder (bitcoin-seeder `kuma` branch, with the
> `--minversion/--protover/--initversion` options for the old peercoin-style
> wallet) is deployed and serving nodes, so KumaCoin mining is operational.

## Roadmap

### Near-term
- Fill in the LICENSE year / copyright holder.
- Complete the VIPSTARCOIN mainnet config and verify a real payout.
- Decide Susucoin: get the daemon building, or drop it to an example.
- Verify Yenten dev-fee payouts on mainnet (height ≥ 2,030,000).
- Add a CI step that does more than boot `init.js` (e.g. lint + a headless
  config-parse / Redis round-trip check).

### Mid-term
- Add unit tests for `shareProcessor`, `paymentProcessor` and `stats` against
  a local Redis.
- Replace `mysql` with `mysql2`, or drop MPOS mode if unused.
- Restore a profit-switch price source, or remove the feature and its config.

### Long-term
- **Consolidate the three repos into a single monorepo** — the portal, the
  Stratum library and the hashing addon are developed as one unit, so a
  monorepo (e.g. npm workspaces) would remove the cross-repo git-dependency
  pinning, the `npm link` chain, the per-repo CI duplication, and the
  three-way release dance. This is the intended end state of the stack.
- Modern web UI consuming the existing JSON API (`libs/api.js`).
- Metrics endpoint (Prometheus) for pool/worker hashrate and payments.
- Tagged-release workflow so consumers can pin git deps by tag instead of
  tracking `#main` (an interim step until the monorepo lands).
