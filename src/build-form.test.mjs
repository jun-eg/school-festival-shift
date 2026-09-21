#!/usr/bin/env node
// フォームの作り方の検査 — src/build-form.js を、偽のフォームと偽のスプレッドシートの上で走らせる。
//
//   使い方: node src/build-form.test.mjs
//
// 見るものは 5 つある。
//   ① 定義の順どおりに置かれる（設問 9 つ ＋ 画像アイテム 1 つ。必須・選択肢・正規表現・文言ごと）
//   ② 担当者が選んだ画像が、そのまま画像アイテムに入る（選ばれていなければ名指しで止まる）
//   ③ 回答先がこのスプレッドシート自身に向く（担当者が紐付けない → 6 の #6）
//   ④ フォームが作った回答シートが構成の「回答」になる（見出し・位置・保護・5 枚のまま）
//   ⑤ 2 回目・回答がある・見出しが違う、のそれぞれで名指しして止まる（黙って直さない）
//
// ここで分かるのは手順だけである。
// 本物の Google フォームで正規表現とエラーメッセージ（句点の揺れ ◎）が設定できるかは
// issue #145（6-1 の #1）が、setDestination が 1 スコープで通るかは実機が持つ
// （→ src/real-device-log.md）。

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

class FakeProtection {
  constructor(sheet) {
    this.sheet = sheet
    this.description = null
    this.warningOnly = false
  }
  setDescription(description) { this.description = description; return this }
  setWarningOnly(value) { this.warningOnly = value; return this }
  remove() { this.sheet.protections = this.sheet.protections.filter((p) => p !== this) }
}

let nextSheetId = 1

class FakeSheet {
  constructor(name) {
    Object.assign(this, {
      name, id: nextSheetId++, cells: new Map(), bold: new Map(), notes: new Map(),
      protections: [], frozenRows: 0, formUrl: null,
    })
  }
  getName() { return this.name }
  setName(name) { this.name = name; return this }
  getSheetId() { return this.id }
  getRange(row, column, rowCount = 1, columnCount = 1) { return new FakeRange(this, row, column, rowCount, columnCount) }
  setFrozenRows(count) { this.frozenRows = count }
  getProtections() { return [...this.protections] }
  protect() { const p = new FakeProtection(this); this.protections.push(p); return p }
  getFormUrl() { return this.formUrl }
  getLastRow() { return [...this.cells.keys()].reduce((max, key) => Math.max(max, Number(key.split(',')[0])), 0) }
  getLastColumn() { return [...this.cells.keys()].reduce((max, key) => Math.max(max, Number(key.split(',')[1])), 0) }
}

class FakeSpreadsheet {
  constructor(names, id = 'this-spreadsheet') {
    this.sheets = names.map((name) => new FakeSheet(name))
    this.activeSheet = this.sheets[0]
    this.id = id
    this.name = '学祭シフト'
  }
  getId() { return this.id }
  getName() { return this.name }
  getSheets() { return [...this.sheets] }
  getSheetByName(name) { return this.sheets.filter((s) => s.getName() === name)[0] ?? null }
  insertSheet(name) { const s = new FakeSheet(name); this.sheets.push(s); return s }
  deleteSheet(sheet) { this.sheets = this.sheets.filter((s) => s !== sheet) }
  setActiveSheet(sheet) { this.activeSheet = sheet }
  moveActiveSheet(position) {
    this.sheets = this.sheets.filter((s) => s !== this.activeSheet)
    this.sheets.splice(position - 1, 0, this.activeSheet)
  }
}

// ---- 偽のフォーム -----------------------------------------------------------
//
// 本物の Google フォームがやることのうち、この検査が見るものだけを真似る。
//   ・置かれた設問を順に覚える
//   ・setDestination で、回答先のスプレッドシートに回答シートを 1 枚作る
//     （名前は Google が決める「フォームの回答 1」、見出しはタイムスタンプ ＋ 設問の題である）

class FakeValidationBuilder {
  constructor(kind) { this.built = { kind } }
  requireTextMatchesPattern(pattern) { this.built.pattern = pattern; return this }
  setHelpText(text) { this.built.helpText = text; return this }
  build() { return this.built }
}

class FakeItem {
  constructor(kind) { Object.assign(this, { kind, title: null, required: false, helpText: null, validation: null }) }
  setTitle(title) { this.title = title; return this }
  setRequired(required) { this.required = required; return this }
  setHelpText(text) { this.helpText = text; return this }
  setValidation(validation) { this.validation = validation; return this }
  setChoiceValues(choices) { this.choices = choices; return this }
  setImage(image) { this.image = image; return this }
}

class FakeForm {
  constructor(title, books) {
    Object.assign(this, { title, items: [], destination: null, books })
  }
  add(kind) { const item = new FakeItem(kind); this.items.push(item); return item }
  addTextItem() { return this.add('text') }
  addParagraphTextItem() { return this.add('paragraph') }
  addMultipleChoiceItem() { return this.add('radio') }
  addImageItem() { return this.add('image') }
  getPublishedUrl() { return 'https://forms.example/viewform' }
  getEditUrl() { return 'https://forms.example/edit' }
  setDestination(type, id) {
    this.destination = { type, id }
    const book = this.books[id]
    if (!book) throw new Error(`偽のフォーム: 回答先 ${id} が無い`)
    const sheet = book.insertSheet('フォームの回答 1')
    const header = ['タイムスタンプ', ...this.items.filter((item) => item.kind !== 'image').map((item) => item.title)]
    sheet.getRange(1, 1, 1, header.length).setValues([header])
    sheet.formUrl = this.getPublishedUrl()
    return this
  }
}

// ---- 読み込む ---------------------------------------------------------------

const books = {}
const createdForms = []

const context = vm.createContext({
  SpreadsheetApp: { ProtectionType: { SHEET: 'SHEET' }, flush() {} },
  FormApp: {
    DestinationType: { SPREADSHEET: 'SPREADSHEET' },
    create(title) { const form = new FakeForm(title, books); createdForms.push(form); return form },
    createTextValidation() { return new FakeValidationBuilder('text') },
    createParagraphTextValidation() { return new FakeValidationBuilder('paragraph') },
  },
  Utilities: {
    base64Decode(base64) { return [...base64].map((c) => c.charCodeAt(0)) },
    newBlob(bytes, mimeType, fileName) { return { bytes, mimeType, fileName } },
  },
  console: { log() {} },
})
for (const name of ['sheet-layout.js', 'form-definition.js', 'build-template.js', 'build-form.js']) {
  vm.runInContext(fs.readFileSync(path.join(here, name), 'utf8'), context, { filename: name })
}
const { buildTemplateInto, buildFormOn, rosterImageFrom } = context
const { sheetLayout, formItems, protectionNote } = vm.runInContext(
  '({ sheetLayout, formItems, protectionNote })',
  context,
)

// ---- 道具 -------------------------------------------------------------------

const failed = []
const passed = []

function check(title, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed.push(title)
  else failed.push({ title, actual, expected })
}

function whyItStopped(run) {
  try {
    run()
    return null
  } catch (error) {
    return error.message
  }
}

/** 組み立て済みのテンプレートを 1 つ用意する（build-template.js そのものを通す）。 */
function freshTemplate(id = 'this-spreadsheet') {
  const book = new FakeSpreadsheet(['シート1'], id)
  buildTemplateInto(book)
  books[id] = book
  return book
}

const rosterImage = { bytes: [1, 2, 3], mimeType: 'image/png', fileName: '調理名簿.png' }

// ---- ①②③④ 1 回通す --------------------------------------------------------

const book = freshTemplate()
const built = buildFormOn(book, rosterImage)
const form = createdForms[createdForms.length - 1]

check(
  '① 定義の順どおりに、設問 9 つ ＋ 画像アイテム 1 つが置かれた',
  form.items.map((item) => [item.kind, item.title]),
  [
    ['text', '学籍番号'],
    ['text', '氏名'],
    ['radio', '学年'],
    ['radio', '調理担当ですか？'],
    ['image', '調理名簿'],
    ['text', '一緒に組みたいお友達'],
    ['paragraph', '11月1日(準備日)'],
    ['paragraph', '11月2日(学祭1日目)'],
    ['paragraph', '11月3日(学祭2日目)'],
    ['paragraph', '11月4日(片付け)'],
  ],
)

check(
  '① 必須の設問が 4-1 の表どおりである（任意は友達欄だけ）',
  form.items.filter((item) => item.kind !== 'image').map((item) => [item.title, item.required]),
  formItems.filter((item) => item.kind !== '画像アイテム').map((item) => [item.title, item.required]),
)

check(
  '① 選択肢が 4-1 の表どおりに入った',
  form.items.filter((item) => item.kind === 'radio').map((item) => [item.title, item.choices]),
  [['学年', ['1年生', '2年生', '3年生', '4年生']], ['調理担当ですか？', ['はい', 'いいえ']]],
)

check(
  '① 正規表現が 3 箇所に入り、希望時間の 4 設問は同じ 1 本である',
  form.items.filter((item) => item.validation).map((item) => [item.title, item.validation.pattern]),
  formItems.filter((item) => item.pattern).map((item) => [item.title, item.pattern]),
)

check(
  '① エラーメッセージの句点の揺れ ◎ が、揃わずにそのまま渡った（→ 4-3）',
  form.items.filter((item) => item.kind === 'paragraph').map((item) => [item.title, item.validation.helpText]),
  [
    ['11月1日(準備日)', '無効な書式です'],
    ['11月2日(学祭1日目)', '無効な書式です'],
    ['11月3日(学祭2日目)', '無効な書式です。'],
    ['11月4日(片付け)', '無効な書式です'],
  ],
)

check(
  '① 短文回答には、記録に無いエラーメッセージを付けていない（→ 4-3）',
  form.items.filter((item) => item.kind === 'text' && item.validation).map((item) => item.validation.helpText),
  [undefined, undefined],
)

check(
  '① 長文回答の説明文に、その日の営業時間と例 3 つが入った（→ 4-2）',
  form.items.filter((item) => item.kind === 'paragraph').map((item) => [
    item.helpText.includes('8:00-'),
    item.helpText.includes('10:00-15:00'),
    item.helpText.includes('10:00-12:00,13:00-15:00'),
    item.helpText.includes('00:00-00:00'),
  ]),
  [[true, true, true, true], [true, true, true, true], [true, true, true, true], [true, true, true, true]],
)

check(
  '② 担当者が選んだ画像が、そのまま画像アイテムに入った',
  form.items.filter((item) => item.kind === 'image').map((item) => item.image),
  [rosterImage],
)

check(
  '② 画像が選ばれていなければ、フォームを 1 つも作らずに名指しで止まる',
  [
    whyItStopped(() => rosterImageFrom(null))?.includes('名簿の画像が選ばれていない'),
    whyItStopped(() => rosterImageFrom({ mimeType: 'image/png' }))?.includes('名簿の画像が選ばれていない'),
  ],
  [true, true],
)

check(
  '③ 回答先が、このスプレッドシート自身に向いた（担当者が紐付けない）',
  form.destination,
  { type: 'SPREADSHEET', id: 'this-spreadsheet' },
)

check(
  '③ フォームの名前は、担当者が付けたこのファイルの名前である（文言を発明しない）',
  form.title,
  book.getName(),
)

check(
  '③ 配る URL が返る（担当者が LINE ノートに貼る → 2 の一覧 4）',
  [built.url, built.editUrl],
  ['https://forms.example/viewform', 'https://forms.example/edit'],
)

check(
  '④ シートは 5 枚のままで、構成の並びも変わっていない',
  book.getSheets().map((sheet) => sheet.getName()),
  sheetLayout.map((layout) => layout.name),
)

const answerSheet = book.getSheetByName('回答')

check(
  '④ 「回答」はフォームが作ったシートで、紐付きを持っている',
  [answerSheet.getFormUrl(), answerSheet.frozenRows],
  ['https://forms.example/viewform', 1],
)

check(
  '④ 「回答」の見出しが、構成の 10 列と 1 つずつ一致する',
  answerSheet.getRange(1, 1, 1, 10).getValues()[0],
  sheetLayout.filter((layout) => layout.name === '回答')[0].sections[0].columns,
)

check(
  '④ 「回答」に警告のみの保護がかかっている（生成シートである）',
  answerSheet.protections.map((protection) => [protection.warningOnly, protection.description]),
  [[true, protectionNote]],
)

check(
  '④ 保護がかかっているのは生成シートの 3 枚だけのままである',
  book.getSheets().filter((sheet) => sheet.protections.length > 0).map((sheet) => sheet.getName()),
  ['回答', '検証結果', '指標'],
)

// ---- ⑤ 止まる ---------------------------------------------------------------

const formsBeforeSecondRun = createdForms.length
const secondRun = whyItStopped(() => buildFormOn(book, rosterImage))

check(
  '⑤ 2 回目は、すでに紐付いていることを名指しして止まる',
  [secondRun?.includes('すでにフォームが紐付いている'), secondRun?.includes('作り直さない')],
  [true, true],
)

check(
  '⑤ 止まったとき、フォームを 1 つも作っていない',
  createdForms.length,
  formsBeforeSecondRun,
)

const bookWithAnswers = freshTemplate('with-answers')
bookWithAnswers.getSheetByName('回答').getRange(2, 1, 1, 2).setValues([['2025/09/23 16:31:09', 'EED2349987']])
const stoppedOnAnswers = whyItStopped(() => buildFormOn(bookWithAnswers, rosterImage))

check(
  '⑤ 回答シートに中身があるときは、消さずに名指しして止まる',
  [stoppedOnAnswers?.includes('1 行の中身がある'), stoppedOnAnswers?.includes('黙って直さない')],
  [true, true],
)

check(
  '⑤ 止まったとき、書いてあった行を消していない',
  bookWithAnswers.getSheetByName('回答').getRange(2, 1, 1, 2).getValues()[0],
  ['2025/09/23 16:31:09', 'EED2349987'],
)

const bookWithoutAnswerSheet = freshTemplate('no-answer-sheet')
bookWithoutAnswerSheet.deleteSheet(bookWithoutAnswerSheet.getSheetByName('回答'))

check(
  '⑤ 「回答」が無いときは、シートの名前を出して止まる',
  whyItStopped(() => buildFormOn(bookWithoutAnswerSheet, rosterImage))?.includes('シート「回答」が無い'),
  true,
)

// フォームが作るシートの見出しが構成と違う形（設問の題を 1 つ変えて作らせる）。
const bookWithOddHeader = freshTemplate('odd-header')
const stoppedOnHeader = whyItStopped(() => {
  const original = context.FormApp.create
  context.FormApp.create = (title) => {
    const odd = new FakeForm(title, books)
    const add = odd.add.bind(odd)
    odd.add = (kind) => {
      const item = add(kind)
      const setTitle = item.setTitle.bind(item)
      item.setTitle = (name) => setTitle(name === '氏名' ? '名前' : name)
      return item
    }
    createdForms.push(odd)
    return odd
  }
  try {
    buildFormOn(bookWithOddHeader, rosterImage)
  } finally {
    context.FormApp.create = original
  }
})

check(
  '⑤ フォームが作った回答シートの見出しが構成と違えば、繋がずに名指しして止まる',
  [
    stoppedOnHeader?.includes('見出しが構成と違う'),
    stoppedOnHeader?.includes('名前'),
    stoppedOnHeader?.includes('黙って直さない'),
  ],
  [true, true, true],
)

check(
  '⑤ 止まったとき、テンプレートの「回答」を消していない',
  [
    bookWithOddHeader.getSheetByName('回答') !== null,
    bookWithOddHeader.getSheetByName('フォームの回答 1') !== null,
  ],
  [true, true],
)

// ---- 結果 -------------------------------------------------------------------

console.log('フォームの作り方の検査（src/build-form.js／偽のフォームと偽のスプレッドシートの上）')
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
