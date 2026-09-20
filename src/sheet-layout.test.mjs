#!/usr/bin/env node
// Checks on the sheet layout — holding what src/sheet-layout.js defines up against the shape that was decided.
//
//   How to run it: node src/sheet-layout.test.mjs
//
// There are 2 things it looks at.
//   ① the shape docs/tech-requirements.md and issue #135 decided
//      (5 sheets, which ones the staff write, which ones are protected, the columns)
//   ② whether the columns of the 回答 sheet match the headings of data/前回の希望データ-モック.csv
//      — the columns of the 回答 sheet are a copy of the form questions (4-1), so they can be
//        held up against the record
//
// This is a contract, not an implementation. It rewrites nothing.
// How it behaves up on a real Google spreadsheet (protection, copying) cannot be seen from here
// (→ src/README.md).

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.dirname(here)
const require = createRequire(import.meta.url)

const { sheetLayout, checkKind } = require('./sheet-layout.js')

const failed = []
const passed = []

function check(title, actual, expected) {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  if (same) passed.push(title)
  else failed.push({ title, actual, expected })
}

// ---- ① the shape that was decided -------------------------------------------

check(
  '5 枚あり、並びは issue #135 の表どおりである',
  sheetLayout.map((s) => s.name),
  ['条件入力', '回答', '割り当て', '検証結果', '指標'],
)

check(
  '担当者が書くのは 条件入力 と 割り当て の 2 枚だけである',
  sheetLayout.filter((s) => s.staffWrites).map((s) => s.name),
  ['条件入力', '割り当て'],
)

check(
  '保護をかけるのは生成シートの 3 枚だけである（割り当ては外れる）',
  sheetLayout.filter((s) => s.protect).map((s) => s.name),
  ['回答', '検証結果', '指標'],
)

check(
  '担当者が書くシートに保護をかけていない',
  sheetLayout.filter((s) => s.staffWrites && s.protect).map((s) => s.name),
  [],
)

check(
  '条件入力は 5-1 の #1〜#5 の 5 区画である',
  sheetLayout[0].sections.map((k) => k.heading),
  ['日ごとの営業 4 時刻', '役割と必要人数', '調理責任者の学年', '委員会の指定枠', '準備・片付けのルール'],
)

check(
  '委員会の指定枠は、役割と必要人数と同じ形である（→ 5-1 の #4）',
  sheetLayout[0].sections.find((k) => k.heading === '委員会の指定枠').columns,
  sheetLayout[0].sections.find((k) => k.heading === '役割と必要人数').columns,
)

check(
  '条件入力のほかに区画を 2 つ以上持つシートは無い',
  sheetLayout.filter((s) => s.sections.length > 1).map((s) => s.name),
  ['条件入力'],
)

const overlaps = []
for (const layout of sheetLayout) {
  const byStartColumn = [...layout.sections].sort((a, b) => a.startColumn - b.startColumn)
  byStartColumn.forEach((section, i) => {
    const next = byStartColumn[i + 1]
    // There is at least 1 empty column between sections (so that adding rows below never runs
    // into the section next door)
    if (next && section.startColumn + section.columns.length >= next.startColumn) {
      overlaps.push(`${layout.name}: ${section.heading} と ${next.heading}`)
    }
  })
}
check('区画どうしが列で重なっていない', overlaps, [])

const blankColumnNames = []
const duplicateColumnNames = []
for (const layout of sheetLayout) {
  for (const section of layout.sections) {
    if (section.columns.some((name) => String(name).trim() === '')) blankColumnNames.push(layout.name)
    if (new Set(section.columns).size !== section.columns.length) duplicateColumnNames.push(`${layout.name}: ${section.heading}`)
  }
}
check('列名に空が無い', blankColumnNames, [])
check('1 つの区画の中で列名が重なっていない', duplicateColumnNames, [])

check(
  '検証結果は違反と未充足を種別で分けて持つ（→ 5-4）',
  [sheetLayout[3].sections[0].columns[0], ...Object.values(checkKind)],
  ['種別', '違反', '未充足'],
)

check(
  '指標は 3 つを並べるだけで、順位も閾値も列に無い（→ 5 の #7）',
  sheetLayout[4].sections[0].columns.filter((name) => !['学籍番号', '氏名'].includes(name)),
  ['合計時間', 'シフト回数', '準備回数'],
)

check(
  '友達欄は割り当ての材料にしないので、回答シートの外に出てこない（→ 5-2）',
  sheetLayout
    .filter((s) => s.name !== '回答')
    .flatMap((s) => s.sections.flatMap((k) => k.columns))
    .filter((name) => name.includes('お友達')),
  [],
)

// ---- ② holding it up against the record -------------------------------------

const csvHeadings = fs
  .readFileSync(path.join(root, 'data/前回の希望データ-モック.csv'), 'utf8')
  .replace(/^﻿/, '')
  .split('\n')[0]
  .trim()
  .split(',')

check(
  '回答シートの列が、前回の希望データ（記録）の見出しと一致する',
  sheetLayout[1].sections[0].columns,
  csvHeadings,
)

// ---- results ----------------------------------------------------------------

console.log('シート構成の検査（src/sheet-layout.js）')
console.log('')
for (const title of passed) console.log(`  OK   ${title}`)
for (const { title, actual, expected } of failed) {
  console.log(`  NG   ${title}`)
  console.log(`         実測: ${JSON.stringify(actual)}`)
  console.log(`         期待: ${JSON.stringify(expected)}`)
}
console.log('')
if (failed.length === 0) {
  console.log(`結果: 全件一致（${passed.length} 件）`)
  process.exit(0)
}
console.log(`結果: 不一致 ${failed.length} 件 ／ 一致 ${passed.length} 件`)
process.exit(1)
