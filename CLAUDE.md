# CLAUDE.md

このファイルは、このリポジトリで作業する Claude Code (claude.ai/code) 向けのガイドです。

## マルチリポジトリ開発

このポータルは、一体で開発される3リポジトリ構成の最上位です。**開発は `develop` ブランチで行い、`main` はリリース／プレリリース用です**（2026-06-13 に旧 dev/dev2/stable/old を main へ統合・整理し、その後 `develop` を切って開発を再開しました。区切りごとに develop → main をマージしてタグ（例 `v1.4.0-beta.0`）を切ります。本リポジトリと node-multi-hashing の main は直接 push 可、node-stratum-pool の main は保護ブランチなので develop → main は PR 経由）。兄弟リポジトリは隣のディレクトリにローカルクローンがある前提です:

```
zny-nomp (このリポジトリ — ポータル本体, ESM)
  └─ stratum-pool      = git: ROZ-MOFUMOFU-ME/node-stratum-pool#main   → ローカルクローン: ../node-stratum-pool (ESM)
       └─ multi-hashing = git: ROZ-MOFUMOFU-ME/node-multi-hashing#main → ローカルクローン: ../node-multi-hashing (ネイティブアドオン)
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
- リリースフロー: `node-multi-hashing` の main を更新 → `node-stratum-pool` の main を更新（PR）→ ここで `npm update stratum-pool multi-hashing` を実行してロックされたコミットを進めます。
- **リンクは npm install で消える**: このリポジトリで何かしら `npm install` / `npm update` を実行すると、`node_modules/stratum-pool` のシンボリックリンクが GitHub クローンに置き換えられます。インストール後は必ず `npm link stratum-pool` を再実行してください（リンクされているかは `ls -la node_modules/stratum-pool` で確認できます）。ローカル修正をテストしたのに反映されていない場合は、まずこれを疑ってください。
- **ネイティブアドオンの注意点**: multi-hashing は Node の ABI ごとにコンパイルされる NAN アドオンです。Node のバージョンを切り替えると、起動時に `Error: Module did not self-register: .../multihashing.node` で失敗します — 再ビルドしてください（`../node-multi-hashing` で `npm run build`、または `npm rebuild multi-hashing`）。さらに Node 24 では multi-hashing を `-std=c++20` でビルドする必要があります（`binding.gyp` で設定済み）。
- Node 24 での動作確認済み（起動・プール spawn・Website・Redis）。

## コマンド

```bash
npm install        # GitHub から git 依存もクローンされる（上記 --ignore-scripts の注意を参照）
npm start          # = node init.js（Redis とコインデーモンの起動が必要）
npm run lint       # eslint init.js
npm run lint:fix
npm run format     # prettier --write .
npm run format:check
node scripts/cli.js <command>   # 稼働中のポータルに CLI ポート経由でコマンド送信（例: blocknotify）
```

`npm test` は `node init.js` を実行するだけで、実体のあるテストスイートはありません。

設定: `init.js` は `config.json`（ポータル設定）を読み込み、存在しない場合は `config_example.json` にフォールバックします。プールは `pool_configs/*.json` でファイルごとに有効化し、それぞれ `coins/*.json` のコイン定義を参照します。

## アーキテクチャ

純粋な ESM（`"type": "module"`）でビルド工程はありません。`init.js` がクラスタのマスターで、ポータル設定と有効な全プール設定を読み込み、役割ごとにワーカープロセスを fork します:

- **プールワーカー** (`libs/poolWorker.js`) — `clustering.forks` 数だけ fork され、各 fork が有効なプールごとに `stratum-pool` インスタンスを1つ実行します。シェア／ブロックはプールの `share` イベント経由で届き、`libs/shareProcessor.js` が Redis に書き込みます。プール設定で MPOS モードを有効にした場合は `libs/mposCompatibility.js` 経由で MySQL に書き込みます。
- **支払い処理** (`libs/paymentProcessor.js`) — 最大のモジュール。一定間隔で Redis からシェアデータを読み、デーモン RPC でブロックの承認を確認し、支払いを送金します。
- **Website** (`libs/website.js`) — `website/` の `dot` テンプレートをレンダリングする Express 5 サーバー。JSON API は `libs/api.js` と `libs/workerapi.js`、Redis からの統計集計は `libs/stats.js`。
- **プロフィットスイッチャー** (`libs/profitSwitch.js`) — 同一アルゴリズムのコイン間でハッシュパワーを切り替えます（`stratum-pool` のユーティリティを使用。旧 CommonJS 版にあった取引所価格 API モジュール群は ESM 化の際に削除済み）。
- **CLI リスナー** (`libs/cliListener.js`) — `scripts/cli.js` からのコマンドを受け付ける TCP ポート（例: デーモンの `blocknotify` フックからのブロック通知）。

Redis が主要データストアです（シェア・ブロック・残高・統計）。プロセス間通信はすべて `init.js` が処理するクラスタ IPC メッセージ経由です。Redis クライアントは node-redis v6（Promise API）で、接続生成・MULTI 実行の共通処理は `libs/redisUtil.js` に集約されています — 生の `[コマンド, 引数...]` 配列で MULTI を組む場合は `execCommands()` を使い、HGETALL のようにオブジェクト形状の応答が必要な読み取りはクライアントの camelCase メソッド（`hGetAll` など）をチェーンした typed multi を使ってください（raw `addCommand` の HGETALL はフラット配列を返すため）。

このリポジトリはパッケージルートに加えて `stratum-pool/lib/algoProperties.js` と `stratum-pool/lib/util.js` をディープインポートしています。プール設定の `coin` ファイルで指定する `algorithm` は algoProperties に存在する必要があります — 新アルゴリズムの追加は node-multi-hashing（実装）と node-stratum-pool（登録）の作業であり、このリポジトリでは行いません。

`dist/`・`.next/`・`tsconfig.tsbuildinfo` は追跡されていないビルドの残骸で、アプリの一部ではありません。

## 注意

これは本番運用されるプールソフトウェア（"beta"）です: 設定ファイルの構造と Redis のデータレイアウトはコミット間で不安定とみなされており、タグ付きリリースのみが安定版扱いです。設定スキーマや Redis のキー形式の変更には慎重になってください。
