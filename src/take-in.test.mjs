#!/usr/bin/env node
// 取り込む側の検査 — src/take-in.js を、スプレッドシートを 1 つも作らずに走らせる。
//
//   使い方: node src/take-in.test.mjs
//
// 見るものは 5 つある。
//   ① 規則 2 の 3 つを踏む（学籍番号でまとめる／タイムスタンプで畳む／採るのは後から来た行）
//   ② モック CSV の 50 行が 39 件になり、学籍番号の重複が 0 である（→ 仕様 #4）
//   ③ 返るのは型 #6 だけである
//   ④ 1 行に決まらない行・揃っていない行は、名指しして止まる
//   ⑤ コアの段として繋がっていて、回答の行がそのまま下流へ流れない
//
// 採る向きが動いたら、ここの ① と src/take-in.js の foldDirection が一緒に動く。

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(here, '..', 'data')

// ---- 読み込む ---------------------------------------------------------------
// SpreadsheetApp は置かない。shell.js はモックを回答シートの表現に揃えるために読む（→ ②）。

const coreFiles = ['sheet-layout.js', 'input-types.js', 'core.js', 'count-violations.js', 'name-unmet.js', 'fairness-metrics.js', 'take-in.js', 'expand.js', 'generate.js']

function load(files) {
  const context = vm.createContext({})
  for (const name of files) {
    vm.runInContext(fs.readFileSync(path.join(here, name), 'utf8'), context, { filename: name })
  }
  return context
}

const context = load(coreFiles.concat(['shell.js']))
const { takeIn, build, builtInSteps, formatDateTime } = context
const { foldDirection, inputTypes, coreSteps } = vm.runInContext('({ foldDirection, inputTypes, coreSteps })', context)

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

// ---- 入力を組む -------------------------------------------------------------
// 回答シートの 1 行（タイムスタンプ ＋ 設問 9 つ）を、殻が揃えたあとの表現で置く。

function answerRow(at, studentId, answers, more) {
  const one = more || {}
  return [
    at,
    studentId,
    one.name === undefined ? '高木琴音' : one.name,
    one.grade === undefined ? '3年生' : one.grade,
    one.canCook === undefined ? 'いいえ' : one.canCook,
    one.friends === undefined ? '' : one.friends,
  ].concat(answers || ['8:00-21:00', '8:00-20:00', '8:00-20:00', '8:00-15:00'])
}

const early = '2025-10-20 21:50:43'
const later = '2025-10-25 15:50:56'
const latest = '2025-10-27 03:11:57'

const earlyAnswers = ['8:00-12:00', '8:00-12:00', '8:00-12:00', '8:00-12:00']
const laterAnswers = ['13:00-18:00', '13:00-18:00', '13:00-18:00', '13:00-18:00']

// ---- ① 規則 2 の 3 つ -------------------------------------------------------

check(
  '① 同じ学籍番号の 2 行が、1 件に畳まれる（① 学籍番号でまとめる）',
  takeIn([
    answerRow(early, 'LTR2569911', earlyAnswers),
    answerRow(later, 'LTR2569911', laterAnswers),
  ]).length,
  1,
)

check(
  '① 採るのは後から来た行である（③ → ADR design-doc-0006）',
  takeIn([
    answerRow(early, 'LTR2569911', earlyAnswers),
    answerRow(later, 'LTR2569911', laterAnswers),
  ])[0].answers,
  laterAnswers,
)

check(
  '① 行の並びが逆でも、採るのは後から来た行である（見るのはタイムスタンプであって、行の位置ではない）',
  takeIn([
    answerRow(later, 'LTR2569911', laterAnswers),
    answerRow(early, 'LTR2569911', earlyAnswers),
  ])[0].answers,
  laterAnswers,
)

check(
  '① 3 行あっても、残るのは最も新しい 1 行である',
  takeIn([
    answerRow(early, 'LTR2569911', earlyAnswers),
    answerRow(latest, 'LTR2569911', ['9:00-10:00', '9:00-10:00', '9:00-10:00', '9:00-10:00']),
    answerRow(later, 'LTR2569911', laterAnswers),
  ])[0].answers,
  ['9:00-10:00', '9:00-10:00', '9:00-10:00', '9:00-10:00'],
)

check(
  '① 学年と調理可否も、採った行のものである（列ごとに混ぜない）',
  takeIn([
    answerRow(early, 'LTR2569911', earlyAnswers, { grade: '1年生', canCook: 'いいえ' }),
    answerRow(later, 'LTR2569911', laterAnswers, { grade: '2年生', canCook: 'はい' }),
  ]).map((wish) => [wish.grade, wish.canCook]),
  [['2年生', true]],
)

check(
  '① 大文字・小文字だけ違う学籍番号は、同じ人として 1 件に畳まれる（大文字・小文字に意味は無い ◎）',
  takeIn([
    answerRow(early, 'LTR2569911', earlyAnswers),
    answerRow(later, 'ltr2569911', laterAnswers),
  ]).length,
  1,
)

check(
  '① 畳んだ 1 件の学籍番号は大文字である（識別キーの形は 1 つである → 3 の規則 2 の ①）',
  takeIn([
    answerRow(early, 'ltr2569911', earlyAnswers),
    answerRow(later, 'Ltr2569911', laterAnswers),
  ]).map((wish) => [wish.studentId, wish.answers]),
  [['LTR2569911', laterAnswers]],
)

check(
  '① 学籍番号が違えば、タイムスタンプが同じでも畳まない（まとめるのは学籍番号である）',
  takeIn([
    answerRow(early, 'LTR2569911', earlyAnswers),
    answerRow(early, 'CSB2272037', laterAnswers, { name: '石井結衣' }),
  ]).map((wish) => wish.studentId),
  ['LTR2569911', 'CSB2272037'],
)

check(
  '① 採る向きが、名前で置いてある（向きが動いたらここが動く）',
  [foldDirection.key, foldDirection.label],
  ['latest', '後から来た行を採る'],
)

// ---- ② 前回の希望データのモックで通る（→ 仕様 #4・7 の件数の表） -------------

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

// 貼るとタイムスタンプは日時になるので、殻の formatDateTime で揃えてから食わせる。
function asSheetRow(row) {
  const [year, month, day] = row[0].split(' ')[0].split('/').map(Number)
  const [hour, minute, second] = row[0].split(' ')[1].split(':').map(Number)
  return [formatDateTime(new Date(year, month - 1, day, hour, minute, second))].concat(row.slice(1))
}

const mockRows = readCsv(fs.readFileSync(path.join(dataDir, '前回の希望データ-モック.csv'), 'utf8'))
  .slice(1)
  .map(asSheetRow)
const mockWishes = takeIn(mockRows)
const mockIds = mockWishes.map((wish) => wish.studentId)

check(
  '② 前回の希望データ（モック）全 50 行 ◎ が、実人数 39 人 ◎ の 39 件になった（→ 仕様 #4）',
  [mockRows.length, mockWishes.length],
  [50, 39],
)

check(
  '② 学籍番号の重複が 0 である（→ 仕様 #4・M1 ②）',
  mockIds.length - new Set(mockIds).size,
  0,
)

check(
  '② 畳まれたのは、出し直し 11 行 ◎ である',
  mockRows.length - mockWishes.length,
  11,
)

// 採った行が、その人の最も新しい行かをモックの側から数え直す（③ の向きを実データで見る）。
const latestByHand = {}
mockRows.forEach((row) => {
  if (!latestByHand[row[1]] || row[0] > latestByHand[row[1]][0]) latestByHand[row[1]] = row
})

check(
  '② 39 件とも、その人の行のうち最も新しい 1 行の中身である（日ごとの回答文字列 4 つで突き合わせる）',
  mockWishes.filter((wish) => (
    JSON.stringify(wish.answers) !== JSON.stringify(latestByHand[wish.studentId].slice(6, 10))
  )),
  [],
)

check(
  '② 出し直した 11 人は、いま入っている中身が古いほうの行と違う（畳み方が結果を変えている）',
  (() => {
    const rowsById = {}
    mockRows.forEach((row) => { (rowsById[row[1]] = rowsById[row[1]] || []).push(row) })
    const resubmitted = Object.keys(rowsById).filter((id) => rowsById[id].length > 1)
    const oldest = resubmitted.filter((id) => {
      const wish = mockWishes.filter((one) => one.studentId === id)[0]
      const old = rowsById[id].slice().sort((a, b) => (a[0] < b[0] ? -1 : 1))[0]
      return JSON.stringify(wish.answers) === JSON.stringify(old.slice(6, 10))
    })
    return [resubmitted.length, oldest]
  })(),
  [11, []],
)

check(
  '② SpreadsheetApp を 1 度も掴んでいない（→ 6 の #8）',
  fs.readFileSync(path.join(here, 'take-in.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .includes('SpreadsheetApp'),
  false,
)

// ---- ③ 返るのは型 #6 だけである ---------------------------------------------

check(
  '③ 返る 1 件が持つ名前は、型 #6 の 4 つだけである（タイムスタンプも氏名も友達欄も乗らない → 5-1 の #6・5-2）',
  Object.keys(mockWishes[0]),
  inputTypes[5].fields,
)

check(
  '③ 人の並びは、その人が最初に現れた行の順である（採った行の位置で並べ直さない）',
  mockIds,
  (() => {
    const seen = []
    mockRows.forEach((row) => { if (seen.indexOf(row[1]) === -1) seen.push(row[1]) })
    return seen
  })(),
)

check(
  '③ 1 行も無ければ、1 件も返らない（フォームを配る前の回答シートである）',
  takeIn([]),
  [],
)

check(
  '③ 途中の空の行は読み飛ばす（→ input-types.js の eachFilledRow）',
  takeIn([
    answerRow(early, 'LTR2569911', earlyAnswers),
    new Array(10).fill(''),
    answerRow(later, 'CSB2272037', laterAnswers),
  ]).map((wish) => wish.studentId),
  ['LTR2569911', 'CSB2272037'],
)

// ---- ④ 決まらない行・揃っていない行で止まる ---------------------------------

check(
  '④ 同じ人・同じタイムスタンプの 2 行は、黙って選ばずに止まる（キーで 1 行に決まらない）',
  whyItStopped(() => takeIn([
    answerRow(early, 'LTR2569911', earlyAnswers),
    answerRow(early, 'LTR2569911', laterAnswers),
  ]))?.includes('同じタイムスタンプ'),
  true,
)

check(
  '④ タイムスタンプが空の行で止まる（畳み込みのキーが無いまま畳まない）',
  whyItStopped(() => takeIn([answerRow('', 'LTR2569911', earlyAnswers)]))
    ?.includes('YYYY-MM-DD HH:MM:SS でない'),
  true,
)

check(
  '④ タイムスタンプの表現が揃っていない行で止まる（黙って解釈し直さない）',
  whyItStopped(() => takeIn([answerRow('2025/10/20 21:50:43', 'LTR2569911', earlyAnswers)]))
    ?.includes('「回答」の 1 行目（シートの 2 行目）の「タイムスタンプ」'),
  true,
)

check(
  '④ 畳んで落ちるほうの行が型に乗らなくても止まる（落ちる側も黙って通さない）',
  whyItStopped(() => takeIn([
    answerRow(early, 'LTR2569911', earlyAnswers, { grade: '5年生' }),
    answerRow(later, 'LTR2569911', laterAnswers),
  ]))?.includes('学年「5年生」が選択肢の外である'),
  true,
)

check(
  '④ 列数が構成と違う行で止まる（隣の列を別の項目として読まない）',
  whyItStopped(() => takeIn([answerRow(early, 'LTR2569911', earlyAnswers).slice(0, 9)]))
    ?.includes('列数が構成と違う'),
  true,
)

// ---- ⑤ コアの段として繋がっている -------------------------------------------

/** 骨組みを回すのに足りるだけの入力。値は data/ の転記元と同じ表現で置く（→ core.test.mjs）。 */
function skeletonInputs(answers) {
  return {
    '日ごとの営業時刻': [['2025-11-01', '08:00', '10:00', '18:00', '18:00', '20:00']],
    '役割と必要人数': [['', '', '', '調理', 2]],
    '調理責任者の学年': [[3], [4]],
    '委員会の指定枠': [],
    '準備・片付けのルール': [['午前と午後の境目', '12:00']],
    '置き方のルール': [],
    '回答': answers,
    '割り当て': [],
    '手直し': [],
  }
}

check(
  '⑤ 「取り込む」が、中身の入っている段になった（未了に出ない → core.js の builtInSteps）',
  [
    Object.keys(builtInSteps()).indexOf('取り込む') !== -1,
    build(skeletonInputs([])).notBuilt.map((step) => step.name).indexOf('取り込む'),
  ],
  [true, -1],
)

// 展開する段に渡るのは、畳んだあとの型 #6 である。
let receivedByExpand = null
build(skeletonInputs([
  answerRow(early, 'LTR2569911', earlyAnswers),
  answerRow(later, 'LTR2569911', laterAnswers),
]), {
  '展開する': (wishes) => { receivedByExpand = wishes; return [] },
})

check(
  '⑤ 下流へ渡るのは、畳んだあとの型 #6 である（回答の行がそのまま流れない）',
  receivedByExpand,
  [{ studentId: 'LTR2569911', grade: '3年生', canCook: false, answers: laterAnswers }],
)

check(
  '⑤ take-in.js を貼り忘れると、段を「まだ作っていない」に混ぜずに名指しして止まる',
  whyItStopped(() => load(coreFiles.filter((name) => name !== 'take-in.js')).builtInSteps())
    ?.includes('take-in.js が貼られていない'),
  true,
)

check(
  '⑤ 段の表は、この段の issue を 146 として持っている（→ 8 の 6）',
  coreSteps.filter((step) => step.name === '取り込む').map((step) => step.issue),
  [146],
)

// ---- 結果 ------------------------------------------------------------------

console.log('取り込む側の検査（src/take-in.js／スプレッドシート無し）')
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
