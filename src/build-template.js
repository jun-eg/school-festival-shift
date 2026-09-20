/**
 * Make the one template (docs/tech-requirements.md 8 の 1).
 *
 * Who runs this is the side that prepares the template (the implementer). It is run once, and
 * the spreadsheet it produces is what the staff copy.
 * It is not put on the staff's menu (menu.js) — what the staff do is the 10 lines of
 * 2「担当者がやることの全部」, and this operation is not among them.
 *
 * Never silently fix. Never silently run.
 * If the headings of a sheet that is already there differ from the layout, it names it and stops
 * (it does not overwrite).
 */

/** The door to run this by hand from the Apps Script editor. */
function buildTemplate() {
  const log = buildTemplateInto(SpreadsheetApp.getActive())
  console.log(log.join('\n'))
  return log.join('\n')
}

/**
 * Make the sheets as sheetLayout has them, put the headings in, and protect the generated sheets.
 * However many times it is run, the shape comes out the same (only what is missing gets added).
 */
function buildTemplateInto(spreadsheet) {
  const log = []

  sheetLayout.forEach((layout, index) => {
    let sheet = spreadsheet.getSheetByName(layout.name)
    if (!sheet) {
      sheet = spreadsheet.insertSheet(layout.name)
      log.push(`シート「${layout.name}」を作った`)
    }
    putHeaders(sheet, layout, log)
    sheet.setFrozenRows(layout.frozenRows)
    spreadsheet.setActiveSheet(sheet)
    spreadsheet.moveActiveSheet(index + 1)
    applyProtection(sheet, layout, log)
  })

  removeDefaultSheet(spreadsheet, log)
  spreadsheet.setActiveSheet(spreadsheet.getSheetByName(sheetLayout[0].name))
  log.push(`5 枚のうち保護したのは ${sheetLayout.filter((c) => c.protect).length} 枚である`)
  return log
}

/** Per section, put the heading row and the column name row in. Where the content differs, it stops instead of overwriting. */
function putHeaders(sheet, layout, log) {
  const columnNameRow = layout.hasSectionHeadings ? 2 : 1

  layout.sections.forEach((section) => {
    if (layout.hasSectionHeadings) {
      replaceValues(sheet, 1, section.startColumn, [section.heading], layout.name, log)
      sheet.getRange(1, section.startColumn).setFontWeight('bold').setNote(section.note)
    }
    replaceValues(sheet, columnNameRow, section.startColumn, section.columns, layout.name, log)
    const headingRange = sheet.getRange(columnNameRow, section.startColumn, 1, section.columns.length)
    headingRange.setFontWeight('bold')
    if (!layout.hasSectionHeadings) {
      sheet.getRange(columnNameRow, section.startColumn).setNote(section.note)
    }
  })
}

/** Empty, so write. The same, so do nothing. Different, so name it and stop. */
function replaceValues(sheet, row, startColumn, values, sheetName, log) {
  const range = sheet.getRange(row, startColumn, 1, values.length)
  const actual = range.getValues()[0].map((cell) => String(cell))
  const wanted = values.map((cell) => String(cell))

  if (actual.join('\t') === wanted.join('\t')) return
  if (actual.every((cell) => cell === '')) {
    range.setValues([wanted])
    log.push(`「${sheetName}」の ${row} 行目 ${startColumn} 列目から見出しを置いた`)
    return
  }
  throw new Error(
    `「${sheetName}」の ${row} 行目 ${startColumn} 列目が構成と違う。`
      + `いま: ${actual.join(' / ')} ／ 構成: ${wanted.join(' / ')}。`
      + '中身を見てから決める（黙って直さない）',
  )
}

/**
 * Put protection on the generated sheets.
 * The protection is warning-only — the owner of the copied file is the staff member themselves,
 * and Google Sheets has no protection that can shut the owner out (→ src/README.md).
 */
function applyProtection(sheet, layout, log) {
  sheet
    .getProtections(SpreadsheetApp.ProtectionType.SHEET)
    .forEach((existing) => existing.remove())

  if (!layout.protect) return

  sheet.protect().setDescription(protectionNote).setWarningOnly(true)
  log.push(`シート「${layout.name}」に保護をかけた（警告のみ）`)
}

/** Delete the empty sheet a new spreadsheet comes with. If it has content, keep it and name it. */
function removeDefaultSheet(spreadsheet, log) {
  const layoutNames = sheetLayout.map((layout) => layout.name)

  spreadsheet.getSheets().forEach((sheet) => {
    const name = sheet.getName()
    if (layoutNames.indexOf(name) !== -1) return

    if (sheet.getLastRow() === 0 && sheet.getLastColumn() === 0) {
      spreadsheet.deleteSheet(sheet)
      log.push(`空のシート「${name}」を消した`)
      return
    }
    log.push(`構成に無いシート「${name}」に中身があるので、残した`)
  })
}
