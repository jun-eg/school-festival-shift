/**
 * 走る前の構造の検証 — シートの有無・見出し・列数を照らす（docs/tech-requirements.md 2 の「止まる箇所」#8）。
 * シートの保護（build-template.js）は持ち主を締め出せず、「警告のみ」は押し切れるので、こちらでも止める。
 *
 * 崩れていたら、崩れている箇所を全部名指しして止まる。セルは 1 つも書き換えない（読むだけ）。
 * 見るのは見出しの行だけである（データの行は担当者が増減させるのが仕様）。
 * 「回答」の後ろ 4 列（希望時間）は列名が毎年変わるので、位置だけを当てる。
 *
 * スプレッドシートは引数で受ける。他のファイルの値をこのファイルの最上位で使わない（→ core.js の同じ注意）。
 */

/** 崩れの種類（→ breakageToText）。 */
const breakageKind = {
  missingSheet: 'シートが無い',
  tooFewColumns: '列が足りない',
  headingMismatch: '見出しが違う',
  unknownColumn: '構成に無い列',
}

/**
 * 崩れている箇所を全部名指しして返す（崩れていなければ空の配列）。
 * 最初の 1 件で切り上げない — 一度に出したほうが直す手数が少ない。読むのはシートごとに 1 回である。
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

/** 走る前に構造を確かめる。崩れていれば全部名指しして止まり、崩れていなければ空の配列を返す。 */
function checkStructure(spreadsheet) {
  const breakages = nameBreakages(spreadsheet)
  if (breakages.length === 0) return breakages

  // 黙って直さない。生成・書き換え後の数え直し・画像の書き出しのどれからも呼ばれるので、「生成」とは言わない。
  throw new Error(
    `シートの見出しや列が ${breakages.length} か所変わっているため、処理できません。`
      + '元に戻すか、テンプレートをコピーし直して条件を入れ直してください。\n'
      + breakages.map(breakageToText).join('\n'),
  )
}

/** 崩れ 1 つを、場所を名指しした 1 行にする。 */
function breakageToText(breakage) {
  if (breakage.kind === breakageKind.missingSheet) {
    return `シート「${breakage.sheet}」が見つかりません`
  }
  if (breakage.kind === breakageKind.tooFewColumns) {
    return `シート「${breakage.sheet}」の列が ${breakage.actual[0]} 列しかありません（本来は ${breakage.expected[0]} 列です）`
  }
  const where = `「${breakage.sheet}」の ${breakage.row} 行目 ${breakage.column} 列目`
  if (breakage.kind === breakageKind.unknownColumn) {
    return `${where} に、本来ない「${breakage.actual[0]}」があります`
  }
  const width = breakage.expected.length > 1 ? `から ${breakage.expected.length} 列` : ''
  return `${where}${width} が本来と違います。`
    + `今: ${breakage.actual.map(showBlank).join(' / ')} ／ 本来: ${breakage.expected.join(' / ')}`
}

/** シートの列が構成の要る数だけあるかを見る（列をまとめて消されたとき、範囲外の例外より先に名指しする）。 */
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
 * 見出しの行だけを 1 回で読む。挿された列を見るため、区画の右端より右も中身があるところまで読む。
 * 読む範囲はシートの外に出さない（出すと範囲外の例外になる）。
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

/** 区画ごとに、見出しのセルと列名の並び（section.columns）を突き合わせ、違えば 1 件にまとめて名指しする。 */
function checkSections(layout, headerRows, breakages) {
  const columnNameRow = headerRowCount(layout)

  layout.sections.forEach((section) => {
    if (layout.hasSectionHeadings) {
      checkRange(layout, headerRows, 1, section.startColumn, [section.heading], breakages)
    }
    checkRange(layout, headerRows, columnNameRow, section.startColumn, section.columns, breakages)
  })
}

/** 1 行の中の 1 続きの範囲を突き合わせる。違えば 1 件だけ積む。 */
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

/** 見出しの行のうち、どの区画にも入らない列（区画のあいだ・右端より右）に中身があれば名指しする。 */
function checkUnknownColumns(layout, headerRows, breakages) {
  // 名前が input-types.js の conditionSection と別なのは、.gs が 1 つのグローバルを共有するからである
  const usedColumns = {}
  layout.sections.forEach((section) => {
    for (let i = 0; i < sectionWidth(section); i++) usedColumns[section.startColumn + i] = true
  })

  headerRows.forEach((rowValues, i) => {
    rowValues.forEach((cell, j) => {
      if (cell === '' || usedColumns[j + 1]) return
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

/** 読んだ見出しの行から 1 セル取る。読んだ範囲の外は空として扱う。 */
function cellAt(headerRows, row, column) {
  const rowValues = headerRows[row - 1] || []
  return column <= rowValues.length ? rowValues[column - 1] : ''
}

/** 空のセルを文の中で見えるようにする。 */
function showBlank(value) {
  return value === '' ? '（空）' : value
}

// Node から読むためだけの口。Apps Script では module が無いので通らない。
if (typeof module !== 'undefined') {
  module.exports = { breakageKind, nameBreakages, checkStructure, breakageToText }
}
