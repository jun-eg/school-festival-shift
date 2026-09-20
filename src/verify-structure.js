/**
 * 走る前の構造の検証 — シートの有無・見出し・列数を照らす
 * （docs/tech-requirements.md 2 の「止まる箇所」#8 ／ issue #138）。
 *
 * #8 の予防は 2 つあり、これはそのもう片方である。
 * 片方（生成シートに保護をかける）は build-template.js が持つが、
 * かかり方は「警告のみ」で、押し切れば書ける（→ src/README.md「保護は『警告のみ』である」）。
 *
 * 壊れうるのは行の削除・列の挿入・生成シートの上書きで、
 * 担当者から見ると「触っていい操作」と見分けが付かない
 * — 手直しの画面がスプレッドシートそのもの（→ 6 の #2）で、
 * セルを書き換えることが仕様だからである（→ 5-3）。
 *
 * 崩れていたら、崩れている箇所を全部名指しして止まる。
 *   黙って直さない — セルを 1 つも書き換えない。読むだけである
 *   黙って走らない — 読む前に止まるので、生成は 1 行も動かない
 * 「満たせない枠は黙って埋めない」（→ 5 の #6）と同じ扱いである。
 *
 * 直し方はここが決めない。テンプレートをもう 1 回コピーして条件を入れ直す
 * （→ 6 の #1 の理由 ⑤・src/README.md の「テンプレートの作り方」）。
 *
 * 見るのは見出しの行だけである。データの行は見ない — 条件入力と割り当ては担当者が書く所で、
 * 行が増えたり減ったりするのが仕様である（→ 5-1・5-3）。
 * 列数は見出しの行で見る（区画の右端より右や、区画のあいだに中身があれば名指しする）。
 *
 * スプレッドシートは引数で受ける。SpreadsheetApp を名指しするのは shell.js の 1 行だけである。
 * 他のファイルの値をこのファイルの最上位で使わない（→ core.js の同じ注意）。
 */

/** 崩れの種類。文にするときの形が種類ごとに違う（→ breakageToText）。 */
const breakageKind = {
  missingSheet: 'シートが無い',
  tooFewColumns: '列が足りない',
  headingMismatch: '見出しが違う',
  unknownColumn: '構成に無い列',
}

/**
 * 崩れている箇所を全部名指しして返す（崩れていなければ空の配列）。
 *
 * 最初の 1 件で切り上げない。担当者が直すのはスプレッドシートの上なので、
 * 1 箇所ずつ走らせ直させるより、いま崩れている所を一度に出したほうが手数が少ない。
 * 読むのはシートごとに 1 回である。セル単位で往復しない（→ 6 の #2 の実装上の注意）。
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
 * 走る前に構造を確かめる。崩れていれば、崩れている箇所を全部名指しして止まる。
 * 崩れていなければ空の配列を返す（分岐させるためではなく、0 箇所であることを見せるためである）。
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

/** 崩れ 1 つを、場所を名指しした 1 行にする。担当者が読むのはこの行である。 */
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
 * シートの列が、構成の要る数だけあるかを見る。
 * 列をまとめて消されると、読む前にここで名指しになる
 * （読む範囲をシートの外に取ると、名指しの代わりに範囲外の例外が出てしまう）。
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
 * 見出しの行だけを 1 回で読む。区画の右端より右も、中身があるところまで読む（挿された列を見るため）。
 * 読む範囲をシートの外に出さない — 出すと、名指しの代わりに範囲外の例外が出てしまう。
 * 消された側は空として突き合わせるので、名指しは checkSections から出る。
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

/** 区画ごとに、見出しのセルと列名の並びを突き合わせる。並びは 1 件にまとめて名指しする。 */
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

/**
 * 見出しの行のうち、どの区画にも入らない列に中身があれば名指しする。
 *
 * 見るのは区画のあいだ（条件入力は 5 区画が横に並ぶ）と、区画の右端より右である。
 * 列を 1 つ挿すと、右へずれた見出しがここに落ちてくる。
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

/** 区画の右端の列。構成が要る列数である。 */
function sectionRightEdge(layout) {
  return layout.sections.reduce((rightEdge, section) => Math.max(rightEdge, section.startColumn + section.columns.length - 1), 0)
}

/** 読んだ見出しの行から 1 セル取る。読んだ範囲の外は空として扱う（列を消された側である）。 */
function cellAt(headerRows, row, column) {
  const rowValues = headerRows[row - 1] || []
  return column <= rowValues.length ? rowValues[column - 1] : ''
}

/** 空のセルは、文の中で見えないと場所が読めない。 */
function showBlank(value) {
  return value === '' ? '（空）' : value
}

// Node から読むためだけの口。Apps Script では module が無いので通らない。
if (typeof module !== 'undefined') {
  module.exports = { breakageKind, nameBreakages, checkStructure, breakageToText, sectionRightEdge }
}
