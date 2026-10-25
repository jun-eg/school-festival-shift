# 開発基盤（AI エージェント向け）

**作るものを決めるところから、issue を実装して PR にするところまでを Claude Code と進めるための土台です。**
プロジェクト固有のコードは入っていません。新しいプロジェクトはこのブランチから始めます。

## 何が入っているか

| 置き場 | 何を持つか |
| --- | --- |
| [`CLAUDE.md`](CLAUDE.md) | **作業を始める前にしか踏めない手**（`main` を最新にする → worktree を切る） |
| [`.claude/settings.json`](.claude/settings.json) ／ [`.claude/hooks/`](.claude/hooks/) | **事故を実行前に止める柵**（force-push・push 済みの rebase・amend・`reset --hard`・`main` への push と merge など）。経緯は [`.claude/README.md`](.claude/README.md) |
| [`.claude/skills/`](.claude/skills/) | **要件定義の工程と、issue から PR までを回す skill** — 下の「工程」 |
| [`.claude/agents/`](.claude/agents/) | skill から呼ばれる **subagent**（issue の点検・実装・PR 本文・PR レビュー） |
| [`docs/agent/`](docs/agent/) | 各工程の**雛形**（`*-template.md` ／ `journey/_template.md`）と、**判定が動いた記録（ADR）の規約** — [`docs/agent/ADR/README.md`](docs/agent/ADR/README.md)。AI が読み書きする原本の置き場 |
| [`docs/`](docs/) 直下 | 原本から Claude が書く**人が読む要約**。要約・issue・PR 本文の書き方 — [`docs/README.md`](docs/README.md) |
| [`.githooks/`](.githooks/) ／ [`.github/workflows/`](.github/workflows/) ／ [`scripts/`](scripts/) | **commit の前と PR で回る検査**（秘密の混ざり・相対リンクの実在・要約の古さ）— [`scripts/README.md`](scripts/README.md)。**push の前には検査を消す・緩める差分を subagent が読む**（`.githooks/pre-push`） |
| [`.editorconfig`](.editorconfig) ／ [`.node-version`](.node-version) ／ [`.github/dependabot.yml`](.github/dependabot.yml) | 改行・字下げ・Node の版を揃え、Actions の更新を月 1 で PR にする — [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| [`.github/`](.github/) の雛形 | issue と PR を書く瞬間に目に入る約束 |

## 工程

| # | skill | 出力 |
| --- | --- | --- |
| 1 | `/user-journey-map` | `docs/agent/journey/<立場>.md` — ペルソナと改善機会 |
| ― | `/interview-questions` | `docs/agent/interviews/<連番>-<立場>.md` — 聞きに行く前の質問と、聞いた逐語 |
| 2 | `/hmw` | `docs/agent/hmw.md` — 採用するソリューションと、採らなかった候補 |
| 3 | `/design-doc` | `docs/agent/design-doc.md` — 作るものの確定 |
| 4 | `/tech-requirements` | `docs/agent/tech-requirements.md` — 何で・どう作るか、完了の判定方法 |
| ― | `/issue-check` | 起票した issue の解決策が目的に合っているかの判定（直しが要れば本文を直す） |
| ― | `/implement` | issue 1 本（親なら sub-issue を順に）を実装して PR にする。`main` への merge は人がする |

**何をどこに置くかの総目録は [`docs/agent/ADR/README.md`](docs/agent/ADR/README.md) の「器の一覧」にあります。**

## 始めるとき

[`CONTRIBUTING.md`](CONTRIBUTING.md) の手順で、commit の前に回る検査を 1 回だけ有効にします。

## 確かめ方

```
python3 .claude/hooks/guard-bash.test.py
node --test "scripts/**/*.test.mjs"
node scripts/リンクの検査.mjs
node scripts/要約の検査.mjs
```
