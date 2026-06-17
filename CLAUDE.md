# CLAUDE.md

このファイルは、このリポジトリで作業する Claude Code (claude.ai/code) 向けのガイドです。

## マルチリポジトリ開発

このポータルは、一体で開発される3リポジトリ構成の最上位です。**開発は `develop` ブランチで行い、`main` はリリース／プレリリース用です**（2026-06-13 に旧 dev/dev2/stable/old を main へ統合・整理し、その後 `develop` を切って開発を再開しました。区切りごとに develop → main をマージしてタグ（例 `v1.4.0-beta.0`）を切ります。本リポジトリと node-multi-hashing の main は直接 push 可、node-stratum-pool の main は保護ブランチなので develop → main は PR 経由）。兄弟リポジトリは隣のディレクトリにローカルクローンがある前提です:

```
zny-nomp (このリポジトリ — ポータル本体, ESM/TypeScript)
  └─ stratum-pool      = git: ROZ-MOFUMOFU-ME/node-stratum-pool#main   → ローカルクローン: ../node-stratum-pool (ESM/TypeScript)
       └─ multi-hashing = git: ROZ-MOFUMOFU-ME/node-multi-hashing#main → ローカルクローン: ../node-multi-hashing (ネイティブアドオン, JS のまま)
```

各兄弟リポジトリにもそれぞれ CLAUDE.md があります。重要なポイント:

- 依存関係は**ローカルパスではなく GitHub の `#main` ブランチに固定**されています。素の `npm install` は GitHub からクローンするため、`../node-stratum-pool` や `../node-multi-hashing` での編集は、`main` に push して再インストール（`npm update stratum-pool`）するまで反映されません。`package-lock.json` は各 git 依存の特定コミットを固定します。
- ローカルでのクロスリポジトリ開発では、代わりにローカルクローンをリンクします（これが標準のセットアップです）:

```bash
cd ../node-multi-hashing && npm link              # ネイティブアドオンをビルド
cd ../node-stratum-pool  && npm link multi-hashing && npm link
cd ../zny-nomp           && npm link stratum-pool
```

`stratum-pool` をリンクすると、`multi-hashing` は `../node-stratum-pool/node_modules` 経由でローカルクローンに解決されます — 本リポジトリの `node_modules` 内の GitHub コピーは使われません。解除は `npm unlink stratum-pool && npm install`。

- `npm install` が git 版 multi-hashing のコンパイルで失敗する場合（例: GitHub の `main` がまだ対応していない Node バージョン）は、`npm install --ignore-scripts` を使い、リンクチェーンに任せてください — 他の依存はすべて純粋な JS です。
- **起動は `tsx` ローダー経由**（`npm start` = `node --import tsx src/init.ts`、`tsx` は dependencies に含む）。stratum-pool／multi-hashing は `node_modules` 配下に **TypeScript（`.ts`）** として入るが、Node 組み込みの型除去は **node_modules 配下の `.ts` を拒否**する（`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`）。tsx が実行時に変換するため、プレーンな `npm install`／`npm ci` だけで（VPS・Docker でも）そのまま起動でき、**`npm link` は起動には不要**（リンクは兄弟リポジトリのライブ編集用の任意手段として残る）。`init.ts` は `cluster.fork()` で全ワーカーを生成し `execArgv` を継承するので `--import tsx` は全ワーカーへ伝播する。zny-nomp 自身の `src/*.ts`（node_modules 外）は元々ネイティブ型除去でも動くが、起動経路を tsx に統一している。`scripts/cli.ts`（blocknotify）は stratum-pool を import しないので素の `node scripts/cli.ts` のままで可。なお `package-lock.json` が古い stratum-pool コミット（旧 `lib/` レイアウト）を指していると tsx 通過後に `Cannot find module .../stratum-pool/src/util.ts` になるため、`npm update stratum-pool` でロックを現行 `#develop`（`src/` レイアウト）へ進める。
- リリースフロー: `node-multi-hashing` の main を更新 → `node-stratum-pool` の main を更新（PR）→ ここで `npm update stratum-pool multi-hashing` を実行してロックされたコミットを進めます。タグ（`v*`、例 `v1.4.0-beta.0`）を push すると `.github/workflows/release.yml` が package.json のバージョンとの一致を検証したうえで GitHub Release を自動作成します（ハイフン付き semver はプレリリース扱い、リリースノートは自動生成）。タグは CI 通過済みの main コミットから切ってください（ビルド／Lint ワークフローはタグ push では走りません）。
- **リンクは npm install で消える**: このリポジトリで何かしら `npm install` / `npm update` を実行すると、`node_modules/stratum-pool` のシンボリックリンクが GitHub クローンに置き換えられます。インストール後は必ず `npm link stratum-pool` を再実行してください（リンクされているかは `ls -la node_modules/stratum-pool` で確認できます）。ローカル修正をテストしたのに反映されていない場合は、まずこれを疑ってください。
- **3リポジトリの TypeScript 状況**: zny-nomp と node-stratum-pool はともに TypeScript（ビルドレスの型除去）に移行済みです。一方 node-multi-hashing は NAN ネイティブアドオンのため `index.js`（と `tests/*.js`）を**意図的に JS のまま**残しています — エントリを `.ts` にすると Node の ESM→CJS 変換を経由した `bindings` リゾルバが `multihashing.node` を解決できず "Could not locate the bindings file" で失敗するためです。
- **ネイティブアドオンの注意点**: multi-hashing は Node の ABI ごとにコンパイルされる NAN アドオンです。Node のバージョンを切り替えると、起動時に `Error: Module did not self-register: .../multihashing.node` で失敗します — 再ビルドしてください（`../node-multi-hashing` で `npm run build`、または `npm rebuild multi-hashing`）。さらに Node 24 では multi-hashing を `-std=c++20` でビルドする必要があります（`binding.gyp` で設定済み）。
- Node 24 での動作確認済み（起動・プール spawn・Website・Redis）。
- **Node の最低要件**: 依存 `@exodus/bitcoinjs-lib-zcash`（node-stratum-pool 経由、koto/zcash アドレス処理）が ESM の `@exodus/crypto` を `require()` で読み込むため、`require(ESM)` 対応の Node が必須です（`^20.19 || >=22.12`、推奨 24）。Node 20.0–20.18・22.0–22.11 は起動時に `ERR_REQUIRE_ESM` で失敗します（暫定回避は起動フラグ `--experimental-require-module`）。`package.json` の `engines` にも反映済み。

## コマンド

```bash
npm install        # GitHub から git 依存もクローンされる（上記 --ignore-scripts の注意を参照）
npm start          # = node --import tsx src/init.ts（tsx ローダー経由・下記。Redis とコインデーモンの起動が必要）
npm run lint       # eslint src/init.ts（typescript-eslint）
npm run lint:fix
npm run format     # prettier --write .
npm run format:check
npm run test:unit  # node:test のユニットテスト（test/*.test.ts・*.test.mjs）。ネイティブアドオン不要の純粋ロジックのみ
npm run typecheck  # tsc --noEmit（型チェックのみ。実行は tsx ローダーで .ts を直接ロード＝ビルド工程なし）
npm run check:config  # config_example.json / config.json / coins/*・coins/coins-examples{,-testnet}/*・pool_configs/*・pool_configs/examples/* を JSON として検証（CI 用）
node scripts/cli.ts <command>   # 稼働中のポータルに CLI ポート経由でコマンド送信（例: blocknotify）
```

`npm test` は `node src/init.ts` を実行するだけの起動スモークで、テストスイートではありません。実体のあるユニットテストは `npm run test:unit`（`test/*.test.ts`・`*.test.mjs`）にあります。`node --test test/`（ディレクトリ指定）はこの Node ではバグるため、glob/ファイル指定を使ってください。

Web フロントエンド（SPA）は `web/`（Vite + React + TypeScript）にあり、独自の `package.json`／`tsconfig`／`vite.config` を持つこのスタック唯一のビルド工程です（バックエンドはビルドレス）。初回は `cd web && npm install --legacy-peer-deps`、開発は `npm run dev`（Vite 開発サーバーが :5173 で起動し `/api` を :8080 のポータルへプロキシ）、本番ビルドは `npm run build`（成果物は `web/dist`、`src/website.ts` が配信）。Dockerfile はイメージビルド時に `web/` をビルドします。

設定: `src/init.ts` は `config.json`（ポータル設定）を読み込み、存在しない場合は `config_example.json` にフォールバックします。プールは `pool_configs/*.json` でファイルごとに有効化し、それぞれ `coins/*.json` のコイン定義を参照します。

コイン定義（`coins/*.json`）はアドレス→スクリプト変換用の `mainnet`／`testnet`（`pubKeyHash`／`scriptHash`／`bech32`／`bip32.public` を **16進文字列**で指定。bech32/P2SH を使うコインは必須。`addressToScript` は network 未指定だと「バージョンバイトを無視した base58 P2PKH」へフォールバックする。koto は `kotoAddressToScript` を使うため network ブロック不要、kumacoin は旧 Peercoin 系で BIP32 が無いため省略）と、デーモン互換フラグ `getInfo`／`noNetworkInfo`／`noGetnetworkhashps` を持ちます。`getnetworkinfo` 非対応で `subversion`（P2P ユーザーエージェント）を返さない旧ウォレット（kumacoin など。`getinfo.version` は `v0.8.9.9-c60962c-dirty` のようなビルド文字列）向けに、任意の `subVersion` テンプレート（例 `"/Antenna:{version}/"`）を指定すると、`paymentProcessor` がそれを `networkSubVersion` として合成し（`{version}` = version から先頭 `v`・末尾 `-<hash>` を除いた値）、stats の Daemon 表示を本来の `/Antenna:0.8.9.9/` 形式に整えます（実 `subversion` を返すコインではそちらが優先）。任意の `miningTools`（`{name, url}` の配列。URL 文字列だけでも可、`http(s)` のみ表示）を置くと `explorer` と同様に `GET /api/config` で公開され、Getting Started ページで該当コインを選択したときに「Mining Software」リンクとして表示されます（マイニングソフトの配布先を複数掲載できる）。各コインの雛形は `coins/coins-examples{,-testnet}/` と `pool_configs/examples/` にあり、CI（check:config）で検証されます。`config.json`／`pool_configs/*.json`／`coins/*.json` は `.gitignore` 済み（実運用設定）で、コミットされるのは例のみです。

## アーキテクチャ

ESM（`"type": "module"`）。**TypeScript への移行は完了**しており、起動は `tsx` ローダー（`node --import tsx`）で `.ts` を**ビルド工程なしのまま**直接ロードし（Node 単体のネイティブ型除去は node_modules 配下の TS 依存〔stratum-pool／multi-hashing〕を読めないため。コマンド節参照。Node 22.18+ は `engines` でも要求）、`npm run typecheck`（`tsc --noEmit`）で型のみ検査します（`tsconfig.json`: strict・nodenext・erasableSyntaxOnly・allowImportingTsExtensions・allowJs）。`src/init.ts`・`scripts/cli.ts`・`src/*.ts` がすべて TypeScript で、import 指定子は実拡張子＝`./foo.ts` のように書きます（唯一 `eslint.config.js` だけは ESLint フラット設定のため JS のまま）。型のないライブラリは `@types/*` の devDependencies と `types/shims.d.ts`（node-json-minify／newrelic／posix・グローバル `JSON.minify`・`@exodus/bitcoinjs-lib-zcash`／`multi-hashing` をアンビエント宣言）で補い、Lint は `typescript-eslint` を使います。`src/init.ts` がクラスタのマスターで、ポータル設定と有効な全プール設定を読み込み、役割ごとにワーカープロセスを fork します:

- **プールワーカー** (`src/poolWorker.ts`) — `clustering.forks` 数だけ fork され、各 fork が有効なプールごとに `stratum-pool` インスタンスを1つ実行します。シェア／ブロックはプールの `share` イベント経由で届き、`src/shareProcessor.ts` が Redis に書き込みます。
- **支払い処理** (`src/paymentProcessor.ts`) — 最大のモジュール。一定間隔で Redis からシェアデータを読み、デーモン RPC でブロックの承認を確認し、支払いを送金します。
- **Website** (`src/website.ts`) — Express 5 サーバー。フロントエンドは `web/` の Vite + React + TypeScript SPA（React Router v7・@tanstack/react-query・recharts・react-i18next による 21 言語 i18n〔旧 translations.json から移植〕）で、ビルド済み成果物を `web/dist` から配信し、クライアントサイドルーティング用に index.html へフォールバックします（旧 `dot` テンプレート＋jQuery/nvd3 と旧 `website/` フォルダ（index.html・pages・static・key.html）は撤去し、フロントエンドは `web/` に一本化。サーバ側 dot レンダリングも廃止）。JSON API は `src/api.ts`（統計系・`/api/admin`〔`pools`、および `announcement`＝ホームのお知らせ設定。`POST /api/admin/:method` は `adminCenter.password` で認証〕に加え `/api/prices`・公開の `/api/announcement`・`/api/metrics`〔Prometheus, `src/metrics.ts`〕・`/api/health`〔`src/health.ts`〕、さらに SPA が消費する公開ランタイム設定〔stratumHost・有効な切替ポート・プールごとの coin/ports/explorer/miningTools、およびオペレーターのブランディング `website.branding`（サイト名・ヘッダー/ヒーロー別ロゴ・favicon・tagline・`children` でドロップダウン化できる navLinks・home〔ヒーロー見出し〔`title` は coin より優先＝マルチコイン用〕／`No KYC` 等の highlights〔未指定はコード側デフォルト〕／任意 HTML の sections／拠点カード＋ブラウザ側 ping の servers〕・GA4＋任意 script の analytics）〕を返す `GET /api/config`）と `src/workerapi.ts`、Redis からの統計集計は `src/stats.ts`（最新価格を `stats.prices` に付与）。お知らせは Redis キー `announcement` に保存。
- **価格フィード** (`src/priceFeed.ts`) — CoinGecko / CoinPaprika から定期的に価格を取得し（`src/priceProviders.ts` のプラガブルなプロバイダ群＋シンボル単位フォールバック）、Redis の `priceFeed:prices` に格納します。Node のグローバル `fetch` を使用（新規依存なし）。デフォルト無効（`priceFeed.enabled`）。
- **プロフィットスイッチャー** (`src/profitSwitch.ts`) — 同一アルゴリズムのコイン間でハッシュパワーを切り替えます。価格は Redis の `priceFeed:prices` から読み、`reward × price / difficulty` で最良コインを選び、CLI の `coinswitch` 経路（`scripts/cli.ts` と同形式）で切り替えます。純粋な選定ロジックは `src/profitSwitchLogic.ts` に分離（テスト可能）。デフォルト無効・価格フィード前提。
- **CLI リスナー** (`src/cliListener.ts`) — `scripts/cli.ts` からのコマンドを受け付ける TCP ポート（例: デーモンの `blocknotify` フックからのブロック通知）。

Redis が主要データストアです（シェア・ブロック・残高・統計）。プロセス間通信はすべて `src/init.ts` が処理するクラスタ IPC メッセージ経由です。Redis クライアントは node-redis v6（Promise API）で、接続生成・MULTI 実行の共通処理は `src/redisUtil.ts` に集約されています — 生の `[コマンド, 引数...]` 配列で MULTI を組む場合は `execCommands()` を使い、HGETALL のようにオブジェクト形状の応答が必要な読み取りはクライアントの camelCase メソッド（`hGetAll` など）をチェーンした typed multi を使ってください（raw `addCommand` の HGETALL はフラット配列を返すため）。

このリポジトリはパッケージルートに加えて `stratum-pool/src/algoProperties.ts` と `stratum-pool/src/util.ts` をディープインポートしています。プール設定の `coin` ファイルで指定する `algorithm` は algoProperties に存在する必要があります — 新アルゴリズムの追加は node-multi-hashing（実装）と node-stratum-pool（登録）の作業であり、このリポジトリでは行いません。

`dist/`・`.next/`・`tsconfig.tsbuildinfo` は追跡されていないビルドの残骸で、アプリの一部ではありません。

## 注意

これは本番運用されるプールソフトウェア（"beta"）です: 設定ファイルの構造と Redis のデータレイアウトはコミット間で不安定とみなされており、タグ付きリリースのみが安定版扱いです。設定スキーマや Redis のキー形式の変更には慎重になってください。
