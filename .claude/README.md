# .claude — 事故を実行前に止める柵の置き場

**ここにあるのは、作業の事故を「実行される前に」止める仕掛けである。** 読んで守る文章ではない。
**成果物の書き方の規約は混ぜない。** それは [`docs/ADR/README.md`](../docs/ADR/README.md) と [`skills/`](skills/) が持つ。

何を止めているかは [`settings.json`](settings.json) と
[`hooks/guard-bash.py`](hooks/guard-bash.py) の拒否メッセージを読む（**ここには写さない。二重に持つと片方が古くなる**）。
なぜ止めるのかと、jq + grep 版と比べて python3 を採った経緯は
[issue #73](https://github.com/jun-eg/school-festival-shift/issues/73)。

## 2 層あるのはなぜか、rebase が deny に無いのはなぜか

`permissions.deny` は**前置一致**なので `git push --force origin foo` は止まるが
`git push origin foo --force` を拾えない。そこをフックが見る。
逆にフックは `python3` が無ければ素通りする。**片方では穴が残るので両方置く。**

**`git rebase` は `deny` に入れていない。** 前置一致だと、途中で詰まったときの逃げ道である
`git rebase --abort` まで落ちてしまうためである。rebase の判断はフックが持ち、`--abort` と `--quit` だけ通す。
**「deny に抜けがある」と思って足さないこと。**

## 例外：どうしても必要になったら

`deny` もフックも**確認ダイアログを出さずに落とす**ので、「そのときだけ許可」ができない。
抜けるには**人が明示的に動く**。次のどちらか。

1. **ユーザー自身がその場で打つ。** プロンプトで `! git push --force ...` と打てば人の手で実行される。
2. **[`settings.json`](settings.json) の該当行を外し、作業後に戻す。** 外したこと・戻したことを PR か報告に書く。

**Claude が自分の判断で 1 や 2 をやることはしない。**

## 確かめ方

```
python3 .claude/hooks/guard-bash.test.py
```

**止まる形と通る形を 1 本ずつ突き合わせる。この検査が契約であって、実装ではない。**
何も書き換えない。全件一致なら終了コード 0、1 つでも外れたら 1 で落ちる。

`settings.json` を書き換えたら、**`/hooks` を一度開くかセッションを開き直す。**
起動時に設定ファイルが無かったディレクトリは監視されないので、**足したその場では効かないことがある。**

## 足すとき

**「コマンドの形」で書けるものだけをここに足す。** 形にならない約束は、
**その瞬間に目に入る器**へ置く（例: [`.github/pull_request_template.md`](../.github/pull_request_template.md)）。
