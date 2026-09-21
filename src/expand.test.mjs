#!/usr/bin/env node
// 展開する側の検査 — src/expand.js を、スプレッドシートを 1 つも作らずに走らせる。
//
//   使い方: node src/expand.test.mjs
//
// 見るものは 6 つある（issue #149 と、その境界値の側の #150）。
//   ① 規則 1 の順序を踏む（刻んだ枠を受ける／`,` で区切る／完全に含まれる枠だけ／和集合）
//   ② 3 の「境界値と特別扱い」の 4 つが、そのとおりに出る（規則を足していない）
//   ③ data/前回の希望データ-モック.csv の 39 人が、記録どおりの件数で展開される（→ 7）
//   ④ 出るのは候補であって割り当てではない（役割が付いていない → 仕様 #5）
//   ⑤ 決まらない入力は、黙って通さずに名指しして止まる
//   ⑥ コアの段として繋がっていて、貼り忘れが名指しで止まる
//
// どう扱うかを決めたのは上流である（→ docs/tech-requirements.md 3 の規則 1・境界値と特別扱い）。
// 扱いが動いたら、ここと src/expand.js の wishBoundaries が一緒に動く。
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
// shell.js を読むのは、モックの CSV を回答シートに貼ったときの表現に揃えるためである（→ ③）。

const coreFiles = ['sheet-layout.js', 'input-types.js', 'core.js', 'count-violations.js', 'name-unmet.js', 'take-in.js', 'expand.js', 'generate.js']

function load(files) {
  const context = vm.createContext({})
  for (const name of files) {
    vm.runInContext(fs.readFileSync(path.join(here, name), 'utf8'), context, { filename: name })
  }
  return context
}

// form-definition.js を読むのは、4-2 の正規表現そのものと突き合わせるためである（→ ②）。
const context = load(coreFiles.concat(['form-definition.js', 'shell.js']))
const { expand, toDays, takeIn, build, builtInSteps, formatDateTime } = context
const { wishBoundaries, coreSteps, slotMinutes, wishTimePattern } = vm.runInContext('({ wishBoundaries, coreSteps, slotMinutes, wishTimePattern })', context)

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
// 枠（型 #1）は刻み直さない。条件入力の行を型に通して、出てきた枠をそのまま食わせる。

/** 日ごとの営業時刻の行を、型 #1（枠）にする（→ input-types.js の toDays）。 */
function daysOf(rows) {
  return toDays(rows, '日ごとの営業時刻')
}

/** ふつうの 1 日。08:00-10:00 が準備、10:00-18:00 が調理、18:00-20:00 が片付けの帯である。 */
const plainDay = ['2025-11-01', '08:00', '10:00', '18:00', '18:00', '20:00']

/** 営業時刻が 30 分に乗らない日。枠は時刻をまたがず、30 分に足りない端は枠にならない（→ 5-1 の #1）。 */
const raggedDay = ['2025-11-02', '08:00', '09:15', '12:00', '13:00', '14:00']

/** 希望 1 件（型 #6）。日ごとの回答文字列は、渡した日数と同じ数だけ並べる（→ 4-1）。 */
function wishOf(answers, more) {
  const one = more || {}
  return {
    studentId: one.studentId === undefined ? 'LTR2569911' : one.studentId,
    grade: one.grade === undefined ? '3年生' : one.grade,
    canCook: one.canCook === undefined ? false : one.canCook,
    answers: answers,
  }
}

/** 1 人・1 日ぶんを展開して、枠を `HH:MM-HH:MM` の並びにする。 */
function slotsOf(answer, dayRow) {
  return expand([wishOf([answer])], daysOf([dayRow || plainDay]))[0].slots
    .map((slot) => `${slot.start}-${slot.end}`)
}

// ---- ① 規則 1 の順序 --------------------------------------------------------

check(
  '① 刻むのは型 #1 のほうである（受け取った枠の列から選ぶだけで、枠を作り直さない）',
  [daysOf([plainDay])[0].slots.length, slotMinutes],
  [24, 30],
)

check(
  '① 区間に完全に含まれる枠だけを取る（③）',
  slotsOf('10:00-12:00'),
  ['10:00-10:30', '10:30-11:00', '11:00-11:30', '11:30-12:00'],
)

check(
  '① `,` で区切って区間に分け（②）、複数区間は和集合を取る（④）',
  slotsOf('10:00-12:00,13:00-15:00'),
  [
    '10:00-10:30', '10:30-11:00', '11:00-11:30', '11:30-12:00',
    '13:00-13:30', '13:30-14:00', '14:00-14:30', '14:30-15:00',
  ],
)

check(
  '① 区間のあいだ（12:00-13:00）は候補に入らない（和集合であって、端から端までではない）',
  slotsOf('10:00-12:00,13:00-15:00').filter((slot) => slot >= '12:00' && slot < '13:00'),
  [],
)

check(
  '① 重なる 2 区間は、同じ枠を 2 度返さない（④ は和集合である）',
  slotsOf('10:00-12:00,11:00-13:00'),
  [
    '10:00-10:30', '10:30-11:00', '11:00-11:30', '11:30-12:00',
    '12:00-12:30', '12:30-13:00',
  ],
)

check(
  '① 区間が後ろから書かれていても、返る枠はその日の枠の並びである（書かれた順で並べ直さない）',
  slotsOf('13:00-15:00,10:00-12:00'),
  slotsOf('10:00-12:00,13:00-15:00'),
)

check(
  '① 枠は営業時刻をまたがない（30 分に足りない端は枠にならない → 5-1 の #1）',
  slotsOf('08:00-12:00', raggedDay),
  ['08:00-08:30', '08:30-09:00', '09:15-09:45', '09:45-10:15', '10:15-10:45', '10:45-11:15', '11:15-11:45'],
)

// ---- ② 境界値と特別扱い（→ 3 の表） ----------------------------------------

check(
  '② 扱いを決めた 4 つが、名前で置いてある（どれも隠れたまま効かない）',
  wishBoundaries.map((one) => one.key),
  ['allDayOff', 'outsideBusinessHours', 'halfCoveredSlot', 'endNotAfterStart'],
)

check(
  '② `00:00-00:00` は候補が空集合である（時刻として展開しない ◎ → 4-2 の例3）',
  slotsOf('00:00-00:00'),
  [],
)

check(
  '② `00:00-00:00` でも、その人のその日の件は返る（日が消えるのではない）',
  expand([wishOf(['00:00-00:00'])], daysOf([plainDay])).map((one) => [one.studentId, one.date, one.slots.length]),
  [['LTR2569911', '2025-11-01', 0]],
)

check(
  '② 時の先頭の 0 が無い `0:00-0:00` も、同じ合図として落ちる（4-2 の正規表現は両方通す）',
  slotsOf('0:00-0:00'),
  [],
)

check(
  '② 営業時間の外へ伸びた区間は、外側だけが落ちる（弾かない → 規則を足さない）',
  slotsOf('06:00-22:00').length === 24 ? '全枠' : slotsOf('06:00-22:00'),
  '全枠',
)

check(
  '② 区間の端に半分だけかかる枠は、候補に入らない（③ が「完全に含まれる枠だけ」である）',
  [slotsOf('10:00-10:15'), slotsOf('10:15-11:45')],
  [[], ['10:30-11:00', '11:00-11:30']],
)

const endNotAfterStart = whyItStopped(() => slotsOf('15:00-00:00'))

check(
  '② 終端 ≤ 始端の区間は、候補を作らずに名指しして止まる（黙って解釈しない）',
  [
    endNotAfterStart !== null,
    endNotAfterStart?.includes('LTR2569911'),
    endNotAfterStart?.includes('2025-11-01'),
    endNotAfterStart?.includes('15:00-00:00'),
  ],
  [true, true, true, true],
)

check(
  '② 始端と終端が同じ区間も、区間にならないので止まる（`00:00-00:00` だけが特別扱いである）',
  whyItStopped(() => slotsOf('10:00-10:00'))?.includes('終端'),
  true,
)

// 4-2 の正規表現（フォームが通した形そのもの）と、ここが区間として通す形が一致しているかを見る。
// 写し間違いがあると、フォームを通った回答がシートの上で通らなくなる（→ expand.js の wishIntervalPattern）。
const wishTimeRegExp = new RegExp(wishTimePattern)

const samples = [
  '8:00-9:00', '08:00-09:00', '0:00-0:00', '1:05-2:10', '23:00-23:59', '23:59-23:59',
  '10:00-12:00,13:00-15:00', '10:00-12:00,13:00-15:00,16:00-17:00', '00:00-00:00',
  '', ' 8:00-9:00', '24:00-25:00', '10:0-11:00', '10:00-10:60', '9:5-10:00',
  '10:00-12:00,', '10:00〜12:00', '10:00-12:00 ', '1000-1200',
]

/** その回答が、形が違うとして止まったか。区間として通ったあとの止まり方（終端 ≤ 始端）と分けて見る。 */
function stoppedOnFormat(answer) {
  const why = whyItStopped(() => slotsOf(answer))
  return why !== null && why.includes('HH:MM-HH:MM でない')
}

check(
  '② 4-2 の正規表現を通る形と、区間として通る形が一致している（写し間違いが無い）',
  samples.filter((answer) => wishTimeRegExp.test(answer) === stoppedOnFormat(answer)),
  [],
)

// 時は 0-23、分は 00-59 まで通る（→ 4-2）ので、`:00` と `:30` に乗らない入力も来る。
// 前回の回答が `:00` と `:30` だけだったことを、規則の根拠にしない（→ 3 の境界値の表）。
const sweep = []
for (let hour = 0; hour <= 23; hour++) {
  ['00', '05', '30', '59'].forEach((minute) => {
    sweep.push(`${hour}:${minute}-${hour + 1 > 23 ? 23 : hour + 1}:${minute}`)
    sweep.push(`${hour}:${minute}-${hour}:${minute}`)
  })
}

check(
  '② 正規表現を通る入力は、どれも候補（空集合を含む）か名指しのどちらかになる（黙って落ちない）',
  sweep.filter((answer) => {
    if (!wishTimeRegExp.test(answer)) return true
    try {
      return !Array.isArray(slotsOf(answer))
    } catch (error) {
      return !String(error.message).includes('LTR2569911')
    }
  }),
  [],
)

// ---- ③ 前回の希望データのモックで通る（→ 7「判定に使う入力データ」） --------

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

// モックを回答シートに貼ると、タイムスタンプのセルは日時になる（→ take-in.test.mjs の同じ手）。
function asSheetRow(row) {
  const [year, month, day] = row[0].split(' ')[0].split('/').map(Number)
  const [hour, minute, second] = row[0].split(' ')[1].split(':').map(Number)
  return [formatDateTime(new Date(year, month - 1, day, hour, minute, second))].concat(row.slice(1))
}

const mockWishes = takeIn(
  readCsv(fs.readFileSync(path.join(dataDir, '前回の希望データ-モック.csv'), 'utf8')).slice(1).map(asSheetRow),
)

// 前回の 5 時刻は、入力の行としては記録に無い。設問の説明文の営業時間 ◎（→ 4-2）から、
// 始まりの 4 つを営業開始に、片付け終了を営業終了に置き、1 日を 1 本の帯として刻む
// （→ 7 の「前回の 5 時刻の置き方」の M1 ①・フォームの側・scripts/M1①の宣言.json と同じ置き方である）。
// M2 の側は別の置き方である（確定シフトの行から算出する → scripts/前回の5時刻.mjs）。
// ここが見るのは候補の枠の数で、帯の内訳ではないので、こちらのままでよい。
const lastYearDays = daysOf([
  ['2025-11-01', '08:00', '08:00', '08:00', '08:00', '21:00'],
  ['2025-11-02', '08:00', '08:00', '08:00', '08:00', '20:00'],
  ['2025-11-03', '08:00', '08:00', '08:00', '08:00', '20:00'],
  ['2025-11-04', '08:00', '08:00', '08:00', '08:00', '15:00'],
])

check(
  '③ 前回の営業時間 ◎ を 1 本の帯として刻むと、4 日で 26 / 24 / 24 / 14 枠になる',
  lastYearDays.map((day) => day.slots.length),
  [26, 24, 24, 14],
)

// 終端 ≤ 始端の区間を持つ人は、そこで止まる（→ ② と同じ扱い）。
// 記録にあるのは 50 行で 5 件、畳んだあとの 39 人では 3 人である（→ 7・scripts/件数の期待値.json）。
const stoppedPeople = mockWishes.filter((wish) => whyItStopped(() => expand([wish], lastYearDays)) !== null)

check(
  '③ 畳んだ 39 人のうち、終端 ≤ 始端の区間を書いた 3 人で止まる（残りは止まらない）',
  [mockWishes.length, stoppedPeople.length, stoppedPeople.map((wish) => wish.studentId)],
  [39, 3, ['EEE2659176', 'CSC2606801', 'ECK2647386']],
)

const expandable = mockWishes.filter((wish) => stoppedPeople.indexOf(wish) === -1)
const mockCandidates = expand(expandable, lastYearDays)
const emptyOnes = mockCandidates.filter((one) => one.slots.length === 0)

check(
  '③ 残る 36 人 × 4 日 = 144 件が返り、候補が 0 枠なのは 58 件である（`00:00-00:00` が最頻値である ◎）',
  [expandable.length, mockCandidates.length, emptyOnes.length],
  [36, 144, 58],
)

check(
  '③ 候補の枠は、のべ 1191 枠である（同じ入力から同じ数が返る → 6 の #3 の理由 ③）',
  mockCandidates.reduce((sum, one) => sum + one.slots.length, 0),
  1191,
)

/** モックの 1 人・1 日ぶんを引く。 */
function mockOne(studentId, date) {
  return mockCandidates.filter((one) => one.studentId === studentId && one.date === date)[0]
}

check(
  '③ 営業時間の外へ伸びた区間（`10:00-21:00` ／ その日は 20:00 まで ◎）は、外側だけが落ちる',
  [
    mockOne('EED2655876', '2025-11-02').slots.length,
    mockOne('EED2655876', '2025-11-02').slots.slice(-1)[0],
  ],
  [20, { start: '19:30', end: '20:00' }],
)

check(
  '③ 複数区間（`8:00-10:00,16:00-20:00`）は和集合になり、あいだの 10:00-16:00 は入らない',
  [
    mockOne('BAM2363060', '2025-11-02').slots.length,
    mockOne('BAM2363060', '2025-11-02').slots.filter((slot) => slot.start >= '10:00' && slot.start < '16:00'),
  ],
  [12, []],
)

// ---- ④ 出るのは候補であって、割り当てではない（→ 仕様 #5） ------------------

check(
  '④ 返る 1 件が持つのは 学籍番号・日付・枠だけである（役割が付いていない → 仕様 #5）',
  Object.keys(expand([wishOf(['10:00-12:00'])], daysOf([plainDay]))[0]),
  ['studentId', 'date', 'slots'],
)

check(
  '④ 枠が持つのは 始端・終端だけである（人数も役割も持たない）',
  Object.keys(expand([wishOf(['10:00-12:00'])], daysOf([plainDay]))[0].slots[0]),
  ['start', 'end'],
)

check(
  '④ 学年も調理可否も、候補には乗らない（規則 4・5 を見るのは数える側である → 5-4）',
  JSON.stringify(expand([wishOf(['10:00-12:00'], { grade: '4年生', canCook: true })], daysOf([plainDay])))
    .includes('4年生'),
  false,
)

check(
  '④ 1 人 1 日に 1 件である（人の並び × 日の並びで返る）',
  expand(
    [wishOf(['10:00-12:00', '10:00-12:00'], { studentId: 'LTR2569911' }),
      wishOf(['10:00-12:00', '10:00-12:00'], { studentId: 'CSB2272037' })],
    daysOf([plainDay, raggedDay]),
  ).map((one) => `${one.studentId} ${one.date}`),
  ['LTR2569911 2025-11-01', 'LTR2569911 2025-11-02', 'CSB2272037 2025-11-01', 'CSB2272037 2025-11-02'],
)

check(
  '④ 配列を受けて配列を返す（希望が 0 件なら候補も 0 件である）',
  [Array.isArray(expand([], daysOf([plainDay]))), expand([], daysOf([plainDay])).length],
  [true, 0],
)

check(
  '④ SpreadsheetApp を 1 度も掴んでいない（→ 6 の #8）',
  fs.readFileSync(path.join(here, 'expand.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .includes('SpreadsheetApp'),
  false,
)

// ---- ⑤ 黙って通さずに名指しして止まる ---------------------------------------

const brokenFormat = whyItStopped(() => slotsOf('10時-12時'))

check(
  '⑤ 4-2 の正規表現を通らない文字列は、黙って解釈せずに名指しして止まる',
  [brokenFormat !== null, brokenFormat?.includes('LTR2569911'), brokenFormat?.includes('10時-12時')],
  [true, true, true],
)

check(
  '⑤ 空の回答も、区間が無いのではなく形が違うとして止まる（空のセルが文の中で見える）',
  whyItStopped(() => slotsOf(''))?.includes('（空）'),
  true,
)

check(
  '⑤ 区間が 1 つでも崩れていれば、残りを黙って採らずに止まる',
  whyItStopped(() => slotsOf('10:00-12:00,25:00-26:00'))?.includes('25:00-26:00'),
  true,
)

const dayCountDiffers = whyItStopped(() => expand([wishOf(['10:00-12:00'])], daysOf([plainDay, raggedDay])))

check(
  '⑤ 回答の日数と営業時刻の行数が食い違えば、前から当てずに名指しして止まる（→ 4-1）',
  [dayCountDiffers !== null, dayCountDiffers?.includes('1 日ぶん'), dayCountDiffers?.includes('2 行')],
  [true, true, true],
)

// ---- ⑥ コアの段として繋がっている -------------------------------------------

/** 骨組みを回すのに足りるだけの入力。日は 4 行である（→ core.test.mjs の同じ手）。 */
function skeletonInputs(answers) {
  return {
    '日ごとの営業時刻': [
      ['2025-11-01', '08:00', '10:00', '18:00', '18:00', '20:00'],
      ['2025-11-02', '08:00', '10:00', '18:00', '18:00', '20:00'],
      ['2025-11-03', '08:00', '10:00', '18:00', '18:00', '20:00'],
      ['2025-11-04', '08:00', '10:00', '18:00', '18:00', '20:00'],
    ],
    '役割と必要人数': [['', '', '', '調理', 2]],
    '調理責任者の学年': [['3年生'], ['4年生']],
    '委員会の指定枠': [],
    '準備・片付けのルール': [['午前と午後の境目', '12:00']],
    '回答': answers,
    '割り当て': [],
  }
}

check(
  '⑥ 「展開する」が、中身の入っている段になった（未了に出ない → core.js の builtInSteps）',
  [
    Object.keys(builtInSteps()).indexOf('展開する') !== -1,
    build(skeletonInputs([])).notBuilt.map((step) => step.name).indexOf('展開する'),
  ],
  [true, -1],
)

// 生成（#151）へ渡るのは、取り込んだ希望ではなく展開した候補である。
let receivedByBuildStep = null
build(skeletonInputs([[
  '2025-09-23 16:31:09', 'EED2349987', '高木琴音', '3年生', 'いいえ', '',
  '10:00-12:00', '00:00-00:00', '00:00-00:00', '00:00-00:00',
]]), {
  '生成する': (candidates) => { receivedByBuildStep = candidates; return [] },
})

check(
  '⑥ 生成の段へ渡るのは、規則 1 で展開した候補である（回答文字列がそのまま流れない）',
  receivedByBuildStep.map((one) => [one.studentId, one.date, one.slots.length]),
  [
    ['EED2349987', '2025-11-01', 4],
    ['EED2349987', '2025-11-02', 0],
    ['EED2349987', '2025-11-03', 0],
    ['EED2349987', '2025-11-04', 0],
  ],
)

check(
  '⑥ expand.js を貼り忘れると、段を「まだ作っていない」に混ぜずに名指しして止まる',
  whyItStopped(() => load(coreFiles.filter((name) => name !== 'expand.js')).builtInSteps())
    ?.includes('expand.js が貼られていない'),
  true,
)

check(
  '⑥ 段の表は、この段の issue を 149 として持っている（→ 8 の 7）',
  coreSteps.filter((step) => step.name === '展開する').map((step) => [step.issue, step.writesTo]),
  [[149, null]],
)

// ---- 結果 ------------------------------------------------------------------

console.log('展開する側の検査（src/expand.js／スプレッドシート無し）')
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
  console.log(`結果: ${failed.length} 件が食い違った（${passed.length} 件は一致）`)
  process.exit(1)
}
