/**
 * 割り当てを、従来のシフト表の形（行が人・列が 30 分枠・セルが役割名 1 つ、1 日 1 枚）に敷く／戻す（issue #213）。
 *
 * 引き受けるのは敷き方だけで、規則は書かない（置くのは generate.js、数えるのは count-violations.js）。
 * コアの側なので SpreadsheetApp を掴まない（読み書きは shell.js の readGrid ／ writeGrid）。
 * マス目に載らないもの（枠に無い時刻・1 セルに 2 役割・誰の行か分からない役割）は名指しして止まる。
 *
 * 他のファイルの値をこのファイルの最上位で使わない（→ core.js の同じ注意）。
 */

/** 見出しの左側の、名前のある 3 列（→ sheet-layout.js の gridSheet）。 */
function gridNamedColumns() {
  return gridLayouts(assignmentName)[0].sections[0].columns
}

/** 割り当ての行から 1 つ取る（列の並びは assignmentColumns）。 */
function assignmentAt(row, columnName) {
  const index = assignmentColumns.indexOf(columnName)
  if (index === -1) throw internalError(`割り当ての列に「${columnName}」が無い`)
  return row[index]
}

/** 枠 1 つの鍵。終端まで見て 1 つに決める。 */
function gridSlotKey(start, end) {
  return `${start}-${end}`
}

/**
 * 1 日ぶんのマス目に敷く。返すのは { header, rows } である。
 *
 *   header … 学籍番号 / 氏名 / 一緒に組みたいお友達 / その日の枠の開始時刻（枠の数だけ）
 *   rows   … 1 人 1 行。学籍番号 / 氏名 / 友達欄 / 枠ごとの役割名（入っていない枠は空）
 *
 * 行は学籍番号の昇順に並べる。生成の出てきた順だと、担当者が書き換えたセルが別の行へ移ったように見える。
 * 氏名（nameOf）と友達欄（friendsOf）は回答から引く表示のためだけの列で、生成は読まない。
 * alsoStudentIds は、1 枠も置いていなくても行を残す人である — 手直しの印を載せるセルを無くさないため（→ issue #156）。
 */
function toAssignmentGrid(assignments, day, nameOf, alsoStudentIds, friendsOf) {
  const named = gridNamedColumns()
  const header = named.concat((day ? day.slots : []).map((slot) => slot.start))
  if (!day) return { header: header, rows: [] }

  const slotIndex = {}
  day.slots.forEach((slot, index) => { slotIndex[gridSlotKey(slot.start, slot.end)] = index })

  const people = {}
  const order = []

  assignments.forEach((row, rowIndex) => {
    if (assignmentAt(row, '日') !== day.date) return

    const studentId = String(assignmentAt(row, '学籍番号'))
    const start = assignmentAt(row, '開始')
    const end = assignmentAt(row, '終了')
    const role = assignmentAt(row, '役割')
    const index = slotIndex[gridSlotKey(start, end)]

    if (index === undefined) {
      throw internalError(
        `割り当ての ${rowIndex + 1} 行目の ${day.date} ${start}-${end} が、その日の枠に無い`,
      )
    }
    if (!people[studentId]) {
      people[studentId] = day.slots.map(() => '')
      order.push(studentId)
    }
    if (people[studentId][index] !== '') {
      throw internalError(
        `${day.date} ${start}-${end} の「${studentId}」に、`
          + `「${people[studentId][index]}」と「${role}」の 2 つが入っている（1 セルに入るのは役割 1 つである）`,
      )
    }
    people[studentId][index] = role
  })

  ;(alsoStudentIds || []).forEach((studentId) => {
    const id = String(studentId)
    if (people[id]) return
    people[id] = day.slots.map(() => '')
    order.push(id)
  })

  const shown = { '学籍番号': (studentId) => studentId, '氏名': nameOf, '一緒に組みたいお友達': friendsOf }
  const rows = order
    .sort()
    .map((studentId) => named
      .map((column) => (shown[column] ? (shown[column](studentId) || '') : ''))
      .concat(people[studentId]))

  return { header: header, rows: rows }
}

/**
 * 1 日ぶんのマス目を、割り当ての行に戻す（数え直しが読む → core.js の recount）。
 * 列は位置ではなく見出しの時刻で当てる — 位置だと、営業時刻を動かしたときに役割が別の枠へ黙って移る。
 * 氏名も友達欄も読まない（戻す行の氏名は空）。
 */
function fromAssignmentGrid(header, dataRows, day, label) {
  const named = gridNamedColumns()
  const studentIdColumn = named.indexOf('学籍番号')
  const rows = []
  if (!day) {
    if (dataRows.some((row) => row.some((cell) => String(cell) !== ''))) {
      throw new Error(missingDayText(label))
    }
    return rows
  }

  const slotOf = {}
  day.slots.forEach((slot) => { slotOf[slot.start] = slot })

  dataRows.forEach((row, rowIndex) => {
    const studentId = String(row[studentIdColumn] || '').toUpperCase()
    const filled = []
    for (let column = named.length; column < row.length; column++) {
      const role = String(row[column] || '').trim()
      if (role !== '') filled.push({ column: column, role: role })
    }
    if (filled.length === 0) return

    if (studentId === '') throw new Error(emptyStudentIdText(label, rowIndex))
    if (!studentIdPattern.test(studentId)) throw new Error(badStudentIdText(label, rowIndex, studentId))

    filled.forEach((cell) => {
      const headerTime = String(header[cell.column] || '')
      const slot = slotOf[headerTime]
      if (!slot) {
        throw new Error(
          `シート「${label}」の ${cell.column + 1} 列目の時刻「${headerTime === '' ? '（空）' : headerTime}」が、今の営業時刻に合いません。`
            + '営業時刻を変えたときは、メニューの「生成」を押してください（修正済みのセルは残ります）',
        )
      }
      rows.push(buildAssignmentRow(day.date, slot, cell.role, studentId))
    })
  })

  return rows
}

/**
 * 日ごとのシートに当たる行が、条件入力の「日ごとの営業時刻」に無いときの文。
 * セルを書き換えたときにも出るので、「押す」とは言わない。
 */
function missingDayText(label) {
  return `条件入力の「日ごとの営業時刻」を ${gridLayouts(assignmentName).length} 日分入れてください（${label} の日の行がありません）`
}

/** 役割の入った行の学籍番号が空のときの文。rowIndex は見出しの下から数える。 */
function emptyStudentIdText(label, rowIndex) {
  return `シート「${label}」の ${rowIndex + 2} 行目に役割が入っていますが、学籍番号が空です`
}

/** 学籍番号の形が違うときの文。 */
function badStudentIdText(label, rowIndex, studentId) {
  return `シート「${label}」の ${rowIndex + 2} 行目の学籍番号「${studentId}」は、10 桁の英数字で書いてください`
}

/** 割り当ての 1 行を、列の並びのとおりに組む（氏名は空）。 */
function buildAssignmentRow(date, slot, role, studentId) {
  const values = { '日': date, '開始': slot.start, '終了': slot.end, '役割': role, '学籍番号': studentId, '氏名': '' }
  return assignmentColumns.map((columnName) => values[columnName])
}

/**
 * 手直しの印 — 担当者が書き換えたセルに付くメモ（→ 5-3 ／ issue #156）。
 * 値だけでは人の手か機械が置いたかが分からないので、セルそのものに付ける。見えて、消せば外れる。
 * 付けるのは onEdit（→ shell.js の markFixedCells）で、スクリプトの書き戻しでは付かない。
 * 印かどうかは頭の文字で見る（→ isFixedNote）。文言は 1 つに揃える（→ issue #230）。
 */
const fixedNote = 'シフト作成者による修正済み'

/** そのメモが手直しの印か（頭が印の文言なら、後ろに書き足してあっても印）。 */
function isFixedNote(note) {
  return String(note || '').trim().indexOf(fixedNote) === 0
}

/**
 * 残せなかった手直しのメモ。頭が fixedNote でないので次に読むときには印にならない
 * （同じ食い違いを生成のたびに名指しし直さない）。書き換えれば印に置き換わる。
 */
function conflictNote(role, detail) {
  return `この修正（${role === '' ? '空欄' : role}）は反映できませんでした：${detail}`
}

/**
 * 前に見たマス目の控え — onEdit の取りこぼしを印に変える道具（→ issue #226）。
 *
 * 間を置かずに 2 セル書き換えると onEdit が 1 回しか走らず、2 手目に印が付かない。
 * そこで生成と数え直しのたびに中身を控え、次に読んだとき控えと違うセルに印を付ける（→ missedEdits）。
 *
 * 控えは（学籍番号 × 見出しの時刻 → 役割）で、位置では当てない。
 * 役割は 1 文字の番号に詰める（置き場の developer metadata に文字数の上限がある → shell.js の keepSeenGrid）。
 * 役割が 62 種類を超えたら控えを作らない（null）— 取りこぼしを拾わないだけで、ほかは今までどおり動く。
 */
const seenSymbols = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** マス目 1 枚の控えを組む。学籍番号が空の行と、同じ学籍番号が 2 行ある行は控えない。 */
function seenGrid(header, dataRows) {
  const named = gridNamedColumns()
  const studentIdColumn = named.indexOf('学籍番号')
  const times = header.slice(named.length).map((time) => String(time || '').trim())
  const values = ['']
  const rows = {}
  const counts = studentIdCounts(dataRows, studentIdColumn)

  for (const row of dataRows) {
    const studentId = studentIdOf(row, studentIdColumn)
    if (studentId === '' || counts[studentId] > 1) continue
    let symbols = ''
    for (let column = 0; column < times.length; column++) {
      const value = String(row[named.length + column] === undefined ? '' : row[named.length + column]).trim()
      if (values.indexOf(value) === -1) values.push(value)
      if (values.length > seenSymbols.length) return null
      symbols += seenSymbols[values.indexOf(value)]
    }
    rows[studentId] = symbols
  }
  return { times: times, values: values, rows: rows }
}

/**
 * 控えと違うのに印の無いセルを { row, column }（どちらも 0 始まり）で返す。
 *   ・時刻の列で、控えと役割が違うセル（空にしたセルも入る）
 *   ・控えに無い学籍番号の行は、役割の入っているセルぜんぶ
 * 見出しの時刻が控えに無い列は見ない。控えが無ければ何も返さない（全部を手直しにしない）。
 */
function missedEdits(seen, header, dataRows, notes) {
  if (!seen) return []
  const named = gridNamedColumns()
  const studentIdColumn = named.indexOf('学籍番号')
  const counts = studentIdCounts(dataRows, studentIdColumn)
  const missed = []

  dataRows.forEach((row, rowIndex) => {
    const studentId = studentIdOf(row, studentIdColumn)
    if (studentId === '' || counts[studentId] > 1) return
    const before = seen.rows[studentId]
    const rowNotes = (notes || [])[rowIndex] || []

    for (let column = named.length; column < header.length; column++) {
      if (isFixedNote(rowNotes[column])) continue
      const value = String(row[column] === undefined ? '' : row[column]).trim()
      if (before === undefined) {
        if (value !== '') missed.push({ row: rowIndex, column: column })
        continue
      }
      const at = seen.times.indexOf(String(header[column] || '').trim())
      if (String(header[column] || '').trim() === '' || at === -1) continue
      if (seen.values[seenSymbols.indexOf(before[at])] !== value) missed.push({ row: rowIndex, column: column })
    }
  })
  return missed
}

function studentIdOf(row, studentIdColumn) {
  return String(row[studentIdColumn] === undefined ? '' : row[studentIdColumn]).trim().toUpperCase()
}

function studentIdCounts(dataRows, studentIdColumn) {
  const counts = {}
  dataRows.forEach((row) => {
    const studentId = studentIdOf(row, studentIdColumn)
    counts[studentId] = (counts[studentId] || 0) + 1
  })
  return counts
}

/**
 * 1 日ぶんのマス目から、手直しの印が付いたセルだけを手直しの行にする（→ 5-3）。
 * 機械が置いたセルは読まない（読むと、却下した「前回の案全体を初期解にする」になる）。
 *
 * 役割が空のセルの印も読む（「この人をこの枠に置かない」）。
 * 見出しの時刻がいまの枠に無くても止まらない（名指しは generate.js の placeFixed）。
 * 誰の行かが決まらない印は、fromAssignmentGrid と同じに止まる。
 */
function fixedFromAssignmentGrid(header, dataRows, notes, day, label) {
  const named = gridNamedColumns()
  const studentIdColumn = named.indexOf('学籍番号')
  const rows = []

  dataRows.forEach((row, rowIndex) => {
    const rowNotes = (notes || [])[rowIndex] || []
    const studentId = String(row[studentIdColumn] || '').trim().toUpperCase()

    for (let column = named.length; column < row.length; column++) {
      if (!isFixedNote(rowNotes[column])) continue
      const role = String(row[column] || '').trim()
      // 誰の行でもない空のセルの印は読まない
      if (studentId === '' && role === '') continue
      if (!day) throw new Error(missingDayText(label))
      if (studentId === '') throw new Error(emptyStudentIdText(label, rowIndex))
      if (!studentIdPattern.test(studentId)) throw new Error(badStudentIdText(label, rowIndex, studentId))
      const values = { '日': day.date, '開始': String(header[column] || ''), '役割': role, '学籍番号': studentId }
      rows.push(fixedColumns.map((columnName) => values[columnName]))
    }
  })

  return rows
}

/**
 * 書き戻すマス目のメモを、行と列の並びのまま返す（setNotes にそのまま渡す形）。
 *
 *   残せた手直し … そのセルに印（→ fixedNote）。次の周でも固定である
 *   残せなかった手直し … そのセルに食い違いのメモ（→ conflictNote）。列が無ければ学籍番号のセルに付ける
 *
 * 残せなかったかは、検証結果の「食い違った固定」の行で見る。同じセルに 2 つ付くときは改行でつなぐ。
 */
function gridNotes(grid, day, fixed, checks) {
  const named = gridNamedColumns()
  const notes = grid.rows.map(() => grid.header.map(() => ''))
  if (!day) return notes

  const rowsOf = {}
  grid.rows.forEach((row, rowIndex) => {
    const studentId = String(row[named.indexOf('学籍番号')] || '').toUpperCase()
    rowsOf[studentId] = (rowsOf[studentId] || []).concat([rowIndex])
  })
  const columnOf = {}
  for (let column = named.length; column < grid.header.length; column++) columnOf[String(grid.header[column])] = column

  function put(studentId, start, text, replace) {
    const column = columnOf[start] !== undefined ? columnOf[start] : named.indexOf('学籍番号')
    ;(rowsOf[String(studentId).toUpperCase()] || []).forEach((rowIndex) => {
      const now = notes[rowIndex][column]
      notes[rowIndex][column] = replace || now === '' ? text : `${now}\n${text}`
    })
  }

  const fixedAt = (row, name) => row[fixedColumns.indexOf(name)]
  ;(fixed || []).forEach((row) => {
    if (fixedAt(row, '日') !== day.date) return
    if (columnOf[fixedAt(row, '開始')] === undefined) return // いまの枠に無い印は、残せなかった側で名指しされる
    put(fixedAt(row, '学籍番号'), fixedAt(row, '開始'), fixedNote, true)
  })

  const columns = outputColumns('検証結果')
  const checkAt = (row, name) => row[columns.indexOf(name)]
  const conflicted = {}
  ;(checks || []).forEach((row) => {
    if (checkAt(row, '種別') !== checkKind.fixConflict || checkAt(row, '日') !== day.date) return
    const key = `${checkAt(row, '学籍番号')} ${checkAt(row, '開始')}`
    put(checkAt(row, '学籍番号'), checkAt(row, '開始'), conflictNote(checkAt(row, '役割'), checkAt(row, '内容')), !conflicted[key])
    conflicted[key] = true
  })

  return notes
}

/**
 * 役割ごとの背景色（→ issue #213）。色の名前は前回の配布物のもの ◎ で、値は標準の色から近いものを当てた。
 * 違反の赤い太字（→ shell.js の violationMark）が読めるよう淡い側にしてある。
 * ここに無い役割名は塗らない（別の色に寄せない）。
 */
const roleColors = [
  { roles: ['準備', '片付け'], name: 'グレー', color: '#d9d9d9' },
  { roles: ['調理'], name: '黄', color: '#ffe599' },
  { roles: ['調理責任者'], name: '橙', color: '#f9cb9c' },
  { roles: ['会計'], name: '水', color: '#9fc5e8' },
  { roles: ['呼び込み'], name: '桃', color: '#d5a6bd' },
  { roles: ['列整理'], name: '紫', color: '#b4a7d6' },
  { roles: ['クリーンパトロール'], name: '緑', color: '#b6d7a8' },
]

/** 役割名 1 つの背景色を引く。表に無い役割名と空のセルは null（塗らない）。 */
function roleColorOf(role) {
  const name = String(role || '').trim()
  const found = roleColors.filter((one) => one.roles.indexOf(name) !== -1)[0]
  return found ? found.color : null
}

/**
 * マス目のデータの行ぜんぶの背景色を、行と列の並びのまま返す（setBackgrounds にそのまま渡す形）。
 * 名前のある 3 列は塗らない。width に届かない行は、右を null で埋める。
 */
function gridBackgrounds(dataRows, width) {
  const named = gridNamedColumns()
  return dataRows.map((row) => {
    const colors = []
    for (let column = 0; column < width; column++) {
      colors.push(column < named.length ? null : roleColorOf(row[column]))
    }
    return colors
  })
}

/**
 * 検証結果の行の背景色（→ issue #220）。
 *
 *   違反の行 … 役割が何であっても（空でも）、行ぜんぶ赤
 *   それ以外 … 店の役割（準備・片付け以外）の行だけ、行ぜんぶ黄色（未充足と食い違った固定）
 *
 * 違反でない準備・片付けの行は塗らない — 何十行も並ぶので、塗ると店の役割の行が埋もれる。
 * 黄は淡いと白い行と見分けにくいので標準の黄、赤は黒い字が読める明るい赤にしてある。
 */
const checkRowHighlights = {
  violation: { name: '赤', color: '#ea9999' },
  storeRole: { name: '黄', color: '#ffff00' },
}

/** 検証結果の行ぜんぶの背景色を、行と列の並びのまま返す（setBackgrounds の形。塗らない行は null）。 */
function checkResultBackgrounds(rows, width) {
  const columns = sheetColumns('検証結果')
  const kindColumn = columns.indexOf('種別')
  const roleColumn = columns.indexOf('役割')
  const prepCleanup = prepCleanupRoles()
  return rows.map((row) => {
    const role = String(row[roleColumn] || '').trim()
    let color = null
    if (row[kindColumn] === checkKind.violation) color = checkRowHighlights.violation.color
    else if (role !== '' && prepCleanup.indexOf(role) === -1) color = checkRowHighlights.storeRole.color
    const colors = []
    for (let column = 0; column < width; column++) colors.push(color)
    return colors
  })
}

/**
 * 違反の行を、1 日ぶんのマス目のセルに当て戻す（→ issue #155）。印は文字のほうで出す（→ shell.js の violationMark）。
 * 返すのは { row, column }（どちらも 0 始まり、row はデータの行）の配列である。
 *
 *   枠 1 つが単位の違反（規則 1・4・5・同じ枠に二重）… その人の行の、その枠の列のセル
 *   その人のその日が単位の違反（規則 3）… その人の行の、学籍番号と氏名の 2 列
 *
 * 未充足は当てない（人の話ではない）。行は学籍番号で引き、同じ学籍番号の行が 2 つあればどちらにも付ける。
 * どこにも当たらない違反は付けない（検証結果の行は残っている）。
 */
function violationCells(header, dataRows, day, violations) {
  if (!day) return []
  const named = gridNamedColumns()
  const columns = outputColumns('検証結果')
  const at = (row, name) => row[columns.indexOf(name)]

  const rowsOf = {}
  dataRows.forEach((row, rowIndex) => {
    const studentId = String(row[named.indexOf('学籍番号')] || '').trim().toUpperCase()
    if (studentId === '') return
    rowsOf[studentId] = (rowsOf[studentId] || []).concat([rowIndex])
  })

  const columnOf = {}
  for (let column = named.length; column < header.length; column++) {
    const time = String(header[column] || '')
    if (time !== '') columnOf[time] = column
  }

  const whoColumns = ['学籍番号', '氏名'].map((name) => named.indexOf(name))
  const cells = []
  const seen = {}
  function mark(row, column) {
    const key = `${row},${column}`
    if (seen[key]) return
    seen[key] = true
    cells.push({ row: row, column: column })
  }

  violations.forEach((violation) => {
    if (at(violation, '種別') !== checkKind.violation) return
    if (at(violation, '日') !== day.date) return
    const rows = rowsOf[String(at(violation, '学籍番号')).toUpperCase()] || []
    const start = at(violation, '開始')
    rows.forEach((row) => {
      if (start === '') {
        whoColumns.forEach((column) => mark(row, column))
        return
      }
      if (columnOf[start] !== undefined) mark(row, columnOf[start])
    })
  })

  return cells
}

/**
 * 回答の行から (学籍番号 → 氏名) を作る（表示のためだけ）。
 * 同じ学籍番号が 2 行あれば、後から来た行の氏名を採る（→ ADR design-doc-0006）。
 */
function namesFromAnswers(rows) {
  return latestAnswerOf(rows, '氏名')
}

/**
 * 回答の行から (学籍番号 → 友達欄) を作る（表示のためだけ → issue #200）。自由記述なので書かれたとおりに出す。
 * 後から来た行を採り、空でも上書きする（飛ばすと、消した友達欄が前の回答から戻ってくる）。
 */
function friendsFromAnswers(rows) {
  return latestAnswerOf(rows, '一緒に組みたいお友達', true)
}

/** 回答の 1 列を、学籍番号ごとに後から来た行で引く。keepBlank でなければ、空の値は前の行を上書きしない。 */
function latestAnswerOf(rows, columnName, keepBlank) {
  const columns = answerSection().columns
  const studentIdColumn = columns.indexOf('学籍番号')
  const valueColumn = columns.indexOf(columnName)
  const values = {}

  rows.forEach((row) => {
    const studentId = String(row[studentIdColumn] || '').trim().toUpperCase()
    const value = String(row[valueColumn] || '').trim()
    if (studentId === '' || (value === '' && !keepBlank)) return
    values[studentId] = value
  })

  return function (studentId) { return values[String(studentId).toUpperCase()] || '' }
}

// Node から読むためだけの口。Apps Script では module が無いので通らない。
if (typeof module !== 'undefined') {
  module.exports = {
    gridNamedColumns, assignmentAt, toAssignmentGrid, fromAssignmentGrid, buildAssignmentRow,
    fixedNote, isFixedNote, conflictNote, seenGrid, missedEdits, fixedFromAssignmentGrid, gridNotes, roleColors, roleColorOf, gridBackgrounds, checkRowHighlights, checkResultBackgrounds, violationCells, namesFromAnswers,
    friendsFromAnswers,
  }
}
