/**
 * テンプレートを 1 つ作る（docs/tech-requirements.md 8 の 1）。
 *
 * 走らせるのはテンプレートを用意する側（実装者）である。1 回だけ走らせて、
 * 出来上がったスプレッドシートを担当者にコピーさせる。
 * 担当者のメニュー（menu.js）には出さない — 担当者の操作は
 * 2「担当者がやることの全部」の 10 行だけで、そこにこの操作は無い。
 *
 * 黙って直さない。黙って走らない。
 * すでにあるシートの見出しが構成と違えば、名指しで止まる（上書きしない）。
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
 * 名前が buildTemplate と別なのは、コアの build と重ならないようにするためである
 * （Apps Script は .gs で 1 つのグローバルを共有する）。
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

/**
 * 区画ごとに、見出しの行と列名の行を置く。中身が違うときは上書きせずに止まる。
 *
 * 置くのは構成が名前を持っている列だけである。「回答」の後ろ 4 列は空のままになる
 * — 列名は設問の題そのもので、題は今年の入力から出る（→ 4-1）。テンプレートを作る時点では
 * まだ決まっていない。この 4 列が埋まるのは、フォームを作ったときである
 * （テンプレートの「回答」はそこで捨てられ、フォームが作ったシートに置き換わる → build-form.js）。
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

/**
 * 生成シートに保護をかける。
 * 保護は「警告のみ」である — コピーしたファイルの持ち主は担当者自身で、
 * 持ち主を締め出せる保護は Google スプレッドシートに無い（→ src/README.md）。
 */
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
