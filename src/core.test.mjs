#!/usr/bin/env node
// コアの検査 — src/core.js を、スプレッドシートを 1 つも作らずに走らせる。
//
//   使い方: node src/core.test.mjs
//
// 見るものは 5 つある。
//   ① コアの側のファイルに SpreadsheetApp が 1 度も出てこない（→ 6 の #8）
//   ② 配列を渡すと配列が返る。偽のスプレッドシートすら要らない（→ issue #137 の受け入れ条件）
//   ③ 中身の入っていない段は、空の配列を返して名指しで持ち帰る（黙って走らない）
//   ④ 段を差し替えると、その段だけを先に回せる（8 の 3 が 8 の 8 より先にある）
//   ⑤ 表現の揺れ・列数の違い・決めていない種別は、黙って直さずに名指しで止まる
//
// これは契約であって実装ではない。何も書き換えない。
// 値の表現を揃える側（殻）の検査は src/shell.test.mjs が持つ。

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// ---- 読み込む ---------------------------------------------------------------
// SpreadsheetApp を文脈に置いていない。置かなくても通ることが、この検査そのものである。

const context = vm.createContext({})
for (const name of ['sheet-layout.js', 'core.js']) {
  vm.runInContext(fs.readFileSync(path.join(here, name), 'utf8'), context, { filename: name })
}
// const は文脈のプロパティにならないので、式で取り出す（function は文脈に出る）
const { build, inputNames, conditionNames, sheetColumns } = context
const { coreSteps, outputNames, sheetLayout, checkKind } = vm.runInContext(
  '({ coreSteps, outputNames, sheetLayout, checkKind })',
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

/** 骨組みを回すのに足りるだけの入力。値は data/ の転記元と同じ表現で置く。 */
function skeletonInputs(overrides) {
  const inputs = {
    '日ごとの営業 4 時刻': [['2025-11-01', '08:00', '10:00', '20:00', '20:00']],
    '役割と必要人数': [['', '', '', '調理', 2]],
    '調理責任者の学年': [['3年生'], ['4年生']],
    '委員会の指定枠': [],
    '準備・片付けのルール': [['午前と午後の境目', '12:00']],
    '回答': [[
      '2025-09-23 16:31:09', 'EED2349987', '高木琴音', '3年生', 'いいえ', '',
      '8:00-21:00', '8:00-20:00', '8:00-22:00', '8:00-15:00',
    ]],
    '割り当て': [['2025-11-01', '08:00', '08:30', '準備', 'EED2349987', '高木琴音']],
  }
  Object.keys(overrides || {}).forEach((name) => { inputs[name] = overrides[name] })
  return inputs
}

// ---- ① 境目がコードの上に立っているか ---------------------------------------

// 「掴まない」とコメントに書いてあるのは掴んだうちに入らないので、コメントを落としてから見る。
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const filesTouchingSpreadsheetApp = fs
  .readdirSync(here)
  .filter((name) => name.endsWith('.js'))
  .filter((name) => stripComments(fs.readFileSync(path.join(here, name), 'utf8')).includes('SpreadsheetApp'))
  .sort()

check(
  '① SpreadsheetApp を掴むのは 3 ファイルだけである（コアの 2 つも、構造の検証も掴まない）',
  filesTouchingSpreadsheetApp,
  ['build-template.js', 'menu.js', 'shell.js'],
)

check(
  '① コアを読むのに SpreadsheetApp が要らなかった（この検査が文脈に置いていない）',
  typeof build,
  'function',
)

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

check(
  '③ 入っていない段が、issue 番号つきで全部名指しされる',
  skeletonOutput.notBuilt.map((step) => [step.name, step.issue]),
  coreSteps.map((step) => [step.name, step.issue]),
)

check(
  '③ 生成シート 3 枚は空の配列で返る（何も書かない）',
  outputNames.map((name) => skeletonOutput[name]),
  [[], [], []],
)

check(
  '③ 未了は、どのシートに出す段だったかを持っている（殻が上書きを避けるのに要る）',
  skeletonOutput.notBuilt.map((step) => step.writesTo),
  coreSteps.map((step) => step.writesTo),
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
  coreSteps.map((step) => step.name).filter((name) => name !== '未充足を名指しする'),
)

// ---- ④-2 友達欄は生成の側へ渡らない（→ 5-2） --------------------------------

const receivedArgs = {}
build(skeletonInputs(), {
  '生成する': (candidates, conditions, fixed) => { receivedArgs['生成する'] = [candidates, conditions, fixed]; return [] },
  '違反を数える': (assignments, conditions) => { receivedArgs['違反を数える'] = [assignments, conditions]; return [] },
})

check(
  '④-2 生成に渡るのは条件入力の 5 区画だけで、回答そのものは渡らない（→ 5-2）',
  Object.keys(receivedArgs['生成する'][1]),
  conditionNames(),
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
  '④-2 固定として渡るのは、前の周の割り当てシートの行である（→ 5-3）',
  receivedArgs['生成する'][2],
  skeletonInputs()['割り当て'],
)

// ---- ⑤ 黙って直さずに止まる -------------------------------------------------

const stillWobbling = whyItStopped(() => build(skeletonInputs({
  '日ごとの営業 4 時刻': [['2025-11-01', new Date(1899, 11, 30, 8, 0), '10:00', '20:00', '20:00']],
})))

check(
  '⑤ Date が混じったまま渡すと、区画と行と列を名指しして止まる',
  [
    stillWobbling !== null,
    stillWobbling?.includes('「日ごとの営業 4 時刻」の 1 行目 2 列目'),
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
  [undecidedKind !== null, undecidedKind?.includes('5-4')],
  [true, true],
)

// ---- 入力の名前が sheet-layout.js から引かれているか ------------------------

check(
  '入力の名前は、条件入力の 5 区画 ＋ 回答 ＋ 割り当てである（検証結果と指標は入らない）',
  inputNames(),
  [...conditionNames(), '回答', '割り当て'],
)

check(
  '出力の名前は、どれも シートの構成 にあるシートである',
  outputNames.filter((name) => !sheetLayout.some((layout) => layout.name === name)),
  [],
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
