#!/usr/bin/env node
// 指標を出す側の検査 — src/fairness-metrics.js を、スプレッドシートを 1 つも作らずに走らせる。
//
//   使い方: node src/fairness-metrics.test.mjs
//
// 見るものは 6 つある。
//   ① 合計時間は、置いた枠の長さの合計である（準備・片付けも含む）
//   ② シフト回数は塊の数である。役割が変われば別の塊で、時刻が飛べば切れる
//   ③ 準備回数は、準備か片付けに入った日の数である
//   ④ 人ごとに 3 つの値が出る。1 枠も置かれない人も 0 で並ぶ。順位付けも閾値も出ない
//   ⑤ 同じ枠の二重を 2 回数えない ／ 枠に乗らない行は名指しして止まる
//   ⑥ コアの段として繋がっていて、返った行が指標シートの形に合っている

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// ---- 読み込む ---------------------------------------------------------------
// SpreadsheetApp は置かない。置かずに通ることを見る。

const context = vm.createContext({})
for (const name of ['sheet-layout.js', 'input-types.js', 'core.js', 'count-violations.js', 'name-unmet.js', 'fairness-metrics.js', 'take-in.js', 'expand.js', 'generate.js']) {
  vm.runInContext(fs.readFileSync(path.join(here, name), 'utf8'), context, { filename: name })
}
const { fairnessMetrics, takeConditions, build, sheetColumns } = context
const { metricDefinitions } = vm.runInContext('({ metricDefinitions })', context)

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
    return error.detail || error.message
  }
}

// ---- 入力を組む -------------------------------------------------------------
// 1 日は 08:00 準備開始 ／ 09:00 調理開始 ／ 15:00 調理終了・片付け開始 ／ 17:00 片付け終了である。

const dates = ['2025-11-02', '2025-11-03']

function conditionRows() {
  return {
    '日ごとの営業時刻': dates.map((date) => [date, '08:00', '09:00', '15:00', '15:00', '17:00']),
    '役割と必要人数': [],
    '調理責任者の学年': [[3], [4]],
    '委員会の指定枠': [],
    '準備・片付けのルール': [['午前と午後の境目', '12:00']],
    '置き方のルール': [],
  }
}

const conditions = takeConditions(conditionRows())

const people = {
  a: { id: 'AAA1234567', name: '' },
  b: { id: 'BBB1234567', name: '' },
  c: { id: 'CCC1234567', name: '' },
}

/** 割り当て 1 行（開始から 30 分の枠。氏名は生成と同じく空）。 */
function placed(date, start, role, who) {
  const minutes = Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + 30
  const end = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  return [date, start, end, role, who.id, who.name]
}

/** 希望（型 #6）。指標が見るのは学籍番号だけである。 */
function wishOf(who) {
  return { studentId: who.id, grade: '3年生', canCook: true, answers: [] }
}

const columns = sheetColumns('指標')

/** その人の行を、列名から値への対応にする。 */
function metricsOf(rows, who) {
  const row = rows.filter((one) => one[columns.indexOf('学籍番号')] === who.id)[0]
  if (!row) return null
  return { '合計時間': row[columns.indexOf('合計時間')], 'シフト回数': row[columns.indexOf('シフト回数')], '準備回数': row[columns.indexOf('準備回数')] }
}

// ---- ① 合計時間 -------------------------------------------------------------

const withPrepAndCleanup = fairnessMetrics([
  placed(dates[0], '08:00', '準備', people.a),
  placed(dates[0], '09:00', '調理', people.a),
  placed(dates[0], '09:30', '調理', people.a),
  placed(dates[1], '16:00', '片付け', people.a),
], conditions, [wishOf(people.a)])

check(
  '① 合計時間は、置いた枠の長さの合計を時間で出す。準備・片付けの枠も含める（4 枠 ＝ 2 時間）',
  metricsOf(withPrepAndCleanup, people.a)['合計時間'],
  2,
)

// ---- ② シフト回数 -----------------------------------------------------------

const runs = fairnessMetrics([
  // 1 日目: 調理 09:00-10:00 → 呼び込み 10:00-10:30 → 調理 10:30-11:00 → 1 時間空けて 調理 12:00-12:30
  placed(dates[0], '09:00', '調理', people.b),
  placed(dates[0], '09:30', '調理', people.b),
  placed(dates[0], '10:00', '呼び込み', people.b),
  placed(dates[0], '10:30', '調理', people.b),
  placed(dates[0], '12:00', '調理', people.b),
  // 2 日目: 1 日目の終わりと同じ役割でも、日が変われば別の塊である
  placed(dates[1], '09:00', '調理', people.b),
], conditions, [wishOf(people.b)])

check(
  '② 同じ役割が続いた区間を 1 回と数える。役割が変われば別の塊で、戻っても続きにならない'
    + '（調理 → 呼び込み → 調理 で 3 回）。時刻が飛べば切れる（＋1）。日が変われば切れる（＋1）',
  metricsOf(runs, people.b)['シフト回数'],
  5,
)

check(
  '② 帯の切れ目で時刻が続いていれば、そこは切れない — 塊を切るのは時刻であって帯ではない'
    + '（調理終了 15:00 ＝ 片付け開始 なので、14:30 と 15:00 の調理は続きである）',
  metricsOf(fairnessMetrics([
    placed(dates[0], '14:30', '調理', people.b),
    placed(dates[0], '15:00', '調理', people.b),
  ], conditions, []), people.b)['シフト回数'],
  1,
)

// ---- ③ 準備回数 -------------------------------------------------------------

const prepDays = fairnessMetrics([
  placed(dates[0], '08:00', '準備', people.a),
  placed(dates[0], '08:30', '準備', people.a),
  placed(dates[1], '16:00', '片付け', people.a),
  placed(dates[0], '08:00', '準備', people.c),
  placed(dates[0], '08:30', '準備', people.c),
], conditions, [wishOf(people.a), wishOf(people.c)])

check(
  '③ 準備回数は、準備か片付けに入った日の数である（同じ日に 2 枠入っても 1。片付けも数える）',
  [metricsOf(prepDays, people.a)['準備回数'], metricsOf(prepDays, people.c)['準備回数']],
  [2, 1],
)

check(
  '③ 店の役割だけの人は、準備回数が 0 である',
  metricsOf(runs, people.b)['準備回数'],
  0,
)

// ---- ④ 人ごとに 3 つ。並べるだけ ---------------------------------------------

const everyone = fairnessMetrics([
  placed(dates[0], '09:00', '調理', people.c),
  placed(dates[0], '09:30', '調理', people.c),
  placed(dates[0], '10:00', '調理', people.c),
  placed(dates[0], '09:00', '呼び込み', people.b),
], conditions, [wishOf(people.c), wishOf(people.a)])

check(
  '④ 1 枠も置かれなかった人も、0 で並ぶ（落とすと、いちばん偏っている人が指標から消える）',
  metricsOf(everyone, people.a),
  { '合計時間': 0, 'シフト回数': 0, '準備回数': 0 },
)

check(
  '④ 希望に無い学籍番号が割り当てにあれば（手直しで足された人）、その人も並ぶ',
  metricsOf(everyone, people.b),
  { '合計時間': 0.5, 'シフト回数': 1, '準備回数': 0 },
)

check(
  '④ 並びは学籍番号の昇順で、値の大小に依らない（値で並べ替えると順位付けになる → 5 の #7）',
  everyone.map((row) => row[columns.indexOf('学籍番号')]),
  [people.a.id, people.b.id, people.c.id],
)

check(
  '④ 行は指標シートの 5 列ちょうどで、順位・平均・閾値の列を足していない',
  [columns, everyone.every((row) => row.length === columns.length)],
  [['学籍番号', '氏名', '合計時間', 'シフト回数', '準備回数'], true],
)

check(
  '④ 数え方の定義は、指標シートの値の 3 列と 1 対 1 である（→ metricDefinitions）',
  metricDefinitions.map((one) => one.column),
  columns.filter((name) => name !== '学籍番号' && name !== '氏名'),
)

check(
  '④ 氏名はここで埋めない（型 #6 に氏名は無い → 5 の #1。埋めるのは殻である → shell.js）',
  everyone.map((row) => row[columns.indexOf('氏名')]),
  ['', '', ''],
)

// ---- ⑤ 数え落とし・数えすぎをしない -------------------------------------------

const doubled = fairnessMetrics([
  placed(dates[0], '09:00', '調理', people.a),
  placed(dates[0], '09:00', '調理', people.a),
], conditions, [wishOf(people.a)])

check(
  '⑤ 同じ枠・同じ役割の二重は 1 枠と数える（二重は違反の側が数える → 5-4）',
  metricsOf(doubled, people.a),
  { '合計時間': 0.5, 'シフト回数': 1, '準備回数': 0 },
)

check(
  '⑤ その日の枠に乗っていない行は、黙って数えずに名指しして止まる（→ count-violations.js の readAssignments）',
  whyItStopped(() => fairnessMetrics([[dates[0], '09:10', '09:40', '調理', people.a.id, '']], conditions, []))
    ?.includes('30 分枠に無い'),
  true,
)

check(
  '⑤ 割り当ても希望も無ければ、行は 0 である',
  fairnessMetrics([], conditions, []),
  [],
)

// ---- ⑥ コアの段として繋がっている ------------------------------------------

const output = build({
  ...conditionRows(),
  '回答': [],
  '割り当て': [],
  '手直し': [],
}, {
  '取り込む': () => [wishOf(people.a)],
  '展開する': () => [],
  '生成する': () => [placed(dates[0], '09:00', '調理', people.b)],
  '違反を数える': () => [], // ここで見るのは指標の側だけである
  '未充足を名指しする': () => [],
})

check(
  '⑥ build から呼ばれて、指標の行が返る。希望も割り当ても段に渡っている（→ core.js の build）',
  [metricsOf(output['指標'], people.a), metricsOf(output['指標'], people.b)],
  [{ '合計時間': 0, 'シフト回数': 0, '準備回数': 0 }, { '合計時間': 0.5, 'シフト回数': 1, '準備回数': 0 }],
)

check(
  '⑥ 「指標を出す」は、まだ作っていない段に出てこない',
  output.notBuilt.map((step) => step.name),
  [],
)

// ---- 結果 ------------------------------------------------------------------

console.log('指標を出す側の検査（src/fairness-metrics.js／スプレッドシート無し）')
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
