#!/usr/bin/env node
// Checks on the shell — running src/shell.js on top of a fake spreadsheet.
//
//   How to run it: node src/shell.test.mjs
//
// There are 6 things it looks at.
//   ① the value representations line up (Date, booleans, whitespace and empty cells all become
//      a string or a number → 6 の #8 の理由 ③)
//   ② the inputs it read go through the door of the core (checkRepresentation) as they are
//   ③ it does not read the heading rows. The 5 sections lying side by side are cut apart and
//      read per section (→ src/README.md)
//   ④ reading and writing is once per range, never back and forth cell by cell
//      (→ 6 の #2 の実装上の注意)
//   ⑤ if even one step is not in, not a single sheet is written (the hand edits never silently
//      disappear → 5-3)
//   ⑥ if the structure is broken, it stops without reading a single row or writing a single sheet
//      (→ verify-structure.js・issue #138)
//
// How the breakages themselves get named is src/verify-structure.test.mjs's to look at.
// Here, all that is looked at is that it does not run.
//
// This is a contract, not an implementation. It rewrites nothing.
// How a Date comes back on a real spreadsheet cannot be seen from here (→ src/real-device-log.md).

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// ---- the fake spreadsheet ---------------------------------------------------
// All the shell uses is getSheetByName / getLastRow / getRange, plus getValues, setValues and
// clearContent on a range.
// Checking the structure before running (→ verify-structure.js) adds getMaxRows / getMaxColumns /
// getLastColumn to that.

const roundTrips = { reads: 0, writes: 0 }

class FakeRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    Object.assign(this, { sheet, row, column, rowCount, columnCount })
  }
  getValues() {
    roundTrips.reads += 1
    const table = []
    for (let r = this.row; r < this.row + this.rowCount; r++) {
      const row = []
      for (let c = this.column; c < this.column + this.columnCount; c++) row.push(this.sheet.cells.get(`${r},${c}`) ?? '')
      table.push(row)
    }
    return table
  }
  setValues(table) {
    roundTrips.writes += 1
    table.forEach((row, i) => row.forEach((value, j) => this.sheet.cells.set(`${this.row + i},${this.column + j}`, value)))
    return this
  }
  clearContent() {
    roundTrips.writes += 1
    for (let r = this.row; r < this.row + this.rowCount; r++) {
      for (let c = this.column; c < this.column + this.columnCount; c++) this.sheet.cells.delete(`${r},${c}`)
    }
    return this
  }
}

class FakeSheet {
  constructor(name) {
    Object.assign(this, { name, cells: new Map() })
  }
  getName() { return this.name }
  getRange(row, column, rowCount = 1, columnCount = 1) { return new FakeRange(this, row, column, rowCount, columnCount) }
  getLastRow() {
    return [...this.cells.entries()]
      .filter(([, value]) => value !== '')
      .reduce((max, [key]) => Math.max(max, Number(key.split(',')[0])), 0)
  }
  getLastColumn() {
    return [...this.cells.entries()]
      .filter(([, value]) => value !== '')
      .reduce((max, [key]) => Math.max(max, Number(key.split(',')[1])), 0)
  }
  // 1000 rows by 26 columns is the default size of a new spreadsheet
  // (checking the structure looks at this to keep the range it reads inside the sheet
  //  → verify-structure.js)
  getMaxRows() { return Math.max(1000, this.getLastRow()) }
  getMaxColumns() { return Math.max(26, this.getLastColumn()) }
  put(row, column, value) { this.cells.set(`${row},${column}`, value); return this }
}

class FakeSpreadsheet {
  constructor(sheets) { this.sheets = sheets }
  getSheetByName(name) { return this.sheets.find((s) => s.getName() === name) ?? null }
}

// ---- loading ----------------------------------------------------------------

const context = vm.createContext({})
for (const name of ['sheet-layout.js', 'core.js', 'shell.js', 'verify-structure.js']) {
  vm.runInContext(fs.readFileSync(path.join(here, name), 'utf8'), context, { filename: name })
}
const { readInputs, run, normalizeValue, checkRepresentation, sheetColumns } = context
const { valueRepresentation, sheetLayout, checkKind, coreSteps } = vm.runInContext(
  '({ valueRepresentation, sheetLayout, checkKind, coreSteps })',
  context,
)

const failed = []
const passed = []

function check(title, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed.push(title)
  else failed.push({ title, actual, expected })
}

function whyItStopped(work) {
  try {
    work()
    return null
  } catch (error) {
    return error.message
  }
}

/** Make the 5 empty sheets, with the headings put in as sheetLayout has them. */
function emptyTemplate() {
  const sheets = sheetLayout.map((layout) => {
    const sheet = new FakeSheet(layout.name)
    layout.sections.forEach((section) => {
      if (layout.hasSectionHeadings) sheet.put(1, section.startColumn, section.heading)
      const columnNameRow = layout.hasSectionHeadings ? 2 : 1
      section.columns.forEach((columnName, i) => sheet.put(columnNameRow, section.startColumn + i, columnName))
    })
    return sheet
  })
  return new FakeSpreadsheet(sheets)
}

/** One book with the conditions, the answers and the previous round's hand edits in it. The time cells deliberately hold Dates. */
function filledBook() {
  const book = emptyTemplate()
  const conditions = book.getSheetByName('条件入力')

  // 日ごとの営業 4 時刻 (A〜E) — 2 days. A time-only cell comes back as a Date
  ;[[1, 8, 10, 20, 20], [2, 8, 10, 20, 20]].forEach((row, i) => {
    conditions.put(3 + i, 1, new Date(2025, 10, row[0]))
    row.slice(1).forEach((hour, j) => conditions.put(3 + i, 2 + j, new Date(1899, 11, 30, hour, 0, 0)))
  })
  // 役割と必要人数 (G〜K) — one row only. A row with the day and the time span left empty applies
  // to every slot (→ 5-1 の #2)
  ;['', '', '', '調理', 2].forEach((value, j) => conditions.put(3, 7 + j, value))
  // 調理責任者の学年 (M) — 2 rows
  conditions.put(3, 13, '3年生').put(4, 13, ' 4年生 ')
  // 準備・片付けのルール (U〜V) — one row
  conditions.put(3, 21, '午前と午後の境目').put(3, 22, new Date(1899, 11, 30, 12, 0, 0))

  const answers = book.getSheetByName('回答')
  const answerRow = [
    new Date(2025, 8, 23, 16, 31, 9), 'EED2349987', '高木琴音', '3年生', 'いいえ', '',
    '8:00-21:00', '8:00-20:00', '8:00-22:00', '8:00-15:00',
  ]
  answerRow.forEach((value, j) => answers.put(2, 1 + j, value))

  const assignments = book.getSheetByName('割り当て')
  ;['2025-11-01', '08:00', '08:30', '準備', 'EED2349987', '高木琴音']
    .forEach((value, j) => assignments.put(2, 1 + j, value))

  // Leftovers from the previous round. They go when a step is in, and are left alone when it is not
  book.getSheetByName('指標').put(2, 1, '古い行')
  return book
}

// ---- ① the value representations line up ------------------------------------

check(
  '① 時刻だけのセル（1899-12-30 を土台にした Date）が HH:MM になる',
  [normalizeValue(new Date(1899, 11, 30, 8, 0, 0)), normalizeValue(new Date(1899, 11, 30, 12, 30, 0))],
  ['08:00', '12:30'],
)

check(
  '① 日付だけのセルが YYYY-MM-DD になり、日時は秒まで付く',
  [normalizeValue(new Date(2025, 10, 1)), normalizeValue(new Date(2025, 8, 23, 16, 31, 9))],
  ['2025-11-01', '2025-09-23 16:31:09'],
)

check(
  '① 数値はそのまま、真偽値と空のセルは文字列になる',
  [normalizeValue(2), normalizeValue(true), normalizeValue(false), normalizeValue(null), normalizeValue(undefined)],
  [2, 'TRUE', 'FALSE', '', ''],
)

check(
  '① 文字列は両端の空白を落とすだけで、中身に手を入れない',
  [normalizeValue('  3年生 '), normalizeValue('8:00-21:00'), normalizeValue('15:00-00:00')],
  ['3年生', '8:00-21:00', '15:00-00:00'],
)

check(
  '① 揃えた先の形は、値の表現 に書いてあるとおりである',
  [valueRepresentation.date, valueRepresentation.time, valueRepresentation.dateTime],
  ['YYYY-MM-DD', 'HH:MM', 'YYYY-MM-DD HH:MM:SS'],
)

// ---- ②③ reading ------------------------------------------------------------

const inputs = readInputs(filledBook())

check(
  '② 読んだ入力が、そのままコアの入口を通る（表現の揺れが残っていない）',
  whyItStopped(() => checkRepresentation(inputs)),
  null,
)

check(
  '③ 条件入力は 2 行目までが見出しなので、3 行目から読む',
  inputs['日ごとの営業 4 時刻'],
  [['2025-11-01', '08:00', '10:00', '20:00', '20:00'], ['2025-11-02', '08:00', '10:00', '20:00', '20:00']],
)

check(
  '③ 区画ごとに列を切って読む（役割と必要人数は G 列から 5 列ぶん）',
  inputs['役割と必要人数'],
  [['', '', '', '調理', 2]],
)

check(
  '③ 行数の違う区画は、下の空の行が落ちる（横に並べてあるので最終行は揃っている）',
  [inputs['調理責任者の学年'], inputs['委員会の指定枠'], inputs['準備・片付けのルール']],
  [[['3年生'], ['4年生']], [], [['午前と午後の境目', '12:00']]],
)

check(
  '③ 回答と割り当ては 1 行目が見出しなので、2 行目から読む',
  [inputs['回答'][0].slice(0, 5), inputs['割り当て']],
  [
    ['2025-09-23 16:31:09', 'EED2349987', '高木琴音', '3年生'].concat(['いいえ']),
    [['2025-11-01', '08:00', '08:30', '準備', 'EED2349987', '高木琴音']],
  ],
)

check(
  '③ 読むのは 3 枚だけである（検証結果と指標は生成しか書かないので読まない）',
  Object.keys(inputs).length,
  sheetLayout.filter((layout) => layout.name === '条件入力')[0].sections.length + 2,
)

// ---- ④⑤ writing -------------------------------------------------------------

const checkResultColumns = sheetColumns('検証結果')

function checkResultRow(kind, detail) {
  const row = checkResultColumns.map(() => '')
  row[checkResultColumns.indexOf('種別')] = kind
  row[checkResultColumns.indexOf('内容')] = detail
  return row
}

const skeletonBook = filledBook()
roundTrips.reads = 0
roundTrips.writes = 0
const notBuilt = run(skeletonBook, {})

check(
  '⑤ 骨組みのまま走らせても、割り当てシートの手直しが残っている（→ 5-3）',
  skeletonBook.getSheetByName('割り当て').getRange(2, 1, 1, 6).getValues()[0],
  ['2025-11-01', '08:00', '08:30', '準備', 'EED2349987', '高木琴音'],
)

check(
  '⑤ 段が入っていないあいだは、生成シートに 1 度も書いていない',
  roundTrips.writes,
  0,
)

check(
  '⑤ 何が入っていないかは、issue 番号つきで返る',
  notBuilt.map((step) => `${step.name}#${step.issue}`),
  coreSteps.map((step) => `${step.name}#${step.issue}`),
)

// If even one step is missing, nothing is written however many of the rest are in (what comes
// after the missing step comes back empty)
const partialBook = filledBook()
roundTrips.writes = 0
run(partialBook, {
  '指標を出す': () => [],
})

check(
  '⑤ 段が 1 つでも欠けていれば、残りが入っていても 1 枚も書かない',
  [roundTrips.writes, partialBook.getSheetByName('指標').getRange(2, 1, 1, 1).getValues()[0][0]],
  [0, '古い行'],
)

const fullBook = filledBook()
roundTrips.reads = 0
roundTrips.writes = 0
const fullNotBuilt = run(fullBook, {
  '取り込む': (answers) => answers.map((row) => [row[1], row[3], row[4]]),
  '展開する': (wishes) => wishes.map((row) => [row[0]]),
  '生成する': (candidates) => candidates.map((row) => ['2025-11-01', '10:00', '10:30', '調理', row[0], '高木琴音']),
  '違反を数える': () => [checkResultRow(checkKind.violation, '検便を通っていない')],
  '未充足を名指しする': () => [checkResultRow(checkKind.unmet, 'あと 1 人')],
  '指標を出す': (assignments) => assignments.map((row) => [row[4], row[5], 0.5, 1, 0]),
})
// The checks below call getValues, so the round trips that were counted are copied off here
const fullRoundTrips = { reads: roundTrips.reads, writes: roundTrips.writes }

check('④ 全部そろえば、未了は 1 つも無い', fullNotBuilt, [])

check(
  '④ 生成シート 3 枚に、見出しの次の行から書かれている',
  [
    fullBook.getSheetByName('割り当て').getRange(2, 1, 1, 6).getValues()[0],
    fullBook.getSheetByName('検証結果').getRange(2, 1, 2, 9).getValues().map((row) => row[0]),
    fullBook.getSheetByName('指標').getRange(2, 1, 1, 5).getValues()[0],
  ],
  [
    ['2025-11-01', '10:00', '10:30', '調理', 'EED2349987', '高木琴音'],
    [checkKind.violation, checkKind.unmet],
    ['EED2349987', '高木琴音', 0.5, 1, 0],
  ],
)

check(
  '④ 前の周の残りかすが消えている（指標の「古い行」が残っていない）',
  fullBook.getSheetByName('指標').getRange(3, 1, 1, 1).getValues()[0],
  [''],
)

// Reading is: checking the structure before running, once per sheet (5 of them), plus the inputs,
// once per section.
// Writing is at most twice per generated sheet —「clear」and「put」
check(
  '④ 読み書きはどちらも範囲ごとに 1 回で、セル単位で往復していない（→ 6 の #2）',
  [fullRoundTrips.reads, fullRoundTrips.writes <= vm.runInContext('outputNames.length', context) * 2],
  [sheetLayout.length + Object.keys(inputs).length, true],
)

// ---- when a sheet is missing ------------------------------------------------

const bookMissingASheet = emptyTemplate()
bookMissingASheet.sheets = bookMissingASheet.sheets.filter((s) => s.getName() !== '回答')

check(
  'シートが 1 枚でも無ければ、名指しして止まる（黙って作らない）',
  whyItStopped(() => readInputs(bookMissingASheet))?.includes('シート「回答」が無い'),
  true,
)

// ---- ⑥ when the structure is broken -----------------------------------------
// run calls checkStructure before reading (→ verify-structure.js).
// Run it while it is broken and the staff's hand edits (→ 5-3) silently disappear, or the rows
// get written with the columns still slid over.

const brokenBook = filledBook()
brokenBook.getSheetByName('検証結果').put(1, 1, '区分')
const brokenBookCopy = JSON.stringify(
  brokenBook.sheets.map((s) => [s.name, [...s.cells.entries()].sort()]),
)
roundTrips.reads = 0
roundTrips.writes = 0
const whyTheBreakageStoppedIt = whyItStopped(() => run(brokenBook, {
  '取り込む': () => [],
  '展開する': () => [],
  '生成する': () => [],
  '違反を数える': () => [],
  '未充足を名指しする': () => [],
  '指標を出す': () => [],
}))

check(
  '⑥ 構造が崩れていれば、段が全部そろっていても走らずに名指しで止まる',
  [
    whyTheBreakageStoppedIt?.includes('生成を走らせない'),
    whyTheBreakageStoppedIt?.includes('「検証結果」の 1 行目 1 列目'),
  ],
  [true, true],
)

check(
  '⑥ 止まったとき、生成シートに 1 度も書いていない（入力も 1 行も読んでいない）',
  [roundTrips.writes, roundTrips.reads],
  [0, sheetLayout.length],
)

check(
  '⑥ 止まったとき、セルが 1 つも変わっていない（黙って直した箇所が 0 である）',
  JSON.stringify(brokenBook.sheets.map((s) => [s.name, [...s.cells.entries()].sort()])),
  brokenBookCopy,
)

// ---- results ----------------------------------------------------------------

console.log('殻の検査（src/shell.js／偽のスプレッドシートの上）')
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
