# e2e — 実機の殻の関数を、Claude が無人で回す

**E2E は任意である。** 手元の検査（`npm test`）と CI だけで回り、**担当者にも次の開発者にも GCP プロジェクトを要求しない**。
**CI では回さない**（秘密情報と実ファイルの作成を伴う。載せるかは後で判断し、判断したらこの節に書く）。`npm test` にも混ぜない。

```
npm run e2e
```

## 何が起きるか

1. `.env` を読み（環境変数では上書きできない）、スプレッドシートの題名が `sfs-e2e` で始まることを確かめる（違えば何も書かずに止まる）
2. `.e2e/dist/` に `npm run build` と同じ 4 つを出し、`.env` のスクリプト ID へ `clasp push` する。**push 先はそのスクリプトだけで、`.clasp.json` は読まない**。push の前に Script API で、そのスクリプトの親（`parentId`）が `.env` のスプレッドシートと同じか確かめる。違えば何も push せずに止まるので、テンプレート（本番）のスクリプト ID を書き間違えても届かない
3. スプレッドシートを Sheets API で**シート 1 枚の空に戻す**（実行の頭。前の実行の残骸は効かない）
4. Apps Script Execution API（`scripts.run`、devMode）で `buildTemplate` を呼ぶ。**メニューの関数は呼ばない**（`getUi()` と toast で落ちる）
5. 返り値と、Sheets API で読んだ構造（8 枚・保護・入力欄・幅・固定）を、[`src/core/sheet-layout.ts`](../src/core/sheet-layout.ts) の構成と `node:test` で突き合わせる。**手元の [`build-template.test.ts`](../src/shell/build-template.test.ts) の①②③⑥と同じ見方**である（①②③と⑥の幅。太い線は見ていない）。2 回目の呼び出しで形が変わらないことも見る

## 1 本の流れ（[`pipeline.e2e.mjs`](pipeline.e2e.mjs)）

上の `buildTemplate` の検査（[`build-template.e2e.mjs`](build-template.e2e.mjs)）の後に、**もう 1 回空に戻して**、次の順に 1 本で回す。**見るのは「手元の検査と同じ入力で、同じ結果になるか」だけ**である。

| 順 | 実機で呼ぶもの | 突き合わせる相手（手元の検査） |
| --- | --- | --- |
| 1 | `buildTemplate` | [`build-template.test.ts`](../src/shell/build-template.test.ts)（直後の各シートの値を控える） |
| 2 | モック投入（[`data/`](../data/) の希望データのモックを回答シートへ。氏名・学籍番号は作りもの。条件入力は初期値のまま） | — |
| 3 | `e2eCheckStructure`（崩さずに 0 箇所 ／ 列挿し・見出し書き換え・シート消しで名指しして止まる。そのつど元に戻す） | `verify-structure`（[`breakageToText`](../src/shell/verify-structure.ts) が組む行） |
| 4 | `e2eGenerate`（**所要時間を毎回出す**） | 同じモックと条件入力を [`build`](../src/core/core.ts) に通した出力（違反 0・未充足の名指し・割り当て・指標）。マス目・検証結果・指標のシートの中身も |
| 5 | `exportImagesFromDialog` | 同じ出力から組んだマス目を [`distributionImages`](../src/core/distribution-image.ts) に通した値 |
| 6 | `createFormFromPicker`（1 画素の画像。作る前に回答の行は空にする） | [`formItemsFor`](../src/core/form-definition.ts) が組む設問の題と記録 |
| 7 | `e2eClearForNextYear`（回答を入れ直してから。フォームが作った「回答」は表で、SpreadsheetApp は表を外せないので、シートを作り直す → #347） | 1 の直後の各シートの値と、8 枚の並び・保護・幅・固定（「回答」の後ろ 4 列の見出しも空。許す例外は無い） |
| 7b | `createFormFromPicker`（空にしたファイルで、もう一度。来年の担当者がやること） | 6 と同じ設問の題。作り直した「回答」がフォームの作るシートに置き換わる |
| 8 | Node 側が Drive API で、作ったフォームをゴミ箱へ（1 つ目は空にした後に、2 つ目は最後に）（[`drive.mjs`](drive.mjs)） | — |

**実機の生成の所要時間は、実行のたびに出力へ残る**（`生成の所要時間（実機）: スクリプトの中で … 秒`。合格の線は 360 秒）。人が測った 2026-09-22 の値（項目 14）が最後で、以後はこの出力が持つ。

**E2E 用の口**（`e2eGenerate` ・ `e2eCheckStructure` ・ `e2eClearForNextYear`）は [`src/shell/e2e.ts`](../src/shell/e2e.ts) にあり、`getActive` で包んだだけで、規則も文言も足さない。[`entry.ts`](../src/entry.ts) の一覧に載るので `dist/main.gs` に出るが、**メニューにも画面にも出ない**（担当者の操作は 1 つも増えない）。

**フォームを作るのはこの検証用スプレッドシートだけ**で、テンプレートでは押さない（#260）。**作ったフォームは、来年用に空にするで紐付けを外した後に捨てる。**途中で落ちた回の残りは、**次の回の頭**（空に戻す前）に拾って捨てる — 作った直後に `.e2e/leftover-form.json` に控え、条件入力の編集用 URL 欄（C10）も読む。**スクリプトは Drive を掴まない**（[`appsscript.json`](../src/appsscript.json)）。ゴミ箱へ移せるのは Node 側のトークンだけである。**スコープは今の clasp のトークンの `drive.file` で足りた**（実機で見た: スクリプトが作ったフォームは移せ、ユーザーが作った検証用スプレッドシートの属性の書き換えは 403 だった。つまり Drive で触れるのは、この GCP プロジェクトのスクリプトが作ったファイルに限られる）。ファイルの種類がフォームでなければ動かさない。移せなければ（403・404）、人が何をやり直すかを書いて止まる。

**画面でしか分からないもの**（メニュー「シフト」の見た目・ダイアログ 2 枚・初回の権限承認・toast の文言・`onEdit` が本物のセル書き換えで発火すること・保護の「警告のみ」が目にどう出るか）は、ここでは見ない。名指しは [`src/real-device-log.md`](../src/real-device-log.md) が持つ。

**配布物のマニフェストは変えない。** 検証した範囲では、`executionApi` を足さなくても devMode の呼び出しは通る（初回の呼び出しだけ `reading from storage … NOT_FOUND` が返ることがあり、1 回の再試行で通る）。

## 硬さ

| | |
| --- | --- |
| 同時実行 1 本 | `.e2e/lock`（pid を持つ。生きていれば待たずに止まる。死んでいれば奪う） |
| 日次クォータ | `scripts.run` は 1 日 100 回まで、再試行を含む（`.e2e/quota.json`、[`gas.mjs`](gas.mjs)）。Apps Script の日次の上限よりずっと下 |
| タイムアウトと再試行 | 関数 1 回は 180 秒で切る。通信の失敗・5xx・429・上記の一時的な失敗は 1 回だけ再試行。スクリプト自身の例外は再試行しない。`clasp push` も 1 回だけやり直す |
| 秘密が commit に混ざらない | ファイルは [`.gitignore`](../.gitignore) が名指し（`.env` ・ `.clasprc.json` ・ `creds.json` ・ `.e2e/`）。内容は [`.githooks/pre-commit`](../.githooks/pre-commit) の [`秘密の検査.mjs`](../scripts/秘密の検査.mjs) が止める |
| 入れるデータ | `buildTemplate` が置く見出しと初期値と、[`data/`](../data/) のモック（氏名・学籍番号は作りもの）だけ。実データは 1 行も入らない |

## 用意するもの（人が 1 回）

1. **検証専用の GCP プロジェクト**を作り、Apps Script API ・ Sheets API ・ Drive API を有効にし、OAuth 同意画面（外部・テスト、テストユーザーは自分）とデスクトップの OAuth クライアントを用意する。JSON は**リポジトリの外**に置く
2. **検証用スプレッドシートを 1 つ**作る（題名は `sfs-e2e` で始める）。拡張機能 → Apps Script を開き、**プロジェクトの設定 → Google Cloud Platform プロジェクトを、上の GCP プロジェクトの番号に変更する**（結び付けはエディタでしかできない）
3. `npx clasp login --creds <JSON のパス> --use-project-scopes --include-clasp-scopes --extra-scopes https://www.googleapis.com/auth/spreadsheets` を通す（ブラウザで承認。トークンは `~/.clasprc.json`）
4. [`.env.example`](../.env.example) を `.env` にコピーして、スプレッドシート ID ・スクリプト ID ・ GCP プロジェクトを埋める。置き場は **worktree の直下**か、**`~/.config/sfs-e2e/.env`**（worktree をまたいで 1 つで済む。直下に無いときだけ読む）。環境変数では上書きできない

**トークン（`~/.clasprc.json`）・ OAuth クライアントの JSON ・ `.env` は、表示・コピー・commit をしない。**

## 無人で進めなくなるのは

- clasp のトークンが失効した（テスト公開の OAuth 同意画面は、リフレッシュトークンが 7 日で切れる）→ 人が 3 をやり直す
- スクリプトの GCP プロジェクトの結び付けが外れた → 人が 2 をやり直す
