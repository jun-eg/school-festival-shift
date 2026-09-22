/**
 * 殻 — SpreadsheetApp に触る唯一の場所（docs/tech-requirements.md 6 の #8）。
 *
 * やることは 3 つだけである。
 *   ① シートを読んで、値の表現を揃えてコアに渡す
 *   ② コア（core.js の build）を呼ぶ
 *   ③ 返ってきた行を生成シートに書く
 *
 * 割り当てだけは、シート 1 枚と 1 対 1 でない。日ごとの 4 枚にマス目で載る
 * （→ sheet-layout.js の dayLabels ／ issue #213）。敷き方と戻し方は assignment-grid.js が持つ
 * — 殻がやるのは範囲を決めて読み書きすることだけで、どの列が何時かはコアの側が決める。
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
  return readInputsAndGrids(spreadsheet).inputs
}

/**
 * 入力と、読んだマス目 4 枚をいっしょに返す。
 * マス目も返すのは、色を塗り直すときに、担当者のシートの何行目が誰かを読み直さずに済ませるためである
 * （→ paintGrids ／ 6 の #2 の実装上の注意）。
 *
 * forGeneration のときは、マス目から「割り当て」を組まない（空で渡す）。生成が読むのは手直しだけだからである
 * （→ core.js の build ／ 5-3）。組むと、条件入力の営業時刻を動かした後の前の周の列（いまの枠に無い見出し）で、
 * 機械が置いただけのセルのために止まる。手直しの側は止まらずに名指しで返る（→ generate.js の placeFixed）。
 */
function readInputsAndGrids(spreadsheet, forGeneration) {
  const inputs = {}
  const grids = []

  sheetsToRead().forEach((name) => {
    const layout = findLayout(name)
    const sheet = findSheet(spreadsheet, name)
    // マス目の 4 枚は、条件入力を読んでからでないと列が何時かが決まらないので、後回しにする。
    if (layout.grid) {
      grids.push({ layout: layout, grid: readGrid(sheet, layout) })
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
 * 読んだマス目 4 枚を、入力に積む。積む先は 2 つある（→ core.js の inputNames）。
 *   割り当て … いま書いてあるとおり（手直しの後の数え直しが読む → assignment-grid.js の fromAssignmentGrid）
 *   手直し   … 担当者が書き換えたセルだけ（印はセルのメモ → assignment-grid.js の fixedFromAssignmentGrid ／ 5-3）
 * forGeneration のときは、割り当てを積まない（→ readInputsAndGrids の注意）。
 *
 * どの列が何時かは、条件入力の「日ごとの営業時刻」から刻んだ枠で決まる（→ 規則 1 の ①）。
 * 4 枚とも空なら、枠を刻まずに済ませる — 条件入力がまだ空のテンプレートでも、
 * ここで止まらないようにするためである（型の名指しは、コアの入口が出す → input-types.js）。
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
 * マス目のシート 1 枚を、見出しの行とデータの行に分けて読む。
 *
 * 見出しの行も読むのが、区画を読むのと違うところである — 何時の枠かは見出しに書いてある。
 * 読む幅は区画の幅（名前のある 2 列 ＋ 時刻の 48 列 → sheet-layout.js の maxSlotsPerDay）で、
 * 列がそれだけあることは走る前に確かめてある（→ verify-structure.js の checkColumnCount）。
 *
 * セルのメモも同じ範囲で読む。手直しの印はメモである（→ assignment-grid.js の fixedNote ／ 5-3）。
 * notes は rows と同じ行数・同じ幅で並ぶ。
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
 * 読む幅は区画の幅である（→ sheet-layout.js の sectionWidth）。「回答」の後ろ 4 列のように
 * 構成が名前を持たない列も、位置は取ってあるので同じだけ読む（→ 4-1・input-types.js）。
 *
 * 下の空の行を落とすのは、条件入力の 6 区画を横に並べてある（→ src/README.md）からである。
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
 *
 * gridsAsTheyAre を渡したときは、マス目を書き戻さない（手直しの後の数え直し → recountSpreadsheet）。
 * 担当者が書いたセルそのものなので、書き戻すと表現を揃えた値で上書きすることになる。
 * 書き戻すときは、手直しの印（メモ）も付け直す（→ writeGrids）。
 * どちらのときも、最後にマス目の色を塗り直す — 背景は役割の色、違反した所は赤い太字である（→ paintGrids ／ 6 の #2）。
 */
function writeOutputs(spreadsheet, output, context, gridsAsTheyAre) {
  if ((output.notBuilt || []).length > 0) return
  const toGrid = context || { days: [], nameOf: null }
  let grids = []

  outputNames.forEach((name) => {
    // 割り当てはシート 1 枚でない。日ごとの 4 枚にマス目で敷く（→ writeGrids ／ issue #213）。
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
    if (output[name].length === 0) return
    const rows = name === '指標' ? withNamesFromAnswers(output[name], name, (context || {}).nameOf) : output[name]
    sheet.getRange(headerRows + 1, 1, rows.length, columnCount).setValues(rows)
  })

  paintGrids(spreadsheet, grids, output['検証結果'], toGrid.days)
}

/**
 * 違反した所の印（→ 6 の #2「違反した所はセルの色と検証結果シートに出る」／ issue #155）。
 * 文字を赤い太字にする。背景は役割の色に使っている（→ assignment-grid.js の roleColors）ので、
 * 同じ背景に 2 つの意味を重ねない。
 */
const violationMark = { fontColor: '#cc0000', fontWeight: 'bold' }

/**
 * マス目の色を塗り直す — 背景は役割の色、違反した所は赤い太字である。
 *
 * 1 枚につき 4 回までで済ませる（セル単位で往復しない → 6 の #2 の実装上の注意）。
 *   ① データの行ぜんぶの書式を 1 回で消す（下の端 getMaxRows まで。行が減っても前の色が残らない）
 *   ② 役割の背景色を、データの行の幅で 1 回で置く
 *   ③④ 違反したセルを RangeList でまとめて、文字の色と太さを 1 回ずつ
 * 書式を消すので、担当者が自分で付けた色や太字も消える（→ src/README.md の「違反した所は、セルの色で出る」）。
 * どの色か・どのセルかはコアの側が決める（→ assignment-grid.js の gridBackgrounds ／ violationCells）。
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
 * 指標の氏名を回答から埋める（→ issue #154）。マス目の氏名と同じ手である（→ writeGrids・namesFromAnswers）。
 * コアは氏名を 1 度も見ない（型 #6 に氏名は無い → 5 の #1）ので、指標の段が返す行の氏名は空である。
 * 空でない氏名は上書きしない。返す行は新しい配列で、コアの出力を書き換えない。
 */
function withNamesFromAnswers(rows, name, nameOf) {
  if (!nameOf) return rows
  const columns = outputColumns(name)
  const studentIdColumn = columns.indexOf('学籍番号')
  const nameColumn = columns.indexOf('氏名')
  return rows.map((row) => {
    if (row[nameColumn] !== '') return row
    const filled = row.slice()
    filled[nameColumn] = nameOf(row[studentIdColumn])
    return filled
  })
}

/**
 * 割り当てを、日ごとの 4 枚のマス目に敷く。
 *
 * 見出しの時刻も毎回書き直す — 枠は条件入力から刻むので、営業時刻を動かせば列も変わる。
 * 前の周の列が残ると、次に読むときに「いまの枠に無い見出し」として名指しになる
 * （→ assignment-grid.js の fromAssignmentGrid）。
 *
 * 条件入力に行が無い日は、名前のある 2 列だけを残して空にする。黙って別の日に寄せない。
 *
 * 手直しの印（メモ）も書き直す（→ assignment-grid.js の gridNotes ／ 5-3）。行の並びは学籍番号の順なので、
 * 人が増えれば行がずれる — メモを残したままにすると、印が別の人のセルに移る。だから一度ぜんぶ消してから付け直す。
 * 置けた手直しには同じ印が、置けなかった手直しには何が食い違ったかのメモが付く（checks の「食い違った固定」）。
 * 担当者が自分で書いたメモも消える（背景色や太字と同じ → paintGrids）。
 *
 * 返すのは敷いたマス目である（{ layout, grid } の配列）。色を塗り直す側が、読み直さずに使う（→ paintGrids）。
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
    // 行を残すのは、印か名指しを載せる先がある人だけである。いまの枠に無い見出しの空のセルは、外す相手が無いので載せない。
    const fixedToday = day
      ? fixed
        .filter((row) => at(row, '日') === day.date)
        .filter((row) => at(row, '役割') !== '' || day.slots.some((slot) => slot.start === at(row, '開始')))
        .map((row) => at(row, '学籍番号'))
      : []
    const grid = toAssignmentGrid(assignments, day, context.nameOf, fixedToday)

    if (grid.header.length > width) {
      throw new Error(
        `シート「${layout.name}」に ${grid.header.length - namedCount} 枠を敷こうとしたが、`
          + `時刻の列は ${width - namedCount} 列しかない（→ sheet-layout.js の maxSlotsPerDay）`,
      )
    }

    sheet.getRange(1, namedCount + 1, 1, width - namedCount).clearContent()
    if (lastRow > headerRows) sheet.getRange(headerRows + 1, 1, lastRow - headerRows, width).clearContent()
    // メモは値の無い行にも残るので、下の端（getMaxRows）まで消す（→ paintGrids の書式と同じ）。
    const maxRows = sheet.getMaxRows()
    if (maxRows > headerRows) sheet.getRange(headerRows + 1, 1, maxRows - headerRows, width).clearNote()

    // 時刻の見出しは左に寄せる。時刻のセルは既定で右寄せになるので、
    // 見出しが自分の列ではなく右隣の列の頭に見えて、どの列が何時か読みにくい。
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
 * Apps Script から呼ぶ入口。SpreadsheetApp を名指しするのは、このファイルのこの 1 行だけである。
 * メニューの「生成」がここを押す（→ menu.js の runGeneration ／ issue #151）。
 * steps を渡さなければ、中身が入っている段だけが走る（→ core.js の builtInSteps）。
 * 返すのは run と同じ、コアの出力の束である。
 */
function runOnActiveSpreadsheet(steps) {
  return run(SpreadsheetApp.getActive(), steps)
}

/**
 * 構造を確かめる → 読む → コアを呼ぶ → 書く。殻の側の 1 本である。
 * スプレッドシートは引数で受ける — 手元の検査で偽のスプレッドシートを渡せるようにするためである。
 * steps はコアの段（→ core.js の coreSteps）で、入っている段だけを渡す。
 * 返すのはコアの出力の束（割り当て・検証結果・指標・notBuilt）である
 * — 担当者に何と言うかは、メニューから呼ぶ側が決める（→ menu.js の runGeneration）。
 * 束ごと返すのは、何も書かなかった理由（notBuilt）と、残せなかった手直しの数（検証結果の「食い違った固定」）の
 * 両方を、読み直さずに言えるようにするためである。
 *
 * 構造が崩れていれば、1 行も読まずに名指しして止まる（→ verify-structure.js）。
 * notBuilt と違って返り値で持ち帰らない — 崩れているのは担当者のシートのほうで、
 * 何を直すかはメニューの出方に関わらず同じである。
 */
function run(spreadsheet, steps) {
  checkStructure(spreadsheet)
  const inputs = readInputsAndGrids(spreadsheet, true).inputs
  const output = build(inputs, steps)
  writeOutputs(spreadsheet, output, gridContext(inputs))
  return output
}

/**
 * 手直しの後に数え直す。構造を確かめる → 読む → 数え直す → 検証結果と指標を書き、マス目の色を塗り直す
 * （→ 5 の #8 ／ 6 の #2 ／ issue #155）。
 *
 * run と違うのは 2 つだけである。生成を走らせない（→ core.js の recount）ことと、
 * マス目を書き戻さないことである — マス目は担当者がいま書いたセルそのもので、数える側はそれを読むだけである。
 * 構造の検証は run と同じに先に通す。崩れたまま読むと、別の列を別の枠として数える。
 */
function recountSpreadsheet(spreadsheet) {
  checkStructure(spreadsheet)
  const read = readInputsAndGrids(spreadsheet)
  const output = recount(read.inputs)
  writeOutputs(spreadsheet, output, gridContext(read.inputs), read.grids)
  return output
}

/**
 * セルが書き換えられたときに呼ばれる口（→ menu.js の onEdit）。返すのは担当者に見せる一言である。
 *
 * 数え直すのは、マス目の 4 枚のどれかが書き換えられたときだけである（→ 2 の一覧 8）。
 * 条件入力は書きかけの途中で型に乗らないことが普通にあるので、1 文字ごとに数え直して名指しを出さない
 * — 条件を動かした後は、メニューの「生成」を押す（→ 2 の一覧 7）。
 * スクリプトが書いたセル（生成の書き戻し）では呼ばれない — 単純トリガーは人の編集でしか走らない。
 *
 * 止まった理由は捕まえて、文にして返す。単純トリガーの中で投げた例外は、担当者の画面に出ない
 * （実行ログに残るだけである）。メニューの「生成」が例外をそのまま見せる（→ menu.js の runGeneration）のと
 * 同じことを、ここでは一言にして出す — 黙って止まらない。
 * スプレッドシートはイベントから受ける（e.source）。SpreadsheetApp を名指ししない。
 *
 * 数え直す前に、書き換えたセルに手直しの印（メモ）を付ける（→ markFixedCells ／ 5-3）。
 * 印は数え方を 1 つも動かさない — 数え直しは書いてあるとおりを数えるだけである。印が効くのは次の「生成」である。
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
      text: `数え直した — 違反 ${violations} 件 ／ 未充足 ${unmet} 件（検証結果と指標を書き換えた。`
        + `違反した所は${violations === 0 ? '無い' : 'マス目の色で出ている'}）`,
      seconds: 5,
    }
  } catch (error) {
    return {
      text: `数え直せなかった。検証結果と指標は前のままである — ${error.message}`,
      seconds: 30,
    }
  }
}

/**
 * 担当者が書き換えたセルに、手直しの印（メモ）を付ける（→ assignment-grid.js の fixedNote ／ 5-3 ／ issue #156）。
 * 返すのは印を付けたセルの数である。
 *
 * 付けるのは時刻の列のデータの行だけである — 見出しの行と、名前のある 2 列（学籍番号・氏名）には付けない。
 * 空にしたセルにも付ける。「この人をこの枠に置かない」という手直しである。
 * 貼り付けで何セルもまとめて書き換えたときは、その範囲ぜんぶに付く（書き込みは 1 回で済ませる → 6 の #2）。
 *
 * 学籍番号を書き換えた行は、役割の入っているセルぜんぶに付ける。
 * 行の持ち主を替えたので、その行の割り当ては担当者が別の人に置き直したものである。
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
 * マス目を敷くのに要る 3 つ — その日の枠と、学籍番号から引く氏名と、担当者の手直しである。
 *
 * どちらも入力から出る。build を通った後に組んでいるので、枠の刻み直しはここでは起きない
 * （崩れていればコアの入口がすでに名指しして止まっている → input-types.js）。
 * 氏名は回答から引く。生成は氏名を 1 度も見ない（→ 5 の #1・assignment-grid.js の namesFromAnswers）。
 * 手直しは、書き戻すときに印を付け直すのに使う（→ writeGrids）。
 */
function gridContext(inputs) {
  return {
    days: toDays(inputs['日ごとの営業時刻'], '日ごとの営業時刻'),
    nameOf: namesFromAnswers(inputs['回答']),
    fixed: inputs[fixedName] || [],
  }
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
    valueRepresentation, sheetsToRead, headerRowCount, readInputs, readInputsAndGrids, readSection, readGrid,
    putGridsIntoInputs, writeOutputs, withNamesFromAnswers, writeGrids, violationMark, paintGrids,
    a1Notation, run, runOnActiveSpreadsheet, recountSpreadsheet, recountOnEdit, markFixedCells, gridContext,
    normalizeValue, formatDateTime, findLayout, findSheet,
  }
}
