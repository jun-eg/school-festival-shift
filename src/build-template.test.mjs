#!/usr/bin/env node
// 組み立ての検査 — src/build-template.js を、偽のスプレッドシートの上で走らせる。
//
//   使い方: node src/build-template.test.mjs
//
// 見るものは 9 つある。
//   ① 5 枚が構成の並びででき、最初からある空のシートが消える
//   ② 8 枚に保護がかかる。割り当ての 4 枚は「持ち主だけ」、ほかの 4 枚は「警告のみ」で、
//      条件入力だけは区画の入力欄が保護の外にある（→ issue #234）
//   ③ 2 回走らせても形が変わらない（足りないものだけ足す）
//   ④ 見出しが構成と違うときは、上書きせずに名指しで止まる（黙って直さない）
//   ⑤ 条件入力の区画ごとに、列名の下へ初期値が置かれる。入力欄に中身がある区画には置かない（→ issue #240）
//   ⑥ 割り当ての 4 枚で、友達欄が時刻の列 3 つ分の幅になり、友達欄の右に太い線が引かれる（→ issue #245）
//   ⑦ 検証結果の候補の列は、ほかの列の 5 倍の幅になる。候補の列が無い前の形のシートには、見出しを足して止まらない（→ issue #246）
//   ⑧ 条件入力の 9〜10 行目に、フォームの URL 欄（見出しと空の URL 欄・結合・太枠）が置かれ、保護の内に残る（→ issue #255）
//   ⑨ 条件入力の 13 行目に、引き継ぎ書の所在（見出しと URL・結合・太枠）が置かれ、保護の内に残る（→ issue #274）
//
// 本物のスプレッドシートで保護が効くか・コピーでスクリプトが渡るか・
// コピーした先で「持ち主だけ」が誰に効くかは分からない（→ issue #136・real-device-log.md の項目 22）。

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
  /** 見るのは、四方を囲う枠（→ issue #255）と、右だけの線（→ issue #245）である。 */
  setBorder(top, left, bottom, right, vertical, horizontal, color, style) {
    if (top === true && left === true && bottom === true && right === true) {
      this.sheet.boxes.add(`${this.row},${this.column},${this.rowCount},${this.columnCount} ${color} ${style}`)
    } else if (right === true) {
      this.positions().forEach((key) => this.sheet.rightBorders.set(key, `${color} ${style}`))
    }
    return this
  }
  merge() {
    this.sheet.merges.add(`${this.row},${this.column},${this.rowCount},${this.columnCount}`)
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
      name, cells: new Map(), bold: new Map(), notes: new Map(), rightBorders: new Map(), boxes: new Set(), merges: new Set(), columnWidths: new Map(), protections: [],
      frozenRows: 0, frozenColumns: 0, maxRows: 1000, maxColumns: 26,
    })
  }
  getName() { return this.name }
  getRange(row, column, rowCount = 1, columnCount = 1) { return new FakeRange(this, row, column, rowCount, columnCount) }
  setFrozenRows(count) { this.frozenRows = count }
  setFrozenColumns(count) { this.frozenColumns = count }
  // 100 px は、新しいスプレッドシートの列の既定の幅である
  getColumnWidth(column) { return this.columnWidths.get(column) ?? 100 }
  setColumnWidth(column, width) { this.columnWidths.set(column, width) }
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
  SpreadsheetApp: { ProtectionType: { SHEET: 'SHEET' }, BorderStyle: { SOLID_THICK: 'solid-thick' } },
  console: { log() {} },
})
for (const name of ['sheet-layout.js', 'build-template.js']) {
  vm.runInContext(fs.readFileSync(path.join(here, name), 'utf8'), context, { filename: name })
}
// const は文脈のプロパティにならないので、式で取り出す（function は文脈に出る）
const { buildTemplateInto } = context
const { sheetLayout, protectionNote, gridProtectionNote, inputProtectionNote, sectionRightEdge, sectionWidth, dayLabels, dividerLine, formUrlBlock, handoverBlock } = vm.runInContext(
  '({ sheetLayout, protectionNote, gridProtectionNote, inputProtectionNote, sectionRightEdge, sectionWidth, dayLabels, dividerLine, formUrlBlock, handoverBlock })',
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
  '② 条件入力だけ、区画ごとの入力欄（列名の下から最下行まで — 日ごとの営業時刻は URL 欄の上の 8 行目まで・区画の幅）が保護の外にある',
  book.getSheets().map((s) => [
    s.getName(),
    protectionOf(s.getName()).unprotectedRanges.map((r) => [r.row, r.column, r.rowCount, r.columnCount]),
  ]),
  sheetLayout.map((c) => [
    c.name,
    c.name === '条件入力' ? c.sections.map((section) => [3, section.startColumn, section.lastRow ? section.lastRow - 2 : 998, sectionWidth(section)]) : [],
  ]),
)

check(
  '⑥ 割り当ての 4 枚は友達欄（3 列目）が時刻の列 3 つ分、検証結果は候補（10 列目）が 5 列分の幅になった — ほかの列は既定の幅のまま',
  book.getSheets().map((s) => [s.getName(), [...s.columnWidths]]),
  sheetLayout.map((c) => [c.name, dayLabels.includes(c.name) ? [[3, 300]] : c.name === '検証結果' ? [[10, 500]] : []]),
)

check(
  '⑥ 割り当ての 4 枚だけ、友達欄の右に太い線が見出しから最下行まで引かれた — ほかの列には引かれない',
  book.getSheets().map((s) => [
    s.getName(),
    s.rightBorders.size,
    [...s.rightBorders].every(([key, line]) => key.split(',')[1] === '3' && line === `${dividerLine.color} solid-thick`),
  ]),
  sheetLayout.map((c) => [c.name, dayLabels.includes(c.name) ? 1000 : 0, true]),
)

const shapeOf = (target) => JSON.stringify(target.getSheets().map((s) => [s.getName(), [...s.cells], s.frozenRows, s.protections.length, [...s.columnWidths], [...s.rightBorders]]))
const shapeAfterFirstRun = shapeOf(book)
const secondRunLog = buildTemplateInto(book)
const shapeAfterSecondRun = shapeOf(book)

check('③ 2 回目を走らせても形が変わらない', shapeAfterSecondRun, shapeAfterFirstRun)
check(
  '③ 2 回目は何も作らない（記録に「作った」が出ない）',
  secondRunLog.filter((line) => line.includes('作った') || line.includes('置いた') || line.includes('広げた')),
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

const checkLayout = sheetLayout.find((c) => c.name === '検証結果')
const candidateColumn = checkLayout.sections[0].columns.indexOf('候補') + 1
const widthsOf = (target) => {
  const sheet = target.getSheetByName('検証結果')
  return checkLayout.sections[0].columns.map((_, i) => sheet.getColumnWidth(i + 1))
}

check(
  '⑦ 検証結果の候補は J 列で、ほかの列の 5 倍の幅になる（2 回目を走らせても倍々に伸びない）',
  [candidateColumn, widthsOf(book)],
  [10, checkLayout.sections[0].columns.map((name) => (name === '候補' ? 500 : 100))],
)

// 候補の列を足す前（#246 より前）に作ったシートである。見出しは I 列までしか無い。
const olderBook = new FakeSpreadsheet(['シート1'])
buildTemplateInto(olderBook)
olderBook.getSheetByName('検証結果').getRange(1, candidateColumn, 1, 1).setValues([['']])
let olderStopped = null
try {
  buildTemplateInto(olderBook)
} catch (error) {
  olderStopped = error.message
}

check(
  '⑦ 候補の列が無い前の形の検証結果には、止まらずに見出しを足す（中身のある見出しは構成と同じなので）',
  [olderStopped, olderBook.getSheetByName('検証結果').getRange(1, 1, 1, candidateColumn).getValues()[0]],
  [null, checkLayout.sections[0].columns],
)

const conditionSheet = book.getSheetByName('条件入力')

check(
  '⑧ 条件入力の A9 ／ A10 に URL 欄の見出しが入り、B 列と C9:E10 は空である',
  conditionSheet.getRange(9, 1, 2, 5).getValues(),
  [['配布用googleフォームurl:', '', '', '', ''], ['編集用googleフォームurl:', '', '', '', '']],
)
check(
  '⑧⑨ 見出しは A:B、URL は C:E で結合され、A9:E10 と A13:E13 が黒の太枠で囲われる — ほかのシートには無い',
  book.getSheets().map((s) => [s.getName(), [...s.merges].sort(), [...s.boxes].sort()]),
  sheetLayout.map((c) => [
    c.name,
    c.name === '条件入力' ? ['10,1,1,2', '10,3,1,3', '13,1,1,2', '13,3,1,3', '9,1,1,2', '9,3,1,3'] : [],
    c.name === '条件入力' ? ['13,1,1,5 #000000 solid-thick', '9,1,2,5 #000000 solid-thick'] : [],
  ]),
)
const insideAny = (row, column) => protectionOf('条件入力').unprotectedRanges.some((r) => (
  row >= r.row && row < r.row + r.rowCount && column >= r.column && column < r.column + r.columnCount
))
check(
  '⑧ A9:E10 は、保護の外に出す入力欄のどれにも入らない（保護の内に残る）',
  [9, 10].flatMap((row) => [1, 2, 3, 4, 5].map((column) => insideAny(row, column))),
  Array(10).fill(false),
)
check(
  '⑧ URL 欄の位置と見出しは構成（formUrlBlock）が持つ',
  [formUrlBlock.row, formUrlBlock.rows.map((one) => one.label)],
  [9, ['配布用googleフォームurl:', '編集用googleフォームurl:']],
)

// フォームを作った後に、テンプレートを走らせ直したときである。
const bookWithUrls = new FakeSpreadsheet(['シート1'])
buildTemplateInto(bookWithUrls)
bookWithUrls.getSheetByName('条件入力').getRange(9, 3, 2, 1).setValues([['https://forms.example/pub'], ['https://forms.example/edit']])
let urlsStopped = null
try {
  buildTemplateInto(bookWithUrls)
} catch (error) {
  urlsStopped = error.message
}
check(
  '⑧ URL が入った後に走らせ直しても止まらず、URL を消さない',
  [urlsStopped, bookWithUrls.getSheetByName('条件入力').getRange(9, 3, 2, 1).getValues()],
  [null, [['https://forms.example/pub'], ['https://forms.example/edit']]],
)

check(
  '⑨ 条件入力の A13 に「引き継ぎ書所在:」、C13 にリポジトリの URL が入り、B13 ／ D13:E13 は空である',
  conditionSheet.getRange(13, 1, 1, 5).getValues(),
  [['引き継ぎ書所在:', '', 'https://github.com/jun-eg/school-festival-shift', '', '']],
)
check(
  '⑨ A13 は太字である',
  conditionSheet.bold.get('13,1'),
  'bold',
)
check(
  '⑨ A13:E13 は、保護の外に出す入力欄のどれにも入らない（保護の内に残る）',
  [1, 2, 3, 4, 5].map((column) => insideAny(13, column)),
  Array(5).fill(false),
)
check(
  '⑨ 位置・見出し・URL は構成（handoverBlock）が持つ',
  [handoverBlock.row, handoverBlock.label, handoverBlock.url],
  [13, '引き継ぎ書所在:', 'https://github.com/jun-eg/school-festival-shift'],
)

// 引き継ぎ書の所在が構成と違う URL に書き換えられていたら、上書きせずに止まる。
const bookWithOtherUrl = new FakeSpreadsheet(['シート1'])
buildTemplateInto(bookWithOtherUrl)
bookWithOtherUrl.getSheetByName('条件入力').getRange(13, 3, 1, 1).setValues([['https://example.com/other']])
let otherUrlStopped = null
try {
  buildTemplateInto(bookWithOtherUrl)
} catch (error) {
  otherUrlStopped = error.message
}
check(
  '⑨ C13 が構成と違う URL なら、上書きせずに名指しで止まる',
  [otherUrlStopped !== null && otherUrlStopped.includes('13 行目 3 列目'), bookWithOtherUrl.getSheetByName('条件入力').getRange(13, 3, 1, 1).getValues()],
  [true, [['https://example.com/other']]],
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
