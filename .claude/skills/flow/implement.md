# implement

> issue 1 本を「実装 → PR → レビュー → 修正 → merge」の形に乗せる。親 issue なら sub-issue ごとにこれを回し、クッション branch に積む。

手を 3 本に分ける。実装するのは `implementer`、PR 本文を書くのは `pr-writer`、差分を見るのは `pr-reviewer`
（[`.claude/agents/`](../../agents/)）。**push・PR 作成・merge・issue の書き換えは、この skill を回している側だけが打つ。** subagent には打たせない。

- **入力**: issue 番号か URL が 1 つ。`/flow implement 320`、`/flow implement https://github.com/<owner>/<repo>/issues/320`
- **出力**: main 向けの PR 1 本（merge は人がやる）と、人への報告

**merge してよいのは main 以外の branch（クッション branch）向けの PR だけ。** main 向けの PR に `gh pr merge` を打つと柵が止める（[`.claude/README.md`](../../README.md)）。

## 手順

### 1. 状態を取り、役割で分ける

```
bash .claude/skills/flow/state.sh <番号か URL>
```

役割（`親` ／ `単独` ／ `sub-issue`）、クッション branch の有無、sub-issue ごとの branch と PR、main 向け PR の有無が JSON で出る。

- `親` → 手順 3
- `単独` → 手順 4
- `sub-issue` を単独で渡された → `単独` と同じに扱う。ただし base は、親のクッション branch が origin にあればそれ、無ければ main。親までは遡らない

**state が CLOSED の issue は実装しない。** 報告に「閉じている」と書いて止まる。

### 2. 共通の 1 本分（issue 1 本を branch 1 本で実装し、PR を 1 本開く）

この手順は 3 と 4 から呼ばれる。引数は issue 番号・branch 名・base branch 名。

**2-1. implementer を回す。** Agent tool で `subagent_type: implementer`。prompt には次を入れる。

- issue 番号と owner/repo。sub-issue なら親の番号
- 作業ディレクトリ（worktree の絶対パス）と、今の branch 名
- scratchpad の絶対パス（commit メッセージとスクリプトの置き場）
- 親の「決めたこと」（下段）と、前の sub-issue の PR 番号と変えたもの（前提になる）
- commit 末尾に付ける `Claude-Session:` の行
- 「push・PR 作成・merge・issue の書き換えを打たないこと」

返答が「終わりの判定を満たせない」なら、**ここで止めて人に返す。** 無理に合わせない。

**2-2. push する。** `git push -u origin <branch>`。1 コマンドで、他の git と繋げない。

**2-3. pr-writer に本文を書かせ、PR を作る。** Agent tool で `subagent_type: pr-writer`。prompt には形（`クッション向け` ／ `main 向け`）、head と base、issue 番号（クッション向けなら sub と親、main 向けなら親と全 sub）、本文を置く絶対パス、作業ディレクトリ、implementer の「走らせた検査」、セッションの URL を入れる。

```
gh pr create --base <base> --head <branch> --title "<implementer の commit 1 行目>" --body-file <絶対パス>
```

「PR コメントに置く分」が返ってきたら、作った PR にコメントする。

```
gh api repos/<owner>/<repo>/issues/<PR 番号>/comments -F body=@<絶対パス>
```

**2-4. レビューと修正を回す。上限 3 周。**

1. Agent tool で `subagent_type: pr-reviewer`。prompt には PR 番号、issue 番号（と親）、周回（`n 周目 / 上限 3`）、2 周目以降は前回の所見と implementer の「直したもの」を入れる
2. 返答をそのまま PR コメントに残す（何を見て merge したかの跡）。先頭に `pr-reviewer n 周目` と書く
3. 判定で分ける

   | 判定 | すること |
   | --- | --- |
   | merge してよい | 2-5 へ |
   | 直しが要る | 同じ implementer に **SendMessage** で「直し方」を渡し、直して commit させる（implementer が居なければ新しく立て、prompt に前回の所見と直し方を入れる）。`git push` して 1 に戻る（周回 +1） |
   | issue から見直し | **止めて人に返す。** PR は開いたまま。食い違いを subagent の文のまま報告に載せる |

   3 周目でも「直しが要る」なら、**merge せず PR を開いたまま人に返す。** 残った所見を報告に載せる。

**2-5. CI を待つ。**

```
gh pr checks <PR 番号> --watch
```

落ちたら **merge せず、PR を開いたまま人に返す**。落ちたジョブ名とログの要点を報告に載せる。

### 3. 親 issue: クッション branch に sub-issue を積む

**3-1. クッション branch を用意する。** `state.sh` の `cushion` が null なら作る。

1. `git switch main` と `git pull`（[`CLAUDE.md`](../../../CLAUDE.md) の 1 手目。1 コマンドずつ）
2. EnterWorktree で `<親番号>-<slug>` を切る。branch は `worktree-<親番号>-<slug>` になる。`git log -1` で分岐元が最新の main か見る
3. 空のまま `git push -u origin worktree-<親番号>-<slug>`。sub-issue の PR の base になる

`cushion` があれば、その worktree に入る（`.claude/worktrees/<名前>` が無ければ `git worktree add .claude/worktrees/<名前> <cushion>` で作ってから EnterWorktree の `path`）。`git pull` で origin に合わせる。

**3-2. sub-issue を 1 本ずつ、親の「やること」に書かれた順に回す。** 同期で。前の merge が次の土台になる。GitHub の並びと親の順が違えば親の順を採り、違いは報告に書く。

sub-issue ごとに `state.sh` の結果で分ける。

| 状態 | すること |
| --- | --- |
| `pr.state == "MERGED"` | 飛ばす。報告に「merge 済み」 |
| `pr.state == "OPEN"` | その branch に `git switch` して `git pull`。PR コメントの `pr-reviewer n 周目` の最大値から周回を続け、直前の所見を前回の所見として pr-reviewer に渡す（手順 2-4 のレビューから）。直しが要るときは implementer を新しく立て、prompt に前回の所見と直し方を入れる。最大値が既に 3 で判定が「直しが要る」なら、周回を進めず人に返す |
| `pr.state == "CLOSED"` | merge せず閉じた PR が最新。merge せず人に返す（閉じた PR がある） |
| sub-issue の `state == "CLOSED"` で PR が MERGED でない | 飛ばして報告に「閉じている」。**この行が他の行より先に当たる**（人が手で閉じた issue は、PR が開いていても触らない） |
| `pr == null`、`branch` あり | その branch に `git switch` して `git pull`。commit が無ければ 2-1 から、あれば 2-2 から |
| 何も無い | `git switch <cushion>`、`git pull`、`git switch -c worktree-<sub番号>-<slug>` → 手順 2 を base = クッションで |

**merge は 1 コマンドで。**

```
gh pr merge <PR 番号> --merge
```

`--delete-branch` を付けない（gh が default branch に切り替えようとして、main を持つ本体の worktree と衝突する）。`--squash`・`--rebase` も使わない。merge したら `git switch <cushion>`、続けて `git pull`（別々の 1 コマンドで）。sub-issue の branch は残してよい。

**3-3. 全部 merge したら main 向けの PR を作る。** pr-writer に `main 向け` で本文を書かせる（親と全 sub-issue の `Closes`、sub-issue ごとに 1 行と PR 番号。`mainPr` があればその PR 番号も渡す）。

```
gh pr create --base main --head <cushion> --title "<親 issue のタイトル>（#<親番号>）" --body-file <絶対パス>
```

`state.sh` の `mainPr` が既にあれば、作らずに本文を書き直す（`gh api -X PATCH repos/<owner>/<repo>/issues/<PR 番号> -F body=@<絶対パス>`）。書き直したら何をどう変えたかをコメントに残す。

**main 向けの PR はレビューに回してよいが、merge は打たない。** 人がレビューし、issue を直し、もう一度 `/flow implement <親>` を打つ。

### 4. 単独 issue: main 向けの PR を 1 本作る

1. `git switch main`、`git pull` → EnterWorktree で `<番号>-<slug>`
2. 手順 2 を base = main で回す（2-5 まで）
3. merge は打たない。PR の URL を人に渡す

### 5. 報告する

sub-issue ごとに 1 行の表（単独なら 1 行）。

```
| issue | branch | PR | レビュー周回 | 結果 |
```

結果は `merge 済み` ／ `今回 merge` ／ `人に返す（理由）` ／ `閉じている`。続けて、「人に返す」の理由を 1〜2 行ずつ。「issue から見直し」が出た sub-issue は、何が食い違っているかを subagent の文のまま載せる。最後に main 向けの PR の URL。

## 守ること

- subagent は 1 本ずつ。並列に回さない。前の sub-issue の merge が次の前提になる
- subagent に push・`gh pr create`・`gh pr merge`・`gh issue edit` を打たせない。打つのはこの skill を回す側
- main 向けの PR を merge しない。クッション向けだけ
- `gh pr merge` は番号を付けて `--merge` で。`--delete-branch` を付けない
- git を含む複合コマンドを打たない（`for`・変数・`xargs`・heredoc と混ぜると worktree の柵が止める）。1 コマンドずつ
- PR 本文の編集とコメントは `gh api`（REST）で、ファイルは `-F body=@path`（`gh pr edit`／`gh pr comment` は projectCards のエラーで落ちる）
- レビューの返答は必ず PR コメントに残す。何を見て merge したかの跡
- 止まる条件（終わりの判定を満たせない／3 周／CI が落ちる／issue から見直し）では merge せず、PR を開いたまま人に返す
- 人がクッション PR に付けたレビューコメントへの対応は、この skill の範囲の外。issue を直してからもう一度 `/flow implement <親>` を打つ
