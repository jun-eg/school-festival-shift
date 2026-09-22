/**
 * 割り当てを、従来のシフト表の形に敷く／その形から戻す（issue #213）。
 *
 * 従来の形は記録が持っている ◎ — 前回の配布物が、行が人・列が 30 分枠・セルが役割名 1 つである。
 * 1 日 1 枚で、4 枚に分かれる（→ sheet-layout.js の dayLabels）。
 *
 * ここが引き受けるのは敷き方だけである。割り当てそのもの（誰をどの枠に置くか）は生成が、
 * 破っている所を数えるのは違反の側が持つ（→ generate.js ／ count-violations.js）。
 * ここに規則を 1 つも書かない（→ src/README.md）。
 *
 * コアの側である。配列を受けて配列を返し、SpreadsheetApp を 1 度も掴まない（→ 6 の #8）。
 * 読み書きの範囲を決めるのは殻である（→ shell.js の readGrid ／ writeGrid）。
 *
 * 黙って捨てない。マス目に載らないもの（その日の枠に無い時刻・1 セルに 2 役割・
 * 誰の行か分からない役割）は、その場で名指しして止まる。
 * 「満たせない枠は黙って埋めない」（→ 5 の #6）と同じ扱いである。
 *
 * 他のファイルの値をこのファイルの最上位で使わない（→ core.js の同じ注意）。
 */

/** 見出しの左側 — 名前のある 2 列である（→ sheet-layout.js の gridSheet）。 */
function gridNamedColumns() {
  return gridLayouts(assignmentName)[0].sections[0].columns
}

/** 割り当ての行から 1 つ取る。列の並びは sheet-layout.js が持つ（→ assignmentColumns）。 */
function assignmentAt(row, columnName) {
  const index = assignmentColumns.indexOf(columnName)
  if (index === -1) throw new Error(`割り当ての列に「${columnName}」が無い`)
  return row[index]
}

/** 枠 1 つの鍵。開始だけで当てない — 枠は時刻をまたがないので、終端まで見て 1 つに決まる。 */
function gridSlotKey(start, end) {
  return `${start}-${end}`
}

/**
 * 1 日ぶんのマス目に敷く。返すのは { header, rows } である。
 *
 *   header … 学籍番号 / 氏名 / その日の枠の開始時刻（枠の数だけ）
 *   rows   … 1 人 1 行。学籍番号 / 氏名 / 枠ごとの役割名（入っていない枠は空）
 *
 * 行の並びは学籍番号の昇順である。入力から決まるので、同じ入力からは同じ並びが出る（→ 6 の #3）。
 * 生成の出てきた順に並べない — 順が変わると、担当者が書き換えたセルが別の行へ移ったように見えて、
 * 「動かしたセルが 1 つも戻っていない」（5 の #11）が数えられなくなる。
 *
 * 氏名は回答から引く（nameOf）。生成は氏名を 1 度も見ない（型 #6 に氏名は無い → 5 の #1）ので、
 * ここで足している。見出しに出すためだけの列である（→ input-types.js の columnsOutsideWish）。
 */
function toAssignmentGrid(assignments, day, nameOf) {
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
      throw new Error(
        `割り当ての ${rowIndex + 1} 行目の ${day.date} ${start}-${end} が、その日の枠に無い。`
          + '枠は条件入力の「日ごとの営業時刻」から刻む（→ 規則 1 の ①）ので、'
          + '刻んだ枠の外に置いたものは列に落ちない',
      )
    }
    if (!people[studentId]) {
      people[studentId] = day.slots.map(() => '')
      order.push(studentId)
    }
    if (people[studentId][index] !== '') {
      throw new Error(
        `${day.date} ${start}-${end} の「${studentId}」に、`
          + `「${people[studentId][index]}」と「${role}」の 2 つが入っている。`
          + '1 セルに入るのは役割 1 つである（同じ人が同じ枠に 2 つ入っているのは違反である → 5-4）',
      )
    }
    people[studentId][index] = role
  })

  const rows = order
    .sort()
    .map((studentId) => [studentId, nameOf ? (nameOf(studentId) || '') : ''].concat(people[studentId]))

  return { header: header, rows: rows }
}

/**
 * 1 日ぶんのマス目を、割り当ての行に戻す（前の周の手直し ＝ 5-3 の固定を読む口である）。
 *
 * 列に当てるのは位置ではなく、見出しに書いてある時刻そのものである。
 * 位置で当てると、条件入力の営業時刻を動かしたときに、前の周の役割が別の枠へ黙って移る。
 *
 * 氏名は読まない。表示のための列で、生成が見ると 5 の #1（7 種類の外を参照しない）が破れる。
 * 戻す行の氏名は空である（生成が置くときと同じ → generate.js の generationNotAimed）。
 */
function fromAssignmentGrid(header, dataRows, day, label) {
  const named = gridNamedColumns()
  const studentIdColumn = named.indexOf('学籍番号')
  const rows = []
  if (!day) {
    if (dataRows.some((row) => row.some((cell) => String(cell) !== ''))) {
      throw new Error(
        `シート「${label}」に中身があるが、条件入力の「日ごとの営業時刻」にその日の行が無い。`
          + `${gridLayouts(assignmentName).length} 行そろえてから、もう一度押す（→ 4-1）`,
      )
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

    if (studentId === '') {
      throw new Error(
        `シート「${label}」の ${rowIndex + 2} 行目に役割が入っているが、学籍番号が空である。`
          + '誰の行かが決まらない（行は学籍番号で引く → issue #213）',
      )
    }
    if (!studentIdPattern.test(studentId)) {
      throw new Error(
        `シート「${label}」の ${rowIndex + 2} 行目の学籍番号「${studentId}」が形式と違う。`
          + '10 桁の英数字である（→ 4-1 の #1）',
      )
    }

    filled.forEach((cell) => {
      const headerTime = String(header[cell.column] || '')
      const slot = slotOf[headerTime]
      if (!slot) {
        throw new Error(
          `シート「${label}」の ${rowIndex + 2} 行目 ${cell.column + 1} 列目に「${cell.role}」が入っているが、`
            + `見出しの「${headerTime === '' ? '（空）' : headerTime}」が、いまの ${day.date} の枠に無い。`
            + '条件入力の「日ごとの営業時刻」を動かしたのなら、'
            + 'その手直しをどう扱うかが決まっていない（黙って外さない → 5-3 ／ issue #156）',
        )
      }
      rows.push(buildAssignmentRow(day.date, slot, cell.role, studentId))
    })
  })

  return rows
}

/** 割り当ての 1 行を、列の並びのとおりに組む。氏名は空である（→ fromAssignmentGrid の注意）。 */
function buildAssignmentRow(date, slot, role, studentId) {
  const values = { '日': date, '開始': slot.start, '終了': slot.end, '役割': role, '学籍番号': studentId, '氏名': '' }
  return assignmentColumns.map((columnName) => values[columnName])
}

/**
 * 役割ごとの背景色（→ issue #213 の「色」の行）。
 *
 * 色の名前は記録が持っている ◎ — 前回の配布物は、準備・片付け = グレー ／ 調理 = 黄 ／ 調理責任者 = 橙 ／
 * 会計 = 水 ／ 呼び込み = 桃 ／ 列整理 = 紫 ／ クリーンパトロール = 緑 である。
 * 色の値（color）は記録に無いので、スプレッドシートの標準の色から名前に近いものを当てた。
 * 違反の印（赤い太字 → shell.js の violationMark）が読めるよう、どれも淡い側である。
 *
 * ここに無い役割名は塗らない。役割名は条件入力から来るので、年で増えることがある（→ 5-1 の #2）。
 * 黙って別の色に寄せない。
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

/** 役割名 1 つの背景色を引く。表に無い役割名と空のセルは null（塗らない）である。 */
function roleColorOf(role) {
  const name = String(role || '').trim()
  const found = roleColors.filter((one) => one.roles.indexOf(name) !== -1)[0]
  return found ? found.color : null
}

/**
 * マス目のデータの行ぜんぶの背景色を、行と列の並びのまま返す（setBackgrounds にそのまま渡す形）。
 * 名前のある 2 列は塗らない。width に届かない行は、右を null で埋める。
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
 * 違反の行を、1 日ぶんのマス目のセルに当て戻す（→ 6 の #2「違反した所はセルの色に出る」／ issue #155）。
 * 背景は役割の色で使っているので、違反は文字のほうで出す（→ shell.js の violationMark）。
 * 返すのは { row, column } の配列で、どちらもマス目の中の 0 始まりの位置である（row はデータの行）。
 *
 *   枠 1 つが単位の違反（規則 1・4・5・同じ枠に二重）… その人の行の、その枠の列のセル
 *   その人のその日が単位の違反（規則 3）… その人の行の、名前のある 2 列（学籍番号・氏名）
 *     — 規則 3 が壊れているのは枠 1 つではない（→ count-violations.js の countPrepCleanupBroken）。
 *       準備にも片付けにも入っていない ④ は、印を付ける枠そのものが無い
 *
 * 未充足は当てない。枠の話であって人の話ではないので、印を付ける行が無い（→ name-unmet.js）。
 * マス目は名指しを置き換えない — 未充足を名指しするのは検証結果である（→ src/README.md）。
 *
 * 行は学籍番号で引く（→ issue #213）。同じ学籍番号の行が 2 つあれば、どちらにも付ける
 * （どちらに書いた役割も同じ人の割り当てとして数えている → fromAssignmentGrid）。
 * どの行にも列にも当たらない違反には付けない — 検証結果の行が残っているので、黙って消えるのではない。
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
        for (let column = 0; column < named.length; column++) mark(row, column)
        return
      }
      if (columnOf[start] !== undefined) mark(row, columnOf[start])
    })
  })

  return cells
}

/**
 * 回答の行から (学籍番号 → 氏名) を作る。見出しに出すためだけの対応である。
 *
 * 同じ学籍番号が 2 行あるときは、後から来た行の氏名を採る
 * （→ ADR design-doc-0006・規則 2 の ③。出し直しで名乗りが変わったときに、新しいほうが出る）。
 * 畳み込みそのものはここでしない — ここが返すのは表示の対応であって、型 #6 ではない。
 */
function namesFromAnswers(rows) {
  const columns = answerSection().columns
  const studentIdColumn = columns.indexOf('学籍番号')
  const nameColumn = columns.indexOf('氏名')
  const names = {}

  rows.forEach((row) => {
    const studentId = String(row[studentIdColumn] || '').trim().toUpperCase()
    const name = String(row[nameColumn] || '').trim()
    if (studentId === '' || name === '') return
    names[studentId] = name
  })

  return function (studentId) { return names[String(studentId).toUpperCase()] || '' }
}

// Node から読むためだけの口。Apps Script では module が無いので通らない。
if (typeof module !== 'undefined') {
  module.exports = {
    gridNamedColumns, assignmentAt, toAssignmentGrid, fromAssignmentGrid, buildAssignmentRow, roleColors, roleColorOf, gridBackgrounds, violationCells, namesFromAnswers,
  }
}
