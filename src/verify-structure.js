/**
 * Checking the structure before running — holding the sheets, the headings and the column
 * counts up against the layout
 * (docs/tech-requirements.md 2 の「止まる箇所」#8 ／ issue #138).
 *
 * There are 2 guards for #8, and this is the other one.
 * The first (putting protection on the generated sheets) is build-template.js's to hold, but
 * it only goes on as a warning, and it can be written through (→ src/README.md「保護は『警告のみ』である」).
 *
 * What can break is a deleted row, an inserted column, an overwritten generated sheet — and
 * from where the staff sit, none of that looks different from an operation they are allowed to do,
 * because the screen for the hand edits is the spreadsheet itself (→ 6 の #2) and rewriting cells
 * is the specification (→ 5-3).
 *
 * If it is broken, every broken spot is named and it stops.
 *   Never silently fix — not one cell is rewritten. It only reads
 *   Never silently run — it stops before reading, so generation does not move a single row
 * This is the same treatment as「満たせない枠は黙って埋めない」(→ 5 の #6).
 *
 * How to fix it is not decided here. Copy the template once more and put the conditions back in
 * (→ 6 の #1 の理由 ⑤・src/README.md の「テンプレートの作り方」).
 *
 * Only the heading rows are looked at. The data rows are not — 条件入力 and 割り当て are where the
 * staff write, and rows growing and shrinking there is the specification (→ 5-1・5-3).
 * Column counts are looked at in the heading rows (anything to the right of the right edge of the
 * sections, or between two sections, gets named).
 *
 * The spreadsheet comes in as an argument. The one line that names SpreadsheetApp is in shell.js.
 * Never use a value from another file at the top level of this file (→ the same note in core.js).
 */

/** The kinds of breakage. The shape of the sentence differs per kind (→ breakageToText). */
const breakageKind = {
  missingSheet: 'シートが無い',
  tooFewColumns: '列が足りない',
  headingMismatch: '見出しが違う',
  unknownColumn: '構成に無い列',
}

/**
 * Name every broken spot and return them (an empty array if nothing is broken).
 *
 * It does not cut off at the first one. What the staff fix is up on the spreadsheet, so putting
 * out everything that is broken right now takes fewer moves than making them run it again for
 * each spot. Reading is once per sheet. Never go back and forth cell by cell
 * (→ 6 の #2 の実装上の注意).
 */
function nameBreakages(spreadsheet) {
  const breakages = []

  sheetLayout.forEach((layout) => {
    const sheet = spreadsheet.getSheetByName(layout.name)
    if (!sheet) {
      breakages.push({ sheet: layout.name, kind: breakageKind.missingSheet, row: null, column: null, actual: [], expected: [] })
      return
    }
    checkColumnCount(sheet, layout, breakages)
    const headerRows = readHeaderRows(sheet, layout)
    checkSections(layout, headerRows, breakages)
    checkUnknownColumns(layout, headerRows, breakages)
  })

  return breakages
}

/**
 * Check the structure before running. If it is broken, every broken spot is named and it stops.
 * If it is not broken, it returns an empty array (not to branch on, but to show that it is 0 spots).
 */
function checkStructure(spreadsheet) {
  const breakages = nameBreakages(spreadsheet)
  if (breakages.length === 0) return breakages

  throw new Error(
    `シートの構造が ${breakages.length} 箇所崩れているので、生成を走らせない。`
      + '中身を見てから決める（黙って直さない）。'
      + '戻せないときは、テンプレートをもう 1 回コピーして条件を入れ直す（→ src/README.md）。\n'
      + breakages.map(breakageToText).join('\n'),
  )
}

/** Turn one breakage into one line that names where it is. This line is what the staff read. */
function breakageToText(breakage) {
  if (breakage.kind === breakageKind.missingSheet) {
    return `シート「${breakage.sheet}」が無い`
  }
  if (breakage.kind === breakageKind.tooFewColumns) {
    return `シート「${breakage.sheet}」の列が ${breakage.actual[0]} 列しかない（構成は ${breakage.expected[0]} 列である）`
  }
  const where = `「${breakage.sheet}」の ${breakage.row} 行目 ${breakage.column} 列目`
  if (breakage.kind === breakageKind.unknownColumn) {
    return `${where} に、構成に無い「${breakage.actual[0]}」がある`
  }
  const width = breakage.expected.length > 1 ? `から ${breakage.expected.length} 列` : ''
  return `${where}${width} が構成と違う。`
    + `いま: ${breakage.actual.map(showBlank).join(' / ')} ／ 構成: ${breakage.expected.join(' / ')}`
}

/**
 * Look at whether the sheet has as many columns as the layout needs.
 * If the columns were deleted in one go, it gets named here, before the reading
 * (take the range to read outside the sheet and an out-of-range exception comes out instead of
 * the naming).
 */
function checkColumnCount(sheet, layout, breakages) {
  const rightEdge = sectionRightEdge(layout)
  if (sheet.getMaxColumns() >= rightEdge) return

  breakages.push({
    sheet: layout.name,
    kind: breakageKind.tooFewColumns,
    row: null,
    column: null,
    actual: [String(sheet.getMaxColumns())],
    expected: [String(rightEdge)],
  })
}

/**
 * Read just the heading rows, in one go. To the right of the right edge of the sections it reads
 * as far as there is content (to see an inserted column).
 * Never take the range to read outside the sheet — do that and an out-of-range exception comes
 * out instead of the naming.
 * The deleted side is held up against the layout as empty, so its naming comes out of checkSections.
 */
function readHeaderRows(sheet, layout) {
  const rowCount = Math.min(headerRowCount(layout), sheet.getMaxRows())
  const columnCount = Math.min(
    Math.max(sectionRightEdge(layout), sheet.getLastColumn()),
    sheet.getMaxColumns(),
  )
  return sheet
    .getRange(1, 1, rowCount, columnCount)
    .getValues()
    .map((row) => row.map((cell) => String(normalizeValue(cell))))
}

/** Per section, hold the heading cells up against the column names. A run is named as one item. */
function checkSections(layout, headerRows, breakages) {
  const columnNameRow = headerRowCount(layout)

  layout.sections.forEach((section) => {
    if (layout.hasSectionHeadings) {
      checkRange(layout, headerRows, 1, section.startColumn, [section.heading], breakages)
    }
    checkRange(layout, headerRows, columnNameRow, section.startColumn, section.columns, breakages)
  })
}

/** Hold one continuous range inside one row up against the layout. If it differs, push exactly one item. */
function checkRange(layout, headerRows, row, startColumn, expectedNames, breakages) {
  const actual = []
  for (let i = 0; i < expectedNames.length; i++) actual.push(cellAt(headerRows, row, startColumn + i))
  const expected = expectedNames.map((value) => String(value))
  if (actual.join('\t') === expected.join('\t')) return

  breakages.push({
    sheet: layout.name,
    kind: breakageKind.headingMismatch,
    row: row,
    column: startColumn,
    actual: actual,
    expected: expected,
  })
}

/**
 * Name any column of the heading rows that has content in it but belongs to no section.
 *
 * What is looked at is between the sections (条件入力 has its 5 sections side by side) and to the
 * right of the right edge of the sections.
 * Insert one column and the heading that slid right lands here.
 */
function checkUnknownColumns(layout, headerRows, breakages) {
  const sectionColumns = {}
  layout.sections.forEach((section) => {
    for (let i = 0; i < section.columns.length; i++) sectionColumns[section.startColumn + i] = true
  })

  headerRows.forEach((rowValues, i) => {
    rowValues.forEach((cell, j) => {
      if (cell === '' || sectionColumns[j + 1]) return
      breakages.push({
        sheet: layout.name,
        kind: breakageKind.unknownColumn,
        row: i + 1,
        column: j + 1,
        actual: [cell],
        expected: [],
      })
    })
  })
}

/** The rightmost column of the sections. This is the column count the layout needs. */
function sectionRightEdge(layout) {
  return layout.sections.reduce((rightEdge, section) => Math.max(rightEdge, section.startColumn + section.columns.length - 1), 0)
}

/** Take one cell out of the heading rows that were read. Outside what was read counts as empty (that is the deleted-column side). */
function cellAt(headerRows, row, column) {
  const rowValues = headerRows[row - 1] || []
  return column <= rowValues.length ? rowValues[column - 1] : ''
}

/** An empty cell has to be visible in the sentence, or the place cannot be read. */
function showBlank(value) {
  return value === '' ? '（空）' : value
}

// A door for Node to read this file through, nothing more. Apps Script has no module, so it never runs there.
if (typeof module !== 'undefined') {
  module.exports = { breakageKind, nameBreakages, checkStructure, breakageToText, sectionRightEdge }
}
