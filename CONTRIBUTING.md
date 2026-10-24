# 開発する人へ

**ここは入口である。** この基盤が何を持っているかは [`README.md`](README.md) が持つ。

## 何を作っているかは `docs/` の要約を読む

**ジャーニーマップ・HMW・Design Doc・技術の要件定義・ADR の要約は、[`docs/README.md`](docs/README.md) の一覧から辿る。**
**要約は原本（`docs/agent/`）から Claude が書いたもので、手で直さない。** 原本へは要約の先頭のリンクで 1 クリックで行ける。

## commit の前に回る検査を有効にする

**clone したら 1 回だけ**、git hooks の置き場をリポジトリの中に向ける。

```
git config core.hooksPath .githooks
```

**これで commit のたびに [`.githooks/pre-commit`](.githooks/pre-commit) が走り、相対リンクの実在と要約の古さを見る**
（中身は [`scripts/README.md`](scripts/README.md) の「リンクの検査」「要約の検査」）。**同じ検査が PR でも回る**（[`.github/workflows/ci.yml`](.github/workflows/ci.yml)）。
**止まったときの直し方は [`docs/README.md`](docs/README.md) の「古さの check」。**
