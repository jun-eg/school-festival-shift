#!/usr/bin/env node
// 殻の検査 — src/shell.js を、偽のスプレッドシートの上で走らせる。
//
//   使い方: node src/shell.test.mjs
//
// 見るものは 7 つある。
//   ① 値の表現が揃う（Date・真偽値・空白・空のセルが、文字列か数値になる → 6 の #8 の理由 ③）
//   ② 読んだ入力が、そのままコアの入口（checkRepresentation）を通る
//   ③ 見出しの行を読まない。横に並んだ 6 区画を、区画ごとに切って読む（→ src/README.md）
//   ④ 読み書きは範囲ごとに 1 回で、セル単位で往復しない（→ 6 の #2 の実装上の注意）
//   ⑤ 段が 1 つでも入っていなければ 1 枚も書かない（手直しが黙って消えない → 5-3）
//   ⑥ 構造が崩れていれば、1 行も読まず 1 枚も書かずに止まる（→ verify-structure.js・issue #138）
//   ⑦ マス目のセルを書き換えると、生成を走らせずに数え直し、背景に役割の色・違反した所に赤い太字が出る（→ 5 の #8・issue #155）
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

const roundTrips = { reads: 0, writes: 0, formats: 0 }

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
      name, cells: new Map(), alignments: new Map(), backgrounds: new Map(), fontColors: new Map(), fontWeights: new Map(), minColumns,
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
}

class FakeSpreadsheet {
  constructor(sheets) { this.sheets = sheets }
  getSheetByName(name) { return this.sheets.find((s) => s.getName() === name) ?? null }
}

// ---- 読み込む ---------------------------------------------------------------

const context = vm.createContext({})
for (const name of ['sheet-layout.js', 'input-types.js', 'core.js', 'count-violations.js', 'name-unmet.js', 'fairness-metrics.js', 'take-in.js', 'expand.js', 'generate.js', 'assignment-grid.js', 'shell.js', 'verify-structure.js']) {
  vm.runInContext(fs.readFileSync(path.join(here, name), 'utf8'), context, { filename: name })
}
const {
  readInputs, run, normalizeValue, checkRepresentation, sheetColumns, withNamesFromAnswers,
  sheetsToRead, sectionRightEdge, recountOnEdit, a1Notation,
} = context
const { valueRepresentation, sheetLayout, checkKind, coreSteps, dayLabels, violationMark, roleColors } = vm.runInContext(
  '({ valueRepresentation, sheetLayout, checkKind, coreSteps, dayLabels, violationMark, roleColors })',
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
    new Date(2025, 8, 23, 16, 31, 9), 'EED2349987', '高木琴音', '3年生', 'いいえ', '',
    '8:00-21:00', '8:00-20:00', '8:00-22:00', '8:00-15:00',
  ]
  answerRow.forEach((value, j) => answers.put(2, 1 + j, value))

  // 前の周の手直し（→ 5-3）。マス目の 1 セルである — 行が人、列が枠、セルが役割名（→ issue #213）。
  // 2025-11-01 の枠は 08:00 から 30 分ずつなので、3 列目が 08:00-08:30 である。
  const prepDay = book.getSheetByName(dayLabels[0])
  prepDay.put(1, 3, '08:00').put(1, 4, '08:30').put(1, 5, '09:00')
  prepDay.put(2, 1, 'EED2349987').put(2, 2, '高木琴音').put(2, 3, '準備')

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
  '③ 読むのは 6 枚（条件入力・回答・マス目の 4 枚）で、入力の名前は 7 つである',
  [sheetsToRead(), Object.keys(inputs).length],
  [
    ['条件入力', '回答'].concat(dayLabels),
    sheetLayout.filter((layout) => layout.name === '条件入力')[0].sections.length + 2,
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
const notBuilt = run(skeletonBook, withoutMetrics)

check(
  '⑤ 骨組みのまま走らせても、マス目の手直しが残っている（→ 5-3）',
  skeletonBook.getSheetByName(dayLabels[0]).getRange(2, 1, 1, 3).getValues()[0],
  ['EED2349987', '高木琴音', '準備'],
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
})
// 下の check が getValues を呼ぶので、数えた往復はここで写し取る
const fullRoundTrips = { reads: roundTrips.reads, writes: roundTrips.writes }

check('④ 全部そろえば、未了は 1 つも無い', fullNotBuilt, [])

// 2025-11-01 の枠は 08:00・08:30・09:00・09:30 ／ 10:00 … と刻まれる（→ 規則 1 の ①）。
// 10:00-10:30 は 5 つ目の枠なので、名前のある 2 列の右の 5 列目 ＝ 7 列目に落ちる。
check(
  '④ 割り当てがマス目で書かれている（見出しは時刻、セルは役割名 1 つ → issue #213）',
  [
    fullBook.getSheetByName(dayLabels[0]).getRange(1, 1, 1, 7).getValues()[0],
    fullBook.getSheetByName(dayLabels[0]).getRange(2, 1, 1, 7).getValues()[0],
  ],
  [
    ['学籍番号', '氏名', '08:00', '08:30', '09:00', '09:30', '10:00'],
    ['EED2349987', '高木琴音', '', '', '', '', '調理'],
  ],
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
  [run(builtInBook, {}), builtInBook.getSheetByName('指標').getRange(2, 1, 1, 2).getValues()[0]],
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
  '④ 割り当ての無い日も、見出しだけは書き直される（前の周の列が残らない）',
  [
    fullBook.getSheetByName(dayLabels[1]).getRange(1, 1, 1, 4).getValues()[0],
    fullBook.getSheetByName(dayLabels[1]).getLastRow(),
  ],
  [['学籍番号', '氏名', '08:00', '08:30'], 1],
)

check(
  '④ 時刻の見出しが左に寄っている（時刻のセルは既定で右寄せになる → issue #213）',
  [
    fullBook.getSheetByName(dayLabels[0]).alignments.get('1,3'),
    fullBook.getSheetByName(dayLabels[0]).alignments.get('1,7'),
    fullBook.getSheetByName(dayLabels[0]).alignments.get('1,2'),
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
  cleanupDay.put(1, 3, new Date(1899, 11, 30, 16, 0, 0))
  cleanupDay.put(2, 1, 'EED2349987').put(2, 2, '高木琴音').put(2, 3, '準備')
  // 前の周の印が残っている（数え直した後は消えていなければならない）
  book.getSheetByName(dayLabels[0]).fontColors.set('2,3', violationMark.fontColor)
  book.getSheetByName(dayLabels[0]).fontWeights.set('2,3', violationMark.fontWeight)
  return book
}

const recountBook = editedBook()
const gridsBeforeRecount = JSON.stringify(gridSnapshot(recountBook))
roundTrips.reads = 0
roundTrips.writes = 0
roundTrips.formats = 0
const said = recountOnEdit({ source: recountBook, range: recountBook.getSheetByName(dayLabels[3]).getRange(2, 3) })
const recountRoundTrips = { ...roundTrips }

check(
  '⑦ マス目を 1 セル書き換えると、規則 1 の違反が検証結果に出る（人が数えない → 5 の #8・#13 の ①）',
  recountBook.getSheetByName('検証結果').getRange(2, 1, 200, 9).getValues().filter((row) => row[0] === checkKind.violation),
  [
    [checkKind.violation, '2025-11-04', '16:00', '16:30', '準備', 'EED2349987', '', '規則 1: 希望の時間の外に置いている', ''],
  ],
)

const grayOf = roleColors.filter((one) => one.roles.indexOf('準備') !== -1)[0].color

check(
  '⑦ 違反した所が、赤い太字で出る（片付け の 2 行目 3 列目 → 6 の #2）',
  [
    [...recountBook.getSheetByName(dayLabels[3]).fontColors.entries()],
    [...recountBook.getSheetByName(dayLabels[3]).fontWeights.entries()],
  ],
  [[['2,3', violationMark.fontColor]], [['2,3', violationMark.fontWeight]]],
)

check(
  '⑦ 背景は役割の色である（準備 はグレー。違反したセルも背景は役割の色のまま → issue #213 の「色」）',
  [
    [...recountBook.getSheetByName(dayLabels[3]).backgrounds.entries()],
    [...recountBook.getSheetByName(dayLabels[0]).backgrounds.entries()],
  ],
  [[['2,3', grayOf]], [['2,3', grayOf]]],
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
check(
  '⑦ 数え直しの読み書きも範囲ごとに 1 回で、マス目に値を書かず、書式は 1 枚につき 4 回までである',
  [recountRoundTrips.reads, recountRoundTrips.writes, recountRoundTrips.formats],
  [sheetLayout.length + sheetLayout[0].sections.length + 1 + (gridCount + 2), 3, gridCount + 2 + 2],
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
strayBook.getSheetByName(dayLabels[3]).put(2, 10, '調理')
const strayBefore = bookSnapshot(strayBook)
const straySaid = recountOnEdit({ source: strayBook, range: strayBook.getSheetByName(dayLabels[3]).getRange(2, 10) })
check(
  '⑦ 載らない書き換えは、止まった理由を名指しの一言で返し、検証結果も指標も書き換えない',
  [
    straySaid.text.startsWith('数え直せなかった'),
    straySaid.text.includes('シート「片付け」の 2 行目 10 列目に「調理」'),
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
      const filled = [...sheet.cells.entries()].filter(([key, value]) => Number(key.split(',')[0]) > 1 && Number(key.split(',')[1]) > 2 && value !== '')
      return [sheet.fontColors.size, filled.every(([key]) => sheet.backgrounds.has(key)), sheet.backgrounds.size === filled.length]
    })
  })(),
  dayLabels.map(() => [0, true, true]),
)

check(
  '⑦ RangeList に渡す A1 の書き方（マス目は 50 列目＝AX 列まである）',
  [a1Notation(1, 1), a1Notation(3, 26), a1Notation(2, 27), a1Notation(2, 50)],
  ['A1', 'Z3', 'AA2', 'AX2'],
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
