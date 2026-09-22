#!/usr/bin/env node
// 敷き方の検査 — src/assignment-grid.js を、スプレッドシートを 1 つも作らずに走らせる（issue #213）。
//
//   使い方: node src/assignment-grid.test.mjs
//
// 見るものは 5 つある。
//   ① 従来の形に敷ける — 行が人、列が 30 分枠、セルが役割名 1 つ（記録の配布物 ◎ と同じ形である）
//   ② 行の並びが入力から決まる（学籍番号の昇順。同じ入力からは同じ並びが出る → 6 の #3）
//   ③ 敷いて戻すと元の行に戻る（往復しても割り当てが増えも減りもしない）
//   ④ 当てるのは位置ではなく見出しの時刻である（営業時刻を動かしても、役割が別の枠へ移らない）
//   ⑤ 載らないものは黙って捨てず、名指しして止まる
//
// これは契約であって実装ではない。何も書き換えない。
// 記録の側（前回の確定シフトが本当にこの形に敷けるか）は scripts/前回のシフト表.mjs が見る。

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// ---- 読み込む ---------------------------------------------------------------
// SpreadsheetApp を文脈に置いていない。敷く側はコアなので、掴まなくても通る（→ 6 の #8）。

const context = vm.createContext({})
for (const name of ['sheet-layout.js', 'input-types.js', 'core.js', 'assignment-grid.js']) {
  vm.runInContext(fs.readFileSync(path.join(here, name), 'utf8'), context, { filename: name })
}
const { toAssignmentGrid, fromAssignmentGrid, namesFromAnswers, toDays } = context
const { dayLabels, assignmentColumns } = vm.runInContext('({ dayLabels, assignmentColumns })', context)

const failed = []
const passed = []

function check(title, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed.push(title)
  else failed.push({ title, actual, expected })
}

function whyItStopped(work) {
  try {
    work()
    return null
  } catch (error) {
    return error.message
  }
}

// ---- 材料 -------------------------------------------------------------------
// 前回の 2025-11-02 と同じ 5 時刻である（→ data/前回の確定シフト.md）。枠は 24 になる。

const days = toDays([['2025-11-02', '08:00', '10:00', '18:00', '18:00', '20:00']], '日ごとの営業時刻')
const day = days[0]

/** 割り当ての 1 行を、列の並びのとおりに組む。氏名は生成が空で置く（→ 5 の #1）。 */
function row(date, start, end, role, studentId) {
  const values = { '日': date, '開始': start, '終了': end, '役割': role, '学籍番号': studentId, '氏名': '' }
  return assignmentColumns.map((name) => values[name])
}

const assignments = [
  row('2025-11-02', '10:00', '10:30', '調理', 'EED2402549'),
  row('2025-11-02', '10:30', '11:00', '調理', 'EED2402549'),
  row('2025-11-02', '10:00', '10:30', '呼び込み', 'ECK2626643'),
  row('2025-11-02', '08:00', '08:30', '準備', 'LTS2390333'),
  // 別の日の行は、この日のマス目に落ちない
  row('2025-11-03', '10:00', '10:30', '調理', 'EED2402549'),
]

const nameOf = namesFromAnswers([
  ['2025-10-01 10:00:00', 'eed2402549', '高木琴音', '3年生', 'はい', '', '', '', '', ''],
  ['2025-10-01 11:00:00', 'ECK2626643', '森田咲良', '2年生', 'いいえ', '', '', '', '', ''],
])

// ---- ① 従来の形に敷ける -----------------------------------------------------

const grid = toAssignmentGrid(assignments, day, nameOf)

check(
  '① 見出しは 学籍番号 / 氏名 ＋ その日の枠の開始時刻である（24 枠 → 26 列）',
  [grid.header.slice(0, 5), grid.header.length, day.slots.length],
  [['学籍番号', '氏名', '08:00', '08:30', '09:00'], 26, 24],
)

check(
  '① 1 人 1 行で、セルに入るのは役割名 1 つである（配布物 ◎ と同じ形 → issue #213）',
  grid.rows.map((one) => [one[0], one[1], one.slice(2).filter((cell) => cell !== '')]),
  [
    ['ECK2626643', '森田咲良', ['呼び込み']],
    ['EED2402549', '高木琴音', ['調理', '調理']],
    ['LTS2390333', '', ['準備']],
  ],
)

check(
  '① 役割は、その枠の列に落ちる（10:00-10:30 は 5 つ目の枠 ＝ 7 列目）',
  [grid.rows[1][6], grid.rows[1][7], grid.rows[2][2]],
  ['調理', '調理', '準備'],
)

check(
  '① 別の日の行は、この日のマス目に落ちない（1 日 1 枚である）',
  grid.rows.map((one) => one.slice(2).filter((cell) => cell !== '').length).reduce((a, b) => a + b, 0),
  4,
)

check(
  '① 氏名は回答から引く。大文字・小文字が違っても同じ人である（→ 規則 2 の ①）',
  [nameOf('EED2402549'), nameOf('eed2402549'), nameOf('LTS2390333')],
  ['高木琴音', '高木琴音', ''],
)

// ---- ② 並びが入力から決まる -------------------------------------------------

check(
  '② 行の並びは学籍番号の昇順である（生成の出てきた順ではない → 5 の #11）',
  grid.rows.map((one) => one[0]),
  ['ECK2626643', 'EED2402549', 'LTS2390333'],
)

check(
  '② 割り当ての順を入れ替えても、同じマス目が出る（決定的である → 6 の #3）',
  JSON.stringify(toAssignmentGrid(assignments.slice().reverse(), day, nameOf)),
  JSON.stringify(grid),
)

// ---- ③ 敷いて戻すと元に戻る -------------------------------------------------

const backAgain = fromAssignmentGrid(grid.header, grid.rows, day, dayLabels[1])

check(
  '③ 敷いて戻すと、その日の行がそのまま戻る（往復で増えも減りもしない）',
  backAgain.slice().sort(),
  assignments.filter((one) => one[0] === '2025-11-02').slice().sort(),
)

check(
  '③ 戻した行の氏名は空である（表示のための列で、生成は見ない → 5 の #1）',
  backAgain.map((one) => one[assignmentColumns.indexOf('氏名')]),
  ['', '', '', ''],
)

check(
  '③ 空のマス目は 0 行に戻る（手直しが無いだけで、止まらない）',
  fromAssignmentGrid(grid.header, [], day, dayLabels[1]),
  [],
)

check(
  '③ 条件入力にその日の行が無くても、マス目が空なら止まらない',
  fromAssignmentGrid(['学籍番号', '氏名'], [], undefined, dayLabels[3]),
  [],
)

// ---- ④ 当てるのは見出しの時刻である -----------------------------------------

// 見出しを 1 列ずらしても、時刻で当てるので役割は同じ枠に戻る（位置で当てていない）
const shiftedHeader = ['学籍番号', '氏名'].concat(day.slots.map((slot) => slot.start))
const shiftedRows = [['EED2402549', '高木琴音'].concat(day.slots.map((slot) => (slot.start === '13:00' ? '会計' : '')))]

check(
  '④ 当てるのは見出しに書いてある時刻である（列の位置ではない）',
  fromAssignmentGrid(shiftedHeader, shiftedRows, day, dayLabels[1]),
  [row('2025-11-02', '13:00', '13:30', '会計', 'EED2402549')],
)

// ---- ⑤ 載らないものは名指しして止まる ---------------------------------------

check(
  '⑤ 1 セルに 2 役割は置けない（同じ人が同じ枠に 2 つ入っているのは違反である → 5-4）',
  whyItStopped(() => toAssignmentGrid(
    assignments.concat([row('2025-11-02', '10:00', '10:30', '会計', 'EED2402549')]),
    day,
    nameOf,
  ))?.includes('1 セルに入るのは役割 1 つである'),
  true,
)

check(
  '⑤ その日の枠に無い時間帯は、黙って落とさずに名指しする',
  whyItStopped(() => toAssignmentGrid([row('2025-11-02', '09:45', '10:15', '調理', 'EED2402549')], day, nameOf))
    ?.includes('その日の枠に無い'),
  true,
)

check(
  '⑤ 学籍番号が空の行に役割が入っていれば、誰の行かが決まらないので止まる',
  whyItStopped(() => fromAssignmentGrid(
    grid.header,
    [['', ''].concat(day.slots.map((slot) => (slot.start === '10:00' ? '調理' : '')))],
    day,
    dayLabels[1],
  ))?.includes('学籍番号が空である'),
  true,
)

check(
  '⑤ 学籍番号が 10 桁英数字でなければ名指しする（→ 4-1 の #1）',
  whyItStopped(() => fromAssignmentGrid(
    grid.header,
    [['あ', ''].concat(day.slots.map((slot) => (slot.start === '10:00' ? '調理' : '')))],
    day,
    dayLabels[1],
  ))?.includes('形式と違う'),
  true,
)

// 営業時刻を動かしたあとのマス目。前の周の見出し（07:00）が、いまの枠に無い
check(
  '⑤ 見出しの時刻がいまの枠に無ければ、黙って別の枠へ移さずに名指しする（→ 5-3）',
  whyItStopped(() => fromAssignmentGrid(
    ['学籍番号', '氏名', '07:00'],
    [['EED2402549', '高木琴音', '調理']],
    day,
    dayLabels[1],
  ))?.includes('いまの 2025-11-02 の枠に無い'),
  true,
)

check(
  '⑤ 条件入力にその日の行が無いのにマス目に中身があれば、名指しして止まる',
  whyItStopped(() => fromAssignmentGrid(
    ['学籍番号', '氏名', '08:00'],
    [['EED2402549', '高木琴音', '準備']],
    undefined,
    dayLabels[3],
  ))?.includes('その日の行が無い'),
  true,
)

// ---- 結果 ------------------------------------------------------------------

console.log('敷き方の検査（src/assignment-grid.js）')
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
} else {
  console.log(`結果: 不一致 ${failed.length} 件 ／ 一致 ${passed.length} 件`)
  process.exitCode = 1
}
