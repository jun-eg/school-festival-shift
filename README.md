# 開発基盤（AI エージェント向け）

**作るものを決めるところから、実装に入るまでを Claude Code と進めるための土台です。**
プロジェクト固有のコードは入っていません。新しいプロジェクトはこのブランチから始めます。

## 何が入っているか

| 置き場 | 何を持つか |
| --- | --- |
| [`CLAUDE.md`](CLAUDE.md) | **作業を始める前にしか踏めない手**（`main` を最新にする → worktree を切る） |
| [`.claude/settings.json`](.claude/settings.json) ／ [`.claude/hooks/`](.claude/hooks/) | **事故を実行前に止める柵**（force-push・push 済みの rebase・amend・`reset --hard` など）。経緯は [`.claude/README.md`](.claude/README.md) |
| [`.claude/skills/`](.claude/skills/) | **要件定義の工程を回す skill** — 下の「工程」 |
| [`docs/`](docs/) | 各工程の**雛形**（`*-template.md` ／ `journey/_template.md`）と、**判定が動いた記録（ADR）の規約** — [`docs/ADR/README.md`](docs/ADR/README.md) |
| [`.github/pull_request_template.md`](.github/pull_request_template.md) | PR を出す瞬間に目に入る約束 |

## 工程

| # | skill | 出力 |
| --- | --- | --- |
| 1 | `/user-journey-map` | `docs/journey/<立場>.md` — ペルソナと改善機会 |
| ― | `/interview-questions` | `docs/interviews/<連番>-<立場>.md` — 聞きに行く前の質問と、聞いた逐語 |
| 2 | `/hmw` | `docs/hmw.md` — 採用するソリューションと、採らなかった候補 |
| 3 | `/design-doc` | `docs/design-doc.md` — 作るものの確定 |
| 4 | `/tech-requirements` | `docs/tech-requirements.md` — 何で・どう作るか、完了の判定方法 |

**何をどこに置くかの総目録は [`docs/ADR/README.md`](docs/ADR/README.md) の「器の一覧」にあります。**

## 確かめ方

```
python3 .claude/hooks/guard-bash.test.py
```
