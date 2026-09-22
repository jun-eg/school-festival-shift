#!/usr/bin/env node
// 未充足を名指しする側の検査 — src/name-unmet.js を、スプレッドシートを 1 つも作らずに走らせる。
//
//   使い方: node src/name-unmet.test.mjs
//
// 見るものは 5 つある。
//   ① 数えるもとは 2 つで、切り方が希望と逆向きである（重なる枠すべて → 5-4・3 の境界値の表）。
//     時間帯を空けた行が効くのは、その日の 調理開始〜調理終了 の帯である（→ 5-1 の #2・issue #210）
//   ② 必要人数（5-1 の #2）と指定枠（規則 6）の不足が、どちらも名指しで出る（→ issue #142 の受け入れ条件）
//   ③ 名指しされていない未充足が 0 件である。埋めずに残し、あと何人を出す（→ 5-4）
//   ④ 数えられない需要は、黙って落とさずに名指しして止まる
//   ⑤ コアの段として繋がっていて、返った行が検証結果シートの形に合っている（→ core.js の checkOutput）
//
// 違反（置いた人が条件を破っている）はここで数えない。数えているのは count-violations.test.mjs である。
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
for (const name of ['sheet-layout.js', 'input-types.js', 'core.js', 'count-violations.js', 'name-unmet.js', 'take-in.js', 'expand.js', 'generate.js']) {
  vm.runInContext(fs.readFileSync(path.join(here, name), 'utf8'), context, { filename: name })
}
const { nameUnmet, takeConditions, build, sheetColumns } = context
const { unmetSources, checkKind } = vm.runInContext('({ unmetSources, checkKind })', context)

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
// 値は data/ の転記元と同じ表現で置く。需要を時間帯で絞ってあるのは、出る行を数え切れる大きさにするためである。

const dates = ['2025-11-02', '2025-11-03']

function conditionRows(overrides) {
  const rows = {
    '日ごとの営業時刻': dates.map((date) => [date, '08:00', '09:00', '15:00', '15:00', '17:00']),
    '役割と必要人数': [[dates[0], '09:00', '10:00', '調理', 2]],
    '調理責任者の学年': [['3年生'], ['4年生']],
    '委員会の指定枠': [],
    '準備・片付けのルール': [['午前と午後の境目', '12:00']],
    '置き方のルール': [],
  }
  Object.keys(overrides || {}).forEach((name) => { rows[name] = overrides[name] })
  return rows
}

const conditions = takeConditions(conditionRows())

const people = {
  a: { id: 'AAA1234567', name: '井上あおい' },
  b: { id: 'BBB1234567', name: '上田はると' },
}

/** 割り当て 1 行（列は 5-3 の割り当てシート）。開始から 30 分の枠である。 */
function placed(date, start, role, who) {
  const minutes = Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + 30
  const end = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  return [date, start, end, role, who.id, who.name]
}

/**
 * その日の調理帯（`調理開始`〜`調理終了`）の 30 分枠。時間帯を空けた需要が効く先である（→ 5-1 の #2）。
 * 枠は時刻をまたがないので、帯の中かどうかは枠の側で決まる（→ 5-1 の #1）。
 */
function cookSlots(day) {
  return day.slots.filter((slot) => slot.start >= day.cookStart && slot.end <= day.cookEnd)
}

/** 未充足を数える。行を差し替えるだけで、条件は同じものを使う。 */
function unmetOf(rows, given) {
  return nameUnmet(rows, (given || {}).conditions || conditions)
}

const columns = sheetColumns('検証結果')
const detailColumn = columns.indexOf('内容')
const shortColumn = columns.indexOf('あと何人')

/** 出た行を (開始・役割・あと何人) だけにする。名指しの中身は、ここで突き合わせる。 */
function namedIn(rows) {
  return rows.map((row) => [row[columns.indexOf('開始')], row[columns.indexOf('役割')], row[shortColumn]])
}

/** 出た行の「内容の頭の名前」。どのもとが人数を決めたかが、ここに出る。 */
function labelsOf(rows) {
  return rows.map((row) => row[detailColumn].split(': ')[0])
}

// ---- ① 数えるもとは 2 つで、切り方が逆向きである ----------------------------

check(
  '① 数えるもとは 2 つである（必要人数と委員会の指定枠 → 5-4 の「未充足」の行）',
  unmetSources.map((source) => source.label),
  ['必要人数', '委員会の指定枠'],
)

check(
  '① 2 つとも、条件入力の区画と対応している（→ 5-1 の #2・#4）',
  unmetSources.map((source) => source.key),
  ['roleNeeds', 'committeeNeeds'],
)

/** 30 分に乗らない指定枠。委員会の指定が 30 分単位に乗らないことがあるのは ◎ である（→ 3 の境界値の表）。 */
const offGridCommittee = takeConditions(conditionRows({
  '委員会の指定枠': [[dates[0], '12:00', '12:15', 'クリーンパトロール', 1]],
}))

check(
  '① 指定枠は重なる枠すべてに効く（12:00-12:15 が 12:00-12:30 の枠に効く。希望とは逆向き → 5-4）',
  namedIn(unmetOf([], { conditions: offGridCommittee }).filter((row) => row[columns.indexOf('役割')] === 'クリーンパトロール')),
  [['12:00', 'クリーンパトロール', 1]],
)

const touchingCommittee = takeConditions(conditionRows({
  '委員会の指定枠': [[dates[0], '12:00', '12:30', 'クリーンパトロール', 1]],
}))

check(
  '① 端が触れているだけの枠には効かない（12:00-12:30 は 11:30-12:00 の枠に重なっていない）',
  namedIn(unmetOf([], { conditions: touchingCommittee }).filter((row) => row[columns.indexOf('役割')] === 'クリーンパトロール')),
  [['12:00', 'クリーンパトロール', 1]],
)

// 時間帯を空けた 1 行。全枠ではなく、その日の調理帯（この置き方では 09:00-15:00）に効く。
const blankTime = unmetOf([], {
  conditions: takeConditions(conditionRows({ '役割と必要人数': [['', '', '', '呼び込み', 1]] })),
})

check(
  '① 時間帯を空けた行は、その日の 調理開始〜調理終了 の帯に効く（全枠ではない → 5-1 の #2）',
  blankTime.length,
  conditions.days.reduce((count, day) => count + cookSlots(day).length, 0),
)

check(
  '① 時間帯を空けた行は、準備帯にも片付け帯にも立たない（営業していない帯に店の需要を立てない）',
  blankTime.filter((row) => row[columns.indexOf('開始')] < '09:00' || row[columns.indexOf('開始')] >= '15:00'),
  [],
)

check(
  '① 日を空けた行は全日に効く（日の欄の読みは動かない → 5-1 の #2）',
  [...new Set(blankTime.map((row) => row[columns.indexOf('日')]))],
  dates,
)

// 調理帯が 0 枠の日（前回の 2025-11-01 のような準備日）。日ごとに書き分けなくても、帯の側で決まる。
check(
  '① 調理帯が 0 枠の日には、時間帯を空けた行の需要が立たない（準備日・片付け日 → issue #210）',
  unmetOf([], {
    conditions: takeConditions(conditionRows({
      '日ごとの営業時刻': [
        [dates[0], '08:00', '09:00', '15:00', '15:00', '17:00'],
        [dates[1], '08:00', '17:00', '17:00', '17:00', '17:00'],
      ],
      '役割と必要人数': [['', '', '', '呼び込み', 1]],
    })),
  }).filter((row) => row[columns.indexOf('日')] === dates[1]),
  [],
)

// ---- ② 必要人数と指定枠の不足が、どちらも名指しで出る -----------------------

check(
  '② 必要人数（5-1 の #2）の不足が、日・時間帯・役割・あと何人で出る',
  [
    namedIn(unmetOf([])),
    unmetOf([])[0][columns.indexOf('日')],
    unmetOf([])[0][columns.indexOf('終了')],
    labelsOf(unmetOf([])),
  ],
  [[['09:00', '調理', 2], ['09:30', '調理', 2]], dates[0], '09:30', ['必要人数', '必要人数']],
)

check(
  '② 委員会の指定枠（規則 6）の不足も、同じ形で出る',
  [
    namedIn(unmetOf([], { conditions: offGridCommittee })),
    labelsOf(unmetOf([], { conditions: offGridCommittee })),
  ],
  [
    [['09:00', '調理', 2], ['09:30', '調理', 2], ['12:00', 'クリーンパトロール', 1]],
    ['必要人数', '必要人数', '委員会の指定枠'],
  ],
)

check(
  '② 指定枠の役割名が 5-1 の #2 に無い名前（クリーンパトロール）でも通る（→ 規則 6 の ③）',
  unmetOf([], { conditions: offGridCommittee })
    .filter((row) => row[columns.indexOf('役割')] === 'クリーンパトロール').length,
  1,
)

const raised = takeConditions(conditionRows({
  '委員会の指定枠': [[dates[0], '09:00', '09:30', '調理', 3]],
}))

check(
  '② 同じ枠に効く行が複数あれば、最大まで引き上げる（足し合わせない → 規則 6 の ②）',
  [namedIn(unmetOf([], { conditions: raised })), labelsOf(unmetOf([], { conditions: raised }))],
  [[['09:00', '調理', 3], ['09:30', '調理', 2]], ['委員会の指定枠', '必要人数']],
)

const sameNumber = takeConditions(conditionRows({
  '委員会の指定枠': [[dates[0], '09:00', '09:30', '調理', 2]],
}))

check(
  '② 2 つのもとが同じ人数なら、どちらの名前も出る',
  labelsOf(unmetOf([], { conditions: sameNumber })),
  ['必要人数 ／ 委員会の指定枠', '必要人数'],
)

// ---- ③ 名指しされていない未充足が 0 件 --------------------------------------

check(
  '③ 1 人置くと、その枠だけ あと何人 が減る',
  namedIn(unmetOf([placed(dates[0], '09:00', '調理', people.a)])),
  [['09:00', '調理', 1], ['09:30', '調理', 2]],
)

check(
  '③ 満たした枠は、もう出ない（未充足そのものは 0 でなくてよい → 5-4）',
  namedIn(unmetOf([
    placed(dates[0], '09:00', '調理', people.a),
    placed(dates[0], '09:00', '調理', people.b),
  ])),
  [['09:30', '調理', 2]],
)

check(
  '③ 同じ人を同じ枠に 2 回置いても 1 人である（二重は違反の側が数える → 5-4）',
  namedIn(unmetOf([
    placed(dates[0], '09:00', '調理', people.a),
    placed(dates[0], '09:00', '調理', people.a),
  ])),
  [['09:00', '調理', 1], ['09:30', '調理', 2]],
)

check(
  '③ 役割が違う人を置いても、その枠は埋まらない',
  namedIn(unmetOf([placed(dates[0], '09:00', '呼び込み', people.a)])),
  [['09:00', '調理', 2], ['09:30', '調理', 2]],
)

check(
  '③ 別の日・別の枠に置いても、その枠は埋まらない',
  namedIn(unmetOf([
    placed(dates[1], '09:00', '調理', people.a),
    placed(dates[0], '10:00', '調理', people.b),
  ])),
  [['09:00', '調理', 2], ['09:30', '調理', 2]],
)

const everySlotUnmet = unmetOf([], {
  conditions: takeConditions(conditionRows({ '役割と必要人数': [['', '', '', '調理', 2]] })),
})

check(
  '③ 置いた行が 1 つも無ければ、要る枠が全部出る（名指しされていない未充足が 0 件 → 5-4）',
  [
    everySlotUnmet.length,
    everySlotUnmet.every((row) => row[shortColumn] === 2),
    everySlotUnmet.filter((row) => row[columns.indexOf('日')] === dates[1]).length,
  ],
  [
    conditions.days.reduce((count, day) => count + cookSlots(day).length, 0),
    true,
    cookSlots(conditions.days[1]).length,
  ],
)

check(
  '③ 種別はどれも「未充足」で、学籍番号も氏名も空である（枠の話であって、人の話ではない）',
  [
    unmetOf([]).map((row) => row[columns.indexOf('種別')]),
    unmetOf([]).map((row) => row[columns.indexOf('学籍番号')] + row[columns.indexOf('氏名')]),
  ],
  [[checkKind.unmet, checkKind.unmet], ['', '']],
)

check(
  '③ 返るのは行の配列で、列数はどれも検証結果の構成どおりである',
  [Array.isArray(unmetOf([])), unmetOf([]).map((row) => row.length)],
  [true, [columns.length, columns.length]],
)

check(
  '③ 需要が 1 行も無ければ、未充足も 0 件である',
  unmetOf([], {
    conditions: takeConditions(conditionRows({ '役割と必要人数': [], '委員会の指定枠': [] })),
  }),
  [],
)

check(
  '③ 同じ入力を 2 回渡すと同じ行が返る（決定的である → 6 の #3 の理由 ③）',
  JSON.stringify(unmetOf([placed(dates[0], '09:00', '調理', people.a)])),
  JSON.stringify(unmetOf([placed(dates[0], '09:00', '調理', people.a)])),
)

// ---- ④ 数えられない需要は、名指しして止まる ---------------------------------

check(
  '④ 時間帯を空けた行でも、どの日も調理帯が 0 枠なら名指しして止まる（→ issue #210）',
  whyItStopped(() => unmetOf([], {
    conditions: takeConditions(conditionRows({
      '日ごとの営業時刻': dates.map((date) => [date, '08:00', '17:00', '17:00', '17:00', '17:00']),
      '役割と必要人数': [['', '', '', '呼び込み', 1]],
    })),
  }))?.includes('30 分枠に 1 つも重ならない'),
  true,
)

check(
  '④ 日ごとの営業時刻に無い日の需要は、名指しして止まる（黙って落とさない）',
  whyItStopped(() => unmetOf([], {
    conditions: takeConditions(conditionRows({ '役割と必要人数': [['2025-11-05', '', '', '調理', 2]] })),
  }))?.includes('30 分枠に 1 つも重ならない'),
  true,
)

check(
  '④ 営業時刻の外へ出た指定枠も、同じように止まる（区画の名前と行の中身が出る）',
  (() => {
    const why = whyItStopped(() => unmetOf([], {
      conditions: takeConditions(conditionRows({
        '委員会の指定枠': [[dates[0], '19:00', '20:00', 'クリーンパトロール', 1]],
      })),
    }))
    return [why?.includes('「委員会の指定枠」'), why?.includes('19:00-20:00'), why?.includes('クリーンパトロール')]
  })(),
  [true, true, true],
)

check(
  '④ その日の 30 分枠に無い時間帯の行は、名指しして止まる（読むのは count-violations.js と同じ手である）',
  whyItStopped(() => unmetOf([[dates[0], '09:00', '10:00', '調理', people.a.id, people.a.name]]))
    ?.includes('30 分枠に無い'),
  true,
)

check(
  '④ 条件入力に無い日の割り当ては、名指しして止まる',
  whyItStopped(() => unmetOf([placed('2025-11-05', '09:00', '調理', people.a)]))
    ?.includes('「日ごとの営業時刻」に無い'),
  true,
)

check(
  '④ 列数が構成と違う行は、詰めずに名指しして止まる',
  whyItStopped(() => unmetOf([[dates[0], '09:00', '09:30', '調理', people.a.id]]))
    ?.includes('列数が構成と違う'),
  true,
)

// ---- ⑤ コアの段として繋がっている ------------------------------------------

const output = build({
  ...conditionRows(),
  '回答': [],
  '割り当て': [],
}, {
  '取り込む': () => [],
  '展開する': () => [],
  '生成する': () => [placed(dates[0], '09:00', '調理', people.a)],
  '違反を数える': () => [], // ここで見るのは未充足の側だけである（違反は count-violations.test.mjs）
})

check(
  '⑤ build から呼ばれて、検証結果の行が返る（→ core.js の builtInSteps）',
  [output['検証結果'].length, namedIn(output['検証結果'])],
  [2, [['09:00', '調理', 1], ['09:30', '調理', 2]]],
)

check(
  '⑤ 「未充足を名指しする」は、まだ作っていない段に出てこない',
  output.notBuilt.map((step) => step.name).indexOf('未充足を名指しする'),
  -1,
)

check(
  '⑤ 返した行が検証結果シートの形を通っている（種別と列数を core.js が見ている）',
  output['検証結果'].map((row) => [row.length, row[columns.indexOf('種別')]]),
  [[columns.length, checkKind.unmet], [columns.length, checkKind.unmet]],
)

// ---- 結果 ------------------------------------------------------------------

console.log('未充足を名指しする側の検査（src/name-unmet.js／スプレッドシート無し）')
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
