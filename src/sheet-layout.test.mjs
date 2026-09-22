#!/usr/bin/env node
// シート構成の検査 — src/sheet-layout.js の定義が、決めた形どおりかを突き合わせる。
//
//   使い方: node src/sheet-layout.test.mjs
//
// 見るものは 2 つある。
//   ① docs/tech-requirements.md と issue #135 が決めた形（5 枚・担当者が書く側・保護する側・列）
//   ② 回答シートの並びが、data/前回の希望データ-モック.csv の見出しと当たるか
//      — 回答シートの列はフォームの設問（4-1）の転記だが、後ろ 4 列の列名は毎年変わる（設問の題だからである）。
//        構成が名前で持つのは前の 6 列だけなので、名前で突き合わせるのもそこまでで、
//        後ろ 4 列は数と位置だけを見る
//
// これは契約であって実装ではない。何も書き換えない。
// 実際の Google スプレッドシートの上での挙動（保護・コピー）はここでは分からない（→ src/README.md）。

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.dirname(here)
const require = createRequire(import.meta.url)

const {
  sheetLayout, checkKind, sectionWidth,
  protectionKind, dayLabels, assignmentName, maxSlotsPerDay, outputColumns, gridLayouts,
} = require('./sheet-layout.js')

/** 名前でシート 1 枚の区画を引く。並びの番号で当てない（並びが動くと検査が別の枚を見てしまう）。 */
function sheetSectionOf(name) {
  return sheetLayout.filter((layout) => layout.name === name)[0].sections[0]
}

const failed = []
const passed = []

function check(title, actual, expected) {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  if (same) passed.push(title)
  else failed.push({ title, actual, expected })
}

// ---- ① 決めた形 ------------------------------------------------------------

check(
  '8 枚あり、割り当ては日ごとの 4 枚である（→ issue #135 の表 ＋ #213）',
  sheetLayout.map((s) => s.name),
  ['条件入力', '回答', '準備日', '学祭1日目', '学祭2日目', '片付け', '検証結果', '指標'],
)

check(
  '割り当ての 4 枚の名前が、希望時間 4 設問のラベル ◎ と同じ 4 つである（値は 1 か所 → #213）',
  gridLayouts(assignmentName).map((s) => s.name),
  dayLabels,
)

check(
  'マス目の 4 枚は、上から順に条件入力の「日ごとの営業時刻」の 4 行と 1 対 1 で当てる',
  gridLayouts(assignmentName).map((s) => s.grid.dayIndex),
  [0, 1, 2, 3],
)

check(
  '割り当ての行の形は、シートの列ではなく別に持つ（マス目に載るため → #213）',
  [outputColumns(assignmentName), gridLayouts(assignmentName)[0].sections[0].columns],
  [['日', '開始', '終了', '役割', '学籍番号', '氏名'], ['学籍番号', '氏名', '一緒に組みたいお友達']],
)

check(
  '担当者が書くのは 条件入力 と 割り当ての 4 枚だけである',
  sheetLayout.filter((s) => s.staffWrites).map((s) => s.name),
  ['条件入力'].concat(dayLabels),
)

check(
  '8 枚とも保護をかける（→ issue #234）',
  sheetLayout.filter((s) => s.protect).map((s) => s.name),
  sheetLayout.map((s) => s.name),
)

check(
  '担当者が書くシートに「警告のみ」を全面にはかけない — 割り当ては持ち主だけ、条件入力は入力欄を外す',
  sheetLayout.filter((s) => s.staffWrites).map((s) => [s.name, s.protect.kind, Boolean(s.protect.openInputs)]),
  [['条件入力', protectionKind.warningOnly, true]].concat(dayLabels.map((name) => [name, protectionKind.ownerOnly, false])),
)

check(
  '担当者が書かないシートは「警告のみ」を全面にかける',
  sheetLayout.filter((s) => !s.staffWrites).map((s) => [s.name, s.protect.kind, Boolean(s.protect.openInputs)]),
  [['回答', protectionKind.warningOnly, false], ['検証結果', protectionKind.warningOnly, false], ['指標', protectionKind.warningOnly, false]],
)

check(
  '条件入力は 5-1 の #1〜#5 と #7 の 6 区画である',
  sheetLayout[0].sections.map((k) => k.heading),
  ['日ごとの営業時刻', '役割と必要人数', '調理責任者の学年', '委員会の指定枠', '準備・片付けのルール', '置き方のルール'],
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
    // 区画のあいだは 1 列以上空ける（下に行を足しても隣の区画とぶつからないため）
    if (next && section.startColumn + sectionWidth(section) >= next.startColumn) {
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
  '検証結果は違反と未充足を種別で分けて持ち（→ 5-4）、残せなかった手直しは 3 つ目の種別で持つ（→ 5-3）',
  [sheetSectionOf('検証結果').columns[0], ...Object.values(checkKind)],
  ['種別', '違反', '未充足', '食い違った固定'],
)

check(
  '指標は 3 つを並べるだけで、順位も閾値も列に無い（→ 5 の #7）',
  sheetSectionOf('指標').columns.filter((name) => !['学籍番号', '氏名'].includes(name)),
  ['合計時間', 'シフト回数', '準備回数'],
)

check(
  '友達欄は割り当ての材料にしないので、回答とマス目の 4 枚（担当者が手で寄せるときに読む → #200）の外に出てこない（→ 5-2）',
  sheetLayout
    .filter((s) => s.name !== '回答' && !dayLabels.includes(s.name))
    .flatMap((s) => s.sections.flatMap((k) => k.columns))
    .filter((name) => name.includes('お友達')),
  [],
)

check(
  '友達欄は割り当ての行の形に無い（マス目に出すのは表示のためだけである → 5-2・#200）',
  outputColumns(assignmentName).filter((name) => name.includes('お友達')),
  [],
)

// ---- ② 記録との突き合わせ ---------------------------------------------------

const csvHeadings = fs
  .readFileSync(path.join(root, 'data/前回の希望データ-モック.csv'), 'utf8')
  .replace(/^\uFEFF/, '')
  .split('\n')[0]
  .trim()
  .split(',')

const answerSection = sheetLayout[1].sections[0]

check(
  '回答シートの並びが、タイムスタンプ ＋ 設問 9 つの 10 列である（→ 4-1・5-1 の #6）',
  sectionWidth(answerSection),
  csvHeadings.length,
)

check(
  '構成が名前で持つ前の 6 列が、前回の希望データ（記録）の見出しの頭 6 列と一致する',
  answerSection.columns,
  csvHeadings.slice(0, answerSection.columns.length),
)

check(
  '後ろ 4 列は構成が名前を持たない（列名は設問の題そのもので毎年変わる → 4-1）',
  [
    answerSection.yearlyColumns,
    answerSection.columns.filter((name) => /月|日/.test(name)),
  ],
  [4, []],
)

check(
  '毎年名前が変わる列があるのは「回答」だけである',
  sheetLayout.filter((s) => s.sections.some((k) => k.yearlyColumns)).map((s) => s.name),
  ['回答'],
)

check(
  '時刻の列を持つのはマス目の 4 枚だけで、幅は 1 日に刻める枠の上限である（→ maxSlotsPerDay）',
  [
    sheetLayout.filter((s) => s.sections.some((k) => k.slotColumns)).map((s) => s.name),
    sectionWidth(gridLayouts(assignmentName)[0].sections[0]),
  ],
  [dayLabels, 3 + maxSlotsPerDay],
)

check(
  '左の 2 列を固定するのはマス目の 4 枚だけである（右へ送っても誰の行かが読める）',
  sheetLayout.filter((s) => s.frozenColumns).map((s) => [s.name, s.frozenColumns]),
  dayLabels.map((name) => [name, 2]),
)

// ---- 結果 ------------------------------------------------------------------

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
