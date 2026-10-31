---
name: flow
description: 段取りの入口。`/flow implement <issue 番号か URL>`（GitHub issue 1 本、親なら sub-issue を順に実装して PR にする。「/実装」「この issue を実装して」「親 issue の sub-issue を順に実装して」と言われたときも）、`/flow issue-create <依頼の文>`（依頼から issue を起こす。「この依頼を issue にして」「issue を起こして」と言われたときも）と明示されたときに使う。引数の 1 語目で開くファイルを選び、そのファイルの手順に従う。
---

# flow

> 段取りの索引。引数の 1 語目で、開くファイルを選ぶ。

## 引数の 1 語目 → 開くファイル

| 1 語目 | 開くファイル | 何をする段取りか |
| --- | --- | --- |
| `implement` | [`implement.md`](implement.md) | issue 1 本（親なら sub-issue を順に）を実装して PR にする。状態は [`state.sh`](state.sh) で取る |
| `issue-create` | [`issue-create.md`](issue-create.md) | 依頼を、1 本 = PR 1 本の大きさで issue にする |

1 語目がこの表に無ければ、開かずに、この表を人に見せて聞き返す。選んだファイルだけを開く。ほかの段取りは読まない。
2 語目以降（issue 番号・URL・依頼の文）は、開いたファイルの「入力」にそのまま渡す。

## 全段取りに共通の守ること

- 複合コマンドを打たない（`for`・変数・`xargs`・heredoc と、版管理のコマンドを混ぜると worktree の柵が止める）。1 コマンドずつ
- `gh pr edit`／`gh issue edit`／`gh pr comment` は projectCards のエラーで落ちるので使わない。本文の編集とコメントは `gh api`（REST）で、ファイルは `-F body=@path`（`-f body=@path` は使わない）
- 物差しと本文の規約は原本（[`docs/README.md`](../../../docs/README.md)・[`.claude/README.md`](../../README.md)）を開いて従う。ここに写さない
