#!/usr/bin/env node
// Checks on the structure check — running src/verify-structure.js on top of a read-only fake spreadsheet.
//
//   How to run it: node src/verify-structure.test.mjs
//
// There are 6 things it looks at.
//   ① laid out as the layout has it, there are 0 broken spots (it runs)
//   ② deleting one sheet, inserting one column, rewriting one heading — each one puts out a
//      line that names it
//   ③ deleting rows, overwriting a generated sheet and deleting columns in one go all get named
//      (→ the 3 ways of breaking it in #8)
//   ④ 0 spots got silently fixed (not one cell changed)
//   ⑤ reading is once per sheet, never back and forth cell by cell (→ 6 の #2 の実装上の注意)
//   ⑥ if it is broken, checkStructure stops and holds every broken spot as a sentence
//
// This is a contract, not an implementation. It rewrites nothing.
// That generation does not run while it is broken is src/shell.test.mjs's to look at
// (run calls this first).

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// ---- the read-only fake spreadsheet -----------------------------------------
// The structure check only reads. That is why this fake sheet has no setValues.
// Try to write and it falls over right there (「never silently fix」checked from the tooling side).

const roundTrips = { reads: 0 }

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
}

class FakeSheet {
  // 1000 rows by 26 columns is the default size of a new spreadsheet
  constructor(name) {
    Object.assign(this, { name, cells: new Map(), maxRows: 1000, maxColumns: 26 })
  }
  getName() { return this.name }
  getRange(row, column, rowCount = 1, columnCount = 1) {
    // The real thing throws when a range is taken outside the sheet. That the structure check
    // never goes there is what is checked here
    if (column + columnCount - 1 > this.maxColumns) throw new Error(`範囲外（${this.name} の ${column + columnCount - 1} 列目）`)
    if (row + rowCount - 1 > this.maxRows) throw new Error(`範囲外（${this.name} の ${row + rowCount - 1} 行目）`)
    return new FakeRange(this, row, column, rowCount, columnCount)
  }
  getMaxRows() { return this.maxRows }
  getMaxColumns() { return this.maxColumns }
  getLastColumn() {
    return [...this.cells.entries()]
      .filter(([, value]) => value !== '')
      .reduce((max, [key]) => Math.max(max, Number(key.split(',')[1])), 0)
  }
  put(row, column, value) { this.cells.set(`${row},${column}`, value); return this }
  /** Put it in the state where the staff deleted columns in one go (everything right of that column goes). */
  cutColumnsTo(maxColumns) {
    this.maxColumns = maxColumns
    this.cells = new Map(
      [...this.cells.entries()].filter(([key]) => Number(key.split(',')[1]) <= maxColumns),
    )
    return this
  }
  /** Put it in the state where the staff deleted rows in one go (everything below that row goes). */
  cutRowsTo(maxRows) {
    this.maxRows = maxRows
    this.cells = new Map(
      [...this.cells.entries()].filter(([key]) => Number(key.split(',')[0]) <= maxRows),
    )
    return this
  }
  /** Put it in the state where the staff inserted one column (everything from that column right slides by one). */
  insertColumn(at) {
    this.cells = new Map(
      [...this.cells.entries()].map(([key, value]) => {
        const [row, column] = key.split(',').map(Number)
        return [`${row},${column < at ? column : column + 1}`, value]
      }),
    )
    return this
  }
  /** Put it in the state where the staff deleted one row (everything from that row down moves up by one). */
  deleteRow(at) {
    this.cells = new Map(
      [...this.cells.entries()]
        .filter(([key]) => Number(key.split(',')[0]) !== at)
        .map(([key, value]) => {
          const [row, column] = key.split(',').map(Number)
          return [`${row < at ? row : row - 1},${column}`, value]
        }),
    )
    return this
  }
  /** Put it in the state where the whole content of the sheet was wiped (a generated sheet overwritten). */
  clear() { this.cells = new Map(); return this }
}

class FakeSpreadsheet {
  constructor(sheets) { this.sheets = sheets }
  getSheetByName(name) { return this.sheets.find((s) => s.getName() === name) ?? null }
  snapshot() { return JSON.stringify(this.sheets.map((s) => [s.name, [...s.cells.entries()].sort()])) }
}

// ---- loading ----------------------------------------------------------------
// headerRowCount and normalizeValue, which the structure check uses, are in shell.js, so that is
// read in too.
// SpreadsheetApp is not put into the context — the one line that touches it is in shell.js, and
// nothing here goes through it.

const context = vm.createContext({})
for (const name of ['sheet-layout.js', 'core.js', 'shell.js', 'verify-structure.js']) {
  vm.runInContext(fs.readFileSync(path.join(here, name), 'utf8'), context, { filename: name })
}
const { nameBreakages, checkStructure, breakageToText } = context
const { sheetLayout } = vm.runInContext('({ sheetLayout })', context)

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

function namedLines(book) {
  return nameBreakages(book).map(breakageToText)
}

// ---- ① nothing broken means 0 spots -----------------------------------------

check('① 構成どおりに並んでいれば、崩れは 0 箇所である', namedLines(emptyTemplate()), [])

// Rows the staff write can be added without breaking anything, because only the headings are looked at
const bookWithMoreRows = emptyTemplate()
bookWithMoreRows.getSheetByName('条件入力').put(3, 1, '2025-11-01').put(4, 1, '2025-11-02')
bookWithMoreRows.getSheetByName('割り当て').put(2, 1, '2025-11-01')
check('① 担当者がデータの行を書き足しても崩れない（見るのは見出しの行だけである）', namedLines(bookWithMoreRows), [])

// ---- ② deleting a sheet / inserting a column / rewriting a heading -----------

const bookMissingASheet = emptyTemplate()
bookMissingASheet.sheets = bookMissingASheet.sheets.filter((s) => s.getName() !== '回答')

check(
  '② シートを 1 枚消すと、そのシートを名指しする',
  namedLines(bookMissingASheet),
  ['シート「回答」が無い'],
)

const bookWithInsertedColumn = emptyTemplate()
bookWithInsertedColumn.getSheetByName('割り当て').insertColumn(2)

check(
  '② 列を 1 つ挿すと、ずれた列名と、右へ押し出された見出しを名指しする',
  namedLines(bookWithInsertedColumn),
  [
    '「割り当て」の 1 行目 1 列目から 6 列 が構成と違う。'
      + 'いま: 日 / （空） / 開始 / 終了 / 役割 / 学籍番号 ／ 構成: 日 / 開始 / 終了 / 役割 / 学籍番号 / 氏名',
    '「割り当て」の 1 行目 7 列目 に、構成に無い「氏名」がある',
  ],
)

// 条件入力 has its 5 sections side by side, so inserting one column slides every section to the right of it
const conditionsWithInsertedColumn = emptyTemplate()
conditionsWithInsertedColumn.getSheetByName('条件入力').insertColumn(2)
const conditionBreakages = nameBreakages(conditionsWithInsertedColumn)

check(
  '② 横に並んだ 5 区画のどれがずれたかも、区画ごとに名指しする',
  [
    conditionBreakages.every((breakage) => breakage.sheet === '条件入力' && breakage.row >= 1 && breakage.column >= 1),
    breakageToText(conditionBreakages[0]),
  ],
  [
    true,
    '「条件入力」の 2 行目 1 列目から 5 列 が構成と違う。'
      + 'いま: 日付 / （空） / 準備開始 / 調理開始 / 調理終了 ／ 構成: 日付 / 準備開始 / 調理開始 / 調理終了 / 片付け開始',
  ],
)

const bookWithChangedHeading = emptyTemplate()
bookWithChangedHeading.getSheetByName('検証結果').put(1, 1, '区分')

check(
  '② 見出しを 1 つ書き換えると、その場所と、いまの中身と構成を並べて名指しする',
  namedLines(bookWithChangedHeading),
  [
    '「検証結果」の 1 行目 1 列目から 9 列 が構成と違う。'
      + 'いま: 区分 / 日 / 開始 / 終了 / 役割 / 学籍番号 / 氏名 / 内容 / あと何人'
      + ' ／ 構成: 種別 / 日 / 開始 / 終了 / 役割 / 学籍番号 / 氏名 / 内容 / あと何人',
  ],
)

// ---- ③ deleting a row / overwriting a generated sheet -----------------------

const bookWithDeletedRow = emptyTemplate()
bookWithDeletedRow.getSheetByName('条件入力').deleteRow(1)

check(
  '③ 見出しの行を 1 つ消すと、区画の見出しの場所を名指しする（行の削除）',
  namedLines(bookWithDeletedRow)[0],
  '「条件入力」の 1 行目 1 列目 が構成と違う。いま: 日付 ／ 構成: 日ごとの営業 4 時刻',
)

const overwrittenBook = emptyTemplate()
overwrittenBook.getSheetByName('指標').clear()

check(
  '③ 生成シートを上書きして見出しが消えても名指しする（黙って置き直さない）',
  namedLines(overwrittenBook),
  [
    '「指標」の 1 行目 1 列目から 5 列 が構成と違う。'
      + 'いま: （空） / （空） / （空） / （空） / （空） ／ 構成: 学籍番号 / 氏名 / 合計時間 / シフト回数 / 準備回数',
  ],
)

// Delete columns in one go and the column count the layout needs is gone outright.
// Taking the range to read outside the sheet would be an out-of-range exception, so it gets named
// before the reading
const bookWithCutColumns = emptyTemplate()
bookWithCutColumns.getSheetByName('割り当て').cutColumnsTo(4)

check(
  '③ 列をまとめて消されても、範囲外で落ちずに列数を名指しする',
  namedLines(bookWithCutColumns),
  [
    'シート「割り当て」の列が 4 列しかない（構成は 6 列である）',
    '「割り当て」の 1 行目 1 列目から 6 列 が構成と違う。'
      + 'いま: 日 / 開始 / 終了 / 役割 / （空） / （空） ／ 構成: 日 / 開始 / 終了 / 役割 / 学籍番号 / 氏名',
  ],
)

// 条件入力 has heading rows down to row 2. With only 1 row left, the column name row itself is gone
const bookWithCutRows = emptyTemplate()
bookWithCutRows.getSheetByName('条件入力').cutRowsTo(1)

check(
  '③ 行をまとめて消されても、範囲外で落ちずに列名の行を名指しする',
  namedLines(bookWithCutRows)[0],
  '「条件入力」の 2 行目 1 列目から 5 列 が構成と違う。'
    + 'いま: （空） / （空） / （空） / （空） / （空） ／ 構成: 日付 / 準備開始 / 調理開始 / 調理終了 / 片付け開始',
)

// ---- ④ nothing got silently fixed -------------------------------------------

const bookLeftBroken = emptyTemplate()
bookLeftBroken.getSheetByName('検証結果').put(1, 1, '区分')
bookLeftBroken.getSheetByName('割り当て').insertColumn(2)
const snapshotBeforeChecking = bookLeftBroken.snapshot()
nameBreakages(bookLeftBroken)

check(
  '④ 照らしたあとも、セルが 1 つも変わっていない（黙って直した箇所が 0 である）',
  bookLeftBroken.snapshot(),
  snapshotBeforeChecking,
)

// ---- ⑤ reading is once per sheet --------------------------------------------

roundTrips.reads = 0
nameBreakages(emptyTemplate())

check('⑤ 読むのはシートごとに 1 回である（5 枚で 5 回）', roundTrips.reads, sheetLayout.length)

roundTrips.reads = 0
nameBreakages(bookMissingASheet)

check('⑤ 無いシートは読まない（4 枚で 4 回）', roundTrips.reads, sheetLayout.length - 1)

// ---- ⑥ broken means it stops ------------------------------------------------

check(
  '⑥ 崩れていなければ、構造を確かめる は 0 箇所を返して通す',
  checkStructure(emptyTemplate()),
  [],
)

const stopped = whyItStopped(() => checkStructure(bookWithInsertedColumn))

check(
  '⑥ 崩れていれば止まり、箇所数と「黙って直さない」と戻し方を名指しする',
  [
    stopped?.startsWith('シートの構造が 2 箇所崩れているので、生成を走らせない。'),
    stopped?.includes('黙って直さない'),
    stopped?.includes('テンプレートをもう 1 回コピーして条件を入れ直す'),
  ],
  [true, true, true],
)

check(
  '⑥ 止まったときの文に、崩れている箇所の行が全部入っている',
  namedLines(bookWithInsertedColumn).filter((line) => !stopped.includes(line)),
  [],
)

// ---- results ----------------------------------------------------------------

console.log('構造の検証の検査（src/verify-structure.js／読むだけの偽のスプレッドシートの上）')
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
