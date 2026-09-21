/**
 * 殻 — SpreadsheetApp に触る唯一の場所（docs/tech-requirements.md 6 の #8）。
 *
 * やることは 3 つだけである。
 *   ① シートを読んで、値の表現を揃えてコアに渡す
 *   ② コア（core.js の build）を呼ぶ
 *   ③ 返ってきた行を生成シートに書く
 *
 * 走る前の構造の検証（シートの有無・見出し・列数）は verify-structure.js が持つ。
 * run が最初に呼ぶ — 崩れていれば、読む前に名指しして止まる。
 *
 * ここに割り当ての規則を書かない。規則はコアが持つ。
 * 逆に、コアに SpreadsheetApp を持ち込まない — 持ち込むと 6-1 の #2 の逃げ道が消える。
 *
 * 読み書きは範囲ごとに 1 回で済ませる。セル単位で往復しない（→ 6 の #2 の実装上の注意）。
 * 時間を食うのは計算ではなく SpreadsheetApp の往復のほうである。
 *
 * 他のファイルの値をこのファイルの最上位で使わない（→ core.js の同じ注意）。
 */

/**
 * 殻がコアに渡す値の表現。コアはこの形の文字列と、数値しか受け取らない
 * （→ core.js の checkRepresentation）。
 *
 * 時刻が HH:MM であることは sheet-layout.js の注記が決めている（条件入力の「日ごとの営業時刻」）。
 * 日付が YYYY-MM-DD であることは data/前回の確定シフト-モック-0N.json の転記元の形である。
 */
const valueRepresentation = {
  date: 'YYYY-MM-DD',
  time: 'HH:MM',
  dateTime: 'YYYY-MM-DD HH:MM:SS',
}

/** 殻が読むシート。生成しか書かない 2 枚は読まない（→ core.js の sheetsNotRead）。 */
function sheetsToRead() {
  return sheetLayout
    .filter((layout) => sheetsNotRead.indexOf(layout.name) === -1)
    .map((layout) => layout.name)
}

/** 区画の見出しを置くシートは 2 行、置かないシートは 1 行が見出しである（→ build-template.js）。 */
function headerRowCount(layout) {
  return layout.hasSectionHeadings ? 2 : 1
}

/**
 * コアに渡す入力を読む。名前は core.js の inputNames と同じ順で並ぶ。
 * 値はどれも、表現を揃えたあとの行の配列である。
 */
function readInputs(spreadsheet) {
  const inputs = {}
  sheetsToRead().forEach((name) => {
    const layout = findLayout(name)
    const sheet = findSheet(spreadsheet, name)
    layout.sections.forEach((section) => {
      inputs[layout.hasSectionHeadings ? section.heading : name] = readSection(sheet, layout, section)
    })
  })
  return inputs
}

/**
 * 区画 1 つぶんの行を読む。
 *
 * 読む幅は区画の幅である（→ sheet-layout.js の sectionWidth）。「回答」の後ろ 4 列のように
 * 構成が名前を持たない列も、位置は取ってあるので同じだけ読む（→ 4-1・input-types.js）。
 *
 * 下の空の行を落とすのは、条件入力の 5 区画を横に並べてある（→ src/README.md）からである。
 * 行数の違う区画が同じ最終行まで読まれるので、短いほうの下は空の行で埋まる。
 *
 * 落とすのは下の空の行だけで、区画の途中の空の行は残す。詰めると、その下の行の番号がずれて、
 * 名指しの「N 行目」が担当者のシートの行を指さなくなる（→ input-types.js の whereIs）。
 * 途中の空の行を読み飛ばすのは、型に直す側である。
 */
function readSection(sheet, layout, section) {
  const headerRows = headerRowCount(layout)
  const lastRow = sheet.getLastRow()
  if (lastRow <= headerRows) return []

  const rows = sheet
    .getRange(headerRows + 1, section.startColumn, lastRow - headerRows, sectionWidth(section))
    .getValues()
    .map((row) => row.map(normalizeValue))

  while (rows.length > 0 && rows[rows.length - 1].every((cell) => cell === '')) rows.pop()
  return rows
}

/**
 * 生成シートに書き戻す。
 *
 * 段が 1 つでも入っていなければ、1 枚も書かない。
 * 段はつながっているので、前の段が欠けたまま後ろの段だけ走らせても、出てくるのは空である。
 * 空の配列で上書きすると、担当者が割り当てシートに入れた手直し（→ 5-3）が黙って消える。
 * 何が入っていないかは notBuilt が名指しで持っている（→ core.js の coreSteps）。
 */
function writeOutputs(spreadsheet, output) {
  if ((output.notBuilt || []).length > 0) return

  outputNames.forEach((name) => {
    const layout = findLayout(name)
    const sheet = findSheet(spreadsheet, name)
    const columnCount = sectionWidth(layout.sections[0])
    const headerRows = headerRowCount(layout)
    const lastRow = sheet.getLastRow()

    if (lastRow > headerRows) {
      sheet.getRange(headerRows + 1, 1, lastRow - headerRows, columnCount).clearContent()
    }
    if (output[name].length === 0) return
    sheet.getRange(headerRows + 1, 1, output[name].length, columnCount).setValues(output[name])
  })
}

/**
 * Apps Script から呼ぶ入口。SpreadsheetApp を名指しするのは、このファイルのこの 1 行だけである。
 * メニューから呼ぶのは issue #151（生成）で、そこで steps を渡す。
 */
function runOnActiveSpreadsheet(steps) {
  return run(SpreadsheetApp.getActive(), steps)
}

/**
 * 構造を確かめる → 読む → コアを呼ぶ → 書く。殻の側の 1 本である。
 * スプレッドシートは引数で受ける — 手元の検査で偽のスプレッドシートを渡せるようにするためである。
 * steps はコアの段（→ core.js の coreSteps）で、入っている段だけを渡す。
 * 返すのは notBuilt — 担当者に何と言うかは、メニューから呼ぶ側（issue #151）が決める。
 *
 * 構造が崩れていれば、1 行も読まずに名指しして止まる（→ verify-structure.js）。
 * notBuilt と違って返り値で持ち帰らない — 崩れているのは担当者のシートのほうで、
 * 何を直すかはメニューの出方に関わらず同じである。
 */
function run(spreadsheet, steps) {
  checkStructure(spreadsheet)
  const output = build(readInputs(spreadsheet), steps)
  writeOutputs(spreadsheet, output)
  return output.notBuilt
}

/**
 * セル 1 つの表現を揃える。ここが、コアに表現の揺れを入れないための関門である。
 *
 * SpreadsheetApp を掴まない純粋な関数にしてあるのは、手元で回して確かめられるようにするためである。
 * 黙って解釈し直さない — 文字列は両端の空白を落とすだけで、中身には手を入れない。
 */
function normalizeValue(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  // instanceof を使わない。vm やダイアログを跨ぐと Date が別物になる
  if (Object.prototype.toString.call(value) === '[object Date]') return formatDateTime(value)
  return String(value).trim()
}

/**
 * Date を valueRepresentation の 3 つのどれかにする。
 *
 * 時刻だけのセルは 1899-12-30 を土台にした Date で返ってくるので、年で見分ける。
 * ちょうど 00:00:00 の日時は日付になる — セルの表示と同じで、ここで作り分けられる情報が無い。
 */
function formatDateTime(dateTime) {
  const year = dateTime.getFullYear()
  const date = `${year}-${twoDigits(dateTime.getMonth() + 1)}-${twoDigits(dateTime.getDate())}`
  const time = `${twoDigits(dateTime.getHours())}:${twoDigits(dateTime.getMinutes())}`
  const seconds = twoDigits(dateTime.getSeconds())

  if (year < 1900) return time
  if (`${time}:${seconds}` === '00:00:00') return date
  return `${date} ${time}:${seconds}`
}

function twoDigits(number) {
  return String(number).length < 2 ? `0${number}` : String(number)
}

/** sheetLayout から 1 枚を引く。無ければ名指しで止まる。 */
function findLayout(name) {
  const layout = sheetLayout.filter((c) => c.name === name)[0]
  if (!layout) throw new Error(`シートの構成に「${name}」が無い`)
  return layout
}

/**
 * スプレッドシートから 1 枚を引く。無ければ名指しで止まる（黙って作らない）。
 * ここに来る前に checkStructure が通っているので、run 経由なら無いことは起きない。
 * それでも見るのは、readInputs を単体で呼べる形にしてあるからである（→ verify-structure.js）。
 */
function findSheet(spreadsheet, name) {
  const sheet = spreadsheet.getSheetByName(name)
  if (!sheet) {
    throw new Error(
      `シート「${name}」が無い。テンプレートを組み立て直す（→ src/README.md）`,
    )
  }
  return sheet
}

// Node から読むためだけの口。Apps Script では module が無いので通らない。
if (typeof module !== 'undefined') {
  module.exports = {
    valueRepresentation, sheetsToRead, headerRowCount, readInputs, readSection, writeOutputs, run, runOnActiveSpreadsheet,
    normalizeValue, formatDateTime, findLayout, findSheet,
  }
}
