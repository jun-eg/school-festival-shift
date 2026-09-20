/**
 * The shell — the only place that touches SpreadsheetApp (docs/tech-requirements.md 6 の #8).
 *
 * It does 3 things and no more.
 *   ① read the sheets, line the value representations up, and hand them to the core
 *   ② call the core (build in core.js)
 *   ③ write the rows that come back into the generated sheets
 *
 * Checking the structure before running (sheets present, headings, column counts) is
 * verify-structure.js's to hold. run calls it first — if the structure is broken, it names
 * what is broken and stops before reading anything.
 *
 * No assignment rule gets written here. The rules are the core's to hold.
 * The other way round, SpreadsheetApp never gets carried into the core — carry it in and the
 * way out of 6-1 の #2 disappears.
 *
 * Reading and writing is done once per range. Never go back and forth cell by cell
 * (→ 6 の #2 の実装上の注意). What costs time is the round trips to SpreadsheetApp,
 * not the computation.
 *
 * Never use a value from another file at the top level of this file (→ the same note in core.js).
 */

/**
 * The value representations the shell hands to the core. The core takes only strings in these
 * shapes, and numbers (→ checkRepresentation in core.js).
 *
 * That times are HH:MM is settled by the notes in sheet-layout.js (条件入力's「日ごとの営業 4 時刻」).
 * That dates are YYYY-MM-DD is the shape of what data/前回の確定シフト-モック-0N.json was copied from.
 */
const valueRepresentation = {
  date: 'YYYY-MM-DD',
  time: 'HH:MM',
  dateTime: 'YYYY-MM-DD HH:MM:SS',
}

/** The sheets the shell reads. The 2 that only generation writes are not read (→ sheetsNotRead in core.js). */
function sheetsToRead() {
  return sheetLayout
    .filter((layout) => sheetsNotRead.indexOf(layout.name) === -1)
    .map((layout) => layout.name)
}

/** A sheet that carries section headings has 2 heading rows; one that does not has 1 (→ build-template.js). */
function headerRowCount(layout) {
  return layout.hasSectionHeadings ? 2 : 1
}

/**
 * Read the inputs to hand to the core. The names come in the same order as inputNames in core.js.
 * Every value is an array of rows whose representations have been lined up.
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
 * Read the rows of one section.
 *
 * Empty rows are dropped because the 5 sections of 条件入力 sit side by side (→ src/README.md).
 * Sections with different row counts are all read down to the same last row, so below the
 * shorter ones there are empty rows.
 */
function readSection(sheet, layout, section) {
  const headerRows = headerRowCount(layout)
  const lastRow = sheet.getLastRow()
  if (lastRow <= headerRows) return []

  return sheet
    .getRange(headerRows + 1, section.startColumn, lastRow - headerRows, section.columns.length)
    .getValues()
    .map((row) => row.map(normalizeValue))
    .filter((row) => row.some((cell) => cell !== ''))
}

/**
 * Write back into the generated sheets.
 *
 * If even one step is not in, not a single sheet gets written.
 * The steps are chained, so running only the later ones while an earlier one is missing puts
 * out nothing but emptiness. Overwriting with an empty array silently wipes the hand edits the
 * staff put into the 割り当て sheet (→ 5-3).
 * What is not in is named in notBuilt (→ coreSteps in core.js).
 */
function writeOutputs(spreadsheet, output) {
  if ((output.notBuilt || []).length > 0) return

  outputNames.forEach((name) => {
    const layout = findLayout(name)
    const sheet = findSheet(spreadsheet, name)
    const columnCount = layout.sections[0].columns.length
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
 * The door Apps Script calls in through. This one line of this one file is the only place
 * SpreadsheetApp is named. Calling it from the menu is issue #151 (生成), and the steps are
 * handed in there.
 */
function runOnActiveSpreadsheet(steps) {
  return run(SpreadsheetApp.getActive(), steps)
}

/**
 * Check the structure → read → call the core → write. This is the one line of the shell side.
 * The spreadsheet comes in as an argument — so that the checks here can hand in a fake one.
 * steps are the steps of the core (→ coreSteps in core.js), and only the ones that are in get handed in.
 * What it returns is notBuilt — what to say to the staff is for the caller from the menu
 * (issue #151) to decide.
 *
 * If the structure is broken, it names what is broken and stops without reading a single row
 * (→ verify-structure.js).
 * Unlike notBuilt, that is not carried back in the return value — what is broken is the staff's
 * sheet, and what to fix is the same however the menu turns out.
 */
function run(spreadsheet, steps) {
  checkStructure(spreadsheet)
  const output = build(readInputs(spreadsheet), steps)
  writeOutputs(spreadsheet, output)
  return output.notBuilt
}

/**
 * Line up the representation of one cell. This is the gate that keeps the wobble out of the core.
 *
 * It is a pure function that never touches SpreadsheetApp, so that it can be run and checked
 * here. It never silently reinterprets anything — a string only loses the whitespace at both
 * ends, and what is inside is left alone.
 */
function normalizeValue(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  // No instanceof. Across a vm or a dialog, Date is a different thing
  if (Object.prototype.toString.call(value) === '[object Date]') return formatDateTime(value)
  return String(value).trim()
}

/**
 * Turn a Date into one of the 3 in valueRepresentation.
 *
 * A time-only cell comes back as a Date built on 1899-12-30, so it is told apart by the year.
 * A date-time of exactly 00:00:00 becomes a date — same as what the cell shows, and there is
 * nothing here to tell the two apart by.
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

/** Look one sheet up in sheetLayout. If it is not there, it stops and names it. */
function findLayout(name) {
  const layout = sheetLayout.filter((c) => c.name === name)[0]
  if (!layout) throw new Error(`シートの構成に「${name}」が無い`)
  return layout
}

/**
 * Look one sheet up in the spreadsheet. If it is not there, it stops and names it (it never
 * silently creates one).
 * checkStructure has passed before anything gets here, so coming through run it cannot be missing.
 * It is looked at anyway because readInputs is left callable on its own (→ verify-structure.js).
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

// A door for Node to read this file through, nothing more. Apps Script has no module, so it never runs there.
if (typeof module !== 'undefined') {
  module.exports = {
    valueRepresentation, sheetsToRead, headerRowCount, readInputs, readSection, writeOutputs, run, runOnActiveSpreadsheet,
    normalizeValue, formatDateTime, findLayout, findSheet,
  }
}
