/**
 * 殻 — SpreadsheetApp に触る唯一の場所（docs/tech-requirements.md 6 の #8）。
 * シートを読んで表現を揃え、コア（core.js の build）を呼び、返った行を書く。
 * 割り当ては日ごとの 4 枚にマス目で載る。どの列が何時かはコアの側（assignment-grid.js）が決める。
 *
 * 規則をここに書かない。コアに SpreadsheetApp を持ち込まない（→ 6-1 の #2）。
 * 読み書きは範囲ごとに 1 回で、セル単位で往復しない（時間を食うのは往復である）。
 * 他のファイルの値をこのファイルの最上位で使わない（→ core.js の同じ注意）。
 */

/** 殻がコアに渡す値の表現。コアはこの形の文字列と数値しか受け取らない（→ core.js の checkRepresentation）。 */
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

/** コアに渡す入力を読む。名前は core.js の inputNames と同じ順で、値は表現を揃えた行の配列である。 */
function readInputs(spreadsheet) {
  return readInputsAndGrids(spreadsheet).inputs
}

/**
 * 入力と、読んだマス目 4 枚を返す。マス目は色を塗り直すときに読み直さずに使う（→ paintGrids）。
 *
 * forGeneration のときは「割り当て」を組まない。生成が読むのは手直しだけで、組むと営業時刻を動かした後の
 * 前の周の列で止まる（→ 5-3）。
 * catchMissed のときは、取りこぼした書き換えに印を付けてから積む（→ markMissedEdits）。画像の書き出しは渡さない。
 */
function readInputsAndGrids(spreadsheet, forGeneration, catchMissed) {
  const inputs = {}
  const grids = []

  sheetsToRead().forEach((name) => {
    const layout = findLayout(name)
    const sheet = findSheet(spreadsheet, name)
    // マス目の 4 枚は、条件入力を読んでからでないと列が何時かが決まらないので、後回しにする。
    if (layout.grid) {
      const grid = readGrid(sheet, layout)
      if (catchMissed) markMissedEdits(sheet, layout, grid)
      grids.push({ layout: layout, grid: grid })
      inputs[layout.grid.of] = inputs[layout.grid.of] || []
      inputs[layout.grid.fixed] = inputs[layout.grid.fixed] || []
      return
    }
    layout.sections.forEach((section) => {
      inputs[layout.hasSectionHeadings ? section.heading : name] = readSection(sheet, layout, section)
    })
  })

  putGridsIntoInputs(inputs, grids, forGeneration)
  return { inputs: inputs, grids: grids }
}

/**
 * 読んだマス目 4 枚を、入力に積む。
 *   割り当て … いま書いてあるとおり（forGeneration のときは積まない）
 *   手直し   … 担当者が書き換えたセル（印はセルのメモ → 5-3）
 * 4 枚とも空なら枠を刻まない。条件入力が空のテンプレートでも止めないためである。
 */
function putGridsIntoInputs(inputs, grids, forGeneration) {
  if (grids.length === 0) return
  const hasAnyRow = grids.some((one) => one.grid.rows.length > 0)
  const days = hasAnyRow ? toDays(inputs['日ごとの営業時刻'], '日ごとの営業時刻') : []

  grids.forEach((one) => {
    const day = days[one.layout.grid.dayIndex]
    const fixed = one.layout.grid.fixed
    inputs[fixed] = inputs[fixed].concat(
      fixedFromAssignmentGrid(one.grid.header, one.grid.rows, one.grid.notes, day, one.layout.name),
    )
    if (forGeneration) return
    const name = one.layout.grid.of
    inputs[name] = inputs[name].concat(fromAssignmentGrid(one.grid.header, one.grid.rows, day, one.layout.name))
  })
}

/**
 * マス目のシート 1 枚を読む。何時の枠かは見出しに書いてあるので、見出しの行も読む。
 * 手直しの印はメモなので、notes も rows と同じ形で読む（→ 5-3）。
 */
function readGrid(sheet, layout) {
  const section = layout.sections[0]
  const width = sectionWidth(section)
  const headerRows = headerRowCount(layout)
  const lastRow = sheet.getLastRow()

  const header = sheet.getRange(1, 1, 1, width).getValues()[0].map(normalizeValue)
  const data = lastRow > headerRows ? sheet.getRange(headerRows + 1, 1, lastRow - headerRows, width) : null
  const rows = data ? data.getValues().map((row) => row.map(normalizeValue)) : []
  const notes = data ? data.getNotes().map((row) => row.map((note) => String(note || ''))) : []

  while (rows.length > 0 && rows[rows.length - 1].every((cell) => cell === '')) rows.pop()
  return { header: header, rows: rows, notes: notes.slice(0, rows.length) }
}

/**
 * 区画 1 つぶんの行を読む。
 *
 * 区画は横に並ぶので、短い区画の下は空の行で埋まる。落とすのは下の空の行だけで、途中の空の行は残す
 * — 詰めると名指しの「N 行目」がずれる（→ input-types.js の whereIs）。
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
 * 生成シートに書き戻し、マス目と検証結果の色を塗り直す。
 *
 * 段が 1 つでも欠けていれば 1 枚も書かない。後ろの段の出力は空なので、上書きすると手直しが黙って消える（→ 5-3）。
 * gridsAsTheyAre を渡したとき（数え直し）は、担当者が書いたセルを上書きしないよう、マス目を書き戻さない。
 *
 * 返すのは塗ったマス目（{ layout, grid } の配列。書かなかったときは空）で、控えを置き直すのに使う。
 */
function writeOutputs(spreadsheet, output, context, gridsAsTheyAre) {
  if ((output.notBuilt || []).length > 0) return []
  const toGrid = context || { days: [], nameOf: null }
  let grids = []

  outputNames.forEach((name) => {
    // 割り当ては日ごとの 4 枚にマス目で敷く（→ writeGrids）。
    const layouts = gridLayouts(name)
    if (layouts.length > 0) {
      grids = gridsAsTheyAre || writeGrids(spreadsheet, layouts, output[name], toGrid, output['検証結果'])
      return
    }
    const layout = findLayout(name)
    const sheet = findSheet(spreadsheet, name)
    const columnCount = sectionWidth(layout.sections[0])
    const headerRows = headerRowCount(layout)
    const lastRow = sheet.getLastRow()

    if (lastRow > headerRows) {
      sheet.getRange(headerRows + 1, 1, lastRow - headerRows, columnCount).clearContent()
    }
    if (name === '検証結果') paintCheckResults(sheet, output[name], headerRows, columnCount)
    if (output[name].length === 0) return
    // 検証結果と指標は氏名を空で返すので、回答から埋める（→ issue #229）
    const rows = withNamesFromAnswers(output[name], name, (context || {}).nameOf)
    sheet.getRange(headerRows + 1, 1, rows.length, columnCount).setValues(rows)
  })

  paintGrids(spreadsheet, grids, output['検証結果'], toGrid.days)
  return grids
}

/** 違反した所の印（→ issue #155）。背景は役割の色に使っているので、文字を赤い太字にする。 */
const violationMark = { fontColor: '#cc0000', fontWeight: 'bold' }

/**
 * マス目の色を塗り直す — 背景は役割の色、違反した所は赤い太字である。1 枚につき 4 回まで。
 *   ① 書式を下の端（getMaxRows）まで消す（担当者が付けた色も消える）
 *   ② 役割の背景色を置く
 *   ③④ 違反したセルに、RangeList で文字の色と太さ
 */
function paintGrids(spreadsheet, grids, violations, days) {
  grids.forEach((one) => {
    const layout = one.layout
    const sheet = findSheet(spreadsheet, layout.name)
    const width = sectionWidth(layout.sections[0])
    const headerRows = headerRowCount(layout)
    const maxRows = sheet.getMaxRows()
    if (maxRows <= headerRows) return

    sheet.getRange(headerRows + 1, 1, maxRows - headerRows, width).clearFormat()
    if (one.grid.rows.length > 0) {
      sheet.getRange(headerRows + 1, 1, one.grid.rows.length, width).setBackgrounds(gridBackgrounds(one.grid.rows, width))
    }
    const cells = violationCells(one.grid.header, one.grid.rows, days[layout.grid.dayIndex], violations)
    if (cells.length === 0) return
    const marked = sheet.getRangeList(cells.map((cell) => a1Notation(headerRows + 1 + cell.row, cell.column + 1)))
    marked.setFontColor(violationMark.fontColor)
    marked.setFontWeight(violationMark.fontWeight)
  })
}

/**
 * 検証結果の行の背景を、下の端（getMaxRows）まで 1 回で置き直す — 違反の行が赤、店の役割の行が黄色（→ issue #220）。
 * clearFormat は使わない。数値や日付の書式まで消え、値の見え方が変わる。
 */
function paintCheckResults(sheet, rows, headerRows, width) {
  const height = Math.max(sheet.getMaxRows() - headerRows, rows.length)
  if (height <= 0) return
  const colors = checkResultBackgrounds(rows, width)
  while (colors.length < height) colors.push(new Array(width).fill(null))
  sheet.getRange(headerRows + 1, 1, height, width).setBackgrounds(colors)
}

/** 行と列の番号（1 始まり）を A1 の書き方にする。RangeList は A1 の書き方でしか受けない。 */
function a1Notation(row, column) {
  let letters = ''
  let rest = column
  while (rest > 0) {
    const digit = (rest - 1) % 26
    letters = String.fromCharCode(65 + digit) + letters
    rest = Math.floor((rest - 1) / 26)
  }
  return `${letters}${row}`
}

/**
 * 検証結果と指標の空の氏名を回答から埋める（コアは氏名を見ない → 5 の #1 ／ issue #229）。
 * 学籍番号が空の行（未充足）は空のまま。コアの出力は書き換えず、新しい配列を返す。
 * 検証結果の「候補」も、コアが並べた学籍番号を氏名に置き換える（→ issue #246）。
 * 回答に氏名が無い人だけは、学籍番号のまま残す — 消すと、入れられる人が 1 人減って見える。
 */
function withNamesFromAnswers(rows, name, nameOf) {
  if (!nameOf) return rows
  const columns = outputColumns(name)
  const studentIdColumn = columns.indexOf('学籍番号')
  const nameColumn = columns.indexOf('氏名')
  const candidateColumn = columns.indexOf('候補')
  return rows.map((row) => {
    const filled = row.slice()
    if (filled[nameColumn] === '') filled[nameColumn] = nameOf(row[studentIdColumn])
    if (candidateColumn !== -1 && row[candidateColumn] !== '') {
      filled[candidateColumn] = String(row[candidateColumn])
        .split(candidateSeparator)
        .map((studentId) => nameOf(studentId) || studentId)
        .join(candidateSeparator)
    }
    return filled
  })
}

/**
 * 割り当てを、日ごとの 4 枚のマス目に敷く。
 *
 * 見出しの時刻も毎回書き直す。前の周の列が残ると、次に読むとき「いまの枠に無い見出し」になる。
 * メモも一度ぜんぶ消して付け直す。人が増えると行がずれ、印が別の人のセルに移るためである（→ 5-3）。
 * 置けなかった手直しには、何が食い違ったかのメモが付く。
 *
 * 返すのは敷いたマス目（{ layout, grid } の配列）で、色を塗り直すのに使う。
 */
function writeGrids(spreadsheet, grids, assignments, context, checks) {
  return grids.map((layout) => {
    const sheet = findSheet(spreadsheet, layout.name)
    const section = layout.sections[0]
    const namedCount = section.columns.length
    const width = sectionWidth(section)
    const headerRows = headerRowCount(layout)
    const lastRow = sheet.getLastRow()
    const day = context.days[layout.grid.dayIndex]
    const fixed = context.fixed || []
    const at = (row, name) => row[fixedColumns.indexOf(name)]
    // 印か名指しを載せる先がある人だけ行を残す。いまの枠に無い見出しの空のセルは載せない。
    const fixedToday = day
      ? fixed
        .filter((row) => at(row, '日') === day.date)
        .filter((row) => at(row, '役割') !== '' || day.slots.some((slot) => slot.start === at(row, '開始')))
        .map((row) => at(row, '学籍番号'))
      : []
    const grid = toAssignmentGrid(assignments, day, context.nameOf, fixedToday, context.friendsOf)

    if (grid.header.length > width) {
      throw new Error(
        `シート「${layout.name}」に ${grid.header.length - namedCount} 枠を敷こうとしたが、`
          + `時刻の列は ${width - namedCount} 列しかない`,
      )
    }

    sheet.getRange(1, namedCount + 1, 1, width - namedCount).clearContent()
    if (lastRow > headerRows) sheet.getRange(headerRows + 1, 1, lastRow - headerRows, width).clearContent()
    // メモは値の無い行にも残るので、下の端（getMaxRows）まで消す。
    const maxRows = sheet.getMaxRows()
    if (maxRows > headerRows) sheet.getRange(headerRows + 1, 1, maxRows - headerRows, width).clearNote()

    // 時刻の見出しは左に寄せる。既定の右寄せだと右隣の列の頭に見える。
    sheet.getRange(1, namedCount + 1, 1, width - namedCount).setHorizontalAlignment('left')

    if (grid.header.length > namedCount) {
      sheet
        .getRange(1, namedCount + 1, 1, grid.header.length - namedCount)
        .setValues([grid.header.slice(namedCount)])
    }
    if (grid.rows.length > 0) {
      const written = sheet.getRange(headerRows + 1, 1, grid.rows.length, grid.header.length)
      written.setValues(grid.rows)
      written.setNotes(gridNotes(grid, day, fixed, checks))
    }
    return { layout: layout, grid: grid }
  })
}

/**
 * メニューの「生成」から呼ぶ入口（→ menu.js の runGeneration）。SpreadsheetApp を名指しするのはこの 1 行だけである。
 * steps を渡さなければ、中身が入っている段だけが走る。
 */
function runOnActiveSpreadsheet(steps) {
  return run(SpreadsheetApp.getActive(), steps)
}

/**
 * 構造を確かめる → 読む → コアを呼ぶ → 書く。スプレッドシートは、検査で偽物を渡せるよう引数で受ける。
 * 返すのはコアの出力の束（割り当て・検証結果・指標・notBuilt）で、担当者に何と言うかは呼ぶ側が決める。
 * 構造が崩れていれば、1 行も読まずに例外で止まる（→ verify-structure.js）。
 */
function run(spreadsheet, steps) {
  checkStructure(spreadsheet)
  const read = readInputsAndGrids(spreadsheet, true, true)
  const output = build(read.inputs, steps)
  const written = writeOutputs(spreadsheet, output, gridContext(read.inputs))
  keepSeenGrids(spreadsheet, written.length > 0 ? written : read.grids)
  return output
}

/**
 * 手直しの後に数え直す（→ 5 の #8 ／ issue #155）。run と違い、生成を走らせず、マス目を書き戻さない
 * — マス目は担当者が書いたセルそのものである。
 */
function recountSpreadsheet(spreadsheet) {
  checkStructure(spreadsheet)
  const read = readInputsAndGrids(spreadsheet, false, true)
  const output = recount(read.inputs)
  writeOutputs(spreadsheet, output, gridContext(read.inputs), read.grids)
  keepSeenGrids(spreadsheet, read.grids)
  return output
}

/**
 * 配る画像の中身を組む（→ 5 の #9 ／ issue #157）。いまのマス目のとおりに描き、何も書かない。
 * 返すのはダイアログに渡す値である（→ export-images.html）。
 */
function distributionImagesOn(spreadsheet) {
  checkStructure(spreadsheet)
  const read = readInputsAndGrids(spreadsheet)
  return distributionImages(read.grids, gridContext(read.inputs).days)
}

/**
 * セルが書き換えられたときに呼ばれる口（→ menu.js の onEdit）。返すのは担当者に見せる一言である。
 *
 * 数え直すのはマス目の 4 枚のときだけ。条件入力は書きかけで型に乗らないことが普通にあるので数え直さない。
 * 単純トリガーの例外は担当者の画面に出ないので、止まった理由は捕まえて一言にして返す。
 * 数え直す前に、書き換えたセルに手直しの印を付ける（効くのは次の「生成」→ markFixedCells）。
 */
function recountOnEdit(event) {
  if (!event || !event.range || !event.source) return null
  const edited = event.range.getSheet().getName()
  if (!gridLayouts(assignmentName).some((layout) => layout.name === edited)) return null

  try {
    markFixedCells(event.range)
    const output = recountSpreadsheet(event.source)
    const kinds = output['検証結果'].map((row) => row[outputColumns('検証結果').indexOf('種別')])
    const violations = kinds.filter((kind) => kind === checkKind.violation).length
    const unmet = kinds.filter((kind) => kind === checkKind.unmet).length
    return {
      text: `数え直した — 違反 ${violations} 件 ／ 未充足 ${unmet} 件`
        + `（違反した所は${violations === 0 ? '無い' : 'マス目の色で出ている'}）`,
      seconds: 5,
    }
  } catch (error) {
    return {
      text: `数え直せなかった（検証結果と指標は前のまま）— ${error.message}`,
      seconds: 30,
    }
  }
}

/**
 * 担当者が書き換えたセルに、手直しの印（メモ）を付ける（→ 5-3 ／ issue #156）。返すのは付けたセルの数である。
 *
 * 付けるのは時刻の列のデータの行だけ。空にしたセルにも付ける（「この枠に置かない」という手直し）。
 * 学籍番号を書き換えた行は、行の持ち主を替えたので、役割の入っているセルぜんぶに付ける。
 */
function markFixedCells(range) {
  const sheet = range.getSheet()
  const layout = gridLayouts(assignmentName).filter((one) => one.name === sheet.getName())[0]
  if (!layout) return 0
  const section = layout.sections[0]
  const namedCount = section.columns.length
  const width = sectionWidth(section)
  const top = Math.max(range.getRow(), headerRowCount(layout) + 1)
  const bottom = range.getLastRow()
  if (bottom < top) return 0

  let marked = 0
  const left = Math.max(range.getColumn(), namedCount + 1)
  const right = Math.min(range.getLastColumn(), width)
  if (right >= left) {
    const notes = []
    for (let row = top; row <= bottom; row++) notes.push(new Array(right - left + 1).fill(fixedNote))
    sheet.getRange(top, left, bottom - top + 1, right - left + 1).setNotes(notes)
    marked += (bottom - top + 1) * (right - left + 1)
  }

  const studentIdColumn = section.columns.indexOf('学籍番号') + 1
  if (range.getColumn() > studentIdColumn || range.getLastColumn() < studentIdColumn) return marked
  const slots = sheet.getRange(top, namedCount + 1, bottom - top + 1, width - namedCount)
  const values = slots.getValues()
  const before = slots.getNotes()
  const after = values.map((row, rowIndex) => row.map((cell, column) => {
    if (normalizeValue(cell) === '' || isFixedNote(before[rowIndex][column])) return before[rowIndex][column]
    marked += 1
    return fixedNote
  }))
  slots.setNotes(after)
  return marked
}

/**
 * 取りこぼした書き換えに、手直しの印を付ける（→ issue #226）。返すのは付けたセルの数である。
 *
 * 間を置かずに 2 セル書き換えると onEdit が 1 回しか走らないので、次に読んだとき、前に見た控えと違うセルへ付ける。
 * 生成はこの後で grid.notes から手直しを組むので、grid.notes も書き換える。
 * 書くのは行ごとに印の左端から右端までだけ。範囲ぜんぶを書き戻すと、その間に onEdit が付けた印を消す。
 */
function markMissedEdits(sheet, layout, grid) {
  const missed = missedEdits(readSeenGrid(sheet), grid.header, grid.rows, grid.notes)
  if (missed.length === 0) return 0
  const headerRows = headerRowCount(layout)
  const byRow = {}
  missed.forEach((cell) => {
    grid.notes[cell.row][cell.column] = fixedNote
    byRow[cell.row] = byRow[cell.row] || []
    byRow[cell.row].push(cell.column)
  })
  Object.keys(byRow).forEach((key) => {
    const row = Number(key)
    const left = Math.min.apply(null, byRow[key])
    const right = Math.max.apply(null, byRow[key])
    sheet.getRange(headerRows + 1 + row, left + 1, 1, right - left + 1).setNotes([grid.notes[row].slice(left, right + 1)])
  })
  return missed.length
}

/**
 * 前に見たマス目の控えを置く鍵。置き場はマス目のシートの developer metadata で、担当者には見えない
 * （手直しの印はメモのほうである）。スコープは spreadsheets.currentonly の中で増えない。
 */
const seenGridKey = 'seenGrid'

/** 控えを読む。無い・読めないときは null を返し、止めない（取りこぼしを拾わないだけである）。 */
function readSeenGrid(sheet) {
  try {
    const found = sheet.getDeveloperMetadata().filter((one) => one.getKey() === seenGridKey)
    return found.length > 0 ? JSON.parse(found[0].getValue()) : null
  } catch (error) {
    return null
  }
}

/**
 * 控えを置き直す。置けないとき（文字数の上限など）は前の控えを外す
 * — 古い控えが残ると、機械が置いたセルを取りこぼした書き換えと取り違える。
 */
function keepSeenGrid(sheet, seen) {
  let found = []
  try {
    found = sheet.getDeveloperMetadata().filter((one) => one.getKey() === seenGridKey)
    if (!seen) throw new Error('控えを組めない')
    const value = JSON.stringify(seen)
    if (found.length > 0) found[0].setValue(value)
    else sheet.addDeveloperMetadata(seenGridKey, value)
    found.slice(1).forEach((one) => one.remove())
  } catch (error) {
    found.forEach((one) => {
      try { one.remove() } catch (ignored) { /* 外せなくても止めない */ }
    })
  }
}

/** 塗ったマス目 4 枚の控えを置き直す（→ run ／ recountSpreadsheet）。 */
function keepSeenGrids(spreadsheet, grids) {
  grids.forEach((one) => keepSeenGrid(findSheet(spreadsheet, one.layout.name), seenGrid(one.grid.header, one.grid.rows)))
}

/**
 * マス目を敷くのに要る 4 つ — その日の枠、学籍番号から引く氏名・友達欄、担当者の手直しである。
 * 氏名と友達欄は回答から引く。生成はどちらも見ない（→ 5 の #1 ／ issue #200）。
 */
function gridContext(inputs) {
  return {
    days: toDays(inputs['日ごとの営業時刻'], '日ごとの営業時刻'),
    nameOf: namesFromAnswers(inputs['回答']),
    friendsOf: friendsFromAnswers(inputs['回答']),
    fixed: inputs[fixedName] || [],
  }
}

/**
 * セル 1 つの表現を揃える。コアに表現の揺れを入れないための関門である。
 * 文字列は両端の空白を落とすだけで、中身には手を入れない。
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
 * 時刻だけのセルは 1899-12-30 を土台にした Date で返るので、年で見分ける。ちょうど 00:00:00 は日付になる。
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

/** スプレッドシートから 1 枚を引く。無ければ名指しで止まる（黙って作らない）。 */
function findSheet(spreadsheet, name) {
  const sheet = spreadsheet.getSheetByName(name)
  if (!sheet) {
    throw new Error(
      `シート「${name}」が無い。テンプレートを組み立て直す`,
    )
  }
  return sheet
}

// Node から読むためだけの口。Apps Script では module が無いので通らない。
if (typeof module !== 'undefined') {
  module.exports = {
    valueRepresentation, sheetsToRead, headerRowCount, readInputs, readInputsAndGrids, readSection, readGrid,
    putGridsIntoInputs, writeOutputs, withNamesFromAnswers, writeGrids, violationMark, paintGrids, paintCheckResults,
    a1Notation, run, runOnActiveSpreadsheet, recountSpreadsheet, distributionImagesOn, recountOnEdit, markFixedCells, gridContext,
    normalizeValue, formatDateTime, findLayout, findSheet,
  }
}
