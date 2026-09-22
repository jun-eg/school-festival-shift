#!/usr/bin/env node
// 入力の型の検査 — src/input-types.js を、スプレッドシートを 1 つも作らずに走らせる。
//
//   使い方: node src/input-types.test.mjs
//
// 見るものは 4 つある。
//   ① 型は 5-1 の 7 種類だけで、その外の名前が型に現れない（→ 5 の #1）
//   ② 枠が営業時刻から刻まれ、30 分に足りない端は枠にならない
//   ③ 揃っていない値は、区画・行・列を名指しして止まる
//   ④ data/ の希望データのモックが型 #6 に乗る
//   ⑤ 条件入力の初期値（→ sheet-layout.js の initialRows）が 6 区画の型に乗る（→ issue #240）
//
// 確定シフトのモックが型に乗るかは scripts/M1①の判定.mjs が数える。

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(here, '..', 'data')

// ---- 読み込む ---------------------------------------------------------------
// SpreadsheetApp を文脈に置かない。置かずに通ることを見ている。

const context = vm.createContext({})
for (const name of ['sheet-layout.js', 'input-types.js']) {
  vm.runInContext(fs.readFileSync(path.join(here, name), 'utf8'), context, { filename: name })
}
const { toType, conditionTypes, toDays, toNeeds, toCookLeaderGrades, toPrepCleanupRule, toPlacementRule, toWishes, toWish, dayAnswerColumns } = context
const { inputTypes, slotMinutes, defaultMinRun } = vm.runInContext('({ inputTypes, slotMinutes, defaultMinRun })', context)

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

/** 型の中に出てくる名前を全部集める。 */
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

// ---- ① 型は 7 種類である ----------------------------------------------------

check(
  '① 型は 5-1 の 7 種類で、並びも 5-1 の表と同じである',
  inputTypes.map((type) => [type.number, type.name]),
  [
    [1, '枠'],
    [2, '役割と必要人数'],
    [3, '調理責任者の学年条件'],
    [4, '委員会の指定枠'],
    [5, '準備・片付けのルール'],
    [6, '希望'],
    [7, '置き方のルール'],
  ],
)

check(
  '① build の入口で行から直すのは条件入力の 6 区画である（型 #6 は規則 2 の畳み込みを通ってから）',
  conditionTypes().map((type) => type.source),
  ['日ごとの営業時刻', '役割と必要人数', '調理責任者の学年', '委員会の指定枠', '準備・片付けのルール', '置き方のルール'],
)

const wish = toWish([
  '2025-09-23 16:31:09', 'EED2349987', '高木琴音', '3年生', 'いいえ', 'ARH2348890',
  '8:00-21:00', '8:00-20:00', '8:00-22:00', '8:00-15:00',
], 0)

check(
  '① 7 種類とも、型の表の呼び方（行の配列を渡す）で直せる',
  inputTypes.map((type) => typeof type.build),
  ['function', 'function', 'function', 'function', 'function', 'function', 'function'],
)

check(
  '① 型 #6 に乗るのは、学籍番号・学年・調理可否・日ごとの回答文字列 4 つだけである（→ 5-1 の #6）',
  [wish.studentId, wish.grade, wish.canCook, wish.answers.length],
  ['EED2349987', '3年生', false, 4],
)

check(
  '① 学籍番号は大文字で型に乗る（大文字・小文字に意味は無い ◎ → 3 の規則 2 の ①）',
  toWish([
    '2025-09-23 16:31:09', 'eed2349987', '高木琴音', '3年生', 'いいえ', 'arh2348890',
    '8:00-21:00', '8:00-20:00', '8:00-22:00', '8:00-15:00',
  ], 0).studentId,
  'EED2349987',
)

check(
  '① 日ごとの回答文字列は、後ろ 4 列を位置で取った並びである（列名は見ない → 4-1・5-1 の #6）',
  [dayAnswerColumns(), wish.answers],
  [[6, 7, 8, 9], ['8:00-21:00', '8:00-20:00', '8:00-22:00', '8:00-15:00']],
)

// 名前で当てる 6 列が wishColumns と columnsOutsideWish でちょうど埋まるか。動けば後ろ 4 列の位置もずれる。
check(
  '① 名前で当てる 6 列が、型に乗る 3 つと乗らない 3 つでちょうど埋まる（残りが位置の側である）',
  vm.runInContext(
    'answerSection().columns.filter((name) => '
      + 'columnsOutsideWish.indexOf(name) === -1 '
      + '&& Object.keys(wishColumns).map((key) => wishColumns[key]).indexOf(name) === -1)',
    context,
  ),
  [],
)

// 列名が毎年変わっても、型に乗る中身は位置で決まる（→ 4-1）。
check(
  '① 見出しが今年の題に変わっても、同じ位置の値が同じ順で型に乗る',
  toWish([
    '2026-10-30 16:31:09', 'EED2349987', '高木琴音', '3年生', 'いいえ', 'ARH2348890',
    '9:00-22:00', '9:30-19:00', '9:30-19:30', '10:00-16:00',
  ], 0).answers,
  ['9:00-22:00', '9:30-19:00', '9:30-19:30', '10:00-16:00'],
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
  toCookLeaderGrades([[3], [4]], '調理責任者の学年'),
  toNeeds([['2025-11-02', '16:10', '17:00', 'クリーンパトロール', 3]], '委員会の指定枠'),
  toPrepCleanupRule([['午前と午後の境目', '12:00']], '準備・片付けのルール'),
  [wish],
  toPlacementRule([['連続して入る最小の長さ', '1:00']], '置き方のルール'),
]

check(
  '① 型に現れる名前が、7 種類が名乗っている名前の外に 1 つも出ない（→ 5 の #1）',
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
  '② 空の欄はそのまま型に乗る（枠に当てる読みは数える側が持つ → name-unmet.js の needCovers）',
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
  toCookLeaderGrades([[3], [4], ['3']], '調理責任者の学年'),
  ['3年生', '4年生'],
)

// 条件入力には数字だけで書き、型は回答と同じ選択肢の形で持つ（→ issue #237）。
check(
  '② 調理責任者の学年は数字で書き、フォームの選択肢の形で型に乗る',
  toCookLeaderGrades([[1], ['2'], [3], ['4']], '調理責任者の学年'),
  ['1年生', '2年生', '3年生', '4年生'],
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
  '学年が選択肢の外': whyItStopped(() => toCookLeaderGrades([[5]], '調理責任者の学年')),
  '学年が数字でない': whyItStopped(() => toCookLeaderGrades([['3年生']], '調理責任者の学年')),
  '決めていない項目': whyItStopped(() => toPrepCleanupRule([['昼休み', '12:00']], '準備・片付けのルール')),
  'まとまりの長さが 30 分の倍数でない': whyItStopped(() => toPlacementRule([['連続して入る最小の長さ', '1:20']], '置き方のルール')),
  'まとまりの長さが 時:分 でない': whyItStopped(() => toPlacementRule([['連続して入る最小の長さ', '60']], '置き方のルール')),
  '置き方のルールに決めていない項目': whyItStopped(() => toPlacementRule([['1 日の上限', '8:00']], '置き方のルール')),
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
    stopped['学年が数字でない'],
  ],
  [
    '「日ごとの営業時刻」の 1 行目（シートの 3 行目）の「準備開始」が HH:MM でない。いま: 8:00',
    '「役割と必要人数」の 1 行目（シートの 3 行目）の「人数」が 1 以上の整数でない。いま: 2 人',
    '「調理責任者の学年」の 1 行目（シートの 3 行目）の「3年生」が学年の数字でない（1 / 2 / 3 / 4 のどれか）',
  ],
)

check(
  '③ 置き方のルールは、空なら既定の 1 時間で型に乗り、書けばその値で乗る（→ 5-1 の #7）',
  [
    toPlacementRule([], '置き方のルール'),
    toPlacementRule([['連続して入る最小の長さ', defaultMinRun]], '置き方のルール'),
    toPlacementRule([['連続して入る最小の長さ', '2:00']], '置き方のルール'),
    toPlacementRule([['連続して入る最小の長さ', '0:30']], '置き方のルール'),
  ],
  [{ minRun: 60 }, { minRun: 60 }, { minRun: 120 }, { minRun: 30 }],
)

check(
  '③ 30 分の倍数でない長さは、切り上げも切り捨てもせずに名指しして止まる（→ 規則 1 の ①）',
  stopped['まとまりの長さが 30 分の倍数でない'],
  '「置き方のルール」の 1 行目（シートの 3 行目）の「値」の「1:20」が 30 分の倍数でない',
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

// ---- ④ data/ の希望データのモックが型に乗る（→ 7 の M1 ②の足がかり） --------

/** 引用符の中のコンマを割らないだけの CSV の読み（友達欄が引用符付き）。 */
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
  '④ 前回の希望データ（モック）の見出しが、構成の並びと当たる（名前で見るのは前の 6 列だけである）',
  [answerHeader.length, answerHeader.slice(0, 6)],
  [
    vm.runInContext('sectionWidth(answerSection())', context),
    vm.runInContext('answerSection().columns', context),
  ],
)

check(
  '④ 前回の希望データ 50 行が、1 行残らず型 #6 に乗った（→ 7 の M1 ②の足がかり）',
  [wishes.length, wishes.filter((one) => one.answers.length !== 4).length],
  [50, 0],
)

// ---- ⑤ 条件入力の初期値が型に乗る（→ issue #240） -----------------------------
// テンプレートに置いた値のまま「生成」を押しても、型の段で止まらないこと。
// 型の読み方が動いたのに初期値を直し忘れると、ここで落ちる。

const initialConditions = conditionTypes().map((type) => {
  const section = vm.runInContext(`conditionSection(${JSON.stringify(type.source)})`, context)
  return [type.source, whyItStopped(() => toType(type, section.initialRows)) ?? '型に乗った']
})

check(
  '⑤ 条件入力の 6 区画とも、初期値が 1 行残らず型に乗る',
  initialConditions,
  conditionTypes().map((type) => [type.source, '型に乗った']),
)

check(
  '⑤ 初期値の枠は 4 日で、日付はラベル 4 つと 1 対 1 に当たる数である（→ 5-1 の #1）',
  vm.runInContext('toType(inputTypes[0], conditionSection("日ごとの営業時刻").initialRows).length', context),
  vm.runInContext('dayLabels.length', context),
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
