// 偽のスプレッドシート — src/*.test.mjs が共有する 1 本。
//
// 以前は shell／verify-structure／build-template／build-form／clear-for-next-year の 5 本に別々に書かれていた
// （→ issue #301）。5 本の振る舞いの和集合を 1 本にしてあり、検査が見る口だけを持つ。
//
// ここは本物ではない。本物と違う所は「本物と違う」と書いて名指しする。実機でしか分からないものは
// src/real-device-log.md の「実機でしか分からないもの」が持つ。
//
//   本物と違う所
//   - 往復の数は roundTrips に数えるだけで、遅さは再現しない（本物は 1 往復ごとに時間がかかる）。
//   - 書式は、検査が引く種類（背景・文字の色・太さ・右の罫線・四方の枠・結合・配置・列の幅）だけを覚える。
//     それ以外の書式（フォントの大きさ、数値の表示形式など）は受け取って捨てる。
//   - setBorder は、四方がすべて true なら枠として、そうでなく right だけが true なら右の線として覚える。
//     上・下・内側の線は覚えない。
//   - 入力規則（setDataValidation）は、渡された値をそのまま持つ。本物のように中身は検めない。
//   - 保護（Protection）は、かけた直後に「持ち主＋共有された編集者」が編集者に入り、ドメインにも開いている。
//     本物がドメインの設定ごとにどう返すかは分からない（→ src/real-device-log.md の項目 22）。
//   - getLastRow／getLastColumn は、空文字でないセルだけを数える。数式の結果が空文字のセルを
//     本物がどう数えるかは確かめていない。
//   - getValues は日付を Date にしない。セルに入れた値をそのまま返す。本物で Date がどう返るかは
//     ここでは分からない（→ src/real-device-log.md）。
//   - 範囲の外を getRange すると、本物と同じく例外を投げる。行や列を足せるのは insertColumnsAfter だけで、
//     insertRows／insertColumns は持たない。
//   - 行や列の大きさは、新しいスプレッドシートの既定（1000 行 26 列）から始まる。本物のシートの
//     上限（セル数 1000 万）は持たない。
//   - 読むだけのシート（readOnly）は、本物に無い道具である。書こうとしたらそこで落とす
//     （「黙って直さない」を道具の側で確かめるため）。落とす口は、範囲への書き込み（setValues／clearContent／
//     書式／罫線／メモ／入力規則／merge）と、シートの状態を変える口（setName／setFrozenRows／setFrozenColumns／
//     setColumnWidth／insertColumnsAfter／protect／addDeveloperMetadata／getRangeList の setFontColor・setFontWeight／
//     getDeveloperMetadata の setValue・remove）である。FakeSpreadsheet は readOnly のシートを 1 枚でも持つと、
//     insertSheet／deleteSheet／moveActiveSheet も落とす。読む口（getValues／getNotes／getRange など）と、
//     検査が盤面を整える口（put／cut*／insertColumn／deleteRow／clear）と、
//     ブックの状態を変えない setActiveSheet は落とさない。

/** 往復の数。検査が 0 に戻して、読み書きの数を比べる。検査 1 本（= 1 プロセス）につき 1 つである。 */
export const roundTrips = { reads: 0, writes: 0, formats: 0, notes: 0, validations: 0 }

/** A1 の書き方を 1 始まりの行と列に戻す（RangeList の偽のため）。 */
export function fromA1(a1) {
  const [, letters, row] = /^([A-Z]+)(\d+)$/.exec(a1)
  const column = [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0)
  return { row: Number(row), column }
}

export class FakeRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    Object.assign(this, { sheet, row, column, rowCount, columnCount })
  }
  /** 範囲に入るセルの鍵（"行,列"）を並べる。 */
  positions() {
    const keys = []
    for (let r = this.row; r < this.row + this.rowCount; r++) {
      for (let c = this.column; c < this.column + this.columnCount; c++) keys.push(`${r},${c}`)
    }
    return keys
  }
  /** 読むだけのシートに書こうとしたら落とす（本物に無い道具。ファイル先頭の注）。 */
  writable() {
    this.sheet.writable()
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
    this.writable()
    roundTrips.writes += 1
    table.forEach((row, i) => row.forEach((value, j) => this.sheet.cells.set(`${this.row + i},${this.column + j}`, value)))
    return this
  }
  clearContent() {
    this.writable()
    roundTrips.writes += 1
    this.positions().forEach((key) => this.sheet.cells.delete(key))
    return this
  }
  /** 書式だけを変える。値を運ばないので往復には数えない。 */
  setHorizontalAlignment(alignment) {
    this.writable()
    this.positions().forEach((key) => this.sheet.alignments.set(key, alignment))
    return this
  }
  setFontWeight(weight) {
    this.writable()
    roundTrips.formats += 1
    this.positions().forEach((key) => this.sheet.bold.set(key, weight))
    return this
  }
  /** 書式を消す（背景色・文字の色・太さ・右の罫線）。値の往復とは別に数える。 */
  clearFormat() {
    this.writable()
    roundTrips.formats += 1
    this.positions().forEach((key) => {
      ;['backgrounds', 'fontColors', 'fontWeights', 'rightBorders', 'bold'].forEach((map) => this.sheet[map].delete(key))
    })
    return this
  }
  /**
   * 罫線を置く。見るのは、四方を囲う枠（→ issue #255）と、右だけの線（→ issue #245）である。
   * 枠と右の線を別々に覚えるのは偽物の都合で、本物は 1 つの罫線の集まりである。
   */
  setBorder(top, left, bottom, right, vertical, horizontal, color, style) {
    this.writable()
    roundTrips.formats += 1
    this.sheet.borders += 1
    if (top === true && left === true && bottom === true && right === true) {
      this.sheet.boxes.add(`${this.row},${this.column},${this.rowCount},${this.columnCount} ${color} ${style}`)
    } else if (right === true) {
      this.positions().forEach((key) => this.sheet.rightBorders.set(key, `${color} ${style}`))
    }
    return this
  }
  /** 背景色を行列でまとめて置く。null は塗らない（今ある色も消す）。 */
  setBackgrounds(colors) {
    this.writable()
    roundTrips.formats += 1
    colors.forEach((row, i) => row.forEach((color, j) => {
      const key = `${this.row + i},${this.column + j}`
      if (color === null) this.sheet.backgrounds.delete(key)
      else this.sheet.backgrounds.set(key, color)
    }))
    return this
  }
  setBackground(color) {
    return this.setBackgrounds(Array.from({ length: this.rowCount }, () => Array(this.columnCount).fill(color)))
  }
  /** 入力規則（プルダウン）を置く。値を運ばないので往復には数えず、別に数える。 */
  setDataValidation(rule) {
    this.writable()
    roundTrips.validations += 1
    this.positions().forEach((key) => this.sheet.validations.set(key, rule))
    return this
  }
  clearDataValidations() {
    this.writable()
    this.positions().forEach((key) => this.sheet.validations.delete(key))
    return this
  }
  merge() {
    this.writable()
    this.sheet.merges.add(`${this.row},${this.column},${this.rowCount},${this.columnCount}`)
    return this
  }
  getSheet() { return this.sheet }
  getRow() { return this.row }
  getColumn() { return this.column }
  getLastRow() { return this.row + this.rowCount - 1 }
  getLastColumn() { return this.column + this.columnCount - 1 }
  /** メモを読む・置く・消す。値の往復とは別に数える。 */
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
  /** 空文字のメモは、無いのと同じにする（本物もメモが空なら外れる）。 */
  setNotes(table) {
    this.writable()
    roundTrips.notes += 1
    table.forEach((row, i) => row.forEach((note, j) => {
      const key = `${this.row + i},${this.column + j}`
      if (note === '') this.sheet.notes.delete(key)
      else this.sheet.notes.set(key, note)
    }))
    return this
  }
  setNote(note) {
    this.writable()
    roundTrips.notes += 1
    this.positions().forEach((key) => this.sheet.notes.set(key, note))
    return this
  }
  clearNote() {
    this.writable()
    roundTrips.notes += 1
    this.positions().forEach((key) => this.sheet.notes.delete(key))
    return this
  }
}

// 本物と同じく、かけた直後は共有された編集者も編集者に入っていて、ドメインにも開いている。
// 持ち主と走らせている人は外れない（→ Protection.removeEditors）。
export const owner = 'owner@example.com'
export const sharedEditor = 'shared@example.com'

export class FakeProtection {
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

let nextSheetId = 1

export class FakeSheet {
  /**
   * 1000 行 26 列は、新しいスプレッドシートの既定の大きさである。
   * options: maxRows／maxColumns（既定の大きさを変える）、readOnly（書こうとしたら落とす）。
   */
  constructor(name, options = {}) {
    Object.assign(this, {
      name, id: nextSheetId++, cells: new Map(), notes: new Map(), validations: new Map(), alignments: new Map(),
      backgrounds: new Map(), fontColors: new Map(), fontWeights: new Map(), rightBorders: new Map(), bold: new Map(),
      boxes: new Set(), merges: new Set(), columnWidths: new Map(), metadata: [], borders: 0, protections: [],
      frozenRows: 0, frozenColumns: 0, maxRows: options.maxRows ?? 1000, maxColumns: options.maxColumns ?? 26,
      formUrl: null, readOnly: options.readOnly ?? false,
    })
  }
  /** 読むだけのシートの状態を変えようとしたら落とす（ファイル先頭の注）。 */
  writable() {
    if (this.readOnly) throw new Error(`偽のスプレッドシート: 読むだけのシート（${this.name}）に書こうとした`)
  }
  getName() { return this.name }
  setName(name) { this.writable(); this.name = name; return this }
  getSheetId() { return this.id }
  getRange(row, column, rowCount = 1, columnCount = 1) {
    // 本物と同じく範囲外で例外を投げる
    if (column + columnCount - 1 > this.getMaxColumns()) throw new Error(`範囲外（${this.name} の ${column + columnCount - 1} 列目）`)
    if (row + rowCount - 1 > this.getMaxRows()) throw new Error(`範囲外（${this.name} の ${row + rowCount - 1} 行目）`)
    return new FakeRange(this, row, column, rowCount, columnCount)
  }
  getRangeList(a1s) {
    const sheet = this
    const each = (map, value) => {
      sheet.writable()
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
  setFrozenRows(count) { this.writable(); this.frozenRows = count }
  setFrozenColumns(count) { this.writable(); this.frozenColumns = count }
  // 100 px は、新しいスプレッドシートの列の既定の幅である
  getColumnWidth(column) { return this.columnWidths.get(column) ?? 100 }
  setColumnWidth(column, width) { this.writable(); this.columnWidths.set(column, width) }
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
  getMaxRows() { return Math.max(this.maxRows, this.getLastRow()) }
  getMaxColumns() { return Math.max(this.maxColumns, this.getLastColumn()) }
  insertColumnsAfter(after, count) { this.writable(); this.maxColumns = Math.max(this.maxColumns, after + count) }
  getProtections() { return [...this.protections] }
  protect() { this.writable(); const p = new FakeProtection(this); this.protections.push(p); return p }
  /** このシートに回答を送るフォームの URL。紐付いていなければ null。 */
  getFormUrl() { return this.formUrl }
  /** シートに置く見えない記録。鍵と値の組で、値は文字列である。 */
  getDeveloperMetadata() {
    const sheet = this
    return this.metadata.map((entry) => ({
      getKey() { return entry.key },
      getValue() { return entry.value },
      setValue(value) { sheet.writable(); entry.value = String(value); return this },
      remove() { sheet.writable(); sheet.metadata = sheet.metadata.filter((one) => one !== entry) },
    }))
  }
  addDeveloperMetadata(key, value) {
    this.writable()
    this.metadata = this.metadata.concat([{ key, value: String(value) }])
    return this
  }

  // ---- 偽物だけが持つ口（検査が盤面を整えるのに使う。本物に無い） ------------------

  put(row, column, value) { this.cells.set(`${row},${column}`, value); return this }
  /** 担当者が列をまとめて消した状態にする（その列より右が消える）。 */
  cutColumnsTo(maxColumns) {
    this.maxColumns = maxColumns
    this.cells = new Map([...this.cells.entries()].filter(([key]) => Number(key.split(',')[1]) <= maxColumns))
    return this
  }
  /** 担当者が行をまとめて消した状態にする（その行より下が消える）。 */
  cutRowsTo(maxRows) {
    this.maxRows = maxRows
    this.cells = new Map([...this.cells.entries()].filter(([key]) => Number(key.split(',')[0]) <= maxRows))
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

export class FakeSpreadsheet {
  /**
   * sheets: FakeSheet か、シートの名前（名前なら既定の大きさのシートを作る）の並び。
   * options: id、name、sheetOptions（insertSheet と名前から作るシートの大きさ。FakeSheet の options）。
   */
  constructor(sheets, options = {}) {
    this.id = options.id ?? 'this-spreadsheet'
    this.name = options.name ?? '学祭シフト'
    this.sheetOptions = options.sheetOptions ?? {}
    this.sheets = sheets.map((one) => (typeof one === 'string' ? new FakeSheet(one, this.sheetOptions) : one))
    this.activeSheet = this.sheets[0]
  }
  getId() { return this.id }
  getName() { return this.name }
  getSheets() { return [...this.sheets] }
  getSheetByName(name) { return this.sheets.find((s) => s.getName() === name) ?? null }
  /** readOnly のシートを持つブックのシートの出し入れを落とす（ファイル先頭の注）。 */
  writable() {
    if (this.sheets.some((s) => s.readOnly)) throw new Error('偽のスプレッドシート: 読むだけのシートを持つブックのシートを増減しようとした')
  }
  insertSheet(name) { this.writable(); const s = new FakeSheet(name, this.sheetOptions); this.sheets.push(s); return s }
  deleteSheet(sheet) { this.writable(); this.sheets = this.sheets.filter((s) => s !== sheet) }
  setActiveSheet(sheet) { this.activeSheet = sheet }
  moveActiveSheet(position) {
    this.writable()
    this.sheets = this.sheets.filter((s) => s !== this.activeSheet)
    this.sheets.splice(position - 1, 0, this.activeSheet)
  }
  /** 全シートの値の写し。書き換わっていないことを見る検査が使う（本物に無い）。 */
  snapshot() { return JSON.stringify(this.sheets.map((s) => [s.name, [...s.cells.entries()].sort()])) }
}
