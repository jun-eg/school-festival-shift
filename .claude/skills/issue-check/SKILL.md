---
name: issue-check
description: 起票済みの GitHub issue の解決策が、その issue の目的に対して妥当かを issue-reviewer subagent（model fable 固定）に判定させ、直しが要れば本文を直す。`/issue-check <issue 番号か URL>` と明示されたとき、「この issue の解決策は目的に合っているか見て」「sub-issue を含めて issue を点検して」と言われたとき、起票した直後に着手前の確認をしたいときに使う。1 本の issue ならそれだけ、親 issue なら親 → sub-issue を 1 本ずつ順に回す。
---

# issue-check

> issue の「目的」と「解決策」が噛み合っているかを、起票した後・着手する前に確かめる。

判定するのは subagent `issue-reviewer`（[`.claude/agents/issue-reviewer.md`](../../agents/issue-reviewer.md)）で、書き換えるのはこの skill を回している側である。
**判定する手と書き換える手を分ける。** subagent に `gh issue edit` を打たせない。

- **入力**: issue 番号か URL が 1 つ。`/issue-check 312`、`/issue-check https://github.com/<owner>/<repo>/issues/312`
- **出力**: issue 本文の直し（要るときだけ）と、直した issue へのコメント、人への報告

## 手順

### 1. 引数をほどき、親子関係を取る

```
bash .claude/skills/issue-check/fetch.sh <番号か URL>
```

番号・タイトル・state・親・sub-issue（親に並んだ順）が JSON で出る。URL なら owner/repo も URL から取る。無ければ今のリポジトリ。

- `subIssues` が空 → **単独**。手順 2 を 1 回
- `subIssues` がある → **親**。手順 3
- 渡されたのが sub-issue（`parent` がある）で単独指定なら、**sub-issue** の役割で手順 2 を 1 回。親までは遡らない

**state が CLOSED の issue は、役割が何でも判定だけして直さない。** 終わった物を書き換えない。判定は報告に残す。

### 2. 1 本を判定し、要れば直す

**2-1. subagent を回す。** Agent tool で `subagent_type: issue-reviewer`。並列に回さない。prompt には次を入れる。

- issue 番号と owner/repo
- 役割（`単独` ／ `親` ／ `sub-issue`。sub-issue なら親の番号）
- 直前に直した issue があれば、その番号と「何をどう直したか」（判定の前提が動いているため）
- 「issue を書き換えないこと。判定と直し方だけを返すこと」

**2-2. 判定で分ける。**

| 判定 | すること |
| --- | --- |
| 妥当 | 直さない。所見を報告に残す。形の指摘だけが残ったなら、それも直さず報告に書く（形は人が読む側で気づく） |
| 直しが要る | OPEN なら 2-3 へ。CLOSED なら直さず、所見と直し方を報告に残す |
| 目的から見直し | **直さない。** 食い違いをそのまま人に返して、この issue で止まる。親でこれが出たら sub-issue も回さない（前提が崩れている） |

**大きさは判定とは別に扱う。** subagent の「大きさ」（適切・大きすぎ・小さすぎ）と分け方・まとめ方の案は、判定が何でも本文に当てず、報告に載せて人に返す。
sub-issue を足す・外す・分けるのは人がやる。

**2-3. 本文を直す。** subagent の「直し方」を本文に当てる。それ以外は触らない。

1. 今の本文を取り、scratchpad に書く。`gh issue view <N> --json body --jq .body > <scratchpad>/<N>.md`
2. 「直し方」の「今 → 後」をそのファイルに当てる。上段の長さと順は [`docs/README.md`](../../../docs/README.md) の「issue 本文」節と「長さ」の表に従う。ここに写さないので、当てた後にそちらを開いて数える
3. 送る。`gh issue edit` は使わない（projectCards の非推奨エラーで落ちる）

   ```
   gh api -X PATCH repos/<owner>/<repo>/issues/<N> -F body=@<scratchpad>/<N>.md
   ```

4. 先頭数行を読み返して、ファイルの中身が入ったことを確かめる（`-f` だとパス文字列が送られる）
5. コメントを 1 本残す。**何をどう直したか**と、**subagent のどの所見によるか**。issue 本文は人が読むが編集しないので、動かした跡を残す

   ```
   gh api repos/<owner>/<repo>/issues/<N>/comments -F body=@<scratchpad>/<N>-comment.md
   ```

タイトルが本文と食い違っていると所見にあれば、タイトルも同じ PATCH で `-f title=...` を足してよい。

**直してよいのは本文とタイトルだけ。** issue を閉じる・開く、sub-issue を足す・外す、新しい issue を起こす、ラベルを付ける、は所見に書いてあっても人に返す。

### 3. 親 issue なら、親 → sub-issue の順に回す

**同期で、1 本ずつ。** 前の直しが次の判定の入力になる。

1. 親を手順 2 で回す（役割 `親`）。「目的から見直し」なら、ここで止めて報告する
2. sub-issue を、親の「やること」に書かれた順に 1 本ずつ手順 2 で回す（役割 `sub-issue`、親の番号付き）。GitHub の並びと親の「やること」の順が違えば、親の順を採り、違いは報告に書く
3. 各 sub-issue の prompt に、親と直前の sub-issue で直した内容を入れる
4. sub-issue を直した結果、親の「やること」の文言（sub-issue のタイトルを写した行など）が古くなったら、親も同じ手順で直す。親の再判定は要らない。何を写し直したかをコメントに書く
5. state が CLOSED の親・sub-issue も読んで判定する。直すのは OPEN の物だけ（手順 1 の規則）

### 4. 報告する

issue ごとに 1 行の表。親なら、親と sub-issue の大きさが 1 つの表に並ぶ。

```
| issue | 役割 | 判定 | 大きさ | 直したか | 主な所見 |
```

大きすぎ・小さすぎが出た issue は、続けて分け方・まとめ方の案を載せる。本文は直していないと明記する。

続けて、直さなかった判定（妥当・目的から見直し・CLOSED）の理由を 1〜2 行ずつ。「目的から見直し」が出た issue は、何が食い違っているかを subagent の文のまま載せる。

## 守ること

- subagent は 1 本ずつ。並列に回さない
- 直すのは subagent の「直し方」の範囲だけ。文体や語の好みで直さない
- 「目的から見直し」は人に返す。目的を変えるのは人の判断
- 大きさの指摘（大きすぎ・小さすぎ）も人に返す。本文を直さず、案を報告に書く
- issue を書き換えたら、必ずコメントで跡を残す
- `gh issue edit`／`gh issue comment` ではなく `gh api`（REST）。ファイルは `-F body=@path`
- subagent の返答に「読めなかった」とあれば、読めなかった物を報告に書く。読めていない判定で直さない
