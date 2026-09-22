#!/usr/bin/env node
// 組み立ての検査 — src/build-template.js を、偽のスプレッドシートの上で走らせる。
//
//   使い方: node src/build-template.test.mjs
//
// 見るものは 5 つある。
//   ① 5 枚が構成の並びででき、最初からある空のシートが消える
//   ② 8 枚に保護がかかる。割り当ての 4 枚は「持ち主だけ」、ほかの 4 枚は「警告のみ」で、
//      条件入力だけは区画の入力欄が保護の外にある（→ issue #234）
//   ③ 2 回走らせても形が変わらない（足りないものだけ足す）
//   ④ 見出しが構成と違うときは、上書きせずに名指しで止まる（黙って直さない）
//   ⑤ 条件入力の区画ごとに、列名の下へ初期値が置かれる。入力欄に中身がある区画には置かない（→ issue #240）
//
// ここで分かるのは組み立ての手順だけである。
// 本物の Google スプレッドシートで保護が効くか・コピーでスクリプトが渡るか・
// コピーした先で「持ち主だけ」が誰に効くかは分からない（→ src/README.md・issue #136・real-device-log.md の項目 22）。

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// ---- 偽のスプレッドシート ---------------------------------------------------

class FakeRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    Object.assign(this, { sheet, row, column, rowCount, columnCount })
  }
  positions() {
    const keys = []
    for (let r = this.row; r < this.row + this.rowCount; r++) {
      for (let c = this.column; c < this.column + this.columnCount; c++) keys.push(`${r},${c}`)
    }
    return keys
  }
  getValues() {
    const table = []
    for (let r = this.row; r < this.row + this.rowCount; r++) {
      const row = []
      for (let c = this.column; c < this.column + this.columnCount; c++) row.push(this.sheet.cells.get(`${r},${c}`) ?? '')
      table.push(row)
    }
    return table
  }
  setValues(table) {
    table.forEach((row, i) => row.forEach((value, j) => this.sheet.cells.set(`${this.row + i},${this.column + j}`, value)))
    return this
  }
  setFontWeight(weight) {
    this.positions().forEach((key) => this.sheet.bold.set(key, weight))
    return this
  }
  setNote(note) {
    this.positions().forEach((key) => this.sheet.notes.set(key, note))
    return this
  }
}

// 本物と同じく、かけた直後は共有された編集者も編集者に入っていて、ドメインにも開いている。
// 持ち主と走らせている人は外れない（→ Protection.removeEditors）。
const owner = 'owner@example.com'
const sharedEditor = 'shared@example.com'

class FakeProtection {
  constructor(sheet) {
    this.sheet = sheet
    this.description = null
    this.warningOnly = false
    this.editors = [owner, sharedEditor]
    this.domainEdit = true
    this.unprotectedRanges = []
  }
  setDescription(description) { this.description = description; return this }
  setWarningOnly(value) { this.warningOnly = value; return this }
  getEditors() { return [...this.editors] }
  removeEditors(users) { this.editors = this.editors.filter((user) => user === owner || !users.includes(user)); return this }
  canDomainEdit() { return this.domainEdit }
  setDomainEdit(value) { this.domainEdit = value; return this }
  setUnprotectedRanges(ranges) { this.unprotectedRanges = ranges; return this }
  remove() { this.sheet.protections = this.sheet.protections.filter((p) => p !== this) }
}

class FakeSheet {
  // 1000 行 26 列は、新しいスプレッドシートの既定の大きさである
  constructor(name) {
    Object.assign(this, {
      name, cells: new Map(), bold: new Map(), notes: new Map(), protections: [],
      frozenRows: 0, frozenColumns: 0, maxRows: 1000, maxColumns: 26,
    })
  }
  getName() { return this.name }
  getRange(row, column, rowCount = 1, columnCount = 1) { return new FakeRange(this, row, column, rowCount, columnCount) }
  setFrozenRows(count) { this.frozenRows = count }
  setFrozenColumns(count) { this.frozenColumns = count }
  getMaxRows() { return this.maxRows }
  getMaxColumns() { return this.maxColumns }
  insertColumnsAfter(after, count) { this.maxColumns = Math.max(this.maxColumns, after + count) }
  getProtections() { return [...this.protections] }
  protect() { const p = new FakeProtection(this); this.protections.push(p); return p }
  getLastRow() { return [...this.cells.keys()].reduce((max, key) => Math.max(max, Number(key.split(',')[0])), 0) }
  getLastColumn() { return [...this.cells.keys()].reduce((max, key) => Math.max(max, Number(key.split(',')[1])), 0) }
}

class FakeSpreadsheet {
  constructor(names) {
    this.sheets = names.map((name) => new FakeSheet(name))
    this.activeSheet = this.sheets[0]
  }
  getSheets() { return [...this.sheets] }
  getSheetByName(name) { return this.sheets.find((s) => s.getName() === name) ?? null }
  insertSheet(name) { const s = new FakeSheet(name); this.sheets.push(s); return s }
  deleteSheet(sheet) { this.sheets = this.sheets.filter((s) => s !== sheet) }
  setActiveSheet(sheet) { this.activeSheet = sheet }
  moveActiveSheet(position) {
    this.sheets = this.sheets.filter((s) => s !== this.activeSheet)
    this.sheets.splice(position - 1, 0, this.activeSheet)
  }
}

// ---- 読み込む ---------------------------------------------------------------

const context = vm.createContext({
  SpreadsheetApp: { ProtectionType: { SHEET: 'SHEET' } },
  console: { log() {} },
})
for (const name of ['sheet-layout.js', 'build-template.js']) {
  vm.runInContext(fs.readFileSync(path.join(here, name), 'utf8'), context, { filename: name })
}
// const は文脈のプロパティにならないので、式で取り出す（function は文脈に出る）
const { buildTemplateInto } = context
const { sheetLayout, protectionNote, gridProtectionNote, inputProtectionNote, sectionRightEdge, sectionWidth, dayLabels } = vm.runInContext(
  '({ sheetLayout, protectionNote, gridProtectionNote, inputProtectionNote, sectionRightEdge, sectionWidth, dayLabels })',
  context,
)

// ---- 検査 -------------------------------------------------------------------

const failed = []
const passed = []

function check(title, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed.push(title)
  else failed.push({ title, actual, expected })
}

const book = new FakeSpreadsheet(['シート1'])
buildTemplateInto(book)

check(
  '① 5 枚が構成の並びででき、空の「シート1」が消えた',
  book.getSheets().map((s) => s.getName()),
  sheetLayout.map((c) => c.name),
)

check(
  '① 条件入力の 1 行目は区画の見出しで、2 行目が列名である',
  [
    book.getSheetByName('条件入力').getRange(1, 1, 1, sectionRightEdge(sheetLayout[0])).getValues()[0].filter((v) => v !== ''),
    book.getSheetByName('条件入力').getRange(2, 1, 1, 5).getValues()[0],
  ],
  [
    sheetLayout[0].sections.map((k) => k.heading),
    ['日付', '準備開始', '調理開始', '調理終了', '片付け開始'],
  ],
)

check(
  '① 回答の 1 行目に、構成が名前で持つ 6 列だけが並んでいる',
  book.getSheetByName('回答').getRange(1, 1, 1, 10).getValues()[0],
  [...sheetLayout[1].sections[0].columns, '', '', '', ''],
)

check(
  '② 8 枚とも保護が 1 つずつかかった',
  book.getSheets().map((s) => [s.getName(), s.protections.length]),
  sheetLayout.map((c) => [c.name, 1]),
)

const protectionOf = (name) => book.getSheetByName(name).protections[0]

check(
  '② 条件入力・回答・検証結果・指標は「警告のみ」で、説明が付いている',
  ['条件入力', '回答', '検証結果', '指標'].map((name) => [protectionOf(name).warningOnly, protectionOf(name).description]),
  [[true, inputProtectionNote], [true, protectionNote], [true, protectionNote], [true, protectionNote]],
)

check(
  '② 割り当ての 4 枚は「持ち主だけ」— 警告ではなく、共有された編集者が外れ、ドメインにも閉じている',
  dayLabels.map((name) => [protectionOf(name).warningOnly, protectionOf(name).editors, protectionOf(name).domainEdit, protectionOf(name).description]),
  dayLabels.map(() => [false, [owner], false, gridProtectionNote]),
)

check(
  '② 条件入力だけ、区画ごとの入力欄（列名の下から最下行まで・区画の幅）が保護の外にある',
  book.getSheets().map((s) => [
    s.getName(),
    protectionOf(s.getName()).unprotectedRanges.map((r) => [r.row, r.column, r.rowCount, r.columnCount]),
  ]),
  sheetLayout.map((c) => [
    c.name,
    c.name === '条件入力' ? c.sections.map((section) => [3, section.startColumn, 998, sectionWidth(section)]) : [],
  ]),
)

const shapeAfterFirstRun = JSON.stringify(book.getSheets().map((s) => [s.getName(), [...s.cells], s.frozenRows, s.protections.length]))
const secondRunLog = buildTemplateInto(book)
const shapeAfterSecondRun = JSON.stringify(book.getSheets().map((s) => [s.getName(), [...s.cells], s.frozenRows, s.protections.length]))

check('③ 2 回目を走らせても形が変わらない', shapeAfterSecondRun, shapeAfterFirstRun)
check(
  '③ 2 回目は何も作らない（記録に「作った」が出ない）',
  secondRunLog.filter((line) => line.includes('作った') || line.includes('置いた')),
  [],
)

const brokenBook = new FakeSpreadsheet(['シート1'])
buildTemplateInto(brokenBook)
brokenBook.getSheetByName('指標').getRange(1, 3, 1, 1).setValues([['合計時間（時）']])
let stopped = null
try {
  buildTemplateInto(brokenBook)
} catch (error) {
  stopped = error.message
}

check(
  '④ 見出しが構成と違うと、シート名を名指しして止まる',
  [stopped !== null, stopped?.includes('「指標」'), stopped?.includes('黙って直さない')],
  [true, true, true],
)
check(
  '④ 止まったとき、書き換えられたセルを上書きしていない',
  brokenBook.getSheetByName('指標').getRange(1, 3, 1, 1).getValues()[0],
  ['合計時間（時）'],
)

const conditionLayout = sheetLayout[0]
const inputRowsOf = (target, section, rowCount) => target
  .getSheetByName('条件入力')
  .getRange(3, section.startColumn, rowCount, sectionWidth(section))
  .getValues()

check(
  '⑤ 条件入力の 6 区画とも、列名の下（3 行目から）に初期値がそのまま置かれた',
  conditionLayout.sections.map((section) => [section.heading, inputRowsOf(book, section, section.initialRows.length)]),
  conditionLayout.sections.map((section) => [section.heading, section.initialRows]),
)
check(
  '⑤ 初期値の下の行は空のままである',
  conditionLayout.sections.map((section) => inputRowsOf(book, section, section.initialRows.length + 1).slice(-1)[0].every((cell) => cell === '')),
  conditionLayout.sections.map(() => true),
)

const writtenBook = new FakeSpreadsheet(['シート1', '条件入力'])
writtenBook.getSheetByName('条件入力').getRange(4, 1, 1, 1).setValues([['2026-10-30']])
const writtenLog = buildTemplateInto(writtenBook)
const [daySection, ...otherSections] = conditionLayout.sections

check(
  '⑤ 入力欄に中身がある区画には初期値を置かず、書いてあった値をそのまま残す',
  inputRowsOf(writtenBook, daySection, daySection.initialRows.length),
  daySection.initialRows.map((row, i) => row.map((_, j) => (i === 1 && j === 0 ? '2026-10-30' : ''))),
)
check(
  '⑤ ほかの区画には初期値が置かれ、置いた区画だけが記録に出る',
  [
    otherSections.every((section) => JSON.stringify(inputRowsOf(writtenBook, section, section.initialRows.length)) === JSON.stringify(section.initialRows)),
    writtenLog.filter((line) => line.includes('初期値')).length,
  ],
  [true, otherSections.length],
)

// ---- 結果 -------------------------------------------------------------------

console.log('組み立ての検査（src/build-template.js／偽のスプレッドシートの上）')
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
