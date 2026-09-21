#!/usr/bin/env node
// 違反を数える側の検査 — src/count-violations.js を、スプレッドシートを 1 つも作らずに走らせる。
//
//   使い方: node src/count-violations.test.mjs
//
// 見るものは 5 つある。
//   ① 数えるのは 5 つで、規則 3 の ⑥ は数えない。数えていないことが隠れていない（→ 5-4 の但し書き）
//   ② 違反を 1 件ずつ仕込んだ入力で、それぞれが名指しで出る（→ issue #141 の受け入れ条件）
//   ③ 配列を受けて配列を返し、未充足を 1 件も混ぜない（→ 5-4・#142）
//   ④ 判定できない行は、黙って通さずに名指しして止まる
//   ⑤ コアの段として繋がっていて、返った行が検証結果シートの形に合っている（→ core.js の checkOutput）
//
// 前回の確定シフト（data/ のモック 4 本）を、ここに食わせていない。
// 数えるのは生成した案で、前回の記録は M1 ① の入力である（→ 5-4 の但し書き。乗るかは input-types.test.mjs）。
//
// これは契約であって実装ではない。何も書き換えない。

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// ---- 読み込む ---------------------------------------------------------------
// SpreadsheetApp を文脈に置いていない。置かなくても通ることが、この検査そのものである。

const context = vm.createContext({})
for (const name of ['sheet-layout.js', 'input-types.js', 'core.js', 'count-violations.js', 'name-unmet.js', 'take-in.js', 'expand.js']) {
  vm.runInContext(fs.readFileSync(path.join(here, name), 'utf8'), context, { filename: name })
}
const { countViolations, takeConditions, toWishes, build, sheetColumns } = context
const { violationRules, violationsNotCounted, checkKind } = vm.runInContext(
  '({ violationRules, violationsNotCounted, checkKind })',
  context,
)

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
// 値は data/ の転記元と同じ表現で置く。2 日あるのは、⑥ を数えていないことを見るためである。

const dates = ['2025-11-02', '2025-11-03']

function conditionRows(overrides) {
  const rows = {
    '日ごとの営業時刻': dates.map((date) => [date, '08:00', '09:00', '15:00', '15:00', '17:00']),
    '役割と必要人数': [
      ['', '', '', '調理', 2],
      ['', '', '', '調理責任者', 1],
      ['', '', '', '呼び込み', 2],
      ['', '', '', '準備', 2],
      ['', '', '', '片付け', 2],
    ],
    '調理責任者の学年': [['3年生'], ['4年生']],
    '委員会の指定枠': [],
    '準備・片付けのルール': [['午前と午後の境目', '12:00']],
  }
  Object.keys(overrides || {}).forEach((name) => { rows[name] = overrides[name] })
  return rows
}

const conditions = takeConditions(conditionRows())

/** 回答 1 行。列は 4-1 の設問 9 つ ＋ タイムスタンプである（→ sheet-layout.js の回答シート）。 */
function answerRow(studentId, name, grade, cookAnswer) {
  return [
    '2025-10-24 21:15:03', studentId, name, grade, cookAnswer, '',
    '8:00-17:00', '8:00-17:00', '8:00-17:00', '8:00-17:00',
  ]
}

const people = {
  a: { id: 'AAA1234567', name: '井上あおい' },
  b: { id: 'BBB1234567', name: '上田はると' },
  c: { id: 'CCC1234567', name: '遠藤ひなた' },
  d: { id: 'DDD1234567', name: '大野つむぎ' },
  noAnswer: { id: 'EEE1234567', name: '岡田れん' },
}

const wishes = toWishes([
  answerRow(people.a.id, people.a.name, '3年生', 'はい'),
  answerRow(people.b.id, people.b.name, '1年生', 'はい'),
  answerRow(people.c.id, people.c.name, '3年生', 'いいえ'),
  answerRow(people.d.id, people.d.name, '3年生', 'はい'),
])

/** 候補（展開する段の出力 → #149）。この検査では、回答した 4 人に 2 日ぶんの全枠を渡す。 */
function candidatesOf(skip) {
  const answered = ['a', 'b', 'c', 'd']
  const candidates = []
  answered.forEach((key) => {
    conditions.days.forEach((day) => {
      candidates.push({
        studentId: people[key].id,
        date: day.date,
        slots: day.slots.filter((slot) => !(skip
          && skip.studentId === people[key].id && skip.date === day.date && skip.start === slot.start)),
      })
    })
  })
  return candidates
}

/** 割り当て 1 行（列は 5-3 の割り当てシート）。開始から 30 分の枠である。 */
function placed(date, start, role, who) {
  const minutes = Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + 30
  const end = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  return [date, start, end, role, who.id, who.name]
}

/**
 * 違反 0 件の割り当て。ここから 1 件ずつ壊して、壊した分だけが出ることを見る。
 *   井上 … 午前だけ（調理）＋ 準備          → 規則 3 の ②
 *   上田 … 午後だけ（呼び込み）＋ 片付け     → 規則 3 の ③
 *   遠藤 … 午前だけ（呼び込み）＋ 準備       → 規則 3 の ②
 */
function cleanRows() {
  return [
    placed(dates[0], '08:00', '準備', people.a),
    placed(dates[0], '09:00', '調理', people.a),
    placed(dates[0], '13:00', '呼び込み', people.b),
    placed(dates[0], '15:00', '片付け', people.b),
    placed(dates[0], '08:00', '準備', people.c),
    placed(dates[0], '09:00', '呼び込み', people.c),
  ]
}

/** 違反を数える。行を差し替えるだけで、条件も希望も候補も同じものを使う。 */
function violationsOf(rows, given) {
  const use = given || {}
  return countViolations(
    rows,
    use.conditions || conditions,
    use.wishes || wishes,
    use.candidates || candidatesOf(),
  )
}

const columns = sheetColumns('検証結果')
const detailColumn = columns.indexOf('内容')

/** 出た行を「内容の頭の名前」だけにする。名指しで出たかどうかは、ここで突き合わせる。 */
function labelsOf(rows) {
  return rows.map((row) => row[detailColumn].split(': ')[0])
}

/** 出た行 1 件の内容（頭の名前の後ろ全部）。 */
function detailOf(rows) {
  if (rows.length !== 1) return `（${rows.length} 件）`
  const detail = rows[0][detailColumn]
  return detail.slice(detail.indexOf(': ') + 2)
}

// ---- ① 数えるのは 5 つで、⑥ は数えない ------------------------------------

check(
  '① 数える違反は 5 つである（→ 5-4 の「違反」の行）',
  violationRules.map((rule) => rule.label),
  ['規則 1', '規則 3', '規則 4', '規則 5', '同じ枠に二重'],
)

check(
  '① 数えない違反が、名前と理由つきで置いてある（⑥ を隠さない → 5-4 の但し書き）',
  [
    violationsNotCounted.length,
    violationsNotCounted[0].rule,
    violationsNotCounted[0].what,
    violationsNotCounted[0].why.includes('△ 5'),
  ],
  [1, '規則 3 の ⑥', '複数日で偏らせない', true],
)

const acrossTwoDays = violationsOf([
  placed(dates[0], '08:00', '準備', people.a),
  placed(dates[0], '09:00', '調理', people.a),
  placed(dates[1], '08:00', '準備', people.a),
  placed(dates[1], '09:00', '調理', people.a),
])

check(
  '① 1 人に 2 日、ほかの 3 人に 0 日でも、⑥ は違反にならない（→ 5-4 の但し書き）',
  acrossTwoDays,
  [],
)

// ---- ② 違反を 1 件ずつ仕込む -----------------------------------------------

check('② 壊していない割り当てでは、違反が 0 件である', violationsOf(cleanRows()), [])

const outsideWish = violationsOf(cleanRows(), {
  candidates: candidatesOf({ studentId: people.a.id, date: dates[0], start: '09:00' }),
})

check(
  '② 規則 1 — 希望の時間の外に置いた 1 枠が、名指しで出る',
  [labelsOf(outsideWish), detailOf(outsideWish), outsideWish[0][columns.indexOf('開始')]],
  [['規則 1'], '希望の時間の外に置いている', '09:00'],
)

const noAnswerRows = cleanRows().concat([
  placed(dates[0], '13:00', '呼び込み', people.noAnswer),
  placed(dates[0], '15:00', '片付け', people.noAnswer),
])

check(
  '② 規則 1 — 回答が無い人を置いた枠も、外に置いたものとして出る（枠の数だけ出る）',
  [labelsOf(violationsOf(noAnswerRows)), violationsOf(noAnswerRows)[0][detailColumn].includes('回答が無い')],
  [['規則 1', '規則 1'], true],
)

const notPlacedInPrep = violationsOf(cleanRows().filter((row) => !(row[4] === people.a.id && row[3] === '準備')))

check(
  '② 規則 3 の ② — 午前だけの人が準備に入っていなければ、その人のその日が 1 行出る',
  [labelsOf(notPlacedInPrep), detailOf(notPlacedInPrep).slice(0, 1), notPlacedInPrep[0][columns.indexOf('学籍番号')]],
  [['規則 3'], '②', people.a.id],
)

const prepInsteadOfCleanup = violationsOf(cleanRows().map((row) => (
  row[4] === people.b.id && row[3] === '片付け' ? placed(dates[0], '15:00', '準備', people.b) : row
)))

check(
  '② 規則 3 の ③ — 午後だけの人を準備に入れていれば、1 行出る',
  [labelsOf(prepInsteadOfCleanup), detailOf(prepInsteadOfCleanup).slice(0, 1)],
  [['規則 3'], '③'],
)

/** 午前と午後の両方にある人を、準備と片付けの両方に入れた割り当て（規則 3 の ④）。 */
function bothSidesRows() {
  return cleanRows().concat([
    placed(dates[0], '13:00', '呼び込み', people.a),
    placed(dates[0], '15:00', '片付け', people.a),
  ])
}

const bothSides = violationsOf(bothSidesRows())

check(
  '② 規則 3 の ④ — 午前と午後の両方にある人を、準備と片付けの両方に入れていれば 1 行出る',
  [labelsOf(bothSides), detailOf(bothSides).slice(0, 1)],
  [['規則 3'], '④'],
)

const neitherSide = violationsOf(
  cleanRows()
    .filter((row) => !(row[4] === people.a.id && row[3] === '準備'))
    .concat([placed(dates[0], '13:00', '呼び込み', people.a)]),
)

check(
  '② 規則 3 の ④ — 両方にあるのにどちらにも入れていなければ、同じ ④ として 1 行出る',
  [labelsOf(neitherSide), detailOf(neitherSide).slice(0, 1), detailOf(neitherSide).includes('準備に入っていない')],
  [['規則 3'], '④', true],
)

const prepWithoutShift = violationsOf(cleanRows().concat([placed(dates[0], '08:00', '準備', people.d)]))

check(
  '② 規則 3 の ⑤ — 午前にも午後にも割り当てが無い人を準備に入れていれば、1 行出る',
  [labelsOf(prepWithoutShift), detailOf(prepWithoutShift).slice(0, 1), prepWithoutShift[0][columns.indexOf('学籍番号')]],
  [['規則 3'], '⑤', people.d.id],
)

const youngCookLeader = violationsOf(cleanRows().map((row) => (
  row[4] === people.b.id && row[3] === '呼び込み' ? placed(dates[0], '13:00', '調理責任者', people.b) : row
)))

check(
  '② 規則 4 — 調理責任者の枠に 1年生 を置いていれば、1 行出る',
  [labelsOf(youngCookLeader), youngCookLeader[0][detailColumn].includes('3年生 / 4年生')],
  [['規則 4'], true],
)

const cookWithoutAnswer = violationsOf(cleanRows().map((row) => (
  row[4] === people.c.id && row[3] === '呼び込み' ? placed(dates[0], '09:00', '調理', people.c) : row
)))

check(
  '② 規則 5 — 調理の枠に 調理担当ですか？ が いいえ の人を置いていれば、1 行出る',
  [labelsOf(cookWithoutAnswer), cookWithoutAnswer[0][detailColumn].includes('いいえ')],
  [['規則 5'], true],
)

const twiceInOneSlot = violationsOf(cleanRows().concat([placed(dates[0], '09:00', '調理責任者', people.a)]))

check(
  '② 同じ枠に二重 — 同じ人が同じ 30 分枠に 2 つ入っていれば、2 つ目が 1 行出る（規則ではない → 5-4）',
  [labelsOf(twiceInOneSlot), twiceInOneSlot[0][columns.indexOf('役割')], twiceInOneSlot[0][detailColumn].includes('1 つ目は 調理')],
  [['同じ枠に二重'], '調理責任者', true],
)

check(
  '② 5 つとも、仕込めば名指しで出た（数えると書いてあるものが全部動いている）',
  violationRules.map((rule) => rule.label).filter((label) => [
    ...labelsOf(outsideWish), ...labelsOf(notPlacedInPrep), ...labelsOf(youngCookLeader),
    ...labelsOf(cookWithoutAnswer), ...labelsOf(twiceInOneSlot),
  ].indexOf(label) === -1),
  [],
)

// ---- ③ 未充足を混ぜない ／ 配列を返す --------------------------------------

check(
  '③ 種別はどれも「違反」で、「あと何人」は空である（数を出すのは未充足の側 → 5-4・#142）',
  [
    twiceInOneSlot.concat(bothSides, youngCookLeader).map((row) => row[columns.indexOf('種別')]),
    twiceInOneSlot.concat(bothSides, youngCookLeader).map((row) => row[columns.indexOf('あと何人')]),
  ],
  [[checkKind.violation, checkKind.violation, checkKind.violation], ['', '', '']],
)

check(
  '③ 人数が足りない枠は、違反にならない（調理は 2 人必要で 1 人しか置いていない → 5-4）',
  violationsOf(cleanRows()).length,
  0,
)

check(
  '③ 返るのは行の配列で、列数はどれも検証結果の構成どおりである',
  [Array.isArray(twiceInOneSlot), twiceInOneSlot.map((row) => row.length)],
  [true, [columns.length]],
)

check(
  '③ 同じ入力を 2 回渡すと同じ行が返る（決定的である → 6 の #3 の理由 ③）',
  JSON.stringify(violationsOf(bothSidesRows())),
  JSON.stringify(bothSides),
)

check(
  '③ 置いた行が 1 つも無ければ、違反も 0 件である（生成が無いまま数える側だけを回せる → 8 の 3）',
  violationsOf([]),
  [],
)

check(
  '③ 内容に「偏」の字が 1 つも出ない（⑥ を数えていないので、それらしい文を出さない）',
  [...twiceInOneSlot, ...bothSides, ...prepWithoutShift, ...outsideWish]
    .filter((row) => row[detailColumn].includes('偏')),
  [],
)

// ---- ④ 判定できない行は、名指しして止まる ----------------------------------

check(
  '④ その日の 30 分枠に無い時間帯の行は、名指しして止まる（規則を発明しない）',
  whyItStopped(() => violationsOf([[dates[0], '09:00', '10:00', '調理', people.a.id, people.a.name]]))
    ?.includes('30 分枠に無い'),
  true,
)

check(
  '④ 条件入力に無い日の行は、名指しして止まる',
  whyItStopped(() => violationsOf([placed('2025-11-05', '09:00', '調理', people.a)]))
    ?.includes('「日ごとの営業時刻」に無い'),
  true,
)

check(
  '④ 午前と午後の境目が入っていなければ、規則 3 を数えずに名指しして止まる（→ 5-1 の #5）',
  whyItStopped(() => violationsOf(cleanRows(), {
    conditions: takeConditions(conditionRows({ '準備・片付けのルール': [] })),
  }))?.includes('午前と午後の境目'),
  true,
)

check(
  '④ 調理責任者の学年が 1 行も無ければ、規則 4 を数えずに名指しして止まる（→ 5-1 の #3）',
  whyItStopped(() => violationsOf(cleanRows().concat([placed(dates[0], '09:00', '調理責任者', people.d)]), {
    conditions: takeConditions(conditionRows({ '調理責任者の学年': [] })),
  }))?.includes('「調理責任者の学年」'),
  true,
)

check(
  '④ 学籍番号が形式と違えば、名指しして止まる（識別キーである → 5-1）',
  whyItStopped(() => violationsOf([[dates[0], '09:00', '09:30', '調理', 'AAA', '井上あおい']]))
    ?.includes('10 桁の英数字'),
  true,
)

check(
  '④ 割り当ての学籍番号が小文字でも、その人の希望に繋がる（大文字・小文字に意味は無い ◎ → 3 の規則 2 の ①）',
  labelsOf(violationsOf(cleanRows().map((row) => row.map((cell, at) => (
    at === sheetColumns('割り当て').indexOf('学籍番号') ? String(cell).toLowerCase() : cell
  ))))),
  [],
)

check(
  '④ 希望に同じ学籍番号が 2 件あれば、名指しして止まる（規則 2 が畳んでいない → 仕様 #4）',
  whyItStopped(() => violationsOf(cleanRows(), { wishes: wishes.concat([wishes[0]]) }))
    ?.includes('規則 2'),
  true,
)

check(
  '④ 列数が構成と違う行は、詰めずに名指しして止まる',
  whyItStopped(() => violationsOf([[dates[0], '09:00', '09:30', '調理', people.a.id]]))
    ?.includes('列数が構成と違う'),
  true,
)

// ---- ⑤ コアの段として繋がっている ------------------------------------------

const output = build({
  ...conditionRows(),
  '回答': [answerRow(people.a.id, people.a.name, '3年生', 'はい')],
  '割り当て': [],
}, {
  '取り込む': () => wishes,
  '展開する': () => candidatesOf(),
  '生成する': () => bothSidesRows(),
  // ここで見るのは違反の側だけである。未充足は別に数える側が持つ（→ 5-4・name-unmet.test.mjs）
  '未充足を名指しする': () => [],
})

check(
  '⑤ build から呼ばれて、検証結果の行が返る（→ core.js の builtInSteps）',
  [output['検証結果'].length, labelsOf(output['検証結果'])],
  [1, ['規則 3']],
)

check(
  '⑤ 「違反を数える」は、まだ作っていない段に出てこない',
  output.notBuilt.map((step) => step.name).indexOf('違反を数える'),
  -1,
)

check(
  '⑤ 返した行が検証結果シートの形を通っている（種別と列数を core.js が見ている）',
  output['検証結果'].map((row) => [row.length, row[columns.indexOf('種別')]]),
  [[columns.length, checkKind.violation]],
)

// ---- 結果 ------------------------------------------------------------------

console.log('違反を数える側の検査（src/count-violations.js／スプレッドシート無し）')
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
