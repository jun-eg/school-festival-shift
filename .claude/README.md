# .claude — 事故を実行前に止める柵の置き場

**ここにあるのは、作業の事故を「実行される前に」止める仕掛けである。** 読んで守る文章ではない。
**成果物の書き方の規約は混ぜない。** それは [`docs/ADR/README.md`](../docs/ADR/README.md)（ADR の規約）と
[`skills/`](skills/)（アイデア出し 3 ステップの手順）が持つ。

きっかけは [issue #73](https://github.com/jun-eg/school-festival-shift/issues/73)。
レビュー中の PR を force-push で積み直し、同じ作業で `gh api -f body=@file` が
ファイルを読まずパス文字列を投稿した。どちらも「知っていれば起きない」形なので、
**知識ではなくコマンドの形として止める。**

## 止めているもの

| 形 | 止まる場所 | なぜ |
| --- | --- | --- |
| `git push --force` / `--force-with-lease` / `-f` / `+refspec` | deny ＋ フック | レビュー済みコミットが消えると、付いたレビューコメントが行を見失う |
| `git rebase`（`--abort` `--quit` は通す） | フック | push 済みかは判定できない。**main の取り込みは `git merge origin/main`** |
| `git commit --amend` | deny ＋ フック | 同上。新しいコミットを積む |
| `git reset --hard` | deny ＋ フック | 作業が消える。`git restore` / `git revert` を使う |
| `gh ... -f name=@file` / `--raw-field name=@file` | フック | **`-f` はファイルを読まず `@...` を文字列として送る。`-F body=@file` か `--body-file` を使う** |

## なぜ 2 層あるか

| | [`settings.json`](settings.json) の `permissions.deny` | [`hooks/guard-bash.py`](hooks/guard-bash.py) |
| --- | --- | --- |
| **効き方** | 確認ダイアログを出さずに落とす | コマンドを読んで落とす |
| **得意** | 宣言として目で読める。フックが動かない環境でも効く | フラグの位置を問わない。`&&` `;` でつないだ先も見る |
| **苦手** | **前置一致**なので `git push origin foo --force` を拾えない | `python3` が無ければ素通りする |

**どちらか片方では穴が残るので、両方置く。**
`git rebase` を `deny` に入れていないのは、前置一致だと逃げ道の `git rebase --abort` まで
落ちてしまうからである。rebase の判断はフックが持つ。

**依存はゼロである**（Python の標準だけを使う）。`/usr/bin/python3` を絶対パスで呼ぶ。
node を使わないのは、nvm 管理の node が**フックの環境の PATH に居ない**ためである
（`env -i /bin/sh -c 'command -v node'` が空になる）。

## 例外：どうしても必要になったら

`deny` もフックも**確認ダイアログを出さずに落とす**ので、「そのときだけ許可」ができない。
そのぶん、抜けるには**人が明示的に動く**必要がある。次のどちらか。

1. **ユーザー自身がその場で打つ。** Claude Code のプロンプトで `! git push --force ...` と打てば、
   フックも `deny` も通らずに人の手で実行される。
2. **[`settings.json`](settings.json) の該当行を外し、作業後に戻す。**
   外したこと・戻したことを PR か報告に書く。黙って外さない。

**Claude が自分の判断で 1 や 2 をやることはしない。**

## 確かめ方

```
python3 .claude/hooks/guard-bash.test.py
```

**止まる形と通る形を 1 本ずつ突き合わせる**（34 件）。何も書き換えない。
全件一致なら終了コード 0、1 つでも外れたら 1 で落ちる。

`settings.json` を書き換えたら、**Claude Code の `/hooks` を一度開くか、セッションを開き直す。**
起動時に設定ファイルが無かったディレクトリは監視されないので、**足したその場では効かないことがある。**

## 足すとき

**「コマンドの形」で書けるものだけをここに足す。**
形にならない約束（例: 「PR 本文を書き換えたら記録を残す」）は、ここではなく
**その瞬間に目に入る器**に置く。上の例なら [`.github/pull_request_template.md`](../.github/pull_request_template.md) である。
