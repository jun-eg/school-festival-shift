#!/usr/bin/env node
// 入力の型の検査 — src/input-types.js を、スプレッドシートを 1 つも作らずに走らせる。
//
//   使い方: node src/input-types.test.mjs
//
// 見るものは 4 つある。
//   ① 型は 5-1 の 6 種類だけで、その外にある名前が型のどこにも現れない（→ 5 の #1・5-2）
//   ② 枠が営業時刻から刻まれる。30 分に足りない端は枠にならない（→ 5-1 の #1・規則 1 の ①）
//   ③ 揃っていない値は、黙って直さずに区画・行・列を名指しして止まる
//   ④ data/ のモック 5 本が型に乗る（→ 7 の M1 ①。乗らなかった行を数える）
//
// これは契約であって実装ではない。何も書き換えない。

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(here, '..', 'data')

// ---- 読み込む ---------------------------------------------------------------
// SpreadsheetApp を文脈に置いていない。置かなくても通ることが、この検査そのものである。

const context = vm.createContext({})
for (const name of ['sheet-layout.js', 'input-types.js']) {
  vm.runInContext(fs.readFileSync(path.join(here, name), 'utf8'), context, { filename: name })
}
const { toType, conditionTypes, toDays, toNeeds, toCookLeaderGrades, toPrepCleanupRule, toWishes, toWish, dayQuestions } = context
const { inputTypes, slotMinutes } = vm.runInContext('({ inputTypes, slotMinutes })', context)

const failed = []
const passed = []

function check(title, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed.push(title)
  else failed.push({ title, actual, expected })
}

/** 止まることを見る。止まらなければ null が返る。 */
function whyItStopped(work) {
  try {
    work()
    return null
  } catch (error) {
    return error.message
  }
}

/** 型の中に出てくる名前を全部集める（配列とオブジェクトを辿るだけである）。 */
function namesIn(value, found) {
  const names = found || []
  if (Array.isArray(value)) value.forEach((item) => namesIn(item, names))
  else if (value && typeof value === 'object') {
    Object.keys(value).forEach((name) => {
      if (names.indexOf(name) === -1) names.push(name)
      namesIn(value[name], names)
    })
  }
  return names
}

const oneDay = [['2025-11-01', '08:00', '10:00', '18:00', '18:00', '21:00']]

// ---- ① 型は 6 種類である ----------------------------------------------------

check(
  '① 型は 5-1 の 6 種類で、並びも 5-1 の表と同じである',
  inputTypes.map((type) => [type.number, type.name]),
  [
    [1, '枠'],
    [2, '役割と必要人数'],
    [3, '調理責任者の学年条件'],
    [4, '委員会の指定枠'],
    [5, '準備・片付けのルール'],
    [6, '希望'],
  ],
)

check(
  '① build の入口で行から直すのは条件入力の 5 区画である（型 #6 は規則 2 の畳み込みを通ってから）',
  conditionTypes().map((type) => type.source),
  ['日ごとの営業時刻', '役割と必要人数', '調理責任者の学年', '委員会の指定枠', '準備・片付けのルール'],
)

const wish = toWish([
  '2025-09-23 16:31:09', 'EED2349987', '高木琴音', '3年生', 'いいえ', 'ARH2348890',
  '8:00-21:00', '8:00-20:00', '8:00-22:00', '8:00-15:00',
], 0)

check(
  '① 6 種類とも、型の表の呼び方（行の配列を渡す）で直せる',
  inputTypes.map((type) => typeof type.build),
  ['function', 'function', 'function', 'function', 'function', 'function'],
)

check(
  '① 型 #6 に乗るのは、学籍番号・学年・調理可否・日ごとの回答文字列 4 つだけである（→ 5-1 の #6）',
  [wish.studentId, wish.grade, wish.canCook, wish.answers.length],
  ['EED2349987', '3年生', false, 4],
)

check(
  '① 日ごとの回答文字列は、フォームの設問 4 つである（→ 4-1 の #6〜#9）',
  wish.answers.map((answer) => answer.question),
  dayQuestions(),
)

check(
  '① 友達欄も氏名もタイムスタンプも、型のどこにも現れない（→ 5-2・5 の #1）',
  JSON.stringify(wish).includes('ARH2348890')
    || JSON.stringify(wish).includes('高木琴音')
    || JSON.stringify(wish).includes('16:31:09'),
  false,
)

const typedValues = [
  toDays(oneDay, '日ごとの営業時刻'),
  toNeeds([['', '', '', '調理', 2]], '役割と必要人数'),
  toCookLeaderGrades([['3年生'], ['4年生']], '調理責任者の学年'),
  toNeeds([['2025-11-02', '16:10', '17:00', 'クリーンパトロール', 3]], '委員会の指定枠'),
  toPrepCleanupRule([['午前と午後の境目', '12:00']], '準備・片付けのルール'),
  [wish],
]

check(
  '① 型に現れる名前が、6 種類が名乗っている名前の外に 1 つも出ない（→ 5 の #1）',
  typedValues.flatMap((value, i) => namesIn(value).filter((name) => inputTypes[i].fields.indexOf(name) === -1)),
  [],
)

// ---- ② 枠を刻む -------------------------------------------------------------

const days = toDays(oneDay, '日ごとの営業時刻')

check(
  '② 1 日ぶんの枠が、準備開始から片付け終了まで 30 分ずつ刻まれる',
  [days[0].slots.length, days[0].slots[0], days[0].slots[days[0].slots.length - 1]],
  [(21 - 8) * 60 / slotMinutes, { start: '08:00', end: '08:30' }, { start: '20:30', end: '21:00' }],
)

check(
  '② 片付けの帯にも枠が生える（片付け終了がその日の終わりである → ADR tech-requirements-0006）',
  days[0].slots.filter((slot) => slot.start >= '18:00').length,
  (21 - 18) * 60 / slotMinutes,
)

check(
  '② 枠は営業時刻をまたがない（時刻と時刻のあいだごとに刻む）',
  toDays([['2025-11-01', '08:00', '10:15', '18:00', '18:00', '20:00']], '日ごとの営業時刻')[0]
    .slots.filter((slot) => slot.start < '10:15' && slot.end > '10:15'),
  [],
)

check(
  '② 30 分に足りない端は枠にならない（規則を足していない → 3 の境界値の表）',
  toDays([['2025-11-01', '08:00', '08:20', '08:20', '08:20', '08:50']], '日ごとの営業時刻')[0].slots,
  [{ start: '08:20', end: '08:50' }],
)

check(
  '② 5 つの時刻は型に残る（どの枠が準備の帯かは、この 5 つでしか決まらない → 規則 3）',
  [days[0].prepStart, days[0].cookStart, days[0].cookEnd, days[0].cleanupStart, days[0].cleanupEnd],
  ['08:00', '10:00', '18:00', '18:00', '21:00'],
)

// ---- ② 役割と必要人数・学年・ルール -----------------------------------------

check(
  '② 日と時間帯を空けた行は、絞らない（全枠に効く → 5-1 の #2）',
  toNeeds([['', '', '', '調理', 2]], '役割と必要人数'),
  [{ date: '', start: '', end: '', role: '調理', count: 2 }],
)

check(
  '② 委員会の指定枠は #2 と同じ形で、役割名が #2 に無い名前でもよい（→ 5-1 の #4）',
  toNeeds([['2025-11-02', '16:10', '17:00', 'クリーンパトロール', 3]], '委員会の指定枠'),
  [{ date: '2025-11-02', start: '16:10', end: '17:00', role: 'クリーンパトロール', count: 3 }],
)

check(
  '② 学年は集合である（同じ学年が 2 行あっても 1 つ）',
  toCookLeaderGrades([['3年生'], ['4年生'], ['3年生']], '調理責任者の学年'),
  ['3年生', '4年生'],
)

check(
  '② 準備・片付けのルールは、いまは境目 1 つだけである（→ 5-1 の #5）',
  [
    toPrepCleanupRule([['午前と午後の境目', '12:00']], '準備・片付けのルール'),
    toPrepCleanupRule([], '準備・片付けのルール'),
  ],
  [{ noonBoundary: '12:00' }, { noonBoundary: '' }],
)

// ---- ③ 黙って直さずに止まる -------------------------------------------------

const stopped = {
  '時刻が HH:MM でない': whyItStopped(() => toDays([['2025-11-01', '8:00', '10:00', '18:00', '18:00', '21:00']], '日ごとの営業時刻')),
  '時刻が早い順でない': whyItStopped(() => toDays([['2025-11-01', '08:00', '10:00', '18:00', '21:00', '18:00']], '日ごとの営業時刻')),
  '同じ日が 2 行ある': whyItStopped(() => toDays(oneDay.concat(oneDay), '日ごとの営業時刻')),
  '人数が数でない': whyItStopped(() => toNeeds([['', '', '', '調理', '2 人']], '役割と必要人数')),
  '時間帯が片側しか無い': whyItStopped(() => toNeeds([['', '10:00', '', '調理', 2]], '役割と必要人数')),
  '終了が開始より後でない': whyItStopped(() => toNeeds([['', '10:00', '10:00', '調理', 2]], '役割と必要人数')),
  '学年が選択肢の外': whyItStopped(() => toCookLeaderGrades([['3年']], '調理責任者の学年')),
  '決めていない項目': whyItStopped(() => toPrepCleanupRule([['昼休み', '12:00']], '準備・片付けのルール')),
  '学籍番号の形式が違う': whyItStopped(() => toWish(['', 'EED234998', '高木琴音', '3年生', 'いいえ', '', '', '', '', ''], 0)),
  '調理担当ですか？ が選択肢の外': whyItStopped(() => toWish(['', 'EED2349987', '高木琴音', '3年生', 'はい？', '', '', '', '', ''], 0)),
}

check(
  '③ 揃っていない値は、どれも止まる',
  Object.keys(stopped).filter((what) => stopped[what] === null),
  [],
)

check(
  '③ 止まるときは、区画と行と列を名指しする',
  [
    stopped['時刻が HH:MM でない'],
    stopped['人数が数でない'],
  ],
  [
    '「日ごとの営業時刻」の 1 行目（シートの 3 行目）の「準備開始」が HH:MM でない。いま: 8:00',
    '「役割と必要人数」の 1 行目（シートの 3 行目）の「人数」が 1 以上の整数でない。いま: 2 人',
  ],
)

check(
  '③ 区画の途中の空の行は読み飛ばすが、行の番号は詰めない（→ shell.js の readSection）',
  [
    toNeeds([['', '', '', '', ''], ['', '', '', '調理', 2]], '役割と必要人数').length,
    whyItStopped(() => toNeeds([['', '', '', '', ''], ['', '', '', '調理', '2 人']], '役割と必要人数')),
  ],
  [1, '「役割と必要人数」の 2 行目（シートの 4 行目）の「人数」が 1 以上の整数でない。いま: 2 人'],
)

check(
  '③ 列がずれた行は、詰めずに名指しして止まる',
  whyItStopped(() => toNeeds([['', '', '調理', 2]], '役割と必要人数'))?.includes('列数が構成と違う'),
  true,
)

// ---- ④ data/ のモックが型に乗る（→ 7 の M1 ①・②） --------------------------

/** 引用符の中のコンマを割らないだけの CSV の読み。友達欄が引用符付きで入っている。 */
function readCsv(text) {
  return text.replace(/^﻿/, '').trim().split(/\r?\n/).map((line) => {
    const cells = []
    let cell = ''
    let quoted = false
    for (const character of line) {
      if (character === '"') quoted = !quoted
      else if (character === ',' && !quoted) { cells.push(cell); cell = '' }
      else cell += character
    }
    cells.push(cell)
    return cells
  })
}

const answerRows = readCsv(fs.readFileSync(path.join(dataDir, '前回の希望データ-モック.csv'), 'utf8'))
const answerHeader = answerRows[0]
const wishes = toType(inputTypes[5], answerRows.slice(1))

check(
  '④ 前回の希望データ（モック）の見出しが、回答シートの列と同じである',
  answerHeader,
  vm.runInContext('answerColumns()', context),
)

check(
  '④ 前回の希望データ 50 行が、1 行残らず型 #6 に乗った（→ 7 の M1 ②の足がかり）',
  [wishes.length, wishes.filter((one) => one.answers.length !== 4).length],
  [50, 0],
)

// 前回の 5 時刻は記録に無い。記録にあるのは、設問の説明文に書かれた営業時間 ◎ だけである（→ 4-2）。
// それを 1 本の帯として刻み、確定シフトの区間がその枠に乗るかだけを見る。
const lastYear = [
  ['2025-11-01', '08:00', '08:00', '08:00', '08:00', '21:00'],
  ['2025-11-02', '08:00', '08:00', '08:00', '08:00', '20:00'],
  ['2025-11-03', '08:00', '08:00', '08:00', '08:00', '20:00'],
  ['2025-11-04', '08:00', '08:00', '08:00', '08:00', '15:00'],
]
const lastYearDays = toType(inputTypes[0], lastYear)

/** 区間が、その日の 30 分枠に分かれるか（分かれなければ乗らなかった行である）。 */
function ridesOnSlots(assignment) {
  const day = lastYearDays.filter((one) => one.date === assignment.date)[0]
  if (!day) return false
  const inside = day.slots.filter((slot) => slot.start >= assignment.start && slot.end <= assignment.end)
  return inside.length > 0
    && inside[0].start === assignment.start
    && inside[inside.length - 1].end === assignment.end
}

const assignments = []
for (const name of ['01', '02', '03', '04']) {
  const shift = JSON.parse(fs.readFileSync(path.join(dataDir, `前回の確定シフト-モック-${name}.json`), 'utf8'))
  shift.results.forEach((person) => {
    person.assigned.forEach((one) => {
      assignments.push({ memberId: person.memberId, date: one.date, start: one.start, end: one.end, role: one.role })
    })
  })
}

check(
  '④ 前回の確定シフト 4 本の行数が、記録どおり 171 である（→ data/前回の確定シフト.md）',
  assignments.length,
  171,
)

const offTheType = assignments.filter((one) => !ridesOnSlots(one))

check(
  '④ 型に乗らなかった行は、30 分に乗らない クリーンパトロール 3 行だけである（→ 7 の「型に乗せるときに向きが要るのは 1 つだけ」）',
  offTheType.map((one) => `${one.date} ${one.start}-${one.end} ${one.role}`),
  ['2025-11-03 12:00-12:40 クリーンパトロール', '2025-11-03 12:00-12:40 クリーンパトロール', '2025-11-03 12:00-12:40 クリーンパトロール'],
)

check(
  '④ その 3 行も、指定枠と同じ向き（重なる枠を取る）なら 12:00 と 12:30 の 2 枠に乗る。M1 ① の「乗らなかった行」は 0 である',
  offTheType.filter((one) => {
    const day = lastYearDays.filter((candidate) => candidate.date === one.date)[0]
    const overlapping = day.slots.filter((slot) => slot.start < one.end && slot.end > one.start)
    return overlapping.length !== 2 || overlapping[0].start !== '12:00' || overlapping[1].start !== '12:30'
  }).length,
  0,
)

check(
  '④ 学籍番号は、確定シフト側も 10 桁の英数字である（識別キーが 2 つの記録をまたぐ → 7）',
  assignments.filter((one) => !/^[A-Za-z0-9]{10}$/.test(one.memberId)).length,
  0,
)

// ---- 結果 ------------------------------------------------------------------

console.log('入力の型の検査（src/input-types.js／スプレッドシート無し）')
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
