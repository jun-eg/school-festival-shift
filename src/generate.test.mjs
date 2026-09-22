#!/usr/bin/env node
// 生成する側の検査 — src/generate.js を、スプレッドシートを 1 つも作らずに走らせる。
//
//   使い方: node src/generate.test.mjs
//
// 見るものは 6 つある（issue #151 の受け入れ条件 4 つと、その適用の順序 → 5-5）。
//   ① 違反 0 の案が 1 つ出る（数える側に食わせて 0 件 → 5-4・count-violations.js）
//   ② 人数が足りない枠が全部名指しで出る（置いた数 ＋ あと何人 ＝ 需要 → 5-4・name-unmet.js）
//   ③ 同じ入力からは同じ案が出る（決定的である → 6 の #3 の理由 ③）
//   ④ 外部のソルバーを読んでいない（→ 6 の #3）
//   ⑤ 5-5 の適用の順序どおりに置く（きつい順 ／ 入れ替え 1 手 ／ 帯の中 ／ 氏名は空）
//   ⑥ 決まらない入力で止まり、コアの段として繋がっている
//   ⑦ 担当者の手直し（固定）を先に置き、再実行で残す。置けない固定は名指しで返し、違反は作らない（→ 5-3・issue #156）
//
// 規則を決めたのは上流である（→ docs/tech-requirements.md 3）。方式は 6 の #3、適用の順序は 5-5 が持つ。
// 扱いが動いたら、ここと src/generate.js の generationOrder ／ generationNotAimed が一緒に動く。
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

const coreFiles = ['sheet-layout.js', 'input-types.js', 'core.js', 'count-violations.js', 'name-unmet.js', 'fairness-metrics.js', 'take-in.js', 'expand.js', 'generate.js']

function load(files) {
  const context = vm.createContext({})
  for (const name of files) {
    vm.runInContext(fs.readFileSync(path.join(here, name), 'utf8'), context, { filename: name })
  }
  return context
}

// shell.js を読むのは、モックの CSV を回答シートに貼ったときの表現に揃えるためである（→ ①）。
const context = load(coreFiles.concat(['shell.js']))
const {
  generate, expand, takeIn, countViolations, nameUnmet, nameFixedConflicts, builtInSteps, sheetColumns, formatDateTime,
  toDays, toNeeds, toCookLeaderGrades, toPrepCleanupRule, toPlacementRule,
  demandUnits, fillTightestFirst, swapWithinSlot, placedCount, minRunSlotsToPlaceBy,
} = context
const { generationOrder, generationNotAimed, runExceptions, coreSteps, ruleRoles, checkKind } = vm.runInContext(
  '({ generationOrder, generationNotAimed, runExceptions, coreSteps, ruleRoles, checkKind })',
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
// 枠も需要も刻み直さない。条件入力の行を型に通して、出てきたものをそのまま食わせる。

const assignmentColumns = sheetColumns('割り当て')
const checkResultColumns = sheetColumns('検証結果')

/** ふつうの 1 日。08:00-10:00 が準備の帯、10:00-18:00 が調理の帯、18:00-20:00 が片付けの帯である。 */
const plainDay = ['2025-11-01', '08:00', '10:00', '18:00', '18:00', '20:00']

/** 希望 1 件（型 #6）。日ごとの回答文字列は、渡した日数と同じ数だけ並べる（→ 4-1）。 */
function wishOf(studentId, answers, more) {
  const one = more || {}
  return {
    studentId: studentId,
    grade: one.grade || '3年生',
    canCook: one.canCook === undefined ? true : one.canCook,
    answers: answers,
  }
}

/** 条件入力の 5 区画を型にする（→ input-types.js）。 */
function conditionsOf(dayRows, needRows, more) {
  const one = more || {}
  return {
    days: toDays(dayRows, '日ごとの営業時刻'),
    roleNeeds: toNeeds(needRows, '役割と必要人数'),
    cookLeaderGrades: toCookLeaderGrades(one.grades || [[3], [4]], '調理責任者の学年'),
    committeeNeeds: toNeeds(one.committee || [], '委員会の指定枠'),
    prepCleanupRule: toPrepCleanupRule(one.boundary === null ? [] : [['午前と午後の境目', one.boundary || '12:00']], '準備・片付けのルール'),
    // 置き方のルール（型 #7）。空で置くと既定の 1 時間である（→ 5-1 の #7）。
    placementRule: toPlacementRule(one.minRun ? [['連続して入る最小の長さ', one.minRun]] : [], '置き方のルール'),
  }
}

/** 展開（#149）から生成（#151）まで通す。返すのは、数える側に食わせられる一式である。 */
function planOf(dayRows, needRows, wishes, more) {
  const conditions = conditionsOf(dayRows, needRows, more)
  const candidates = expand(wishes, conditions.days)
  const rows = generate(candidates, conditions, wishes, (more || {}).fixed || [])
  return { conditions: conditions, candidates: candidates, wishes: wishes, rows: rows }
}

/** 割り当ての 1 列を引く。 */
function columnOf(row, name) {
  return row[assignmentColumns.indexOf(name)]
}

/** その案に置いてある (役割・学籍番号) の並び。 */
function placedAs(plan, role) {
  return plan.rows.filter((row) => columnOf(row, '役割') === role).map((row) => [columnOf(row, '日'), columnOf(row, '開始'), columnOf(row, '学籍番号')])
}

/** 数える側（#141）に食わせる。 */
function violationsOf(plan) {
  return countViolations(plan.rows, plan.conditions, plan.wishes, plan.candidates)
}

/** 未充足の側（#142）に食わせる。 */
function unmetOf(plan) {
  return nameUnmet(plan.rows, plan.conditions)
}

/** 需要に出てくる役割名（必要人数と委員会の指定枠の両方から）。 */
function demandRoles(plan) {
  const roles = []
  plan.conditions.roleNeeds.concat(plan.conditions.committeeNeeds).forEach((need) => {
    if (roles.indexOf(need.role) === -1) roles.push(need.role)
  })
  return roles
}

/**
 * その枠のその役割に要る人数。効く行が複数あれば最大である（→ 5-4）。
 * 未充足の側（name-unmet.js）と同じ読み方を、この検査の側でもう一度書いてある
 * — 生成と未充足が同じ関数を読んでいるので、突き合わせる相手を別に持たないと確かめたことにならない。
 *
 * 時間帯を空けた行が効くのは、その日の 調理開始〜調理終了 の帯である（→ 5-1 の #2・issue #210）。
 * 「全枠」ではない — 営業していない帯に店の役割の需要を立てない。
 */
function requiredFor(plan, day, slot, role) {
  let required = 0
  plan.conditions.roleNeeds.concat(plan.conditions.committeeNeeds).forEach((need) => {
    if (need.role !== role) return
    if (need.date !== '' && need.date !== day.date) return
    const from = need.start === '' ? day.cookStart : need.start
    const to = need.start === '' ? day.cookEnd : need.end
    if (from < slot.end && slot.start < to && need.count > required) required = need.count
  })
  return required
}

/** 需要の合計（のべ何人分か）。枠と役割ごとに要る人数を足す。 */
function demandTotal(plan) {
  let total = 0
  plan.conditions.days.forEach((day) => {
    day.slots.forEach((slot) => {
      demandRoles(plan).forEach((role) => { total += requiredFor(plan, day, slot, role) })
    })
  })
  return total
}

/** 需要を超えて置いてある (日・枠・役割) の一覧。 */
function overPlaced(plan) {
  const over = []
  plan.conditions.days.forEach((day) => {
    day.slots.forEach((slot) => {
      demandRoles(plan).forEach((role) => {
        const here = plan.rows.filter((row) => (
          columnOf(row, '日') === day.date && columnOf(row, '開始') === slot.start && columnOf(row, '役割') === role
        ))
        if (here.length > requiredFor(plan, day, slot, role)) over.push(`${day.date} ${slot.start} ${role}`)
      })
    })
  })
  return over
}

/** 需要のある役割に置いた行の数（規則 3 で置いた準備・片付けは、需要が無ければ入らない）。 */
function placedForDemand(plan) {
  const roles = plan.conditions.roleNeeds.concat(plan.conditions.committeeNeeds).map((need) => need.role)
  return plan.rows.filter((row) => roles.indexOf(columnOf(row, '役割')) !== -1).length
}

// ---- ① 違反 0 の案が 1 つ出る（受け入れ条件 1） ------------------------------

const fiveRoles = [
  ['', '', '', '調理責任者', 1],
  ['', '', '', '調理', 2],
  ['', '', '', '会計', 1],
  ['', '', '', '呼び込み', 2],
  ['', '', '', '列整理', 2],
]

const wholeDayWishes = []
for (let i = 0; i < 10; i++) {
  wholeDayWishes.push(wishOf(`EED200000${i}`, ['8:00-20:00'], {
    grade: ['1年生', '2年生', '3年生', '4年生'][i % 4],
    canCook: i % 2 === 0,
  }))
}

/**
 * 準備・片付けの需要は、時間帯を明示して置く（→ 5-1 の #2・issue #210）。
 * 空欄で書くと、その日の 調理開始〜調理終了 の帯に立つ — この 2 つは調理帯の外にある帯なので、
 * 意図した所に立たない。plainDay では 準備が 08:00-10:00、片付けが 18:00-20:00 である。
 */
const prepCleanupNeeds = [['', '08:00', '10:00', '準備', 2], ['', '18:00', '20:00', '片付け', 2]]

const plainPlan = planOf([plainDay], fiveRoles.concat(prepCleanupNeeds), wholeDayWishes)

check('① 違反が 0 件である（→ 受け入れ条件・5-4 の「1 件も作らない」）', violationsOf(plainPlan).length, 0)

check(
  '① 規則 1 — 候補の外に 1 行も置いていない',
  plainPlan.rows.filter((row) => {
    const one = plainPlan.candidates.filter((c) => c.studentId === columnOf(row, '学籍番号') && c.date === columnOf(row, '日'))[0]
    return !one || !one.slots.some((slot) => slot.start === columnOf(row, '開始') && slot.end === columnOf(row, '終了'))
  }),
  [],
)

check(
  '① 規則 4 — 調理責任者に立つのは 3 年生と 4 年生だけである',
  placedAs(plainPlan, ruleRoles.cookLeader)
    .map((one) => plainPlan.wishes.filter((wish) => wish.studentId === one[2])[0].grade)
    .filter((grade) => ['3年生', '4年生'].indexOf(grade) === -1),
  [],
)

check(
  '① 規則 5 — 調理の枠（調理責任者を含む）に立つのは 調理担当ですか？ が はい の人だけである',
  placedAs(plainPlan, ruleRoles.cook).concat(placedAs(plainPlan, ruleRoles.cookLeader))
    .filter((one) => !plainPlan.wishes.filter((wish) => wish.studentId === one[2])[0].canCook),
  [],
)

check(
  '① 同じ人を同じ 30 分枠に 2 つ置いていない（→ 5-4 の二重）',
  plainPlan.rows
    .map((row) => `${columnOf(row, '学籍番号')} ${columnOf(row, '日')} ${columnOf(row, '開始')}`)
    .filter((key, at, all) => all.indexOf(key) !== at),
  [],
)

// 規則 3 の ②〜⑤ — その人のその日で見る（→ 3 の規則 3）。
/** その人のその日が、準備・片付けにどう入っているか。 */
function prepCleanupOf(plan, studentId, date) {
  const mine = plan.rows.filter((row) => columnOf(row, '学籍番号') === studentId && columnOf(row, '日') === date)
  const roles = mine.map((row) => columnOf(row, '役割'))
  return {
    prep: roles.indexOf(ruleRoles.prep) !== -1,
    cleanup: roles.indexOf(ruleRoles.cleanup) !== -1,
    business: mine.filter((row) => [ruleRoles.prep, ruleRoles.cleanup].indexOf(columnOf(row, '役割')) === -1).length,
  }
}

const morningOnly = planOf([plainDay], fiveRoles, [wishOf('EED2000100', ['8:00-11:00'])])
const afternoonOnly = planOf([plainDay], fiveRoles, [wishOf('EED2000101', ['13:00-20:00'])])
const bothHalves = planOf([plainDay], fiveRoles, [wishOf('EED2000102', ['8:00-20:00'])])

check(
  '① 規則 3 の ② — 午前だけの人は 準備 に入り、片付け には入らない',
  [prepCleanupOf(morningOnly, 'EED2000100', '2025-11-01').business > 0, prepCleanupOf(morningOnly, 'EED2000100', '2025-11-01').prep, prepCleanupOf(morningOnly, 'EED2000100', '2025-11-01').cleanup],
  [true, true, false],
)

check(
  '① 規則 3 の ③ — 午後だけの人は 片付け に入り、準備 には入らない',
  [prepCleanupOf(afternoonOnly, 'EED2000101', '2025-11-01').business > 0, prepCleanupOf(afternoonOnly, 'EED2000101', '2025-11-01').prep, prepCleanupOf(afternoonOnly, 'EED2000101', '2025-11-01').cleanup],
  [true, false, true],
)

check(
  '① 規則 3 の ④ — 午前と午後の両方にある人は、準備 と 片付け の片方だけに入る',
  [prepCleanupOf(bothHalves, 'EED2000102', '2025-11-01').prep, prepCleanupOf(bothHalves, 'EED2000102', '2025-11-01').cleanup],
  [true, false],
)

// ⑤ どちらも無い日 — 調理担当 いいえ で調理の需要しか無いので、1 行も置かれない。
const notPlaced = planOf([plainDay], [['', '', '', '調理', 1]], [wishOf('EED2000103', ['8:00-20:00'], { canCook: false })])

check(
  '① 規則 3 の ⑤ — その日に 1 行も置かれなかった人は、準備 にも 片付け にも入らない',
  notPlaced.rows,
  [],
)

// ---- ② 人数が足りない枠が全部名指しで出る（受け入れ条件 2） -----------------

const shortPlan = planOf([plainDay], fiveRoles, [
  wishOf('EED2000200', ['8:00-20:00']),
  wishOf('EED2000201', ['8:00-20:00'], { canCook: false, grade: '1年生' }),
])

check(
  '② 置いた数 ＋ あと何人 の合計が、需要の合計と一致する（名指しされていない未充足が 0 件 → 5-4）',
  placedForDemand(shortPlan) + unmetOf(shortPlan).reduce((sum, row) => sum + row[checkResultColumns.indexOf('あと何人')], 0),
  demandTotal(shortPlan),
)

// 枠の側から埋める役割は、需要を超えない。準備・片付けはそうではない — 規則 3 が要るのは「入っていること」
// なので、帯の需要が尽きても帯の頭に 1 枠置く（→ 5-5 の「準備・片付けをどこに置くか」・placeInBand）。
// その 2 つをここで数えると、規則 3 を満たしたことが超過として出る。
check(
  '② 必要人数を超えて置いていない（需要のある枠と役割ごとに見る。準備・片付けは規則 3 が置くので除く → 5-5）',
  overPlaced(plainPlan).filter((one) => [ruleRoles.prep, ruleRoles.cleanup].indexOf(one.split(' ')[2]) === -1),
  [],
)

// 帯を 1 枠も希望していない人は、その日に置けない — 置けば規則 1 か規則 3 のどちらかが破れる（→ 5-5）。
const noBandPlan = planOf([plainDay], fiveRoles, [wishOf('EED2000202', ['10:00-14:00'])])

check(
  '② 満たせない枠は埋めずに残す — 帯を 1 枠も希望していない人は置かず、枠は未充足で残る（→ 5-5）',
  [noBandPlan.rows.length, violationsOf(noBandPlan).length, unmetOf(noBandPlan).length > 0],
  [0, 0, true],
)

check(
  '②「解なし」で止まらない — 1 人も置けなくても案が返る（→ 5 の #6）',
  Array.isArray(noBandPlan.rows),
  true,
)

check(
  '② 需要が 1 行も無い年は、置く先が無いので 0 行である（止まらない）',
  planOf([plainDay], [], [wishOf('EED2000203', ['8:00-20:00'])]).rows,
  [],
)

// ---- ③ 同じ入力からは同じ案が出る（受け入れ条件 3） -------------------------

check(
  '③ 同じ入力を 2 回渡すと、同じ案が返る（→ 6 の #3 の理由 ③）',
  JSON.stringify(planOf([plainDay], fiveRoles, wholeDayWishes).rows),
  JSON.stringify(planOf([plainDay], fiveRoles, wholeDayWishes).rows),
)

const generateSource = fs.readFileSync(path.join(here, 'generate.js'), 'utf8')

check(
  '③ 乱数も現在時刻も読んでいない（同じ入力で案が変わる元を持たない）',
  ['Math.random', 'new Date', 'Date.now'].filter((name) => generateSource.includes(name)),
  [],
)

// ---- ④ 外部のソルバーを読んでいない（受け入れ条件 4） -----------------------

check(
  '④ 外から読み込むものが 0 個である（→ 6 の #3・6 の #8）',
  ['require(', 'import ', 'UrlFetchApp', 'eval(', 'SpreadsheetApp'].filter((name) => generateSource.replace(/\/\*[\s\S]*?\*\//g, '').includes(name)),
  [],
)

// ---- ⑤ 5-5 の適用の順序どおりに置く ----------------------------------------

// きつい順 — 書いた順に埋めると、調理に立てる 1 人が会計に取られて調理が空く。
const tightWishes = [
  wishOf('EED2000300', ['8:00-20:00'], { canCook: true }),
  wishOf('EED2000301', ['8:00-20:00'], { canCook: false }),
]
const tightPlan = planOf([plainDay], [['', '', '', '会計', 1], ['', '', '', '調理', 1]], tightWishes)

check(
  '⑤ 制約のきつい枠から埋める — 会計を先に書いても、調理に立てる 1 人は調理に立つ（→ 5-5 の「埋める順」）',
  [
    placedAs(tightPlan, '調理').map((one) => one[2]).filter((id, at, all) => all.indexOf(id) === at),
    placedAs(tightPlan, '会計').map((one) => one[2]).filter((id, at, all) => all.indexOf(id) === at),
  ],
  [['EED2000300'], ['EED2000301']],
)

// 入れ替え 1 手 — 貪欲だけでは埋まらない枠が、同じ枠の中の入れ替えで埋まる。
const swapWishes = [
  wishOf('EED2000400', ['8:00-20:00'], { canCook: true }),
  wishOf('EED2000401', ['8:00-20:00'], { canCook: true }),
  wishOf('EED2000402', ['8:00-20:00'], { canCook: false }),
]
// 需要を 1 枠に絞る。会計（2 人）を先に書いてあるので、貪欲だけだと調理に立てる 2 人が会計に入る。
const swapConditions = conditionsOf([plainDay], [
  ['2025-11-01', '10:00', '10:30', '会計', 2],
  ['2025-11-01', '10:00', '10:30', '調理', 1],
])
const swapCandidates = expand(swapWishes, swapConditions.days)

/** 貪欲だけ・入れ替えまで、の 2 通りで、その枠のその役割が何人埋まったかを見る。 */
function filledAfter(withSwap) {
  const people = context.peopleToPlace(swapCandidates, swapWishes)
  const needs = swapConditions.roleNeeds.map((need) => ({ source: { key: 'roleNeeds', label: '必要人数' }, need: need }))
  const units = demandUnits(needs, swapConditions.days, people, swapConditions)
  const board = { placed: {} }
  fillTightestFirst(board, units, '12:00')
  if (withSwap) swapWithinSlot(board, units, '12:00')
  const slot = swapConditions.days[0].slots.filter((one) => one.start === '10:00')[0]
  return [placedCount(board, '2025-11-01', slot, '会計'), placedCount(board, '2025-11-01', slot, '調理')]
}

check(
  '⑤ 同じ枠の中の入れ替え 1 手で詰める — 貪欲だけでは調理が空き、入れ替えで埋まる（→ 6 の #3）',
  [filledAfter(false), filledAfter(true)],
  [[2, 0], [2, 1]],
)

// 帯の中にしか置かない（→ 5-5）。準備は 08:00-10:00、片付けは 18:00-20:00 である。
const bandPlan = planOf([plainDay], fiveRoles.concat(prepCleanupNeeds), wholeDayWishes)

check(
  '⑤ 準備・片付けは、その日の帯の中にしか置かない（→ 5-5・5-1 の #1）',
  [
    placedAs(bandPlan, ruleRoles.prep).filter((one) => one[1] < '08:00' || one[1] >= '10:00'),
    placedAs(bandPlan, ruleRoles.cleanup).filter((one) => one[1] < '18:00' || one[1] >= '20:00'),
  ],
  [[], []],
)

// 枠の中で採るのは、置いた数が少ない人から（同数なら候補の順）。
const evenWishes = [
  wishOf('EED2000500', ['8:00-20:00']),
  wishOf('EED2000501', ['8:00-20:00']),
  wishOf('EED2000502', ['8:00-20:00']),
]
const evenPlan = planOf([plainDay], [['', '', '', '会計', 1]], evenWishes)

check(
  '⑤ 枠の中で採るのは、その日にまだ置いた枠が少ない人から（同数なら候補の順 → 5-5）',
  placedAs(evenPlan, '会計').slice(0, 6).map((one) => one[2]),
  [
    'EED2000500', 'EED2000500',
    'EED2000501', 'EED2000501',
    'EED2000502', 'EED2000502',
  ],
)

// まとまりの長さは条件入力から来る（→ 5-1 の #7）。ここが動けば塊の長さが動く。
check(
  '⑤ 「連続して入る最小の長さ」を 2 時間にすると、塊が 4 枠になる（→ 5-1 の #7・5-5）',
  placedAs(planOf([plainDay], [['', '', '', '会計', 1]], evenWishes, { minRun: '2:00' }), '会計')
    .slice(0, 8).map((one) => one[2]),
  [
    'EED2000500', 'EED2000500', 'EED2000500', 'EED2000500',
    'EED2000501', 'EED2000501', 'EED2000501', 'EED2000501',
  ],
)

check(
  '⑤ まとまりの長さは、分から枠の数になる（30 分の刻みは動かない → 規則 1 の ①）',
  ['0:30', '1:00', '1:30', '2:00'].map((written) => minRunSlotsToPlaceBy({
    placementRule: toPlacementRule([['連続して入る最小の長さ', written]], '置き方のルール'),
  })),
  [1, 2, 3, 4],
)

check(
  '⑤ 氏名は空である — 型 #6 に氏名は無い（→ 5 の #1・5-5）',
  plainPlan.rows.map((row) => columnOf(row, '氏名')).filter((name) => name !== ''),
  [],
)

// 役割名は弾かない（→ 規則 6 の ③）。5 役割に無い名前の指定枠にも置く。
const patrolPlan = planOf([plainDay], fiveRoles, wholeDayWishes, {
  committee: [['2025-11-01', '12:00', '12:15', 'クリーンパトロール', 1]],
})

check(
  '⑤ 役割名を弾かない — 5 役割に無い名前（クリーンパトロール）にも置く（→ 規則 6 の ③・5-5）',
  placedAs(patrolPlan, 'クリーンパトロール').length > 0,
  true,
)

check(
  '⑤ 指定枠は重なる枠に効く — 12:00-12:15 の指定が 12:00-12:30 の枠に置かれる（→ 3 の境界値の表）',
  placedAs(patrolPlan, 'クリーンパトロール').map((one) => one[1]),
  ['12:00'],
)

check(
  '⑤ 踏む段は 5 つで（固定が先頭 → 5-3）、目的にしないものは 4 つ名前で置いてある（⑥・1 日の上限・前の周の機械のセル・氏名 → 5-5）',
  [generationOrder.map((step) => step.key), generationNotAimed.map((one) => one.what)],
  [
    ['fixed', 'fill', 'swap', 'prepCleanup', 'prepCleanupDemand'],
    [
      '規則 3 の ⑥（複数日で偏らせない）',
      '1 日の上限（例: 中央の 1.5 倍まで）',
      '前の周に機械が置いたセル',
      '割り当ての 氏名',
    ],
  ],
)

// まとまりで置けない端は、名前で持ってある（→ runExceptions・issue #215 の ②）。
check(
  '⑤ まとまりで置けない端が 5 つ名前で置いてある（隠さない → 5-5・count-violations.js の同じ置き方）',
  runExceptions.map((one) => one.what),
  ['希望の切れ目', '帯の切れ目', '需要の切れ目', '規則 3 の端', 'そこしか置けないとき'],
)

// ---- ⑦ 固定を先に置き、再実行で残す（→ 5-3 ／ issue #156） ------------------
// 手直しの行は 日 ／ 開始（マス目の見出しの時刻）／ 役割 ／ 学籍番号 である（→ sheet-layout.js の fixedColumns）。
// 役割が空の行は「この人をこの枠に置かない」である。

/** 手直し 1 件。 */
function fixOf(start, role, studentId, date) {
  return [date || '2025-11-01', start, role, studentId]
}

/** その案に、その人がその枠のその役割で入っているか。 */
function isAt(plan, start, role, studentId) {
  return plan.rows.some((row) => (
    columnOf(row, '開始') === start && columnOf(row, '役割') === role && columnOf(row, '学籍番号') === studentId
  ))
}

/** 固定を渡して案を組み、名指しもいっしょに返す。 */
function fixedPlanOf(needRows, wishes, fixed, more) {
  const plan = planOf([plainDay], needRows, wishes, Object.assign({}, more || {}, { fixed: fixed }))
  plan.conflicts = nameFixedConflicts(fixed, plan.candidates, plan.conditions, plan.wishes)
  return plan
}

/** 名指しの行から (開始・役割・学籍番号・内容) を引く。 */
function conflictsOf(plan) {
  return plan.conflicts.map((row) => ['開始', '役割', '学籍番号', '内容'].map((name) => row[checkResultColumns.indexOf(name)]))
}

// 担当者が前の周の案に赤を入れた — 店の役割（調理の外）の 3 セルを別の役割に書き換え、1 セルを空にした。
// そのあと締切後の提出が 1 人来た（→ 5 の #11 の「締切後の提出 ◎」）。再実行しても、書き換えた 4 セルが戻らない。
const shopRows = plainPlan.rows.filter((row) => ['会計', '呼び込み', '列整理'].indexOf(columnOf(row, '役割')) !== -1)
const rotated = { '会計': '呼び込み', '呼び込み': '列整理', '列整理': '会計' }
const handFixes = shopRows.slice(0, 3)
  .map((row) => fixOf(columnOf(row, '開始'), rotated[columnOf(row, '役割')], columnOf(row, '学籍番号')))
  .concat([fixOf(columnOf(shopRows[3], '開始'), '', columnOf(shopRows[3], '学籍番号'))])
const lateWishes = wholeDayWishes.concat([wishOf('EED2000100', ['8:00-20:00'], { grade: '4年生' })])
const rerun = fixedPlanOf(fiveRoles.concat(prepCleanupNeeds), lateWishes, handFixes)

check(
  '⑦ 再実行しても、担当者が書き換えたセルが 1 つも戻らない（書き換えた 3 セルは書いた役割のまま → 5 の #11）',
  handFixes.slice(0, 3).map((fix) => isAt(rerun, fix[1], fix[2], fix[3])),
  [true, true, true],
)

check(
  '⑦ 空にしたセルも戻らない — その人はその枠に置かれない（ほかの人がその役割を埋めるのは構わない）',
  rerun.rows.filter((row) => columnOf(row, '開始') === handFixes[3][1] && columnOf(row, '学籍番号') === handFixes[3][3]),
  [],
)

check(
  '⑦ 固定を積んで再実行しても、違反は 0 件で、名指しされる固定も 0 件である（どれも条件を満たしている）',
  [violationsOf(rerun).length, rerun.conflicts.length],
  [0, 0],
)

/** 需要のある (日・枠・役割) ごとに、置いた数を要る人数で頭打ちにして足す（手直しの超過は需要を埋めたぶんだけ数える）。 */
function placedUpToDemand(plan) {
  let total = 0
  plan.conditions.days.forEach((day) => {
    day.slots.forEach((slot) => {
      demandRoles(plan).forEach((role) => {
        const here = plan.rows.filter((row) => (
          columnOf(row, '日') === day.date && columnOf(row, '開始') === slot.start && columnOf(row, '役割') === role
        )).length
        total += Math.min(here, requiredFor(plan, day, slot, role))
      })
    })
  })
  return total
}

check(
  '⑦ 未充足の名指しは、固定を積んでも欠けない（要る人数までに置いた数 ＋ あと何人 ＝ 需要）',
  placedUpToDemand(rerun) + unmetOf(rerun).reduce((sum, row) => sum + row[checkResultColumns.indexOf('あと何人')], 0),
  demandTotal(rerun),
)

check(
  '⑦ 同じ固定からは同じ案が出る（決定的である → 6 の #3 の理由 ③）',
  JSON.stringify(fixedPlanOf(fiveRoles.concat(prepCleanupNeeds), lateWishes, handFixes).rows),
  JSON.stringify(rerun.rows),
)

// 要る人数（会計 1）を超える固定は、違反ではないので置く（→ 5-4）。生成はその枠に人を足さない。
const overPlan = fixedPlanOf(fiveRoles, wholeDayWishes, [
  fixOf('14:00', '会計', 'EED2000001'), fixOf('14:00', '会計', 'EED2000003'),
])
check(
  '⑦ 要る人数を超える固定も置く（超過は違反ではない → 5-4）。その枠には生成が人を足さない',
  [
    overPlan.rows.filter((row) => columnOf(row, '開始') === '14:00' && columnOf(row, '役割') === '会計').map((row) => columnOf(row, '学籍番号')),
    violationsOf(overPlan).length,
  ],
  [['EED2000001', 'EED2000003'], 0],
)

// 食い違った固定 — 置けば条件を破るので置かず、理由と一緒に名指しで返す（→ 5-3）。
//   EED2000001 は 2 年生・調理担当ですか？ が いいえ（i = 1）／ EED2000000 は 1 年生（i = 0）
//   EED2000200 は 11:00 までしか希望していない
const narrowWishes = wholeDayWishes.concat([wishOf('EED2000200', ['8:00-11:00'])])
const conflictPlan = fixedPlanOf(fiveRoles.concat(prepCleanupNeeds), narrowWishes, [
  fixOf('10:00', '調理', 'EED2000001'),
  fixOf('10:30', '調理責任者', 'EED2000000'),
  fixOf('15:00', '会計', 'EED2000200'),
  fixOf('11:00', '会計', 'EED2009999'),
  fixOf('07:00', '会計', 'EED2000002'),
  fixOf('12:00', '会計', 'EED2000004'),
  fixOf('12:00', '列整理', 'EED2000004'),
])

check(
  '⑦ 条件を破る固定は置かず、どの規則で置けないかを名指しで返す（見る順は 枠 → 二重 → 規則 1 → 5 → 4 → 3）',
  conflictsOf(conflictPlan),
  [
    ['10:00', '調理', 'EED2000001', '規則 5: 調理の枠（調理）だが、調理担当ですか？ が いいえ である'],
    ['10:30', '調理責任者', 'EED2000000', '規則 4: 調理責任者 の枠だが、学年が 3年生 / 4年生 でない（いま: 1年生）'],
    ['11:00', '会計', 'EED2009999', '規則 1: この人の回答が無い'],
    ['12:00', '列整理', 'EED2000004', '同じ枠に二重: 同じ人の同じ 30 分枠に、手直しがもう 1 つある'],
    ['15:00', '会計', 'EED2000200', '規則 1: 希望の時間の外である'],
    ['07:00', '会計', 'EED2000002', 'いまの 2025-11-01 の枠に「07:00」が無い（条件入力の「日ごとの営業時刻」が動いた）'],
  ],
)

check(
  '⑦ 名指しした固定は案に入っておらず（黙って置かない）、固定のせいで違反は 1 件も作られていない',
  [
    [
      isAt(conflictPlan, '10:00', '調理', 'EED2000001'),
      isAt(conflictPlan, '10:30', '調理責任者', 'EED2000000'),
      isAt(conflictPlan, '15:00', '会計', 'EED2000200'),
      isAt(conflictPlan, '12:00', '列整理', 'EED2000004'),
    ],
    isAt(conflictPlan, '12:00', '会計', 'EED2000004'),
    violationsOf(conflictPlan).length,
  ],
  [[false, false, false, false], true, 0],
)

// 規則 3 と固定 — 準備・片付けの手直しは、店の割り当てが出そろってから向きを見る（→ releaseMisfitBandFixes）。
//   EED2000300 … 午前の店の時間を希望していない（8:00-9:00 と 14:00-15:00 と 18:00-19:00）。
//                午後だけの店の固定（14:00 会計）＋ 準備の固定 → 生成が午前を足せないので ③ のまま。準備を外して名指しする
//   EED2000003 … 1 日じゅう希望している。午後だけの店の固定 ＋ 準備の固定 → 生成が午前に店の枠を足せば ④ で満たす
//   EED2000005 … 午前の店の固定（10:00 会計）＋ 準備の固定 → ② のとおりなので両方置く。生成は片付けを足さない
//   EED2000007 … 準備と片付けの両方を固定 → 後から来た片付けは置かない（④ 片方だけ）
const rule3Wishes = wholeDayWishes.concat([wishOf('EED2000300', ['8:00-9:00,14:00-15:00,18:00-19:00'], { canCook: false })])
const rule3Plan = fixedPlanOf(fiveRoles.concat(prepCleanupNeeds), rule3Wishes, [
  fixOf('14:00', '会計', 'EED2000300'), fixOf('08:00', '準備', 'EED2000300'),
  fixOf('14:00', '呼び込み', 'EED2000003'), fixOf('08:30', '準備', 'EED2000003'),
  fixOf('10:00', '会計', 'EED2000005'), fixOf('09:00', '準備', 'EED2000005'),
  fixOf('09:30', '準備', 'EED2000007'), fixOf('18:30', '片付け', 'EED2000007'),
])

check(
  '⑦ 規則 3 と向きの合わない準備・片付けの固定は、どう合わないかを名指しで返す（→ 3 の規則 3 の ③④）',
  conflictsOf(rule3Plan).map((one) => [one[0], one[1], one[2], one[3].slice(0, 7)]),
  [
    ['18:30', '片付け', 'EED2000007', '規則 3: そ'],
    ['08:00', '準備', 'EED2000300', '規則 3: ③'],
  ],
)

check(
  '⑦ 外した後は、その日の正しい側が置かれる（午後だけ → 片付け。違反にしない）',
  rule3Plan.rows.filter((row) => columnOf(row, '学籍番号') === 'EED2000300').map((row) => [columnOf(row, '開始'), columnOf(row, '役割')]),
  [['14:00', '会計'], ['18:00', '片付け']],
)

check(
  '⑦ 生成が反対側の半日に店の枠を足せるなら、準備の固定は外さない（午前の店の枠が足され、④ で満たす）',
  [
    isAt(rule3Plan, '08:30', '準備', 'EED2000003'),
    rule3Plan.rows.some((row) => columnOf(row, '学籍番号') === 'EED2000003' && columnOf(row, '開始') < '12:00'
      && ['準備', '片付け'].indexOf(columnOf(row, '役割')) === -1),
  ],
  [true, true],
)

check(
  '⑦ 向きの合う準備の固定は置き、その日の規則 3 はそれで満たす（生成が片付けを足して ④ を壊さない）',
  [
    isAt(rule3Plan, '09:00', '準備', 'EED2000005'),
    rule3Plan.rows.filter((row) => columnOf(row, '学籍番号') === 'EED2000005' && columnOf(row, '役割') === '片付け').length,
    isAt(rule3Plan, '09:30', '準備', 'EED2000007'),
  ],
  [true, 0, true],
)

check(
  '⑦ 準備・片付けを固定した人が居ても、生成が規則 3 を破る置き方をしない（違反 0 件）',
  violationsOf(rule3Plan).length,
  0,
)

// 準備だけを固定した人は、生成が午後だけの店の枠に置かない（置けば ③ で片付けが要り、準備は外せない）。
const prepOnlyPlan = fixedPlanOf(fiveRoles, wholeDayWishes, [fixOf('08:00', '準備', 'EED2000006')])
check(
  '⑦ 準備だけを固定した人を、生成は午後だけの日にしない（違反 0 件・準備の固定は残る）',
  [violationsOf(prepOnlyPlan).length, isAt(prepOnlyPlan, '08:00', '準備', 'EED2000006')],
  [0, true],
)

check(
  '⑦ 需要が 1 行も無くても、固定は置かれる（黙って消えない）',
  fixedPlanOf([], wholeDayWishes, [fixOf('08:00', '準備', 'EED2000006')]).rows.map((row) => [columnOf(row, '開始'), columnOf(row, '役割')]),
  [['08:00', '準備']],
)

check(
  '⑦ 段の表は、固定を照らす段を 156 として持ち、検証結果に書く段である（→ 8 の 11）',
  coreSteps.filter((step) => step.name === '固定を照らす').map((step) => [step.issue, step.writesTo]),
  [[156, '検証結果']],
)

// ---- ⑥ 決まらない入力で止まり、段として繋がっている -------------------------

check(
  '⑥ 午前と午後の境目が無ければ、違反を作らずに名指しして止まる（→ 5-1 の #5）',
  whyItStopped(() => planOf([plainDay], fiveRoles, wholeDayWishes, { boundary: null }))?.includes('午前と午後の境目'),
  true,
)

check(
  '⑥ 調理責任者の学年が空なのに調理責任者の需要があれば、名指しして止まる（→ 5-1 の #3）',
  whyItStopped(() => planOf([plainDay], [['', '', '', '調理責任者', 1]], wholeDayWishes, { grades: [] }))?.includes('調理責任者の学年'),
  true,
)

check(
  '⑥ 候補にあって希望に無い学籍番号は、黙って落とさずに名指しして止まる',
  whyItStopped(() => generate(
    [{ studentId: 'EED2000999', date: '2025-11-01', slots: [{ start: '10:00', end: '10:30' }] }],
    conditionsOf([plainDay], fiveRoles),
    [],
    [],
  ))?.includes('EED2000999'),
  true,
)

check(
  '⑥ どの 30 分枠にも重ならない需要は、黙って落とさずに名指しして止まる（→ 5-4）',
  whyItStopped(() => planOf([plainDay], [['2025-11-09', '', '', '会計', 1]], wholeDayWishes))?.includes('30 分枠に 1 つも重ならない'),
  true,
)

check(
  '⑥ 段の表は、この段の issue を 151 として持ち、割り当てシートに書く段である（→ 8 の 8）',
  coreSteps.filter((step) => step.name === '生成する').map((step) => [step.issue, step.writesTo]),
  [[151, '割り当て']],
)

check(
  '⑥ generate.js が貼られていなければ、名指しして止まる（→ core.js の builtInSteps）',
  whyItStopped(() => load(coreFiles.filter((name) => name !== 'generate.js')).builtInSteps())
    ?.includes('generate.js が貼られていない'),
  true,
)

check(
  '⑥ 貼られていれば、中身が入っている段として返る',
  typeof builtInSteps()['生成する'],
  'function',
)

// ---- ① 前回の希望データのモックで 1 周通す（→ 7「判定に使う入力データ」） ----
// 判定そのものは #153 の仕事である。ここで見るのは、記録と同じ大きさで違反 0 が出ることだけである。

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

// 前回の 5 時刻は、入力の行としては記録に無い。設問の説明文の営業時間 ◎ から 1 日を 1 本の帯として刻む
// （→ 7 の「前回の 5 時刻の置き方」の M1 ①・フォームの側・expand.test.mjs と同じ置き方である）。
// M2 の判定は別の置き方である（確定シフトの行から算出する → scripts/前回の5時刻.mjs）。
// ここが見るのは記録と同じ大きさ（36 人・88 枠）で違反 0 が出ることだけで、帯の内訳は見ない
// （規則 3 の ①〜⑤ そのものは、上の plainDay の側が 1 つずつ見ている）。
//
// だから需要は時間帯を明示して置く（→ 下の fiveRolesWholeDay・issue #210）。1 本の帯として刻んだ日は
// 調理帯が 0 枠なので、時間帯を空けた行はどの枠にも立たない（→ 5-1 の #2）。
// 帯の内訳を見ないこの置き方で、内訳に依る書き方（空欄）を使わない。
const lastYearDayRows = [
  ['2025-11-01', '08:00', '08:00', '08:00', '08:00', '21:00'],
  ['2025-11-02', '08:00', '08:00', '08:00', '08:00', '20:00'],
  ['2025-11-03', '08:00', '08:00', '08:00', '08:00', '20:00'],
  ['2025-11-04', '08:00', '08:00', '08:00', '08:00', '15:00'],
]

// 終端 ≤ 始端の区間を書いた 3 人は、展開の側で止まる（→ expand.test.mjs の ③）。残る 36 人で組む。
const lastYearDays = toDays(lastYearDayRows, '日ごとの営業時刻')
const expandable = mockWishes.filter((wish) => whyItStopped(() => expand([wish], lastYearDays)) === null)

// 5 役割を、4 日の全枠に効かせる。どの日も 08:00 に始まり、いちばん遅い日でも 21:00 に終わる（→ 上の 4 行）
// ので、08:00-21:00 の 1 行が全 88 枠に重なる。数えるのは規模（88 枠 × 8 人 ＝ のべ 704）である。
const fiveRolesWholeDay = fiveRoles.map((need) => ['', '08:00', '21:00', need[3], need[4]])
const mockPlan = planOf(lastYearDayRows, fiveRolesWholeDay, expandable)

check(
  '① 前回の希望データ（モック）36 人・88 枠で、違反が 0 件である（→ 5-4 の「1 件も作らない」）',
  [expandable.length, mockPlan.conditions.days.reduce((sum, day) => sum + day.slots.length, 0), violationsOf(mockPlan).length],
  [36, 88, 0],
)

check(
  '② 前回のモックでも、置いた数 ＋ あと何人 が需要の合計（5 役割 ◎ × 88 枠 ＝ 704）と一致する',
  [
    demandTotal(mockPlan),
    placedForDemand(mockPlan) + unmetOf(mockPlan).reduce((sum, row) => sum + row[checkResultColumns.indexOf('あと何人')], 0),
  ],
  [704, 704],
)

check('② 前回のモックでも、必要人数を超えて置いていない', overPlaced(mockPlan), [])

check(
  '③ 前回のモックでも、2 回通すと同じ案が返る（→ 6 の #3 の理由 ③）',
  JSON.stringify(planOf(lastYearDayRows, fiveRolesWholeDay, expandable).rows),
  JSON.stringify(mockPlan.rows),
)

// 前回のモックの大きさで、手直しを積んで通し直す（→ 5 の #11「動かしたセルが 1 つも戻っていない」・issue #156）。
// 案の 7 行に 1 行を手直しにする — 店の役割（調理の外）は別の役割に書き換え、それ以外は書いてあるとおりに固定する。
// 11 行に 1 行（7 の倍数を除く）は、セルを空にする（その人をその枠に置かない）。
const mockFixes = []
mockPlan.rows.forEach((row, index) => {
  const at = [columnOf(row, '日'), columnOf(row, '開始')]
  const role = columnOf(row, '役割')
  if (index % 7 === 0) mockFixes.push(at.concat([rotated[role] || role, columnOf(row, '学籍番号')]))
  else if (index % 11 === 0) mockFixes.push(at.concat(['', columnOf(row, '学籍番号')]))
})
const mockRerun = planOf(lastYearDayRows, fiveRolesWholeDay, expandable, { fixed: mockFixes })
const mockConflicts = nameFixedConflicts(mockFixes, mockRerun.candidates, mockRerun.conditions, mockRerun.wishes)
const mockNamed = mockConflicts.map((row) => ['日', '開始', '学籍番号'].map((name) => row[checkResultColumns.indexOf(name)]).join(' '))
const mockReturned = mockFixes.filter((fix) => {
  if (mockNamed.indexOf([fix[0], fix[1], fix[3]].join(' ')) !== -1) return false // 名指しで返したものは除く（→ 5 の #11）
  const here = mockRerun.rows.filter((row) => (
    columnOf(row, '日') === fix[0] && columnOf(row, '開始') === fix[1] && columnOf(row, '学籍番号') === fix[3]
  ))
  return fix[2] === '' ? here.length > 0 : !here.some((row) => columnOf(row, '役割') === fix[2])
})

check(
  '⑦ 前回のモックでも、手直しを積んで通し直すと、戻ったセルが 0（名指しで返したものを除く）で、違反も 0 件である',
  [mockFixes.length > 100, mockReturned.length, violationsOf(mockRerun).length],
  [true, 0, 0],
)

// このモックの置き方は準備の帯が 0 枠である（1 日 1 本の帯 → 上の lastYearDayRows）。午前だけの店の手直しは、
// 生成が同じ人の午後の枠を足せたときだけ満たせる（④ → 片付け）。足せなかった日の手直しだけが名指しで返る
// （外すのは、残りで規則 3 を満たせる最小の側である → generate.js の releaseFixesBreakingRule3）。
check(
  '⑦ 前回のモックで名指しされるのは、規則 3 を満たせない日の手直しだけで、名指しは手直しの 1 割に満たない',
  [
    mockConflicts.every((row) => row[checkResultColumns.indexOf('内容')].startsWith('規則 3: ')),
    mockConflicts.length * 10 < mockFixes.length,
  ],
  [true, true],
)

check(
  '② 検証結果に並ぶのは、違反と未充足の 2 種別だけである（→ 5-4）',
  violationsOf(mockPlan).concat(unmetOf(mockPlan))
    .map((row) => row[checkResultColumns.indexOf('種別')])
    .filter((kind) => [checkKind.violation, checkKind.unmet].indexOf(kind) === -1),
  [],
)

// ---- 出す -------------------------------------------------------------------

console.log('\n生成する側の検査（src/generate.js／スプレッドシート無し）\n')
passed.forEach((title) => console.log(`  OK   ${title}`))
failed.forEach((one) => {
  console.log(`  NG   ${one.title}`)
  console.log(`         実測: ${JSON.stringify(one.actual)}`)
  console.log(`         期待: ${JSON.stringify(one.expected)}`)
})
console.log(`\n結果: ${failed.length === 0 ? `全件一致（${passed.length} 件）` : `不一致 ${failed.length} 件 ／ 一致 ${passed.length} 件`}\n`)
process.exit(failed.length === 0 ? 0 : 1)
