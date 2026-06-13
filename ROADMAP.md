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
- **Real-time price feeds** from a modern source (e.g. CoinGecko /
  CoinMarketCap) to replace the removed Bittrex/Poloniex modules — restoring
  profit switching and powering the price-driven services below.

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
- High availability and scale: run multiple portal instances, evaluate Redis
  Cluster/replicas, and harden share/payment processing under load.
- More coins and algorithms as node-stratum-pool / node-multi-hashing gain
  them (e.g. Ethash family, RandomX, Equihash); optional merged mining
  (AuxPoW).

## Focus areas

Cross-cutting improvement themes that span the near/mid/long-term items above.
Monorepo consolidation is deferred; these are the active priorities.

### Modernization
- Replace the `dot`-template frontend with a modern SPA built on the existing
  JSON API (`libs/api.js` / `libs/workerapi.js`).
- Evaluate TypeScript for the portal and the sibling libraries.
- Keep the toolchain current (ESLint/Prettier, Node LTS, routine dependency
  bumps).
- **Finish i18n** — `website/static/translations.json` already ships en / ja /
  zh / zh-TW / fr and more; complete the string coverage, expose a language
  switcher in the UI, and make adding new locales straightforward.
- **Mobile-friendly, responsive UI** plus a Progressive Web App (installable,
  offline stats view, optional push notifications) and a dark mode.
- Documented public API (OpenAPI/Swagger) and optional WebSocket push for
  live stats instead of polling.
- Accessibility (a11y) pass on the UI.

### Security hardening
- Keep dependencies patched (Dependabot + `npm audit`); dev-only advisories
  are already pinned via package.json `overrides`.
- Move daemon RPC credentials out of plaintext `pool_configs/*.json` into
  environment variables / a secrets store.
- TLS for the website and (optionally) stratum ports; tighten the existing
  IP-banning and vardiff-based DoS protection.
- Redis hardening: bind to localhost, require a password/ACL, document
  persistence and firewalling.
- Admin-area 2FA, an audit log, and CSP / security response headers.
- Stronger share-submission rate limiting (in concert with the stratum
  server's banning/vardiff in node-stratum-pool).

### Observability
- Prometheus-compatible metrics endpoint (pool/worker hashrate, valid and
  invalid shares, blocks found, payment totals, per-daemon reachability).
- Structured (JSON) logging plus health / readiness endpoints.
- Alerting on stale daemons, payment failures, and worker-process crashes.
- Miner-facing notifications: block-found, payment-sent and worker-offline
  alerts via email / Discord / generic webhook.

### Containerization
- A `Dockerfile` for the portal (multi-stage; compiles the native addon with
  GCC 10+).
- A `docker-compose` stack wiring the portal, Redis, and coin daemons for
  reproducible local and dev deployments.
- Kubernetes manifests / a Helm chart for production.

### Miner experience
- Additional reward schemes (PPS, PPLNS, solo) on top of the current
  PROP/PPLNT modes.
- Per-worker minimum-payout threshold and payout address configurable by the
  miner.
- Richer hashrate-history graphs and custom worker labels.

### Price & profitability services
Built on the real-time price feeds above:
- Fiat-denominated (USD / JPY / ...) earnings and balances on the dashboard.
- A profitability calculator (hashrate → estimated reward / day) and a
  price ticker / chart.
- Profit switching driven by live price × network-difficulty, with optional
  auto-exchange / auto-conversion hooks.
- Record the coin price at payout time for historical earnings reporting.

### Operations & reliability
- Hot-reload of pool configs (add or change pools without restarting workers).
- Automated CD (tag → deploy) and a documented backup/restore procedure for
  the Redis data (shares, balances, stats).
- A public status page.

### Documentation
- An "add a coin" guide covering the steps to wire a new coin through the
  three repos (coin definition, algorithm, daemon, pool config).
- An operations runbook (incident response, daemon-desync recovery, payout
  reconciliation).
