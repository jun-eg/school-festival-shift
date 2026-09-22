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
 * sheetLayout どおりにシートを作り、見出しを置き、8 枚に保護をかける。
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
  const countOf = (kind) => sheetLayout.filter((c) => c.protect && c.protect.kind === kind).length
  log.push(
    `${sheetLayout.length} 枚のうち保護したのは ${sheetLayout.filter((c) => c.protect).length} 枚である`
    + `（${protectionKind.warningOnly} ${countOf(protectionKind.warningOnly)} 枚 ／ ${protectionKind.ownerOnly} ${countOf(protectionKind.ownerOnly)} 枚。`
    + `割り当ては日ごとの ${gridLayouts(assignmentName).length} 枚である → issue #213）`,
  )
  return log
}

/**
 * 構成が要る列数まで、シートを広げる。
 *
 * 新しいシートは 26 列しかないが、マス目の 4 枚は 51 列を取る（名前のある 3 列 ＋ 時刻の列 → sheet-layout.js の maxSlotsPerDay）。
 * 足りないまま置くと、走る前の検証が「列が足りない」で止まる（→ verify-structure.js）。
 * 減らさない — 余分な列があること自体は、構造の崩れではない。
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
 * シートに保護をかける。かけ方は構成が持つ 2 つのどちらかである（→ sheet-layout.js の protectionKind）。
 *
 * 持ち主を締め出せる保護は Google スプレッドシートに無い — コピーしたファイルの持ち主は担当者自身である
 * （→ src/README.md）。だから誰も手で書かないシートは「警告のみ」にして、持ち主にも確認を出す。
 * 「持ち主だけ」は編集者を全部外す。持ち主と、走らせている人は外れない（Protection.removeEditors の決まりである）。
 */
function applyProtection(sheet, layout, log) {
  sheet
    .getProtections(SpreadsheetApp.ProtectionType.SHEET)
    .forEach((existing) => existing.remove())

  if (!layout.protect) return

  const protection = sheet.protect().setDescription(layout.protect.note)
  if (layout.protect.kind === protectionKind.ownerOnly) {
    protection.removeEditors(protection.getEditors())
    if (protection.canDomainEdit()) protection.setDomainEdit(false)
  } else {
    protection.setWarningOnly(true)
  }
  if (layout.protect.openInputs) protection.setUnprotectedRanges(inputRanges(sheet, layout))
  log.push(
    `シート「${layout.name}」に保護をかけた（${layout.protect.kind}`
    + `${layout.protect.openInputs ? `。区画 ${layout.sections.length} つの入力欄は外した` : ''}）`,
  )
}

/**
 * 保護の外に出す入力欄 — 区画ごとに、列名の行の下からシートの最下行まで、区画の幅だけである。
 * 見出し・列名・区画のあいだの列・右端より右は保護の内に残る（→ verify-structure.js が見る所である）。
 * 最下行より下に行を足すと、足した行は保護の内になる（警告が出るだけで、書ける）。
 */
function inputRanges(sheet, layout) {
  const firstInputRow = (layout.hasSectionHeadings ? 2 : 1) + 1
  const rowCount = sheet.getMaxRows() - firstInputRow + 1
  return layout.sections.map((section) => sheet.getRange(firstInputRow, section.startColumn, rowCount, sectionWidth(section)))
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
