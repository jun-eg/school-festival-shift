/**
 * テンプレートを 1 つ作る（docs/tech-requirements.md 8 の 1）。
 *
 * 実装者が 1 回だけ走らせ、出来上がったスプレッドシートを担当者にコピーさせる。
 * 担当者のメニュー（menu.js）には出さない。
 * すでにあるシートの見出しが構成と違えば、上書きせずに名指しで止まる。
 */
/** Apps Script のエディタから手で走らせる入口。 */
function buildTemplate() {
  const log = buildTemplateInto(SpreadsheetApp.getActive())
  console.log(log.join('\n'))
  return log.join('\n')
}

/**
 * sheetLayout どおりにシートを作り、見出しを置き、生成シートに保護をかける。
 * 何度走らせても同じ形になる（足りないものだけ足す）。
 * 名前をコアの build と重ねない（Apps Script は .gs で 1 つのグローバルを共有する）。
 */
function buildTemplateInto(spreadsheet) {
  const log = []

  sheetLayout.forEach((layout, index) => {
    let sheet = spreadsheet.getSheetByName(layout.name)
    if (!sheet) {
      sheet = spreadsheet.insertSheet(layout.name)
      log.push(`シート「${layout.name}」を作った`)
    }
    widenTo(sheet, layout, log)
    putHeaders(sheet, layout, log)
    sheet.setFrozenRows(layout.frozenRows)
    sheet.setFrozenColumns(layout.frozenColumns || 0)
    spreadsheet.setActiveSheet(sheet)
    spreadsheet.moveActiveSheet(index + 1)
    applyProtection(sheet, layout, log)
  })

  removeDefaultSheet(spreadsheet, log)
  spreadsheet.setActiveSheet(spreadsheet.getSheetByName(sheetLayout[0].name))
  log.push(
    `${sheetLayout.length} 枚のうち保護したのは ${sheetLayout.filter((c) => c.protect).length} 枚である`
    + `（割り当ては日ごとの ${gridLayouts(assignmentName).length} 枚）`,
  )
  return log
}

/**
 * 構成が要る列数まで、シートを広げる（新しいシートは 26 列だが、マス目は 51 列を取る）。
 * 減らさない（余分な列は構造の崩れではない）。
 */
function widenTo(sheet, layout, log) {
  const rightEdge = sectionRightEdge(layout)
  const missing = rightEdge - sheet.getMaxColumns()
  if (missing <= 0) return

  sheet.insertColumnsAfter(sheet.getMaxColumns(), missing)
  log.push(`「${layout.name}」を ${rightEdge} 列に広げた（${missing} 列足した）`)
}

/**
 * 区画ごとに、見出しの行と列名の行を置く。中身が違うときは上書きせずに止まる。
 * 「回答」の後ろ 4 列は空のままにする（題は今年の日付から出るので、フォームを作るときに埋まる → build-form.js）。
 */
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

/** 空なら書く。同じなら何もしない。違うなら名指しで止まる。 */
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

/** 生成シートに「警告のみ」の保護をかける（持ち主の担当者を締め出せる保護は無いため）。 */
function applyProtection(sheet, layout, log) {
  sheet
    .getProtections(SpreadsheetApp.ProtectionType.SHEET)
    .forEach((existing) => existing.remove())

  if (!layout.protect) return

  sheet.protect().setDescription(protectionNote).setWarningOnly(true)
  log.push(`シート「${layout.name}」に保護をかけた（警告のみ）`)
}

/** 新しいスプレッドシートに最初からある空のシートを消す。中身があれば残して名指しする。 */
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
