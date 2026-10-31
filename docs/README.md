# docs — 人が読む要約と、AI が読む原本

ここ（`docs/` 直下）にあるのは人が読む要約である。原本は [`agent/`](agent/) にあり、要約と同じファイル名で置いてある。
要約は原本から Claude が書く。人は要約を手で直さない。直したいことがあれば原本を直し、要約は Claude に書き直させる
（なぜそうするかは [issue #312](https://github.com/jun-eg/school-festival-shift/issues/312)）。

## 一覧

| 要約 | 読むと分かること | 原本 |
| --- | --- | --- |
| [`journey/入る側.md`](journey/入る側.md) | シフトに入る側のペルソナと、体験のどこに改善の余地があるか | [`agent/journey/入る側.md`](agent/journey/入る側.md) |
| [`journey/作る側.md`](journey/作る側.md) | シフトを作る側のペルソナと、体験のどこに改善の余地があるか | [`agent/journey/作る側.md`](agent/journey/作る側.md) |
| [`hmw.md`](hmw.md) | どの改善機会を採り、どの問いからどのソリューションを選んだか | [`agent/hmw.md`](agent/hmw.md) |
| [`design-doc.md`](design-doc.md) | 何を作るか。7 セクションの結論と、まだ決まっていないこと | [`agent/design-doc.md`](agent/design-doc.md) |
| [`tech-requirements.md`](tech-requirements.md) | どう作るか。実行形態・業務の規則・完了の測り方 | [`agent/tech-requirements.md`](agent/tech-requirements.md) |
| [`e2e-症状と対処.md`](e2e-症状と対処.md) | `npm run e2e` が実機で止まるときの症状・切り分け・対処（トークン切れ・GCP の結び付け・180 秒の二重実行） | [`agent/e2e-症状と対処.md`](agent/e2e-症状と対処.md) |
| [`ADR/`](ADR/) | 判定がどう動いたか。原本と同じ `<対象>/<同名>.md` に、1 本 10 行で | [`agent/ADR/`](agent/ADR/) |

要約を置かないものもある。

| 原本 | 要約しない理由 |
| --- | --- |
| [`agent/interviews/`](agent/interviews/) | 逐語（一次情報）なので、要約すると一次情報でなくなる |
| [`agent/画面の記録/`](agent/画面の記録/) | 画像。[`README.md`](../README.md) と [`src/real-device-log.md`](../src/real-device-log.md) が貼って使う |
| `agent/*-template.md`・`agent/journey/_template.md`・`agent/ADR/_template.md` | 雛形。読む物ではなく埋める物 |

[`README.md`](../README.md)・[`CONTRIBUTING.md`](../CONTRIBUTING.md)・[`src/README.md`](../src/README.md)・[`scripts/README.md`](../scripts/README.md) は
それ自体が人間用である。原本と要約の 2 層にはしない。

## 要約の書き方

要約の規約の原本はここである。ADR の要約も、issue と PR の雛形も、skill も、ここを指す。写さない。

### 長さ

| 要約 | 上限 |
| --- | --- |
| 成果物 1 本（journey・hmw・design-doc・tech-requirements） | 40 行 |
| ADR 1 本（[`ADR/`](ADR/) の 1 ファイル） | 10 行 |
| issue 本文の上段 | 20 行 |
| PR 本文（checkbox と `Closes` を含む） | 40 行 |

先頭の `---` で囲んだ数行（原本の在処とハッシュ）は数えない。

### 文体

- 太字を使わない。記号（◎ ○ △）と (n/m) を書かない。根拠の強さは原本が持つ
- 抜き出しではなく要約。原本の文を切り貼りしない
- 原本へのリンクを 1 つ置く。それ以外のリンクは、読む人が次に開く先として要るものだけ
- 1 文 1 つのこと。節は下の順に置き、増やさない

### 成果物の要約に書く順

1. 何を作るか（1〜3 行）
2. 決めたこと（箇条書き）
3. 開いていること（原本の「未検証（△）」節の要約）
4. 根拠の在処（原本へのリンク 1 つ）

journey は「ペルソナと改善機会」、hmw は「採った問いと採ったソリューション」、design-doc は「7 セクションの結論」、
tech-requirements は「実行形態・規則・完了の測り方」が中身になる。

### ADR の要約に書く順

原本 1 本につき要約 1 本で、ファイル名は原本と同じ。1 行目に何が崩れたか（ADR の見出しの言い直し）、続きに今どうなっているか（「新しい結論」の要約）、最後に原本へのリンクを 1 つ。
Status が「取り消し」の ADR も 1 本置き、何が取り消されて何が生きているか、上書きした ADR はどれかを書く。

### issue 本文

上段が人間用で、下段は `<details>` に根拠・却下案・出典を畳む。上段は「何に困っている・何をする・どうなったら終わり」の順。
進捗の checkbox は上段に置いてよい。人が読むのは進捗だからである。
起票は今までどおり先にやる。番号を worktree 名と PR に引く。

#### issue 1 本の大きさ

issue 1 本が PR 1 本の単位になる。単独 issue も sub-issue も同じ物差しで測る。親 issue は sub-issue を束ねる物なので測らず、sub-issue を 1 本ずつ測る。物差しの原本はここである。
issue-reviewer・雛形・起票 skill はここを指し、写さない。

| 大きさ | 定義 |
| --- | --- |
| 大きすぎる | 別々に merge しても成り立つ変更が 2 つ以上入っている。「やること」が切れ目で 2 本に分けられる |
| 小さすぎる | 単独では終わりの判定が立たない。前か後の issue と合わせないと、何が良くなったか言えない |
| 適切 | どちらでもない |

- 行数・ファイル数の数値は置かない。起票の時点では見積もりしかできず、判定がぶれる
- 「妥当・直しが要る・目的から見直し」の判定とは別の軸で、並べて報告する（例: 妥当・大きすぎ）
- 大きすぎる・小さすぎるが出たら、本文を直さず、分ける・まとめる案を人に返す。sub-issue を足す・外すのは人がやる
- 単独 issue が大きすぎるときは、親と sub-issue に分ける案になる

### PR 本文

何に困って・何をして・どう確かめたか、の 3 つを本文に書く。困りごとを issue へのリンクだけにしない。
issue 上段の写しでよい。40 行まで。収まらない分は PR コメントか原本（commit message・docs）に置く。
雛形は [`.github/pull_request_template.md`](../.github/pull_request_template.md)。

## 古さの check

要約の先頭には、原本の在処とハッシュを刻む。commit のハッシュではなくファイルのハッシュなので、無関係な commit では古くならない。

```
---
source: agent/design-doc.md
source-hash: <git hash-object の値。ADR はフォルダなのでツリーハッシュ>
---
```

[`scripts/要約の検査.mjs`](../scripts/要約の検査.mjs) が原本の今のハッシュと比べ、違えば要約の名前を挙げて落ちる。長さの上限も同時に見る。
pre-commit（[`.githooks/pre-commit`](../.githooks/pre-commit)。有効にする手順は [`CONTRIBUTING.md`](../CONTRIBUTING.md)）は作業ツリーの原本と、
GitHub Actions（[`.github/workflows/ci.yml`](../.github/workflows/ci.yml)）は HEAD の原本と比べる。

拾うのは「原本を直して要約を見直していない」だけである。ハッシュを刻み直したのに中身が追いついていないかは、人が読む側で気づく。
typo の修正でも止まるが、「見直した」と宣言する 1 手なので許容する。

### 止まったときの直し方

1. 原本の差分（`git diff` か PR の差分）と、古い要約を読む
2. 要約を書き直す（上の規約に従う）。読み直して変える所が無ければ、そのまま 3 へ
3. 刻み直す。要約を名指しする

   ```
   node scripts/要約の検査.mjs --stamp docs/design-doc.md
   ```

4. 原本と要約を同じ commit に入れる。再生成は当面 Claude がセッションでやり、hook が忘れを止める
