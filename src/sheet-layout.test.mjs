#!/usr/bin/env node
// シート構成の検査 — src/sheet-layout.js の定義が、決めた形どおりかを突き合わせる。
//
//   使い方: node src/sheet-layout.test.mjs
//
// 見るものは 2 つある。
//   ① docs/tech-requirements.md と issue #135 が決めた形（5 枚・担当者が書く側・保護する側・列）
//   ② 回答シートの列が、data/前回の希望データ-モック.csv の見出しと一致するか
//      — 回答シートの列はフォームの設問（4-1）の転記なので、記録と突き合わせられる
//
// これは契約であって実装ではない。何も書き換えない。
// 実際の Google スプレッドシートの上での挙動（保護・コピー）はここでは分からない（→ src/README.md）。

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ここ = path.dirname(fileURLToPath(import.meta.url))
const 根 = path.dirname(ここ)
const require = createRequire(import.meta.url)

const { シートの構成, 検証の種別 } = require('./sheet-layout.js')

const 落ちた = []
const 通った = []

function 見る(見出し, 実測, 期待) {
  const 一致 = JSON.stringify(実測) === JSON.stringify(期待)
  if (一致) 通った.push(見出し)
  else 落ちた.push({ 見出し, 実測, 期待 })
}

// ---- ① 決めた形 ------------------------------------------------------------

見る(
  '5 枚あり、並びは issue #135 の表どおりである',
  シートの構成.map((s) => s.名前),
  ['条件入力', '回答', '割り当て', '検証結果', '指標'],
)

見る(
  '担当者が書くのは 条件入力 と 割り当て の 2 枚だけである',
  シートの構成.filter((s) => s.担当者が書くか).map((s) => s.名前),
  ['条件入力', '割り当て'],
)

見る(
  '保護をかけるのは生成シートの 3 枚だけである（割り当ては外れる）',
  シートの構成.filter((s) => s.保護する).map((s) => s.名前),
  ['回答', '検証結果', '指標'],
)

見る(
  '担当者が書くシートに保護をかけていない',
  シートの構成.filter((s) => s.担当者が書くか && s.保護する).map((s) => s.名前),
  [],
)

見る(
  '条件入力は 5-1 の #1〜#5 の 5 区画である',
  シートの構成[0].区画.map((k) => k.見出し),
  ['日ごとの営業 4 時刻', '役割と必要人数', '調理責任者の学年', '委員会の指定枠', '準備・片付けのルール'],
)

見る(
  '委員会の指定枠は、役割と必要人数と同じ形である（→ 5-1 の #4）',
  シートの構成[0].区画.find((k) => k.見出し === '委員会の指定枠').列,
  シートの構成[0].区画.find((k) => k.見出し === '役割と必要人数').列,
)

見る(
  '条件入力のほかに区画を 2 つ以上持つシートは無い',
  シートの構成.filter((s) => s.区画.length > 1).map((s) => s.名前),
  ['条件入力'],
)

const 重なり = []
for (const シート of シートの構成) {
  const 並べ直し = [...シート.区画].sort((a, b) => a.開始列 - b.開始列)
  並べ直し.forEach((区画, i) => {
    const 次 = 並べ直し[i + 1]
    // 区画のあいだは 1 列以上空ける（下に行を足しても隣の区画とぶつからないため）
    if (次 && 区画.開始列 + 区画.列.length >= 次.開始列) {
      重なり.push(`${シート.名前}: ${区画.見出し} と ${次.見出し}`)
    }
  })
}
見る('区画どうしが列で重なっていない', 重なり, [])

const 空の列名 = []
const 重複した列名 = []
for (const シート of シートの構成) {
  for (const 区画 of シート.区画) {
    if (区画.列.some((名) => String(名).trim() === '')) 空の列名.push(シート.名前)
    if (new Set(区画.列).size !== 区画.列.length) 重複した列名.push(`${シート.名前}: ${区画.見出し}`)
  }
}
見る('列名に空が無い', 空の列名, [])
見る('1 つの区画の中で列名が重なっていない', 重複した列名, [])

見る(
  '検証結果は違反と未充足を種別で分けて持つ（→ 5-4）',
  [シートの構成[3].区画[0].列[0], ...Object.values(検証の種別)],
  ['種別', '違反', '未充足'],
)

見る(
  '指標は 3 つを並べるだけで、順位も閾値も列に無い（→ 5 の #7）',
  シートの構成[4].区画[0].列.filter((名) => !['学籍番号', '氏名'].includes(名)),
  ['合計時間', 'シフト回数', '準備回数'],
)

見る(
  '友達欄は割り当ての材料にしないので、回答シートの外に出てこない（→ 5-2）',
  シートの構成
    .filter((s) => s.名前 !== '回答')
    .flatMap((s) => s.区画.flatMap((k) => k.列))
    .filter((名) => 名.includes('お友達')),
  [],
)

// ---- ② 記録との突き合わせ ---------------------------------------------------

const csvの見出し = fs
  .readFileSync(path.join(根, 'data/前回の希望データ-モック.csv'), 'utf8')
  .replace(/^\uFEFF/, '')
  .split('\n')[0]
  .trim()
  .split(',')

見る(
  '回答シートの列が、前回の希望データ（記録）の見出しと一致する',
  シートの構成[1].区画[0].列,
  csvの見出し,
)

// ---- 結果 ------------------------------------------------------------------

console.log('シート構成の検査（src/sheet-layout.js）')
console.log('')
for (const 見出し of 通った) console.log(`  OK   ${見出し}`)
for (const { 見出し, 実測, 期待 } of 落ちた) {
  console.log(`  NG   ${見出し}`)
  console.log(`         実測: ${JSON.stringify(実測)}`)
  console.log(`         期待: ${JSON.stringify(期待)}`)
}
console.log('')
if (落ちた.length === 0) {
  console.log(`結果: 全件一致（${通った.length} 件）`)
  process.exit(0)
}
console.log(`結果: 不一致 ${落ちた.length} 件 ／ 一致 ${通った.length} 件`)
process.exit(1)
