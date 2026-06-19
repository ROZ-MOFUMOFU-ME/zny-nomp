# Roadmap

This portal is the top of a three-repo stack developed together:

- **zny-nomp** (this repo) — the mining portal (ESM, Node `>=22.18` for native type-stripping, Node 24 recommended)
- [node-stratum-pool](https://github.com/ROZ-MOFUMOFU-ME/node-stratum-pool) — the Stratum poolserver library
- [node-multi-hashing](https://github.com/ROZ-MOFUMOFU-ME/node-multi-hashing) — the native hashing addon

Each sibling repo has its own `ROADMAP.md`. This document tracks the portal
and the stack as a whole.

## Current state

- Runs on Node `>=22.18` (Node 24 recommended; ESM) with the node-redis v6
  client (Redis 6.2+). `>=22.18` is required for unflagged native TypeScript
  type-stripping; older Node also fails to load the ESM `@exodus/crypto`
  dependency with `ERR_REQUIRE_ESM`.
- **TypeScript migration complete (all three repos, buildless)**: the portal
  (`src/init.ts` and the other `src/*.ts`) and node-stratum-pool (`src/*.ts`,
  main `src/index.ts`) are now TypeScript, run directly via Node's native
  type-stripping (Node 22.18+/24, no build step), and are type-checked with
  `tsc --noEmit`. node-multi-hashing's `index.js` stays JavaScript on purpose —
  the `bindings` resolver can't locate the native `multihashing.node` addon when
  the entry is a `.ts` loaded through Node's ESM→CJS translator. (`eslint.config.js`
  also stays JS.)
- **New React/Vite SPA frontend** in `web/` (Vite + React + TypeScript, React
  Router v7, @tanstack/react-query, recharts, react-i18next with the 21-language
  i18n ported from the old `translations.json`). It is the one build step in the
  stack (`cd web && npm run build` → `web/dist`); the portal serves it from
  `src/website.ts` with an index.html fallback for client-side routes and a new
  `GET /api/config` endpoint exposing public runtime config. The old `dot`
  templates + jQuery/nvd3 were removed.
- **Web UX & operator features (2026-06-17)**:
    - The stats page again shows each coin's **daemon version**. For old
      getinfo-only wallets that don't expose a P2P `subversion` (e.g. KumaCoin,
      whose `getinfo.version` is a git build string), the payment processor
      reconstructs it from an optional per-coin `subVersion` template in
      `coins/*.json` (e.g. `"/Antenna:{version}/"` → `/Antenna:0.8.9.9/`).
    - **Admin-editable home announcement** — set or clear a banner shown at the
      top of the home page from the password-gated admin center (public
      `GET /api/announcement`, admin `POST /api/admin/announcement`, stored in
      Redis; rendered as escaped plain text).
    - **Per-coin mining-software links** — an optional `miningTools` array in
      each `coins/*.json` (`{name, url}` entries) is surfaced through
      `GET /api/config` and listed on the Getting Started page when a coin is
      selected.
    - Live-price display fixes: small prices format without exponential notation
      (`5.8079e-7` → `0.00000058079`), and the CoinGecko provider runs keyless
      by default (a stray `apiKey` value had caused intermittent HTTP 401). The
      feed also drives a JPY/other-fiat price ticker.
- **Payments, admin & ops (2026-06-18/19)**:
    - **New payment modes** — `solo`, `pps` (pay-per-share) and `dpps`
      (dynamic PPS, with a realized-luck `rateScalar`) on top of the existing
      `prop`/`pplnt`, selected per pool via `paymentMode`; PPS/D-PPS carry a
      `minFloat` kill-switch. See `docs/payment-schemes.md`.
    - **Admin commands over HTTP** — manual `reloadpool` and `coinswitch` are
      now password-gated `POST /api/admin/<method>` calls relayed to the cluster
      master, replacing the removed `scripts/cli.ts`. The `scripts/` folder is
      gone entirely: config validation moved to `test/config.test.ts` (run by
      `check:config`/`test:unit`), and the old Python/systemd balance scripts
      were replaced by the logger below.
    - **Optional wallet-balance logger** — `src/balanceLogger.ts` (`balanceLog`
      config block, default off) records each pool's daemon `getbalance` into
      Redis, surfaced on the stats page, via `/api`, and as the Prometheus gauge
      `nomp_pool_wallet_balance`.
    - **Reverse-proxy guide** — `docs/reverse-proxy.md` (nginx: SSE-safe `/api`
      buffering, optional direct static serving, TLS).
- CI green on GitHub Actions (Node 22/24 + Redis); CircleCI was removed —
  GitHub Actions covers lint/typecheck/prettier, the config-parse check and the
  unit tests.
- **Stable releases (2026-06-15)**: zny-nomp v1.4.0, node-stratum-pool v0.4.0,
  node-multi-hashing v1.2.0 — promoted from the `-beta.0` line; the git
  dependencies are pinned to those release commits in `package-lock.json`.
- **Example configs completed**: `coins/coins-examples{,-testnet}/` and
  `pool_configs/examples/` carry full per-coin templates — address/network
  params (`mainnet`/`testnet`), the `getInfo`/`noNetworkInfo`/`noGetnetworkhashps`
  daemon-capability flags, and distinct stratum ports — and are JSON-validated
  in CI (`check:config`).
- **Mining + payout verified**: BitZeny, Koto, Monacoin, Bellcoin,
  Sugarchain, KumaCoin.
- **In progress** (pool_configs enabled but not production-ready):
    - VIPSTARCOIN — PoW now verified end-to-end on **mainnet** with
      ccminer-htmlcoin (sha256d over the 181-byte header; the common vipsminer
      can't mine it). The required Stratum fixes live on node-stratum-pool
      `develop` and the running pool needs a restart to load them; a mainnet
      payout run is still pending.
    - Yenten — the developer-fee coinbase output (gbt-driven, issue #65) is now
      **verified against a live mainnet daemon**. The deployed 6.0.4 enforced the
      10% dev fee in consensus but didn't expose it via `getblocktemplate`, so the
      daemon was rebuilt/swapped to the yenten-6 line (6.0.5), whose gbt returns
      `developer{}`; the pool's coinbase now carries the dev-fee output. A
      matured-block payout run is still pending.
    - Susucoin — the daemon now builds and runs and its pool_config is enabled
      (sha256d); pending an end-to-end payout verification.
- **Recently fixed (Koto)**: blocks that carried shielded mempool transactions
  were being found (valid PoW) but rejected by the daemon with
  `hashMerkleRoot mismatch` — the Stratum library now builds the merkle root
  from each transaction's full-serialization hash instead of `txid` (see the
  [node-stratum-pool ROADMAP](https://github.com/ROZ-MOFUMOFU-ME/node-stratum-pool/blob/main/ROADMAP.md)).
  Separately, orphaned-round share merging in `paymentProcessor` now uses
  `hincrbyfloat`, so fractional shares are preserved instead of erroring.
- **Recently fixed (block accounting / PPLNT)**: now that blocks are actually
  accepted, the block-found Redis MULTI surfaced two issues. The
  `shares:timesCurrent` → `times<height>` rename is now skipped when the key is
  absent (it previously failed that one command and logged a spurious
  "1 commands failed"; the block itself was always recorded). And the master's
  PPLNT per-worker time tracking — dead since the node-redis v6 migration
  (`src/init.ts` still used the v3 `multi().exec(cb)` API, a silent no-op, so
  `timesCurrent` was never written) — now uses `execCommands`, so PPLNT time
  data is recorded again.
- **Recently fixed (KumaCoin payouts)**: payouts silently stalled because the
  per-block tx-fee reserve (`coin.txfee`, default `0.0004`) was far below the
  wallet's real `paytxfee` (`0.01`), so each payout drained the wallet slightly
  below what it owed until `paymentProcessor` deferred everything with
  "Insufficient funds … possibly waiting for txs" (blocks pile up `pending`
  with confirmations far past the threshold). Setting a realistic
  `coins/kumacoin.json` `txfee` (`0.03`) clears the backlog and stops the drift;
  modern coins are unaffected (their real fee is well under the default reserve).

## Known issues & limitations

- **Limited test coverage** — `npm test` just boots `src/init.ts`; `npm run test:unit`
  covers only pure logic helpers, with no coverage for the share/payment/stats
  Redis logic.
- **Profit switching** is now driven by the live price feed
  (`src/profitSwitch.ts`, gated off by default), but its coin-switch path has not
  been validated on a running multi-coin pool yet.

> KumaCoin's DNS seeder (bitcoin-seeder `kuma` branch, with the
> `--minversion/--protover/--initversion` options for the old peercoin-style
> wallet) is deployed and serving nodes, so KumaCoin mining is operational.

## Roadmap

### Near-term

- Verify a VIPSTARCOIN mainnet payout — the PoW is resolved; land the
  node-stratum-pool fixes from `develop` and restart the running pool.
- Verify Susucoin end-to-end (mining + payout); the daemon now builds and the
  pool is enabled.
- Complete a Yenten matured-block payout run (the dev-fee coinbase is now
  verified live against the 6.0.5 daemon — see Current state).
- Add a CI step that does more than boot `src/init.ts` (e.g. lint + a headless
  config-parse / Redis round-trip check).

### Mid-term

- Add unit tests for `shareProcessor`, `paymentProcessor` and `stats` against
  a local Redis.
- **Real-time price feeds** _(implemented)_ — a `priceFeed` worker polls
  CoinGecko and CoinPaprika with per-symbol fallback (more providers are
  pluggable via `src/priceProviders.ts`) and stores prices in Redis under
  `priceFeed:prices`, served by the JSON API at `/api/prices`, shown as a
  live ticker on the stats page, and consumed by profit switching
  (`profitSwitch.ts`). Remaining: record the coin price at payout time.

### Long-term

- **Consolidate the three repos into a single monorepo** — the portal, the
  Stratum library and the hashing addon are developed as one unit, so a
  monorepo (e.g. npm workspaces) would remove the cross-repo git-dependency
  pinning, the `npm link` chain, the per-repo CI duplication, and the
  three-way release dance. This is the intended end state of the stack.
- **Modern web UI** _(implemented)_ — a Vite + React + TypeScript SPA in `web/`
  consuming the existing JSON API (`src/api.ts`).
- **Metrics endpoint (Prometheus)** _(implemented)_ — pool/worker/algo
  hashrate, shares, blocks, network stats and live prices are exposed in the
  exposition format at `/api/metrics` (`src/metrics.ts`).
- **Tagged-release workflow** _(implemented)_ — pushing a `vX.Y.Z` tag runs
  `.github/workflows/release.yml`, which checks the tag matches `package.json`
  and publishes a GitHub Release with auto-generated notes (a hyphenated semver
  such as `-beta.0` is marked pre-release). Lets consumers pin the git deps by
  tag instead of tracking `#main` (an interim step until the monorepo lands).
- High availability and scale: run multiple portal instances, evaluate Redis
  Cluster/replicas, and harden share/payment processing under load.
- More coins and algorithms as node-stratum-pool / node-multi-hashing gain
  them (e.g. Ethash family, RandomX, Equihash); optional merged mining
  (AuxPoW).

## Architecture & robustness

Beyond individual features, a deeper modernization of the application
_structure_ itself — to make it more robust and easier to work with. The
portal still follows the original NOMP shape (a `cluster` master forking
workers that talk over IPC, modules issuing raw Redis commands). The frontend
is now a React/Vite SPA and the codebase is TypeScript, but the layering and
test-coverage items below remain. Several Focus-area items below are facets of
this.

### Type safety & layering

- ~~Migrate the portal and the sibling libraries to **TypeScript**~~ _(done —
  portal + node-stratum-pool are TypeScript; node-multi-hashing's native binding
  stays JS)._
- Introduce clear layers: a **data-access layer** that abstracts Redis behind
  a repository/typed API instead of scattering raw commands across
  `shareProcessor` / `paymentProcessor` / `stats`; a **service layer** for the
  share/payment/stats domain logic; and a thin web/API layer on top.
- Use dependency injection so each component is unit-testable in isolation.

### Configuration & process model

- **Schema-validated configuration** (e.g. zod) with helpful errors,
  12-factor environment overrides, and hot reload — replacing the
  hand-parsed JSON config.
- Revisit the `cluster` + IPC model with well-defined service boundaries
  (pool engine, payments, stats, web) that can run in one process or be split
  out and scaled independently.

### Robustness

- Process-wide **error boundaries** and graceful shutdown; a supervised
  worker-restart strategy driven by health checks.
- **Idempotent, transactional payment processing** so a retry can never
  double-pay (today a Redis error mid-payout disables processing entirely).
- **Structured logging** (e.g. pino) with correlation IDs, replacing the
  bespoke `logUtil` logger.
- A **test pyramid** wired into CI: unit (share/payment/stats), integration
  (mock daemon + Redis), and end-to-end (regtest).

### Developer & operator experience

- A **one-command dev environment** (docker-compose / devcontainer).
- **Architecture docs and ADRs**, plus a setup wizard / CLI that scaffolds and
  validates first-time configuration.

## Focus areas

Cross-cutting improvement themes that span the near/mid/long-term items above.
Monorepo consolidation is deferred; these are the active priorities.

### Modernization

- ~~Replace the `dot`-template frontend with a modern SPA built on the existing
  JSON API~~ _(done — `web/` is a Vite + React + TypeScript SPA consuming
  `src/api.ts` / `src/workerapi.ts` and the new `/api/config`)._
- ~~Evaluate TypeScript for the portal and the sibling libraries~~ _(done —
  migrated; see "Type safety & layering")._
- Keep the toolchain current (ESLint/Prettier, Node LTS, routine dependency
  bumps).
- **i18n** — the SPA now ships 20-language i18n via react-i18next (ported from
  the old `translations.json`); keep string coverage complete as the UI grows
  and make adding new locales straightforward.
- ~~Operator **branding & home customization**~~ _(done — `website.branding`
  in `config.json`, served via `/api/config`, drives the site name, separate
  header/hero logos, favicon, dropdown-capable nav links, hero copy and
  "No KYC"-style highlight badges, operator HTML sections, mining-server
  location cards with in-browser ping, and GA4 / custom analytics tags — no
  code changes needed to rebrand)._
- **Mobile-friendly, responsive UI** plus a Progressive Web App (installable,
  offline stats view, optional push notifications) and a dark mode.
- Documented public API (OpenAPI/Swagger) and optional WebSocket push for
  live stats instead of polling.
- Accessibility (a11y) pass on the UI.
- **Web3 wallet (MetaMask) connect** — wallet-signature login (passwordless)
  and EVM payout-address management, pairing with the planned Ethash-family
  support.

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
  alerts via email / Discord / generic webhook / browser (Web Push, tying
  into the PWA).

### Containerization

- A `Dockerfile` for the portal (multi-stage; compiles the native addon with
  GCC 10+).
- A `docker-compose` stack wiring the portal, Redis, and coin daemons for
  reproducible local and dev deployments.
- Kubernetes manifests / a Helm chart for production.

### Miner experience

- ~~Additional reward schemes (PPS, solo)~~ _(done — `solo`, `pps` and `dpps`
  (dynamic PPS) are implemented on top of PROP/PPLNT, selected per pool via
  `paymentMode`; see `docs/payment-schemes.md`)._ PPLNS is still open.
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
- **NiceHash integration** — use the NiceHash API for per-algorithm prices and
  the order book (another input to profit switching and the profitability
  view), and optionally place / track hashpower-rental orders. Pairs with the
  NiceHash-compatible stratum support tracked in node-stratum-pool.
- **Yiimp-style auto-exchange payouts** — adopt the strengths of Yiimp-style
  pools: let miners mine any coin and get paid in a coin of their choice (or
  BTC) via exchange integration, backed by multi-algo / multi-coin profit
  optimization and per-algorithm dashboards.

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

### Mining clients & onboarding

- **Browser mining** — an opt-in, WebAssembly-based in-browser miner: Web
  Workers hashing through a WASM build of node-multi-hashing, connected via a
  WebSocket→stratum bridge (tracked in node-stratum-pool). Zero-install and
  low-barrier for newcomers; explicitly consent-gated and rate-limited to
  avoid the cryptojacking stigma.
- **Per-coin mining apps** — ready-to-run miners preconfigured for each coin
  (pool URL baked in, the miner just enters their address; the right algorithm
  binary bundled), packaged as a one-click desktop (Electron) or mobile app,
  with auto-update.
