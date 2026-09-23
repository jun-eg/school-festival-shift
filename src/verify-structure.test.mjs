#!/usr/bin/env node
// 構造の検証の検査 — src/verify-structure.js を、読むだけの偽のスプレッドシートの上で走らせる。
//
//   使い方: node src/verify-structure.test.mjs
//
// 見るものは 6 つある。
//   ① 構成どおりなら崩れは 0 箇所
//   ② シートを消す／列を挿す／見出しを書き換える、のそれぞれで名指しの行が出る
//   ③ 行の削除・生成シートの上書き・列をまとめて消す、でも名指しする
//   ④ セルが 1 つも変わっていない（黙って直さない）
//   ⑤ 読むのはシートごとに 1 回
//   ⑥ 崩れていれば checkStructure が止まり、崩れている箇所を全部文にして持っている
//
// 崩れた状態で生成が走らないことは src/shell.test.mjs が見る。

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// ---- 読むだけの偽のスプレッドシート -----------------------------------------
// setValues を持たないので、書こうとしたらそこで落ちる（「黙って直さない」を道具の側で確かめる）。

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
  // 1000 行 26 列は、新しいスプレッドシートの既定の大きさである
  constructor(name) {
    Object.assign(this, { name, cells: new Map(), maxRows: 1000, maxColumns: 26 })
  }
  getName() { return this.name }
  getRange(row, column, rowCount = 1, columnCount = 1) {
    // 本物と同じく範囲外で例外を投げる
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
  /** 担当者が列をまとめて消した状態にする（その列より右が消える）。 */
  cutColumnsTo(maxColumns) {
    this.maxColumns = maxColumns
    this.cells = new Map(
      [...this.cells.entries()].filter(([key]) => Number(key.split(',')[1]) <= maxColumns),
    )
    return this
  }
  /** 担当者が行をまとめて消した状態にする（その行より下が消える）。 */
  cutRowsTo(maxRows) {
    this.maxRows = maxRows
    this.cells = new Map(
      [...this.cells.entries()].filter(([key]) => Number(key.split(',')[0]) <= maxRows),
    )
    return this
  }
  /** 担当者が列を 1 つ挿した状態にする（その列から右が 1 つずれる）。 */
  insertColumn(at) {
    this.cells = new Map(
      [...this.cells.entries()].map(([key, value]) => {
        const [row, column] = key.split(',').map(Number)
        return [`${row},${column < at ? column : column + 1}`, value]
      }),
    )
    return this
  }
  /** 担当者が行を 1 つ消した状態にする（その行から下が 1 つ上がる）。 */
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
  /** シートの中身を丸ごと消した状態にする（生成シートの上書き）。 */
  clear() { this.cells = new Map(); return this }
}

class FakeSpreadsheet {
  constructor(sheets) { this.sheets = sheets }
  getSheetByName(name) { return this.sheets.find((s) => s.getName() === name) ?? null }
  snapshot() { return JSON.stringify(this.sheets.map((s) => [s.name, [...s.cells.entries()].sort()])) }
}

// ---- 読み込む ---------------------------------------------------------------
// headerRowCount と normalizeValue は shell.js にあるので一緒に読む。SpreadsheetApp は置かない。

const context = vm.createContext({})
for (const name of ['sheet-layout.js', 'core.js', 'shell.js', 'verify-structure.js']) {
  vm.runInContext(fs.readFileSync(path.join(here, name), 'utf8'), context, { filename: name })
}
const { nameBreakages, checkStructure, breakageToText, sectionRightEdge } = context
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

/** sheetLayout どおりに見出しを置いた空の 8 枚（テンプレートを組んだ直後の形）を作る。 */
function emptyTemplate() {
  const sheets = sheetLayout.map((layout) => {
    const sheet = new FakeSheet(layout.name)
    // マス目の 4 枚は既定の 26 列に収まらないので広げる（→ build-template.js の widenTo）
    sheet.maxColumns = Math.max(sheet.maxColumns, sectionRightEdge(layout))
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

// ---- ① 崩れていなければ 0 箇所 ----------------------------------------------

check('① 構成どおりに並んでいれば、崩れは 0 箇所である', namedLines(emptyTemplate()), [])

// 担当者が書く行を足しても、見出しだけを見ているので崩れない
const bookWithMoreRows = emptyTemplate()
bookWithMoreRows.getSheetByName('条件入力').put(3, 1, '2025-11-01').put(4, 1, '2025-11-02')
bookWithMoreRows.getSheetByName('準備日').put(2, 1, 'EED2349987').put(1, 4, '08:00')
check('① 担当者がデータの行を書き足しても崩れない（見るのは見出しの行だけである）', namedLines(bookWithMoreRows), [])

// ---- ② シートを消す／列を挿す／見出しを書き換える ---------------------------

const bookMissingASheet = emptyTemplate()
bookMissingASheet.sheets = bookMissingASheet.sheets.filter((s) => s.getName() !== '回答')

check(
  '② シートを 1 枚消すと、そのシートを名指しする',
  namedLines(bookMissingASheet),
  ['シート「回答」が無い'],
)

const bookWithInsertedColumn = emptyTemplate()
bookWithInsertedColumn.getSheetByName('指標').insertColumn(2)

check(
  '② 列を 1 つ挿すと、ずれた列名と、右へ押し出された見出しを名指しする',
  namedLines(bookWithInsertedColumn),
  [
    '「指標」の 1 行目 1 列目から 5 列 が構成と違う。'
      + 'いま: 学籍番号 / （空） / 氏名 / 合計時間 / シフト回数'
      + ' ／ 構成: 学籍番号 / 氏名 / 合計時間 / シフト回数 / 準備回数',
    '「指標」の 1 行目 6 列目 に、構成に無い「準備回数」がある',
  ],
)

// マス目の 4 枚は、名前のある 3 列だけを照らす（右の時刻の列は名前を持たない）。
const gridWithInsertedColumn = emptyTemplate()
gridWithInsertedColumn.getSheetByName('学祭1日目').put(1, 4, '08:00').put(1, 5, '08:30').insertColumn(2)

check(
  '② マス目の 4 枚は、名前のある 3 列だけを照らす（時刻の列は名前を持たないので出てこない）',
  namedLines(gridWithInsertedColumn),
  [
    '「学祭1日目」の 1 行目 1 列目から 3 列 が構成と違う。'
      + 'いま: 学籍番号 / （空） / 氏名 ／ 構成: 学籍番号 / 氏名 / 一緒に組みたいお友達',
  ],
)

// 条件入力は 5 区画が横に並ぶので、1 つ挿すと右の区画まで全部ずれる
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
    '「条件入力」の 2 行目 1 列目から 6 列 が構成と違う。'
      + 'いま: 日付 / （空） / 準備開始 / 調理開始 / 調理終了 / 片付け開始'
      + ' ／ 構成: 日付 / 準備開始 / 調理開始 / 調理終了 / 片付け開始 / 片付け終了',
  ],
)

const bookWithChangedHeading = emptyTemplate()
bookWithChangedHeading.getSheetByName('検証結果').put(1, 1, '区分')

check(
  '② 見出しを 1 つ書き換えると、その場所と、いまの中身と構成を並べて名指しする',
  namedLines(bookWithChangedHeading),
  [
    '「検証結果」の 1 行目 1 列目から 10 列 が構成と違う。'
      + 'いま: 区分 / 日 / 開始 / 終了 / 役割 / 学籍番号 / 氏名 / 内容 / あと何人 / 候補'
      + ' ／ 構成: 種別 / 日 / 開始 / 終了 / 役割 / 学籍番号 / 氏名 / 内容 / あと何人 / 候補',
  ],
)

// ---- ③ 行を消す／生成シートを上書きする -------------------------------------

const bookWithDeletedRow = emptyTemplate()
bookWithDeletedRow.getSheetByName('条件入力').deleteRow(1)

check(
  '③ 見出しの行を 1 つ消すと、区画の見出しの場所を名指しする（行の削除）',
  namedLines(bookWithDeletedRow)[0],
  '「条件入力」の 1 行目 1 列目 が構成と違う。いま: 日付 ／ 構成: 日ごとの営業時刻',
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

// 列をまとめて消されたら、範囲外の例外より先に名指しする
const bookWithCutColumns = emptyTemplate()
bookWithCutColumns.getSheetByName('指標').cutColumnsTo(3)

check(
  '③ 列をまとめて消されても、範囲外で落ちずに列数を名指しする',
  namedLines(bookWithCutColumns),
  [
    'シート「指標」の列が 3 列しかない（構成は 5 列である）',
    '「指標」の 1 行目 1 列目から 5 列 が構成と違う。'
      + 'いま: 学籍番号 / 氏名 / 合計時間 / （空） / （空）'
      + ' ／ 構成: 学籍番号 / 氏名 / 合計時間 / シフト回数 / 準備回数',
  ],
)

// マス目の 4 枚は 51 列を取る（→ sheet-layout.js の maxSlotsPerDay）。26 列のままなら名指しする
const gridNotWidened = emptyTemplate()
gridNotWidened.getSheetByName('片付け').cutColumnsTo(26)

check(
  '③ マス目の 4 枚が広げられていなければ、読む前に列数を名指しする',
  namedLines(gridNotWidened),
  ['シート「片付け」の列が 26 列しかない（構成は 51 列である）'],
)

// 条件入力は 2 行目までが見出しなので、1 行しか残っていなければ列名の行が無い
const bookWithCutRows = emptyTemplate()
bookWithCutRows.getSheetByName('条件入力').cutRowsTo(1)

check(
  '③ 行をまとめて消されても、範囲外で落ちずに列名の行を名指しする',
  namedLines(bookWithCutRows)[0],
  '「条件入力」の 2 行目 1 列目から 6 列 が構成と違う。'
    + 'いま: （空） / （空） / （空） / （空） / （空） / （空）'
    + ' ／ 構成: 日付 / 準備開始 / 調理開始 / 調理終了 / 片付け開始 / 片付け終了',
)

// ---- ④ 黙って直していない ---------------------------------------------------

const bookLeftBroken = emptyTemplate()
bookLeftBroken.getSheetByName('検証結果').put(1, 1, '区分')
bookLeftBroken.getSheetByName('指標').insertColumn(2)
const snapshotBeforeChecking = bookLeftBroken.snapshot()
nameBreakages(bookLeftBroken)

check(
  '④ 照らしたあとも、セルが 1 つも変わっていない（黙って直した箇所が 0 である）',
  bookLeftBroken.snapshot(),
  snapshotBeforeChecking,
)

// ---- ⑤ 読むのはシートごとに 1 回 --------------------------------------------

roundTrips.reads = 0
nameBreakages(emptyTemplate())

check('⑤ 読むのはシートごとに 1 回である（8 枚で 8 回）', roundTrips.reads, sheetLayout.length)

roundTrips.reads = 0
nameBreakages(bookMissingASheet)

check('⑤ 無いシートは読まない（4 枚で 4 回）', roundTrips.reads, sheetLayout.length - 1)

// ---- ⑥ 崩れていれば止まる ---------------------------------------------------

check(
  '⑥ 崩れていなければ、構造を確かめる は 0 箇所を返して通す',
  checkStructure(emptyTemplate()),
  [],
)

const stopped = whyItStopped(() => checkStructure(bookWithInsertedColumn))

check(
  '⑥ 崩れていれば止まり、箇所数と「黙って直さない」と戻し方を名指しする',
  [
    stopped?.startsWith('シートの構造が 2 箇所崩れているので、生成を走らせない（黙って直さない）。'),
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

// ---- 結果 ------------------------------------------------------------------

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
