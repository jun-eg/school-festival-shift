#!/usr/bin/env node
// コアの検査 — src/core.js を、スプレッドシートを 1 つも作らずに走らせる。
//
//   使い方: node src/core.test.mjs
//
// 見るものは 6 つある。
//   ① コアの側のファイルに SpreadsheetApp が出てこない（→ 6 の #8）
//   ② 配列を渡すと配列が返る（→ issue #137）
//   ③ 中身の入っていない段は、空の配列を返して名指しで持ち帰る
//   ④ 段を差し替えると、その段だけを先に回せる。生成に渡る固定は手直しだけである（→ 5-3）
//   ⑤ 表現の揺れ・列数の違い・決めていない種別は、名指しで止まる
//   ⑥ 検証結果の候補に、その 30 分枠を希望に含み、その枠にまだ置かれていない人の学籍番号が並ぶ（→ issue #246 ／ #254）
//
// 殻の検査は src/shell.test.mjs が持つ。

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// ---- 読み込む ---------------------------------------------------------------
// SpreadsheetApp を文脈に置かない。置かずに通ることを見ている。

const context = vm.createContext({})
for (const name of ['sheet-layout.js', 'input-types.js', 'core.js', 'count-violations.js', 'name-unmet.js', 'fairness-metrics.js', 'take-in.js', 'expand.js', 'generate.js', 'assignment-grid.js']) {
  vm.runInContext(fs.readFileSync(path.join(here, name), 'utf8'), context, { filename: name })
}
// const は文脈のプロパティにならないので、式で取り出す（function は文脈に出る）
const { build, recount, inputNames, conditionNames, sheetColumns, builtInSteps, withCandidates } = context
const { coreSteps, outputNames, sheetLayout, checkKind, inputTypes } = vm.runInContext(
  '({ coreSteps, outputNames, sheetLayout, checkKind, inputTypes })',
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
    return error.detail || error.message
  }
}

/** 骨組みを回すのに足りるだけの入力。日は 4 行で、回答の日ごとの列 4 つと順に当たる。 */
function skeletonInputs(overrides) {
  const inputs = {
    '日ごとの営業時刻': [
      ['2025-11-01', '08:00', '10:00', '18:00', '18:00', '20:00'],
      ['2025-11-02', '08:00', '10:00', '18:00', '18:00', '20:00'],
      ['2025-11-03', '08:00', '10:00', '18:00', '18:00', '20:00'],
      ['2025-11-04', '08:00', '10:00', '18:00', '18:00', '20:00'],
    ],
    '役割と必要人数': [['', '', '', '調理', 2]],
    '調理責任者の学年': [[3], [4]],
    '委員会の指定枠': [],
    '準備・片付けのルール': [['午前と午後の境目', '12:00']],
    '置き方のルール': [],
    '回答': [[
      '2025-09-23 16:31:09', 'EED2349987', '高木琴音', '3年生', 'いいえ', '',
      '8:00-21:00', '8:00-20:00', '8:00-22:00', '8:00-15:00',
    ]],
    '割り当て': [['2025-11-01', '08:00', '08:30', '準備', 'EED2349987', '高木琴音']],
    '手直し': [],
  }
  Object.keys(overrides || {}).forEach((name) => { inputs[name] = overrides[name] })
  return inputs
}

// ---- ① 境目がコードの上に立っているか ---------------------------------------

// コメントの中の SpreadsheetApp は数えない。
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const filesTouchingSpreadsheetApp = fs
  .readdirSync(here)
  .filter((name) => name.endsWith('.js'))
  .filter((name) => stripComments(fs.readFileSync(path.join(here, name), 'utf8')).includes('SpreadsheetApp'))
  .sort()

check(
  '① SpreadsheetApp を掴むのは 4 ファイルだけである（コアの 8 つも、構造の検証も掴まない）',
  filesTouchingSpreadsheetApp,
  ['build-form.js', 'build-template.js', 'menu.js', 'shell.js'],
)

check(
  '① コアを読むのに SpreadsheetApp が要らなかった（この検査が文脈に置いていない）',
  typeof build,
  'function',
)

// .gs は 1 つのグローバルを共有するので、同じ名前が 2 つあると後から貼ったほうが黙って勝つ。
const declaredTwice = []
const declaredIn = {}
fs.readdirSync(here).filter((name) => name.endsWith('.js')).sort().forEach((file) => {
  const source = stripComments(fs.readFileSync(path.join(here, file), 'utf8'))
  const names = source.match(/^(?:function \w+|const \w+ =)/gm) || []
  names.map((line) => line.replace(/^(?:function |const )/, '').replace(/ =$/, '')).forEach((name) => {
    if (declaredIn[name] && declaredIn[name] !== file) declaredTwice.push(`${name}（${declaredIn[name]} と ${file}）`)
    declaredIn[name] = file
  })
})

check('① 同じ名前を 2 つのファイルが最上位に持っていない（.gs は 1 つのグローバルである）', declaredTwice, [])

// ---- ② 配列を渡し、配列を受け取る -------------------------------------------

const checkResultColumns = sheetColumns('検証結果')
const kindColumn = checkResultColumns.indexOf('種別')

function checkResultRow(kind, detail) {
  const row = checkResultColumns.map(() => '')
  row[kindColumn] = kind
  row[checkResultColumns.indexOf('内容')] = detail
  return row
}

const allStepsIn = {
  '取り込む': (answers) => answers.map((row) => [row[1], row[3], row[4]]),
  '展開する': (wishes) => wishes.map((row) => [row[0], '2025-11-01', '08:00', '08:30']),
  '生成する': (candidates) => candidates.map((row) => ['2025-11-01', '08:00', '08:30', '調理', row[0], '高木琴音']),
  '違反を数える': () => [checkResultRow(checkKind.violation, '検便を通っていない')],
  '未充足を名指しする': () => [checkResultRow(checkKind.unmet, 'あと 1 人')],
  '指標を出す': (assignments) => assignments.map((row) => [row[4], row[5], 0.5, 1, 0]),
}

const fullOutput = build(skeletonInputs(), allStepsIn)

check(
  '② 生成シート 3 枚ぶんの行が、行の配列として返る',
  outputNames.map((name) => Array.isArray(fullOutput[name]) && fullOutput[name].every((row) => Array.isArray(row))),
  [true, true, true],
)

check(
  '② 返った行の列数が、シートの構成どおりである',
  outputNames.map((name) => fullOutput[name].map((row) => row.length)),
  outputNames.map((name) => fullOutput[name].map(() => sheetColumns(name).length)),
)

check(
  '② 違反と未充足が、種別で分かれて同じ 1 枚に並ぶ（→ 5-4）',
  fullOutput['検証結果'].map((row) => row[kindColumn]),
  [checkKind.violation, checkKind.unmet],
)

check('② 全部そろえば、未了は 1 つも無い', fullOutput.notBuilt, [])

check(
  '② 同じ入力を 2 回渡すと同じ出力が返る（決定的である → 6 の #3 の理由 ③）',
  JSON.stringify(build(skeletonInputs(), allStepsIn)),
  JSON.stringify(fullOutput),
)

// ---- ③ 骨組みのまま回す -----------------------------------------------------

const skeletonOutput = build(skeletonInputs())

/** 中身が入っている段（→ core.js の builtInSteps）。 */
const stepsAlreadyIn = Object.keys(builtInSteps())

check(
  '③ 入っていない段が、issue 番号つきで全部名指しされる',
  skeletonOutput.notBuilt.map((step) => [step.name, step.issue]),
  coreSteps.filter((step) => stepsAlreadyIn.indexOf(step.name) === -1).map((step) => [step.name, step.issue]),
)

check(
  '③ 中身が入っている段は、未了に出ない'
    + '（7 つ → take-in.js ／ expand.js ／ generate.js（固定を照らす・生成する）／ count-violations.js ／ name-unmet.js ／ fairness-metrics.js）',
  [stepsAlreadyIn, skeletonOutput.notBuilt.filter((step) => stepsAlreadyIn.indexOf(step.name) !== -1)],
  [['取り込む', '展開する', '固定を照らす', '生成する', '違反を数える', '未充足を名指しする', '指標を出す'], []],
)

check(
  '③ 割り当てが空でも、指標には 1 枠も置かれなかった人が 0 で並ぶ（→ fairness-metrics.js）。'
    + '割り当てが空なのは、この 1 人が 調理担当ですか？ が いいえ で、調理の枠に置けないからである（→ 規則 5）',
  [skeletonOutput['割り当て'], skeletonOutput['指標']],
  [[], [['EED2349987', '', 0, 0, 0]]],
)

// 要る枠は 64 である。時間帯を空けた需要は調理帯（10:00-18:00 の 16 枠）にだけ立つ（16 枠 × 4 日 → issue #210）。
check(
  '③ 置いた行が 1 つも無ければ、要る枠が全部未充足として返る（違反は 0 件のまま → 5-4）',
  [
    skeletonOutput['検証結果'].length,
    skeletonOutput['検証結果'].map((row) => row[kindColumn]).filter((kind) => kind !== checkKind.unmet),
  ],
  [64, []],
)

check(
  '③ 未了は、どのシートに出す段だったかを持っている（殻が上書きを避けるのに要る）',
  skeletonOutput.notBuilt.map((step) => step.writesTo),
  coreSteps.filter((step) => stepsAlreadyIn.indexOf(step.name) === -1).map((step) => step.writesTo),
)

// ---- ④ 段を差し替えて、先に回す ---------------------------------------------

const countingSideOnly = build(skeletonInputs(), {
  '未充足を名指しする': () => [checkResultRow(checkKind.unmet, '調理 が あと 1 人')],
})

check(
  '④ 数える側だけを入れても回る（生成が無いまま 8 の 3 を先に作れる）',
  [countingSideOnly['検証結果'].length, countingSideOnly['検証結果'][0][kindColumn]],
  [1, checkKind.unmet],
)

check(
  '④ 入れた段は未了から消え、残りだけが名指しされる',
  countingSideOnly.notBuilt.map((step) => step.name),
  coreSteps
    .map((step) => step.name)
    .filter((name) => name !== '未充足を名指しする' && stepsAlreadyIn.indexOf(name) === -1),
)

// ---- ④-2 友達欄は生成の側へ渡らない（→ 5-2） --------------------------------

const receivedArgs = {}
const oneFix = [['2025-11-01', '08:00', '準備', 'EED2349987']]
build(skeletonInputs({ '手直し': oneFix }), {
  '展開する': (wishes, days) => { receivedArgs['展開する'] = [wishes, days]; return [] },
  '固定を照らす': (fixed) => { receivedArgs['固定を照らす'] = [fixed]; return [] },
  '生成する': (candidates, conditions, wishes, fixed) => {
    receivedArgs['生成する'] = [candidates, conditions, wishes, fixed]
    return []
  },
  '違反を数える': (assignments, conditions) => { receivedArgs['違反を数える'] = [assignments, conditions]; return [] },
})

check(
  '④-2 生成に渡るのは条件入力の 5 区画だけで、回答そのものは渡らない（→ 5-2）',
  Object.keys(receivedArgs['生成する'][1]),
  inputTypes.filter((type) => type.source !== '回答').map((type) => type.key),
)

check(
  '④-2 条件は行のままではなく、5-1 の型で渡る（→ input-types.js）',
  [
    receivedArgs['生成する'][1].days[0].slots.length,
    receivedArgs['生成する'][1].roleNeeds[0].role,
    receivedArgs['生成する'][1].cookLeaderGrades,
    receivedArgs['生成する'][1].prepCleanupRule.noonBoundary,
  ],
  [24, '調理', ['3年生', '4年生'], '12:00'],
)

check(
  '④-2 展開する段に渡るのは、刻まれた枠（型 #1）である（→ 規則 1 の ①）',
  [receivedArgs['展開する'][1][0].date, receivedArgs['展開する'][1][0].slots[0]],
  ['2025-11-01', { start: '08:00', end: '08:30' }],
)

check(
  '④-2 生成と数える側に渡る条件の列に、友達欄が 1 つも無い（→ 5-2）',
  sheetLayout
    .filter((layout) => layout.name === '条件入力')[0]
    .sections.flatMap((section) => section.columns)
    .filter((name) => name.includes('お友達')),
  [],
)

check(
  '④-2 固定として渡るのは手直し（担当者が書き換えたセル）だけで、前の周の割り当てではない（→ 5-3 の却下した形）',
  [receivedArgs['生成する'][3], receivedArgs['固定を照らす'][0]],
  [oneFix, oneFix],
)

check(
  '④-2 生成に希望が渡る。渡るのは型 #6 であって、回答の行ではない（→ 5-1 の #6・5-2）',
  Object.keys(receivedArgs['生成する'][2][0]),
  inputTypes.filter((type) => type.source === '回答')[0].fields,
)

// ---- ④-3 手直しの後の数え直しは、生成を走らせない（→ 5 の #8・issue #155） ----
// 11-04 の 16:00 に 準備 を足した。この人の 11-04 の希望は 8:00-15:00 なので規則 1 の違反になる。
// 生成ならこの 1 枠は置かれないが、数え直しはそのまま数える。

const handEdited = [
  ['2025-11-01', '08:00', '08:30', '準備', 'EED2349987', ''],
  ['2025-11-04', '16:00', '16:30', '準備', 'EED2349987', ''],
]
const recounted = recount(skeletonInputs({ '割り当て': handEdited }))

check(
  '④-3 数え直しの割り当ては、担当者が書いたとおりである（1 枠も足さない・外さない）',
  [recounted['割り当て'], recounted.notBuilt],
  [handEdited, []],
)

check(
  '④-3 手直しで作った規則 1 の違反が、違反として返る（→ 5 の #13 の ①）',
  recounted['検証結果']
    .filter((row) => row[kindColumn] === checkKind.violation)
    .map((row) => [row[checkResultColumns.indexOf('開始')], row[checkResultColumns.indexOf('内容')]]),
  [['16:00', '希望時間外: 希望していない時間に入っています']],
)

check(
  '④-3 指標も、書いたとおりの割り当てから数える（準備 2 枠 → 1 時間 ／ 塊 2 ／ 準備に入った日 2）',
  recounted['指標'],
  [['EED2349987', '', 1, 2, 2]],
)

check(
  '④-3 同じ入力で生成を押せば、その 1 枠は置かれない（数え直しと生成は別の口である）',
  build(skeletonInputs({ '割り当て': handEdited }))['割り当て']
    .filter((row) => row[0] === '2025-11-04' && row[1] === '16:00'),
  [],
)

// ---- ④-4 固定を先に置き、置けないものは名指しで返す（→ 5-3 ／ issue #156） ----
// この 1 人は 3 年生・調理担当ですか？ が いいえ（→ skeletonInputs）。
//   11-01 08:00 準備 … 置ける
//   11-02 10:00 調理 … 規則 5 で置けない
//   11-03 07:00 会計 … 07:00 の枠がいまの 11-03 に無い（営業時刻を動かした後）

const fixes = [
  ['2025-11-01', '08:00', '準備', 'EED2349987'],
  ['2025-11-02', '10:00', '調理', 'EED2349987'],
  ['2025-11-03', '07:00', '会計', 'EED2349987'],
]
const withFixes = build(skeletonInputs({ '手直し': fixes }))

check(
  '④-4 置ける固定は、生成の案にそのまま入る（担当者が置いたとおり）',
  withFixes['割り当て'],
  [['2025-11-01', '08:00', '08:30', '準備', 'EED2349987', '']],
)

check(
  '④-4 置けない固定は置かれず、食い違った固定として検証結果の先頭に理由つきで並ぶ（黙って外さない・条件も破らない）',
  withFixes['検証結果']
    .filter((row) => row[kindColumn] === checkKind.fixConflict)
    .map((row) => [row[checkResultColumns.indexOf('日')], row[checkResultColumns.indexOf('開始')], row[checkResultColumns.indexOf('内容')]]),
  [
    ['2025-11-02', '10:00', '調理担当ではない人が調理に入っています'],
    ['2025-11-03', '07:00', '営業時刻が変わったため、2025-11-03 の 07:00 の列がなくなりました'],
  ],
)

check(
  '④-4 食い違った固定は検証結果の先頭にあり、固定のせいで違反は 1 件も作られていない',
  [
    withFixes['検証結果'].slice(0, 2).map((row) => row[kindColumn]),
    withFixes['検証結果'].filter((row) => row[kindColumn] === checkKind.violation).length,
  ],
  [[checkKind.fixConflict, checkKind.fixConflict], 0],
)

check(
  '④-4 数え直しでは固定を照らさない（マス目に書いてあるものは違反として数える → recount）',
  recount(skeletonInputs({ '手直し': fixes }))['検証結果'].filter((row) => row[kindColumn] === checkKind.fixConflict),
  [],
)

// ---- ⑤ 黙って直さずに止まる -------------------------------------------------

const stillWobbling = whyItStopped(() => build(skeletonInputs({
  '日ごとの営業時刻': [['2025-11-01', new Date(1899, 11, 30, 8, 0), '10:00', '18:00', '18:00', '20:00']],
})))

check(
  '⑤ Date が混じったまま渡すと、区画と行と列を名指しして止まる',
  [
    stillWobbling !== null,
    stillWobbling?.includes('「日ごとの営業時刻」の 1 行目 2 列目'),
    stillWobbling?.includes('殻'),
  ],
  [true, true, true],
)

check(
  '⑤ null も真偽値も表現の揺れとして止まる',
  [
    whyItStopped(() => build(skeletonInputs({ '調理責任者の学年': [[null]] })))?.includes('表現が揃っていない'),
    whyItStopped(() => build(skeletonInputs({ '調理責任者の学年': [[true]] })))?.includes('表現が揃っていない'),
  ],
  [true, true],
)

check(
  '⑤ 入力の名前が欠けていれば、名指しして止まる',
  whyItStopped(() => {
    const inputs = skeletonInputs()
    delete inputs['委員会の指定枠']
    return build(inputs)
  })?.includes('「委員会の指定枠」'),
  true,
)

check(
  '⑤ 入力に無い名前が渡れば、名指しして止まる（検証結果と指標は読まない → 5-4・5 の #7）',
  whyItStopped(() => build(skeletonInputs({ '検証結果': [] })))?.includes('「検証結果」'),
  true,
)

const columnCountDiffers = whyItStopped(() => build(skeletonInputs(), {
  '指標を出す': () => [['EED2349987', '高木琴音']],
}))

check(
  '⑤ 段が返した行の列数が構成と違えば、詰めずに名指しして止まる',
  [columnCountDiffers !== null, columnCountDiffers?.includes('「指標」'), columnCountDiffers?.includes('列数が構成と違う')],
  [true, true, true],
)

const undecidedKind = whyItStopped(() => build(skeletonInputs(), {
  '違反を数える': () => [checkResultRow('注意', '気になる')],
}))

check(
  '⑤ 検証結果の種別が違反と未充足の外にあれば、止まる（→ 5-4）',
  [undecidedKind !== null, undecidedKind?.includes('種別「注意」')],
  [true, true],
)

// ---- 入力の名前が sheet-layout.js から引かれているか ------------------------

// ---- ⑥ 検証結果の候補 ---------------------------------------------------------

const checkColumns = sheetColumns('検証結果')
const candidateAt = checkColumns.indexOf('候補')

/** 日・開始・終了だけを埋めた検証結果の行。 */
function rowAt(date, start, end) {
  const row = checkColumns.map(() => '')
  row[checkColumns.indexOf('種別')] = checkKind.unmet
  row[checkColumns.indexOf('日')] = date
  row[checkColumns.indexOf('開始')] = start
  row[checkColumns.indexOf('終了')] = end
  return row
}

const wishedSlots = [
  { studentId: 'A1', date: '2025-11-02', slots: [{ start: '10:00', end: '10:30' }, { start: '10:30', end: '11:00' }] },
  { studentId: 'B2', date: '2025-11-02', slots: [{ start: '10:30', end: '11:00' }] },
  { studentId: 'C3', date: '2025-11-03', slots: [{ start: '10:00', end: '10:30' }] },
  { studentId: 'B2', date: '2025-11-02', slots: [{ start: '10:30', end: '11:00' }] },
]

check(
  '⑥ その日のその 30 分枠を希望に含む人だけが、展開の順に 1 回ずつ並ぶ（ほかの日・ほかの枠の人は入らない）',
  withCandidates([rowAt('2025-11-02', '10:00', '10:30'), rowAt('2025-11-02', '10:30', '11:00'), rowAt('2025-11-02', '11:00', '11:30')], wishedSlots)
    .map((row) => row[candidateAt]),
  ['A1', 'A1、B2', ''],
)

check(
  '⑥ 枠が 1 つに決まらない行（開始か終了が空）は、候補を空のままにする',
  withCandidates([rowAt('2025-11-02', '', ''), rowAt('2025-11-02', '10:00', '')], wishedSlots).map((row) => row[candidateAt]),
  ['', ''],
)

/** 割り当て 1 件（役割は何でもよい）。 */
function placedAt(date, start, end, studentId, role) {
  const found = { '日': date, '開始': start, '終了': end, '役割': role || '調理', '学籍番号': studentId, '氏名': '' }
  return sheetColumns('割り当て').map((name) => found[name])
}

check(
  '⑥ その枠を希望していても、その枠にもう置かれている人は（役割を問わず）候補に並ばない（→ issue #254）',
  withCandidates(
    [rowAt('2025-11-02', '10:00', '10:30'), rowAt('2025-11-02', '10:30', '11:00')],
    wishedSlots,
    [placedAt('2025-11-02', '10:30', '11:00', 'A1', '会計')],
  ).map((row) => row[candidateAt]),
  ['A1', 'B2'],
)

check(
  '⑥ ほかの日・ほかの枠に置かれているだけなら、その枠の候補には並ぶ',
  withCandidates(
    [rowAt('2025-11-02', '10:30', '11:00')],
    wishedSlots,
    [placedAt('2025-11-02', '10:00', '10:30', 'A1'), placedAt('2025-11-03', '10:30', '11:00', 'B2')],
  ).map((row) => row[candidateAt]),
  ['A1、B2'],
)

check(
  '⑥ 渡した行は書き換えない（新しい配列を返す）',
  (() => {
    const row = rowAt('2025-11-02', '10:00', '10:30')
    withCandidates([row], wishedSlots)
    return row[candidateAt]
  })(),
  '',
)

// 2 人目は準備帯（8:00-10:00）しか希望していないので、調理帯の未充足には入らない。
const twoPeople = build(skeletonInputs({
  '回答': [
    skeletonInputs()['回答'][0],
    ['2025-09-23 16:40:00', 'EED0000001', '二人目', '1年生', 'いいえ', '', '8:00-10:00', '8:00-10:00', '8:00-10:00', '8:00-10:00'],
  ],
  '役割と必要人数': [['', '', '', '調理', 2], ['2025-11-01', '', '', '準備', 5]],
  '割り当て': [],
}))
const unmetAt = (date, start) => twoPeople['検証結果'].filter((row) => row[0] === checkKind.unmet
  && row[checkColumns.indexOf('日')] === date && row[checkColumns.indexOf('開始')] === start)[0]

check(
  '⑥ 生成を通すと、未充足の行の候補に、その枠を希望していて置かれていない人の学籍番号が入る'
    + '（8:00 の準備は 2 人とも置かれたので空 ／ 氏名にするのは殻 → shell.test.mjs）',
  [unmetAt('2025-11-01', '08:00'), unmetAt('2025-11-01', '10:00')].map((row) => row && row[candidateAt]),
  ['', 'EED2349987'],
)

// 数え直しでは、マス目に書いてあるとおりが割り当てである。担当者が手で置いた人は、その枠の候補から消える。
const recountAt = (placed) => recount(skeletonInputs({ '割り当て': placed }))['検証結果']
  .filter((row) => row[0] === checkKind.unmet
    && row[checkColumns.indexOf('日')] === '2025-11-02' && row[checkColumns.indexOf('開始')] === '10:00')[0][candidateAt]

check(
  '⑥ 数え直しでも、マス目でその枠に置いた人は候補から消え、外すと候補に戻る（→ issue #254）',
  [recountAt([['2025-11-02', '10:00', '10:30', '調理', 'EED2349987', '高木琴音']]), recountAt([])],
  ['', 'EED2349987'],
)

check(
  '入力の名前は、条件入力の 6 区画 ＋ 回答 ＋ 割り当て ＋ 手直しである（検証結果と指標は入らない）',
  inputNames(),
  [...conditionNames(), '回答', '割り当て', '手直し'],
)

check(
  '出力の名前は、どれも シートの構成 が置き場を持っている（1 枚か、マス目の 4 枚か）',
  outputNames.filter((name) => !sheetLayout.some((layout) => layout.name === name || (layout.grid && layout.grid.of === name))),
  [],
)

check(
  '割り当てだけがシート 1 枚に対応しない — 日ごとの 4 枚にマス目で載る（→ issue #213）',
  outputNames.filter((name) => !sheetLayout.some((layout) => layout.name === name)),
  ['割り当て'],
)

// ---- 結果 ------------------------------------------------------------------

console.log('コアの検査（src/core.js／スプレッドシート無し）')
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
