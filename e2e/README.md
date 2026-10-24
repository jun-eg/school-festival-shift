# e2e — 実機の殻の関数を、Claude が無人で回す

**E2E は任意である。** 手元の検査（`npm test`）と CI だけで回り、**担当者にも次の開発者にも GCP プロジェクトを要求しない**。
**CI では回さない**（秘密情報と実ファイルの作成を伴う。載せるかは後で判断し、判断したらこの節に書く）。`npm test` にも混ぜない。

```
npm run e2e
```

## 何が起きるか

1. `.env` を読み、スプレッドシートの題名が `sfs-e2e` で始まることを確かめる（違えば何も書かずに止まる）
2. `.e2e/dist/` に `npm run build` と同じ 4 つを出し、`.env` のスクリプト ID へ `clasp push` する。**push 先はそのスクリプトだけで、`.clasp.json` は読まない**。テンプレート（本番）には届かない
3. スプレッドシートを Sheets API で**シート 1 枚の空に戻す**（実行の頭。前の実行の残骸は効かない）
4. Apps Script Execution API（`scripts.run`、devMode）で `buildTemplate` を呼ぶ。**メニューの関数は呼ばない**（`getUi()` と toast で落ちる）
5. 返り値と、Sheets API で読んだ構造（8 枚・保護・入力欄・幅・固定）を、[`src/core/sheet-layout.ts`](../src/core/sheet-layout.ts) の構成と `node:test` で突き合わせる。**手元の [`build-template.test.ts`](../src/shell/build-template.test.ts) の①②③⑥と同じ見方**である。2 回目の呼び出しで形が変わらないことも見る

**配布物のマニフェストは変えない。** 検証した範囲では、`executionApi` を足さなくても devMode の呼び出しは通る（初回の呼び出しだけ `reading from storage … NOT_FOUND` が返ることがあり、1 回の再試行で通る）。

## 硬さ

| | |
| --- | --- |
| 同時実行 1 本 | `.e2e/lock`（pid を持つ。生きていれば待たずに止まる。死んでいれば奪う） |
| 日次クォータ | `scripts.run` は 1 日 100 回まで、再試行を含む（`.e2e/quota.json`、[`gas.mjs`](gas.mjs)）。Apps Script の日次の上限よりずっと下 |
| タイムアウトと再試行 | 関数 1 回は 180 秒で切る。通信の失敗・5xx・429・上記の一時的な失敗は 1 回だけ再試行。スクリプト自身の例外は再試行しない。`clasp push` も 1 回だけやり直す |
| 秘密が commit に混ざらない | ファイルは [`.gitignore`](../.gitignore) が名指し（`.env` ・ `.clasprc.json` ・ `creds.json` ・ `.e2e/`）。内容は [`.githooks/pre-commit`](../.githooks/pre-commit) の [`秘密の検査.mjs`](../scripts/秘密の検査.mjs) が止める |
| 入れるデータ | `buildTemplate` が置く見出しと初期値だけ。氏名・学籍番号は 1 行も入らない |

## 用意するもの（人が 1 回）

1. **検証専用の GCP プロジェクト**を作り、Apps Script API ・ Sheets API ・ Drive API を有効にし、OAuth 同意画面（外部・テスト、テストユーザーは自分）とデスクトップの OAuth クライアントを用意する。JSON は**リポジトリの外**に置く
2. **検証用スプレッドシートを 1 つ**作る（題名は `sfs-e2e` で始める）。拡張機能 → Apps Script を開き、**プロジェクトの設定 → Google Cloud Platform プロジェクトを、上の GCP プロジェクトの番号に変更する**（結び付けはエディタでしかできない）
3. `npx clasp login --creds <JSON のパス> --use-project-scopes --include-clasp-scopes --extra-scopes https://www.googleapis.com/auth/spreadsheets` を通す（ブラウザで承認。トークンは `~/.clasprc.json`）
4. [`.env.example`](../.env.example) を `.env` にコピーして、スプレッドシート ID ・スクリプト ID ・ GCP プロジェクトを埋める

**トークン（`~/.clasprc.json`）・ OAuth クライアントの JSON ・ `.env` は、表示・コピー・commit をしない。**

## 無人で進めなくなるのは

- clasp のトークンが失効した（テスト公開の OAuth 同意画面は、リフレッシュトークンが 7 日で切れる）→ 人が 3 をやり直す
- スクリプトの GCP プロジェクトの結び付けが外れた → 人が 2 をやり直す
