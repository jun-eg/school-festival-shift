#!/usr/bin/env node
// 殻の検査 — src/shell.js を、偽のスプレッドシートの上で走らせる。
//
//   使い方: node src/shell.test.mjs
//
// 見るものは 11 ある。
//   ① 値の表現が揃う（Date・真偽値・空白・空のセルが、文字列か数値になる → 6 の #8 の理由 ③）
//   ② 読んだ入力が、そのままコアの入口（checkRepresentation）を通る
//   ③ 見出しの行を読まない。横に並んだ 6 区画を、区画ごとに切って読む（→ src/README.md）
//   ④ 読み書きは範囲ごとに 1 回で、セル単位で往復しない（→ 6 の #2 の実装上の注意）
//   ⑤ 段が 1 つでも入っていなければ 1 枚も書かない（手直しが黙って消えない → 5-3）
//   ⑥ 構造が崩れていれば、1 行も読まず 1 枚も書かずに止まる（→ verify-structure.js・issue #138）
//   ⑦ マス目のセルを書き換えると、生成を走らせずに数え直し、背景に役割の色・違反した所に赤い太字が出る（→ 5 の #8・issue #155）
//   ⑧ 書き換えたセルに手直しの印（メモ）が付き、生成し直しても残る。残せないものは名指しで返る（→ 5-3・issue #156）
//   ⑨ 配る画像の中身は、いまのマス目のとおりに組まれ、1 セルも書き換えない（→ 5 の #9・issue #157）
//   ⑩ onEdit が落ちた書き換えにも、次の数え直しか生成で印が付く（→ 5-3・issue #226）
//   ⑪ 検証結果の違反の行が赤、違反でない準備・片付け以外の役割の行が黄色に、値を変えずに行ぜんぶ塗られる（→ issue #220）
//
// 崩れの名指しのしかたそのものは src/verify-structure.test.mjs が見る。ここは走らないことだけを見る。
//
// これは契約であって実装ではない。何も書き換えない。
// 本物のスプレッドシートで Date がどう返ってくるかはここでは分からない（→ src/real-device-log.md）。

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// ---- 偽のスプレッドシート ---------------------------------------------------
// 殻 が使うのは getSheetByName / getLastRow / getRange と、範囲の getValues・setValues・clearContent だけである。
// 走る前の構造の検証（→ verify-structure.js）が、これに getMaxRows / getMaxColumns / getLastColumn を足す。
// 手直しの印（→ 5-3）が、範囲の getNotes・setNotes・clearNote と、編集された範囲の位置（getRow など）を足す。
// 取りこぼした書き換えの控え（→ issue #226）が、シートの getDeveloperMetadata・addDeveloperMetadata を足す。

const roundTrips = { reads: 0, writes: 0, formats: 0, notes: 0 }

/** A1 の書き方を 1 始まりの行と列に戻す（RangeList の偽のため）。 */
function fromA1(a1) {
  const [, letters, row] = /^([A-Z]+)(\d+)$/.exec(a1)
  const column = [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0)
  return { row: Number(row), column }
}

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
  /** 書式だけを変える。往復には数えない — 値を持って行き来していないからである。 */
  setHorizontalAlignment(alignment) {
    for (let r = this.row; r < this.row + this.rowCount; r++) {
      for (let c = this.column; c < this.column + this.columnCount; c++) this.sheet.alignments.set(`${r},${c}`, alignment)
    }
    return this
  }
  /** 書式を消す（背景色・文字の色・太さ）。値の往復とは別に数える（→ ⑦。1 枚につき 4 回までである）。 */
  clearFormat() {
    roundTrips.formats += 1
    for (let r = this.row; r < this.row + this.rowCount; r++) {
      for (let c = this.column; c < this.column + this.columnCount; c++) {
        ;['backgrounds', 'fontColors', 'fontWeights'].forEach((map) => this.sheet[map].delete(`${r},${c}`))
      }
    }
    return this
  }
  /** 背景色を行列でまとめて置く。null は塗らない。 */
  setBackgrounds(colors) {
    roundTrips.formats += 1
    colors.forEach((row, i) => row.forEach((color, j) => {
      if (color === null) this.sheet.backgrounds.delete(`${this.row + i},${this.column + j}`)
      else this.sheet.backgrounds.set(`${this.row + i},${this.column + j}`, color)
    }))
    return this
  }
  getSheet() { return this.sheet }
  getRow() { return this.row }
  getColumn() { return this.column }
  getLastRow() { return this.row + this.rowCount - 1 }
  getLastColumn() { return this.column + this.columnCount - 1 }
  /** メモを読む・置く・消す。値の往復とは別に数える（→ ⑧）。 */
  getNotes() {
    roundTrips.notes += 1
    const table = []
    for (let r = this.row; r < this.row + this.rowCount; r++) {
      const row = []
      for (let c = this.column; c < this.column + this.columnCount; c++) row.push(this.sheet.notes.get(`${r},${c}`) ?? '')
      table.push(row)
    }
    return table
  }
  setNotes(table) {
    roundTrips.notes += 1
    table.forEach((row, i) => row.forEach((note, j) => {
      if (note === '') this.sheet.notes.delete(`${this.row + i},${this.column + j}`)
      else this.sheet.notes.set(`${this.row + i},${this.column + j}`, note)
    }))
    return this
  }
  clearNote() {
    roundTrips.notes += 1
    for (let r = this.row; r < this.row + this.rowCount; r++) {
      for (let c = this.column; c < this.column + this.columnCount; c++) this.sheet.notes.delete(`${r},${c}`)
    }
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
  constructor(name, minColumns = 26) {
    Object.assign(this, {
      name, cells: new Map(), notes: new Map(), alignments: new Map(), backgrounds: new Map(), fontColors: new Map(), fontWeights: new Map(), minColumns,
    })
  }
  getName() { return this.name }
  getRange(row, column, rowCount = 1, columnCount = 1) { return new FakeRange(this, row, column, rowCount, columnCount) }
  getRangeList(a1s) {
    const sheet = this
    const each = (map, value) => {
      roundTrips.formats += 1
      a1s.forEach((a1) => {
        const { row, column } = fromA1(a1)
        sheet[map].set(`${row},${column}`, value)
      })
    }
    return {
      setFontColor(color) { each('fontColors', color); return this },
      setFontWeight(weight) { each('fontWeights', weight); return this },
    }
  }
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
  // 1000 行 26 列は新しいスプレッドシートの既定の大きさである
  // （構造の検証が、読む範囲をシートの外に出さないために見る → verify-structure.js）
  getMaxRows() { return Math.max(1000, this.getLastRow()) }
  getMaxColumns() { return Math.max(this.minColumns, this.getLastColumn()) }
  put(row, column, value) { this.cells.set(`${row},${column}`, value); return this }
  /** シートに置く見えない記録。鍵と値の組で、値は文字列である。 */
  getDeveloperMetadata() {
    const sheet = this
    return (this.metadata || []).map((entry) => ({
      getKey() { return entry.key },
      getValue() { return entry.value },
      setValue(value) { entry.value = String(value); return this },
      remove() { sheet.metadata = sheet.metadata.filter((one) => one !== entry) },
    }))
  }
  addDeveloperMetadata(key, value) {
    this.metadata = (this.metadata || []).concat([{ key, value: String(value) }])
    return this
  }
}

class FakeSpreadsheet {
  constructor(sheets) { this.sheets = sheets }
  getSheetByName(name) { return this.sheets.find((s) => s.getName() === name) ?? null }
}

// ---- 読み込む ---------------------------------------------------------------

const context = vm.createContext({})
for (const name of ['sheet-layout.js', 'input-types.js', 'core.js', 'count-violations.js', 'name-unmet.js', 'fairness-metrics.js', 'take-in.js', 'expand.js', 'generate.js', 'assignment-grid.js', 'distribution-image.js', 'shell.js', 'verify-structure.js']) {
  vm.runInContext(fs.readFileSync(path.join(here, name), 'utf8'), context, { filename: name })
}
const {
  readInputs, run, normalizeValue, checkRepresentation, sheetColumns, withNamesFromAnswers,
  sheetsToRead, sectionRightEdge, recountOnEdit, a1Notation, isFixedNote, distributionImagesOn,
} = context
const { valueRepresentation, sheetLayout, checkKind, coreSteps, dayLabels, violationMark, roleColors, fixedNote } = vm.runInContext(
  '({ valueRepresentation, sheetLayout, checkKind, coreSteps, dayLabels, violationMark, roleColors, fixedNote })',
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

/** sheetLayout どおりに見出しを置いた、空の 8 枚を作る（テンプレートを組んだ直後の形である）。 */
function emptyTemplate() {
  const sheets = sheetLayout.map((layout) => {
    // マス目の 4 枚は既定の 26 列に収まらない（→ build-template.js の widenTo）
    const sheet = new FakeSheet(layout.name, Math.max(26, sectionRightEdge(layout)))
    layout.sections.forEach((section) => {
      if (layout.hasSectionHeadings) sheet.put(1, section.startColumn, section.heading)
      const columnNameRow = layout.hasSectionHeadings ? 2 : 1
      section.columns.forEach((columnName, i) => sheet.put(columnNameRow, section.startColumn + i, columnName))
    })
    return sheet
  })
  return new FakeSpreadsheet(sheets)
}

/** 条件・回答・前の周の手直しを入れた 1 冊。時刻のセルにはわざと Date を置く。 */
function filledBook() {
  const book = emptyTemplate()
  const conditions = book.getSheetByName('条件入力')

  // 日ごとの営業時刻（A〜F）— 4 日ぶん。時刻だけのセルは Date で返ってくる
  // （4 行なのは、回答の日ごとの列 4 つと上から順に 1 対 1 で当たるからである → 4-1・規則 1）
  ;[[1, 8, 10, 18, 18, 20], [2, 8, 10, 18, 18, 20], [3, 8, 10, 18, 18, 20], [4, 8, 10, 18, 18, 20]].forEach((row, i) => {
    conditions.put(3 + i, 1, new Date(2025, 10, row[0]))
    row.slice(1).forEach((hour, j) => conditions.put(3 + i, 2 + j, new Date(1899, 11, 30, hour, 0, 0)))
  })
  // 役割と必要人数（H〜L）— 1 行だけ。時間帯を空けた行はその日の調理帯に効く（→ 5-1 の #2）
  ;['', '', '', '調理', 2].forEach((value, j) => conditions.put(3, 8 + j, value))
  // 調理責任者の学年（N）— 2 行
  conditions.put(3, 14, '3年生').put(4, 14, ' 4年生 ')
  // 準備・片付けのルール（V〜W）— 1 行
  conditions.put(3, 22, '午前と午後の境目').put(3, 23, new Date(1899, 11, 30, 12, 0, 0))
  // 置き方のルール（Y〜Z）— 1 行。長さなので時刻ではない（→ 5-1 の #7）
  conditions.put(3, 25, '連続して入る最小の長さ').put(3, 26, '1:30')

  const answers = book.getSheetByName('回答')
  const answerRow = [
    // 友達欄は自由記述である（→ issue #200）。マス目の 3 列目に、書かれたとおりに出る。
    new Date(2025, 8, 23, 16, 31, 9), 'EED2349987', '高木琴音', '3年生', 'いいえ', '太郎君、同期',
    '8:00-21:00', '8:00-20:00', '8:00-22:00', '8:00-15:00',
  ]
  answerRow.forEach((value, j) => answers.put(2, 1 + j, value))

  // 前の周の割り当て。マス目の 1 セルである — 行が人、列が枠、セルが役割名（→ issue #213）。
  // 2025-11-01 の枠は 08:00 から 30 分ずつなので、4 列目が 08:00-08:30 である（3 列目は友達欄）。
  // メモが無いので、前の周に機械が置いたセルである（手直しではない → ⑧）。
  const prepDay = book.getSheetByName(dayLabels[0])
  prepDay.put(1, 4, '08:00').put(1, 5, '08:30').put(1, 6, '09:00')
  prepDay.put(2, 1, 'EED2349987').put(2, 2, '高木琴音').put(2, 4, '準備')

  // 前の周の残りかす。段が入っていれば消える、入っていなければ触らない
  book.getSheetByName('指標').put(2, 1, '古い行')
  return book
}

// ---- ① 値の表現が揃う -------------------------------------------------------

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

// ---- ②③ 読む ---------------------------------------------------------------

const inputs = readInputs(filledBook())

check(
  '② 読んだ入力が、そのままコアの入口を通る（表現の揺れが残っていない）',
  whyItStopped(() => checkRepresentation(inputs)),
  null,
)

check(
  '③ 条件入力は 2 行目までが見出しなので、3 行目から読む',
  inputs['日ごとの営業時刻'],
  [
    ['2025-11-01', '08:00', '10:00', '18:00', '18:00', '20:00'],
    ['2025-11-02', '08:00', '10:00', '18:00', '18:00', '20:00'],
    ['2025-11-03', '08:00', '10:00', '18:00', '18:00', '20:00'],
    ['2025-11-04', '08:00', '10:00', '18:00', '18:00', '20:00'],
  ],
)

check(
  '③ 区画ごとに列を切って読む（役割と必要人数は H 列から 5 列ぶん）',
  inputs['役割と必要人数'],
  [['', '', '', '調理', 2]],
)

check(
  '③ 行数の違う区画は、下の空の行が落ちる（横に並べてあるので最終行は揃っている）',
  [inputs['調理責任者の学年'], inputs['委員会の指定枠'], inputs['準備・片付けのルール']],
  [[['3年生'], ['4年生']], [], [['午前と午後の境目', '12:00']]],
)

check(
  '③ 回答は 1 行目が見出しなので、2 行目から読む',
  inputs['回答'][0].slice(0, 5),
  ['2025-09-23 16:31:09', 'EED2349987', '高木琴音', '3年生', 'いいえ'],
)

// マス目のセル 1 つが、割り当ての行 1 本に戻る。当てるのは位置ではなく見出しの時刻である。
// 氏名は空である — 表示のための列で、生成が見ると 5 の #1 が破れる（→ assignment-grid.js）。
check(
  '③ マス目の 4 枚が、まとまって「割り当て」1 つに戻る（→ issue #213）',
  inputs['割り当て'],
  [['2025-11-01', '08:00', '08:30', '準備', 'EED2349987', '']],
)

check(
  '③ メモの無いセルは手直しにならない（前の周に機械が置いたセルである → 5-3）',
  inputs['手直し'],
  [],
)

check(
  '③ 読むのは 6 枚（条件入力・回答・マス目の 4 枚）で、入力の名前は 条件入力の区画 ＋ 回答・割り当て・手直し である',
  [sheetsToRead(), Object.keys(inputs).length],
  [
    ['条件入力', '回答'].concat(dayLabels),
    sheetLayout.filter((layout) => layout.name === '条件入力')[0].sections.length + 3,
  ],
)

// ---- ④⑤ 書く ---------------------------------------------------------------

const checkResultColumns = sheetColumns('検証結果')

function checkResultRow(kind, detail) {
  const row = checkResultColumns.map(() => '')
  row[checkResultColumns.indexOf('種別')] = kind
  row[checkResultColumns.indexOf('内容')] = detail
  return row
}

// 6 段とも中身が入っている（→ core.js の builtInSteps）ので、欠けた段は差し替えで作る。
// 関数でないものを渡せば、その段は「まだ作っていない」として名指しされる（→ core.js の build）。
const withoutMetrics = { '指標を出す': null }

const skeletonBook = filledBook()
roundTrips.reads = 0
roundTrips.writes = 0
const notBuilt = run(skeletonBook, withoutMetrics).notBuilt

check(
  '⑤ 骨組みのまま走らせても、マス目の手直しが残っている（→ 5-3）',
  skeletonBook.getSheetByName(dayLabels[0]).getRange(2, 1, 1, 4).getValues()[0],
  ['EED2349987', '高木琴音', '', '準備'],
)

check(
  '⑤ 段が入っていないあいだは、生成シートに 1 度も書いていない',
  roundTrips.writes,
  0,
)

check(
  '⑤ 何が入っていないかは、issue 番号つきで返る（中身が入っている段は出ない → core.js の builtInSteps）',
  notBuilt.map((step) => `${step.name}#${step.issue}`),
  coreSteps
    .filter((step) => Object.keys(withoutMetrics).indexOf(step.name) !== -1)
    .map((step) => `${step.name}#${step.issue}`),
)

// 段が 1 つでも欠けていれば、残りが入っていても書かない（欠けた段の先は空で返るため）。
// 欠けているのは差し替えで外した 指標を出す だけで、残る 5 段は中身が入っている（→ core.js の builtInSteps）。
const partialBook = filledBook()
roundTrips.writes = 0
run(partialBook, withoutMetrics)

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
}).notBuilt
// 下の check が getValues を呼ぶので、数えた往復はここで写し取る
const fullRoundTrips = { reads: roundTrips.reads, writes: roundTrips.writes }

check('④ 全部そろえば、未了は 1 つも無い', fullNotBuilt, [])

// 2025-11-01 の枠は 08:00・08:30・09:00・09:30 ／ 10:00 … と刻まれる（→ 規則 1 の ①）。
// 10:00-10:30 は 5 つ目の枠なので、名前のある 3 列の右の 5 列目 ＝ 8 列目に落ちる。
check(
  '④ 割り当てがマス目で書かれている（見出しは時刻、セルは役割名 1 つ → issue #213）',
  [
    fullBook.getSheetByName(dayLabels[0]).getRange(1, 1, 1, 8).getValues()[0],
    fullBook.getSheetByName(dayLabels[0]).getRange(2, 1, 1, 8).getValues()[0],
  ],
  [
    ['学籍番号', '氏名', '一緒に組みたいお友達', '08:00', '08:30', '09:00', '09:30', '10:00'],
    ['EED2349987', '高木琴音', '太郎君、同期', '', '', '', '', '調理'],
  ],
)

check(
  '④ 友達欄は回答から引いて、書かれたとおりにマス目の 3 列目に出る（生成は読まない → 5-2 ／ issue #200）',
  [
    vm.runInContext('typeof friendsFromAnswers', context),
    fullBook.getSheetByName(dayLabels[0]).getRange(2, 3, 1, 1).getValues()[0][0],
  ],
  ['function', '太郎君、同期'],
)

check(
  '④ 氏名は回答から引く（生成は氏名を空で置いている → 5 の #1・assignment-grid.js）',
  [
    vm.runInContext('typeof namesFromAnswers', context),
    fullBook.getSheetByName(dayLabels[0]).getRange(2, 2, 1, 1).getValues()[0][0],
  ],
  ['function', '高木琴音'],
)

// 差し替えずに 6 段の中身で回す。指標の段は氏名を空で返す（→ fairness-metrics.js）ので、埋まっていれば殻が引いている。
const builtInBook = filledBook()
check(
  '④ 段を差し替えずに回すと、指標が 1 人 1 行で書かれ、氏名は回答から引いてある（→ issue #154）',
  [run(builtInBook, {}).notBuilt, builtInBook.getSheetByName('指標').getRange(2, 1, 1, 2).getValues()[0]],
  [[], ['EED2349987', '高木琴音']],
)

check(
  '④ 氏名を引くのは空の欄だけで、コアの出力を書き換えない',
  (() => {
    const rows = [['EED2349987', '', 1, 1, 0], ['EED0000000', '手で書いた名前', 1, 1, 0]]
    const filled = withNamesFromAnswers(rows, '指標', () => '回答の名前')
    return [filled.map((row) => row[1]), rows[0][1]]
  })(),
  [['回答の名前', '手で書いた名前'], ''],
)

check(
  '④ 検証結果の氏名も回答から引く。学籍番号の無い行（未充足）は空のまま（→ issue #229）',
  (() => {
    const violation = checkResultRow(checkKind.violation, '規則 1: 希望の時間の外に置いている')
    violation[checkResultColumns.indexOf('学籍番号')] = 'EED2349987'
    const unmet = checkResultRow(checkKind.unmet, 'あと 1 人')
    const nameAt = checkResultColumns.indexOf('氏名')
    return withNamesFromAnswers([violation, unmet], '検証結果', (studentId) => (studentId === 'EED2349987' ? '高木琴音' : ''))
      .map((row) => row[nameAt])
  })(),
  ['高木琴音', ''],
)

check(
  '④ 割り当ての無い日も、見出しだけは書き直される（前の周の列が残らない）',
  [
    fullBook.getSheetByName(dayLabels[1]).getRange(1, 1, 1, 5).getValues()[0],
    fullBook.getSheetByName(dayLabels[1]).getLastRow(),
  ],
  [['学籍番号', '氏名', '一緒に組みたいお友達', '08:00', '08:30'], 1],
)

check(
  '④ 時刻の見出しが左に寄っている（時刻のセルは既定で右寄せになる → issue #213）',
  [
    fullBook.getSheetByName(dayLabels[0]).alignments.get('1,4'),
    fullBook.getSheetByName(dayLabels[0]).alignments.get('1,8'),
    fullBook.getSheetByName(dayLabels[0]).alignments.get('1,3'),
  ],
  ['left', 'left', undefined],
)

check(
  '④ 検証結果と指標は、見出しの次の行から書かれている',
  [
    fullBook.getSheetByName('検証結果').getRange(2, 1, 2, 9).getValues().map((row) => row[0]),
    fullBook.getSheetByName('指標').getRange(2, 1, 1, 5).getValues()[0],
  ],
  [
    [checkKind.violation, checkKind.unmet],
    ['EED2349987', '高木琴音', 0.5, 1, 0],
  ],
)

check(
  '④ 前の周の残りかすが消えている（指標の「古い行」が残っていない）',
  fullBook.getSheetByName('指標').getRange(3, 1, 1, 1).getValues()[0],
  [''],
)

// 読むのは、走る前の構造の検証がシートごとに 1 回（8 枚）＋ 入力が区画ごとに 1 回である。
// マス目は見出しの行とデータの行を分けて読むので、中身のある日だけ 2 回になる
// （filledBook で中身があるのは 準備日 の 1 枚だけ → 条件入力の区画 ＋ 回答 1 ＋ マス目 5）。
// 区画の数をここに書かない — 区画が 1 つ増えれば読む回数も 1 つ増える（→ sheetLayout）。
// 書くのは、シート 1 枚につき「消す」と「置く」である。マス目は見出しとデータで 2 組ある。
const gridCount = dayLabels.length
check(
  '④ 読み書きはどちらも範囲ごとに 1 回で、セル単位で往復していない（→ 6 の #2）',
  [
    fullRoundTrips.reads,
    fullRoundTrips.writes <= gridCount * 4 + (vm.runInContext('outputNames.length', context) - 1) * 2,
  ],
  [sheetLayout.length + sheetLayout[0].sections.length + 1 + (gridCount + 1), true],
)

// ---- ⑦ 手直しの後に数え直す -------------------------------------------------
// 担当者が 片付け（2025-11-04）の 16:00 の枠に 準備 を書いた。この人の 11-04 の希望は 8:00-15:00 なので、
// 規則 1（希望の時間の外）の違反になる — 生成は作らないが、手直しは作りうる（→ 5 の #13 の ①）。
// 見出しは 1 列目の時刻から始まっていなくてよい。当てるのは位置ではなく見出しの時刻である（→ issue #213）。

/** マス目 4 枚の、見出しとデータの中身だけを写し取る（色は別に見る）。 */
function gridSnapshot(book) {
  return dayLabels.map((label) => [...book.getSheetByName(label).cells.entries()].sort())
}

/** 全シートの中身を写し取る（書き換わっていないことを見るため）。 */
function bookSnapshot(book) {
  return JSON.stringify(book.sheets.map((sheet) => [sheet.name, [...sheet.cells.entries()].sort()]))
}

function editedBook() {
  const book = filledBook()
  const cleanupDay = book.getSheetByName(dayLabels[3])
  cleanupDay.put(1, 4, new Date(1899, 11, 30, 16, 0, 0))
  cleanupDay.put(2, 1, 'EED2349987').put(2, 2, '高木琴音').put(2, 4, '準備')
  // 前の周の印が残っている（数え直した後は消えていなければならない）
  book.getSheetByName(dayLabels[0]).fontColors.set('2,4', violationMark.fontColor)
  book.getSheetByName(dayLabels[0]).fontWeights.set('2,4', violationMark.fontWeight)
  return book
}

const recountBook = editedBook()
const gridsBeforeRecount = JSON.stringify(gridSnapshot(recountBook))
roundTrips.reads = 0
roundTrips.writes = 0
roundTrips.formats = 0
const said = recountOnEdit({ source: recountBook, range: recountBook.getSheetByName(dayLabels[3]).getRange(2, 4) })
const recountRoundTrips = { ...roundTrips }

check(
  '⑦ マス目を 1 セル書き換えると、規則 1 の違反が検証結果に出る（人が数えない → 5 の #8・#13 の ①）',
  recountBook.getSheetByName('検証結果').getRange(2, 1, 200, 9).getValues().filter((row) => row[0] === checkKind.violation),
  [
    [checkKind.violation, '2025-11-04', '16:00', '16:30', '準備', 'EED2349987', '高木琴音', '規則 1: 希望の時間の外に置いている', ''],
  ],
)

const grayOf = roleColors.filter((one) => one.roles.indexOf('準備') !== -1)[0].color

check(
  '⑦ 違反した所が、赤い太字で出る（片付け の 2 行目 4 列目 → 6 の #2）',
  [
    [...recountBook.getSheetByName(dayLabels[3]).fontColors.entries()],
    [...recountBook.getSheetByName(dayLabels[3]).fontWeights.entries()],
  ],
  [[['2,4', violationMark.fontColor]], [['2,4', violationMark.fontWeight]]],
)

check(
  '⑦ 背景は役割の色である（準備 はグレー。違反したセルも背景は役割の色のまま → issue #213 の「色」）',
  [
    [...recountBook.getSheetByName(dayLabels[3]).backgrounds.entries()],
    [...recountBook.getSheetByName(dayLabels[0]).backgrounds.entries()],
  ],
  [[['2,4', grayOf]], [['2,4', grayOf]]],
)

check(
  '⑦ 前の周の印は消えている（違反でなくなったセルに赤い太字が残らない）',
  [recountBook.getSheetByName(dayLabels[0]).fontColors.size, recountBook.getSheetByName(dayLabels[0]).fontWeights.size],
  [0, 0],
)

// 準備 が 11-01 と 11-04 に 1 枠ずつ → 合計 1 時間 ／ 塊 2 つ ／ 準備に入った日 2 日（→ 5-6）
check(
  '⑦ 指標も数え直され、書き換えた 1 枠が合計時間に入っている',
  recountBook.getSheetByName('指標').getRange(2, 1, 1, 5).getValues()[0],
  ['EED2349987', '高木琴音', 1, 2, 2],
)

check(
  '⑦ 生成を走らせない — マス目は 1 セルも書き換わっていない（担当者のセルそのものを数える）',
  JSON.stringify(gridSnapshot(recountBook)),
  gridsBeforeRecount,
)

check(
  '⑦ 担当者に見せる一言に、違反の件数と色の在処が入っている',
  [said.text.includes('違反 1 件'), said.text.includes('マス目の色'), said.seconds],
  [true, true, 5],
)

// 読むのは run と同じ（構造の検証 8 ＋ 区画 ＋ 回答 1 ＋ マス目）。マス目は中身のある 2 枚だけが 2 回になる。
// 書くのは検証結果と指標の「消す」「置く」だけで、マス目には 1 度も値を書かない
// （検証結果は前の行が無いので「消す」が起きない → 置く 1 ＋ 指標の消す・置く 2 ＝ 3）。
// 書式は 1 枚につき「消す」1 回、行がある枚だけ「背景を置く」1 回、違反がある枚だけ「文字の色」「太さ」の 2 回である
// （行があるのは 準備日 と 片付け の 2 枚、違反があるのは 片付け の 1 枚 → 4 ＋ 2 ＋ 2）。
// ほかに、検証結果の行の背景を 1 回で置き直す（→ ⑪ ／ issue #220）。
check(
  '⑦ 数え直しの読み書きも範囲ごとに 1 回で、マス目に値を書かず、書式は 1 枚につき 4 回までである',
  [recountRoundTrips.reads, recountRoundTrips.writes, recountRoundTrips.formats],
  [sheetLayout.length + sheetLayout[0].sections.length + 1 + (gridCount + 2), 3, gridCount + 2 + 2 + 1],
)

const conditionEditBook = editedBook()
const conditionEditBefore = bookSnapshot(conditionEditBook)
check(
  '⑦ 条件入力の書き換えでは数え直さない（書きかけの途中で名指しを出さない）',
  [
    recountOnEdit({ source: conditionEditBook, range: conditionEditBook.getSheetByName('条件入力').getRange(3, 8) }),
    bookSnapshot(conditionEditBook),
  ],
  [null, conditionEditBefore],
)

// 見出しの無い列に役割を書いた。どの枠かが決まらないので数えられない（→ assignment-grid.js の fromAssignmentGrid）。
// 単純トリガーの例外は担当者の画面に出ないので、止まった理由を一言にして返す。
const strayBook = editedBook()
strayBook.getSheetByName(dayLabels[3]).put(2, 11, '調理')
const strayBefore = bookSnapshot(strayBook)
const straySaid = recountOnEdit({ source: strayBook, range: strayBook.getSheetByName(dayLabels[3]).getRange(2, 11) })
check(
  '⑦ 載らない書き換えは、止まった理由を名指しの一言で返し、検証結果も指標も書き換えない',
  [
    straySaid.text.startsWith('数え直せなかった'),
    straySaid.text.includes('シート「片付け」の 2 行目 11 列目に「調理」'),
    bookSnapshot(strayBook) === strayBefore,
  ],
  [true, true, true],
)

check(
  '⑦ 生成を押しても塗り直す — 前の周の赤い太字は消え、背景は書いたマス目の役割の色になる（生成は違反を作らない → 5 の #6）',
  (() => {
    const book = editedBook()
    run(book, {})
    return dayLabels.map((label) => {
      const sheet = book.getSheetByName(label)
      const filled = [...sheet.cells.entries()].filter(([key, value]) => Number(key.split(',')[0]) > 1 && Number(key.split(',')[1]) > 3 && value !== '')
      return [sheet.fontColors.size, filled.every(([key]) => sheet.backgrounds.has(key)), sheet.backgrounds.size === filled.length]
    })
  })(),
  dayLabels.map(() => [0, true, true]),
)

check(
  '⑦ RangeList に渡す A1 の書き方（マス目は 51 列目＝AY 列まである）',
  [a1Notation(1, 1), a1Notation(3, 26), a1Notation(2, 27), a1Notation(2, 51)],
  ['A1', 'Z3', 'AA2', 'AY2'],
)

// ---- ⑧ 手直しの印（→ 5-3 ／ issue #156） -----------------------------------
// 担当者が書き換えたセルにだけメモが付き、生成はそのセルを固定として先に置く。
// 前の周に機械が置いたセル（メモが無い）は、生成し直せば組み直される。

/** onEdit と同じ形で、1 セルを書き換える（値を置いてから、その範囲でイベントを起こす）。 */
function edit(book, label, row, column, value) {
  const sheet = book.getSheetByName(label)
  sheet.put(row, column, value)
  return recountOnEdit({ source: book, range: sheet.getRange(row, column) })
}

/** そのシートのメモを [キー, メモ] で並べる。 */
function notesOf(book, label) {
  return [...book.getSheetByName(label).notes.entries()].sort()
}

const markBook = filledBook()
edit(markBook, dayLabels[0], 2, 6, '準備') // 11-01 09:00 に 準備（08:00 の 準備 は前の周の機械のセル）

check(
  '⑧ 書き換えたセルに手直しの印（メモ）が付く。見出しの行と名前のある 3 列には付かない',
  [notesOf(markBook, dayLabels[0]), isFixedNote(fixedNote), isFixedNote('担当者が自分で書いたメモ')],
  [[['2,6', fixedNote]], true, false],
)

check(
  '⑧ 印の付いたセルだけが、入力の「手直し」になる（日・見出しの時刻・役割・学籍番号）',
  readInputs(markBook)['手直し'],
  [['2025-11-01', '09:00', '準備', 'EED2349987']],
)

run(markBook, {})
check(
  '⑧ 生成し直すと、印の付いたセルは残り、印の無い前の周のセルは組み直される（この人は調理の枠に置けないので消える）',
  [
    markBook.getSheetByName(dayLabels[0]).getRange(2, 1, 1, 6).getValues()[0],
    notesOf(markBook, dayLabels[0]),
  ],
  [['EED2349987', '高木琴音', '太郎君、同期', '', '', '準備'], [['2,6', fixedNote]]],
)

run(markBook, {})
check(
  '⑧ もう一度生成し直しても残る（書き戻すときに印も付け直すので、次の周でも固定である）',
  [markBook.getSheetByName(dayLabels[0]).getRange(2, 6, 1, 1).getValues()[0][0], notesOf(markBook, dayLabels[0])],
  ['準備', [['2,6', fixedNote]]],
)

// 11-02 10:00 に 調理 と書いた。この人は 調理担当ですか？ が いいえ なので、置けば規則 5 の違反である。
// 11-03 は、営業時刻を動かす前の列（07:00）に 会計 が書いてあり、印も付いている。
const conflictBook = filledBook()
edit(conflictBook, dayLabels[1], 1, 4, '10:00')
edit(conflictBook, dayLabels[1], 2, 1, 'EED2349987')
edit(conflictBook, dayLabels[1], 2, 4, '調理')
const staleDay = conflictBook.getSheetByName(dayLabels[2])
staleDay.put(1, 4, '07:00').put(2, 1, 'EED2349987').put(2, 4, '会計')
staleDay.notes.set('2,4', fixedNote)

const conflictOutput = run(conflictBook, {})
const kindAt = checkResultColumns.indexOf('種別')

check(
  '⑧ 条件を破る手直しは置かれず、食い違った固定として検証結果の先頭に名指しで出る（違反は 0 件のまま）',
  [
    conflictBook.getSheetByName('検証結果').getRange(2, 1, 2, 9).getValues().map((row) => [row[0], row[1], row[2], row[4], row[6], row[7]]),
    conflictOutput['検証結果'].filter((row) => row[kindAt] === checkKind.violation).length,
  ],
  [
    [
      [checkKind.fixConflict, '2025-11-02', '10:00', '調理', '高木琴音', '規則 5: 調理の枠（調理）だが、調理担当ですか？ が いいえ である'],
      [checkKind.fixConflict, '2025-11-03', '07:00', '会計', '高木琴音', 'いまの 2025-11-03 の枠に「07:00」が無い（条件入力の「日ごとの営業時刻」が動いた）'],
    ],
    0,
  ],
)

check(
  '⑧ 営業時刻を動かした後の前の周の列があっても、生成は止まらない（前の周の列は書き直される）',
  conflictBook.getSheetByName(dayLabels[2]).getRange(1, 1, 1, 4).getValues()[0],
  ['学籍番号', '氏名', '一緒に組みたいお友達', '08:00'],
)

check(
  '⑧ 残せなかった手直しは、そのセルのメモに理由が出る。1 枠も置いていない人にも行が残る。'
    + 'いまの枠に無いものは学籍番号のセルに出る（見出しは 08:00 から敷き直されるので、10:00 は 8 列目である）',
  [
    conflictBook.getSheetByName(dayLabels[1]).getRange(2, 1, 1, 4).getValues()[0],
    notesOf(conflictBook, dayLabels[1]).map(([key, note]) => [key, note.startsWith('残せなかった手直し「調理」— 規則 5')]),
    notesOf(conflictBook, dayLabels[2]).map(([key, note]) => [key, note.startsWith('残せなかった手直し「会計」— いまの 2025-11-03 の枠')]),
  ],
  [['EED2349987', '高木琴音', '太郎君、同期', ''], [['2,8', true]], [['2,1', true]]],
)

check(
  '⑧ 残せなかった手直しのメモは印にならない（次の生成で同じ食い違いを名指しし直さない）',
  [readInputs(conflictBook)['手直し'], run(conflictBook, {})['検証結果'].filter((row) => row[kindAt] === checkKind.fixConflict)],
  [[], []],
)

// 会計 を 11-01 の調理帯に 1 人立てた。この人は 11-01 の 8:00-21:00 を希望しているので、生成は 10:00 から置く。
// 10:00 のセルを空にした（＝ この人をここに置かない）。空のセルにも印が付き、生成はそこへ置かない。
const removalBook = filledBook()
removalBook.getSheetByName('条件入力').put(3, 11, '会計').put(3, 12, 1)
run(removalBook, {})
const before10 = removalBook.getSheetByName(dayLabels[0]).getRange(2, 8, 1, 2).getValues()[0]
edit(removalBook, dayLabels[0], 2, 8, '')
run(removalBook, {})

check(
  '⑧ 空にしたセルも手直しである — 生成し直しても、その人はその枠に戻らない（印は空のセルに残る）',
  [
    before10,
    removalBook.getSheetByName(dayLabels[0]).getRange(2, 8, 1, 2).getValues()[0],
    notesOf(removalBook, dayLabels[0]).filter(([key]) => key === '2,8').map(([, note]) => note),
  ],
  [['会計', '会計'], ['', '会計'], [fixedNote]],
)

// 学籍番号を書き換えた行は、行の持ち主を替えたことになる。役割の入っているセルぜんぶに印が付く。
const ownerBook = filledBook()
edit(ownerBook, dayLabels[0], 2, 1, 'EED2349987')
check(
  '⑧ 学籍番号を書き換えた行は、役割の入っているセルぜんぶに印が付く（空のセルと名前の列には付かない）',
  notesOf(ownerBook, dayLabels[0]),
  [['2,4', fixedNote]],
)

// ---- ⑩ 取りこぼした書き換え（→ 5-3 ／ issue #226） ---------------------------
// 本物で間を置かずに 2 セル書き換えると、onEdit が 1 回しか走らない（→ real-device-log.md）。
// 2 手目は値だけを置き、イベントを起こさない。次に数え直すか生成するときに、控えと違うセルとして印が付くか。

/** 値だけを置く（onEdit が落ちた 2 手目）。 */
function editWithoutEvent(book, label, row, column, value) {
  book.getSheetByName(label).put(row, column, value)
}

/** 会計 を 11-01 の調理帯に 1 人立て、生成しておく（10:00・10:30 に 会計 が入る → ⑧ の removalBook と同じ）。 */
function generatedBook() {
  const book = filledBook()
  book.getSheetByName('条件入力').put(3, 11, '会計').put(3, 12, 1)
  run(book, {})
  return book
}

const seenBook = generatedBook()
check(
  '⑩ 生成すると、マス目 4 枚それぞれに控えが 1 つ置かれる（学籍番号 × 見出しの時刻 → 役割）',
  dayLabels.map((label) => {
    const kept = seenBook.getSheetByName(label).getDeveloperMetadata().filter((one) => one.getKey() === 'seenGrid')
    return kept.length === 1 && JSON.parse(kept[0].getValue()).rows !== undefined
  }),
  [true, true, true, true],
)

const burstBook = generatedBook()
editWithoutEvent(burstBook, dayLabels[0], 2, 9, '') // 2 手目 — 10:30 の 会計 を空に。onEdit が落ちた
const burstSaid = edit(burstBook, dayLabels[0], 2, 8, '') // 1 手目 — 10:00 の 会計 を空に。onEdit はこれ 1 回だけ
check(
  '⑩ onEdit が 1 回しか走らなくても、続けて書き換えた 2 セルとも印が付く',
  [notesOf(burstBook, dayLabels[0]), burstSaid.text.startsWith('数え直した')],
  [[['2,8', fixedNote], ['2,9', fixedNote]], true],
)

run(burstBook, {})
check(
  '⑩ そのあと生成し直しても、2 手目は戻らない（空のまま、印も残る）',
  [burstBook.getSheetByName(dayLabels[0]).getRange(2, 8, 1, 2).getValues()[0], notesOf(burstBook, dayLabels[0])],
  [['', ''], [['2,8', fixedNote], ['2,9', fixedNote]]],
)

const lastDroppedBook = generatedBook()
edit(lastDroppedBook, dayLabels[0], 2, 8, '')
editWithoutEvent(lastDroppedBook, dayLabels[0], 2, 9, '') // 数え直しが終わった後に書き換えた。onEdit が落ちた
check(
  '⑩ 最後の 1 手の onEdit が落ちても、次の「生成」がその書き換えを手直しとして読み、戻さない',
  [
    readInputs(lastDroppedBook)['手直し'].length,
    run(lastDroppedBook, {}) && lastDroppedBook.getSheetByName(dayLabels[0]).getRange(2, 8, 1, 2).getValues()[0],
    notesOf(lastDroppedBook, dayLabels[0]),
  ],
  [1, ['', ''], [['2,8', fixedNote], ['2,9', fixedNote]]],
)

const ownerBurstBook = generatedBook()
editWithoutEvent(ownerBurstBook, dayLabels[0], 2, 1, 'ZZZ9999999')
edit(ownerBurstBook, dayLabels[1], 1, 1, '学籍番号') // 別のシートの見出し — 数え直しは走るが印は付かない
check(
  '⑩ 学籍番号を書き換えた行の onEdit が落ちても、役割の入っているセルぜんぶに印が付く（控えに無い学籍番号の行）',
  (() => {
    const row = ownerBurstBook.getSheetByName(dayLabels[0]).getRange(2, 1, 1, 51).getValues()[0]
    const filled = row.map((value, index) => [`2,${index + 1}`, value]).filter(([key, value]) => Number(key.split(',')[1]) > 3 && value !== '')
    return [filled.length > 3, JSON.stringify(notesOf(ownerBurstBook, dayLabels[0])) === JSON.stringify(filled.map(([key]) => [key, fixedNote]).sort())]
  })(),
  [true, true],
)

const noSeenBook = filledBook()
editWithoutEvent(noSeenBook, dayLabels[0], 2, 5, '準備')
run(noSeenBook, {})
check(
  '⑩ 控えが無ければ（テンプレートのまま・消された）、今までどおりに動く — 黙って全部を手直しにしない',
  [notesOf(noSeenBook, dayLabels[0]), noSeenBook.getSheetByName(dayLabels[0]).getRange(2, 5, 1, 1).getValues()[0][0]],
  [[], ''],
)

const machineBook = generatedBook()
run(machineBook, {})
check(
  '⑩ 生成し直しただけでは印は付かない（スクリプトの書き戻しは控えを置き直すので、差にならない）',
  notesOf(machineBook, dayLabels[0]),
  [],
)

const imageSeenBook = generatedBook()
editWithoutEvent(imageSeenBook, dayLabels[0], 2, 8, '')
const imageSeenBefore = JSON.stringify(imageSeenBook.getSheetByName(dayLabels[0]).metadata)
distributionImagesOn(imageSeenBook)
check(
  '⑩ 画像の書き出しは取りこぼしを拾わない（1 セルも書き換えない。控えも置き直さない）',
  [notesOf(imageSeenBook, dayLabels[0]), JSON.stringify(imageSeenBook.getSheetByName(dayLabels[0]).metadata) === imageSeenBefore],
  [[], true],
)

const brokenSeenBook = generatedBook()
brokenSeenBook.getSheetByName(dayLabels[0]).metadata[0].value = '{壊れた'
editWithoutEvent(brokenSeenBook, dayLabels[0], 2, 9, '')
check(
  '⑩ 控えが読めなくても止まらない（取りこぼしを拾わないだけで、数え直しは走り、控えは置き直される）',
  [
    edit(brokenSeenBook, dayLabels[0], 2, 8, '').text.startsWith('数え直した'),
    notesOf(brokenSeenBook, dayLabels[0]),
    JSON.parse(brokenSeenBook.getSheetByName(dayLabels[0]).metadata[0].value).rows !== undefined,
  ],
  [true, [['2,8', fixedNote]], true],
)

// ---- ⑪ 検証結果の赤と黄色（→ issue #220） -----------------------------------
// 違反の行は、役割に関係なく行ぜんぶ赤にする。違反でない行は、店の役割（準備・片付け以外）の行だけを行ぜんぶ黄色にする。
// 値は 1 セルも変えない（→ assignment-grid.js の checkResultBackgrounds）。

function checkRow(kind, role, detail) {
  const row = checkResultRow(kind, detail)
  row[checkResultColumns.indexOf('役割')] = role
  return row
}

/** 検証結果の行を差し替えて 1 周する。ほかの段は ④ と同じ差し替えである。 */
function runWithChecks(book, violations, unmet) {
  return run(book, {
    '取り込む': (answers) => answers.map((row) => [row[1], row[3], row[4]]),
    '展開する': (wishes) => wishes.map((row) => [row[0]]),
    '生成する': (candidates) => candidates.map((row) => ['2025-11-01', '10:00', '10:30', '調理', row[0], '高木琴音']),
    '違反を数える': () => violations,
    '未充足を名指しする': () => unmet,
    '指標を出す': (assignments) => assignments.map((row) => [row[4], row[5], 0.5, 1, 0]),
  })
}

/** 検証結果の、塗った行の番号（1 始まり）と、その行で塗ったセルの数と色。 */
function paintedRows(book) {
  const byRow = {}
  ;[...book.getSheetByName('検証結果').backgrounds.entries()].forEach(([key, color]) => {
    const row = Number(key.split(',')[0])
    byRow[row] = byRow[row] || []
    byRow[row].push(color)
  })
  return Object.keys(byRow).map((row) => [Number(row), byRow[row].length, [...new Set(byRow[row])]])
}

const { violation: { color: redOf }, storeRole: { color: yellowOf } } = vm.runInContext('checkRowHighlights', context)
const mixedViolations = [
  checkRow(checkKind.violation, '調理', '規則 5: 検便を通っていない'),
  checkRow(checkKind.violation, '', '規則 3: 午前だけなのに準備に入っていない'),
  checkRow(checkKind.violation, '準備', '規則 1: 希望の時間の外に置いている'),
]
const mixedUnmet = [
  checkRow(checkKind.unmet, '準備', 'あと 3 人'),
  checkRow(checkKind.unmet, '会計', 'あと 1 人'),
  checkRow(checkKind.unmet, '片付け', 'あと 2 人'),
]
const paintedBook = filledBook()
runWithChecks(paintedBook, mixedViolations, mixedUnmet)
const checkWidth = checkResultColumns.length

check(
  '⑪ 違反の行は役割に関係なく行ぜんぶ（9 列）赤、違反でない店の役割の行は行ぜんぶ黄色、ほかは塗らない（→ issue #220）',
  paintedRows(paintedBook),
  [[2, checkWidth, [redOf]], [3, checkWidth, [redOf]], [4, checkWidth, [redOf]], [6, checkWidth, [yellowOf]]],
)

check(
  '⑪ 値は書いた行のとおりで、色を足しても 1 セルも変わらない',
  paintedBook.getSheetByName('検証結果').getRange(2, 1, 7, checkWidth).getValues(),
  mixedViolations.concat(mixedUnmet).concat([checkResultColumns.map(() => '')]),
)

// 生成し直して、違反も店の役割の行も無くなった。前の周の赤も黄色も残ってはいけない。
runWithChecks(paintedBook, [], [checkRow(checkKind.unmet, '準備', 'あと 3 人')])
check('⑪ 生成し直して違反も店の役割の行も無くなれば、前の周の赤も黄色も残らない', paintedRows(paintedBook), [])

// 手直しの後の数え直しでも塗る。⑦ と同じ書き換え（片付けの日に準備）は規則 1 の違反を 1 行出す。
// 役割と必要人数に 会計 を 1 行足して、会計の未充足も出させる。
const recountPaintedBook = editedBook()
recountPaintedBook.getSheetByName('条件入力').put(4, 11, '会計').put(4, 12, 1)
recountOnEdit({ source: recountPaintedBook, range: recountPaintedBook.getSheetByName(dayLabels[3]).getRange(2, 3) })
const recountChecks = recountPaintedBook.getSheetByName('検証結果').getRange(2, 1, 200, checkWidth).getValues()
  .filter((row) => row[0] !== '')
const kindColumnIndex = checkResultColumns.indexOf('種別')
const roleColumnIndex = checkResultColumns.indexOf('役割')
check(
  '⑪ 数え直しでも塗り直す — 違反の行は赤、違反でない店の役割の行は黄色、ほかは塗らない',
  [
    recountChecks.some((row) => row[kindColumnIndex] === checkKind.violation),
    recountChecks.some((row) => row[kindColumnIndex] !== checkKind.violation && row[roleColumnIndex] === '会計'),
    paintedRows(recountPaintedBook).map(([row, , colors]) => [row, colors]),
  ],
  [
    true,
    true,
    recountChecks
      .map((row, i) => {
        if (row[kindColumnIndex] === checkKind.violation) return [i + 2, [redOf]]
        return ['準備', '片付け', ''].indexOf(row[roleColumnIndex]) === -1 ? [i + 2, [yellowOf]] : null
      })
      .filter((row) => row !== null),
  ],
)

// ---- ⑨ 配る画像の中身（→ 5 の #9 ／ issue #157） -----------------------------
// 描くのは、いまシートに見えているとおりである。生成も数え直しも走らせず、何も書かない。

const imageBook = filledBook()
const everyNote = (book) => JSON.stringify(book.sheets.map((sheet) => notesOf(book, sheet.name)))
const imageBookBefore = bookSnapshot(imageBook)
const imageNotesBefore = everyNote(imageBook)
roundTrips.writes = 0
roundTrips.formats = 0
const exported = distributionImagesOn(imageBook)

check(
  '⑨ マス目の 1 セルが、そのまま配る画像の 1 セルになる（名前は氏名だけで、学籍番号は載らない）',
  exported.map((image) => [image.label, image.fileName, image.times, image.rows]),
  [
    ['準備日', '11月1日シフト表.png', ['08:00', '08:30', '09:00'], [{ name: '高木琴音', cells: [{ role: '準備', color: grayOf }, { role: '', color: null }, { role: '', color: null }] }]],
    ['学祭1日目', '11月2日シフト表.png', [], []],
    ['学祭2日目', '11月3日シフト表.png', [], []],
    ['片付け', '11月4日シフト表.png', [], []],
  ],
)
check('⑨ 描かない日は図形を持たない（塗る側が「描いていない」と言う）', exported.map((image) => image.drawing === null), [false, true, true, true])
check('⑨ 1 セルも書き換えない（値も書式もメモも）', [bookSnapshot(imageBook) === imageBookBefore, everyNote(imageBook) === imageNotesBefore, roundTrips.writes, roundTrips.formats], [true, true, 0, 0])

const brokenImageBook = filledBook()
brokenImageBook.getSheetByName('検証結果').put(1, 1, '区分')
check(
  '⑨ 構造が崩れていれば、描かずに名指しで止まる（生成と同じ検証を先に通す）',
  whyItStopped(() => distributionImagesOn(brokenImageBook))?.includes('「検証結果」の 1 行目 1 列目'),
  true,
)

// ---- シートが無いとき -------------------------------------------------------

const bookMissingASheet = emptyTemplate()
bookMissingASheet.sheets = bookMissingASheet.sheets.filter((s) => s.getName() !== '回答')

check(
  'シートが 1 枚でも無ければ、名指しして止まる（黙って作らない）',
  whyItStopped(() => readInputs(bookMissingASheet))?.includes('シート「回答」が無い'),
  true,
)

// ---- ⑥ 構造が崩れているとき -------------------------------------------------
// run は、読む前に checkStructure を呼ぶ（→ verify-structure.js）。
// 崩れたまま走ると、担当者の手直し（→ 5-3）が黙って消えるか、列がずれたまま書かれる。

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

// ---- 結果 ------------------------------------------------------------------

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
