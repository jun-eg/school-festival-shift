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

/** 見出しの左側 — 名前のある 3 列である（→ sheet-layout.js の gridSheet）。 */
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
 *   header … 学籍番号 / 氏名 / 一緒に組みたいお友達 / その日の枠の開始時刻（枠の数だけ）
 *   rows   … 1 人 1 行。学籍番号 / 氏名 / 友達欄 / 枠ごとの役割名（入っていない枠は空）
 *
 * 行の並びは学籍番号の昇順である。入力から決まるので、同じ入力からは同じ並びが出る（→ 6 の #3）。
 * 生成の出てきた順に並べない — 順が変わると、担当者が書き換えたセルが別の行へ移ったように見えて、
 * 「動かしたセルが 1 つも戻っていない」（5 の #11）が数えられなくなる。
 *
 * 氏名は回答から引く（nameOf）。生成は氏名を 1 度も見ない（型 #6 に氏名は無い → 5 の #1）ので、
 * ここで足している。見出しに出すためだけの列である（→ input-types.js の columnsOutsideWish）。
 *
 * 友達欄も回答から引く（friendsOf）。担当者が余裕のあるときに手で寄せるための列で、生成は読まない
 * （→ 5-2 ／ issue #200）。氏名と同じく、表示のためだけに足している。
 *
 * alsoStudentIds は、その日に 1 枠も置いていなくても行を残す人である（→ 5-3 ／ issue #156）。
 * 「この人をここに置かない」という手直し（空のセルに付いた印）と、残せなかった手直しの名指しは、
 * 置いた枠が 1 つも無い人にも付く。行が無いと、印を載せるセルが無くなり、手直しが黙って消える。
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
 * 1 日ぶんのマス目を、割り当ての行に戻す（手直しの後の数え直しが読む口である → core.js の recount）。
 * 担当者が書き換えたセルだけを読むのは、ここではなく fixedFromAssignmentGrid である（→ 5-3）。
 *
 * 列に当てるのは位置ではなく、見出しに書いてある時刻そのものである。
 * 位置で当てると、条件入力の営業時刻を動かしたときに、前の周の役割が別の枠へ黙って移る。
 *
 * 氏名も友達欄も読まない。表示のための列で、生成が見ると 5 の #1（7 種類の外を参照しない）が破れる。
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
            + '条件入力の「日ごとの営業時刻」を動かしたのなら、メニューの「生成」を押す。'
            + '手直しの印（メモ）が付いたセルは残し、いまの枠に無くて残せないものは検証結果に名指しで出る'
            + '（→ 5-3 ／ issue #156）。数え直しは、いま書いてあるとおりしか数えない',
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
 * 手直しの印（→ 5-3 ／ issue #156）。**担当者が書き換えたセルに付くメモである。**
 *
 * どのセルが担当者の手で、どのセルが前の周に機械が置いたものかは、値だけでは分からない。
 * 印をセルそのものに付けるのは、次の 3 つのためである。
 *   ・入力の側にある — 割り当ての 4 枚の中にあるので、再実行は「入力が 1 つ増えた状態でもう一度通す」ことになる（→ 5-3）
 *   ・担当者に見える — セルの右上に印が出る。どこを固定したかを、別の画面を開かずに読める（→ 6 の #2）
 *   ・担当者が外せる — メモを消せば、次の生成でそのセルは組み直される
 * 付けるのは onEdit である（→ shell.js の markFixedCells）。スクリプトの書き戻しでは付かない — 単純トリガーは人の編集でしか走らない。
 *
 * 印かどうかは頭の文字で見る（→ isFixedNote）。担当者が自分で書いたメモは印にならない。
 * 文言は 1 つに揃える（→ issue #230）。メモを見た人に「誰が直したか」が読めればよく、外し方は割り当ての説明が持つ（→ sheet-layout.js）。
 */
const fixedNote = 'シフト作成者による修正済み'

/** そのメモが手直しの印か。頭が印の文言なら印である（後ろに担当者が書き足しても外れない）。 */
function isFixedNote(note) {
  return String(note || '').trim().indexOf(fixedNote) === 0
}

/**
 * 残せなかった手直しのメモ（→ 5-3「食い違った固定は、名指しで返す」）。
 * 頭が印の文言（→ fixedNote）でないので、次に読むときには印にならない — 同じ食い違いを生成のたびに名指しし直さない。
 * 担当者がそのセルをもう一度書き換えれば、印に置き換わる（→ shell.js の markFixedCells）。
 */
function conflictNote(role, detail) {
  return `残せなかった手直し「${role}」— ${detail}`
}

/**
 * 前に見たマス目の控え（→ 5-3 の「取りこぼした書き換え」／ issue #226）。**印ではない。取りこぼしを印に変える道具である。**
 *
 * 本物で間を置かずに 2 セル書き換えると、onEdit が 1 回しか走らず、2 手目のセルに印が付かない（→ real-device-log.md）。
 * 落ちたイベントは中から拾えないので、生成と数え直しのたびにマス目の中身を控えておき、
 * 次に読んだときに控えと違うセルを「人が書き換えたのに印が付いていないセル」として印を付ける（→ missedEdits）。
 * スクリプトの書き戻しは控えを置き直すので、機械が置いたセルは差にならない。
 *
 * 控えは（学籍番号 × 見出しの時刻 → 役割）である。行の位置でも列の位置でも当てない — 人が増えれば行が、営業時刻を動かせば列がずれる（→ ADR tech-requirements-0010）。
 * 役割は出てきた順に 1 文字の番号にして詰める。置き場（シートの developer metadata）の文字数に上限があるからである（→ shell.js の keepSeenGrid）。
 * 番号の文字が足りない（役割が 62 種類を超える）ときは控えを作らない（null）— 控えが無ければ、取りこぼしを拾わないだけで今までどおりに動く。
 */
const seenSymbols = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** マス目 1 枚の控えを組む。学籍番号が空の行と、同じ学籍番号が 2 行ある行は、誰の行かが決まらないので控えない。 */
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
 * 控えと違うのに印の無いセルを返す（{ row, column } — データの行の番号と、マス目の列の番号。どちらも 0 始まり）。
 * 付け方は shell.js の markFixedCells と同じ決めである（→ 5-3）。
 *   ・時刻の列で、控えと役割が違うセル（空にしたセルも入る）
 *   ・控えに無い学籍番号の行（学籍番号を書き換えた・行を足した）は、役割の入っているセルぜんぶ
 * 見出しの時刻が控えに無い列は見ない（見出しを書き換えたのは手直しではない）。控えが無ければ何も返さない
 * — 黙って全部を手直しにしない。
 * 同じ値に書き直した手は、控えと違わないので拾えない。
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
 * 1 日ぶんのマス目から、手直しの印が付いたセルだけを手直しの行にする（→ fixedColumns ／ 5-3）。
 *
 * 前の周に機械が置いたセルは読まない。**読むと、却下した「前回の案全体を初期解にする」になる**
 * — どこが人の意思で、どこが機械の都合かが消える（→ 5-3 の却下した形）。
 *
 * 役割が空のセルに付いた印も読む。「この人をこの枠に置かない」という手直しである（役割は空で乗る）。
 * 見出しの時刻がいまの枠に無くても止まらない。そのまま乗せ、生成の側が名指しで返す（→ generate.js の placeFixed）。
 * 誰の行かが決まらない印（学籍番号が空・形式が違う）は、fromAssignmentGrid と同じに止まる。
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
      // 誰の行でもない空のセルの印は、外す相手がいないので読まない。
      if (studentId === '' && role === '') continue
      if (!day) {
        throw new Error(
          `シート「${label}」に手直しの印があるが、条件入力の「日ごとの営業時刻」にその日の行が無い。`
            + `${gridLayouts(assignmentName).length} 行そろえてから、もう一度押す（→ 4-1）`,
        )
      }
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
      const values = { '日': day.date, '開始': String(header[column] || ''), '役割': role, '学籍番号': studentId }
      rows.push(fixedColumns.map((columnName) => values[columnName]))
    }
  })

  return rows
}

/**
 * 書き戻すマス目のメモを、行と列の並びのまま返す（setNotes にそのまま渡す形 → shell.js の writeGrids）。
 *
 *   残せた手直し … その人の行の、その枠のセルに印（→ fixedNote）。書き戻しても印が残るので、次の周でも固定である
 *   残せなかった手直し … 同じセルに、何が食い違ったかのメモ（→ conflictNote）。
 *     見出しがいまの枠に無いときは列が無いので、その人の学籍番号のセルに付ける
 *
 * 残せなかったかどうかは、検証結果の「食い違った固定」の行で見る（→ generate.js の nameFixedConflicts）。
 * 同じセルに 2 つ付くときは、改行でつなぐ。それ以外のセルは空（メモなし）である。
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
 * 違反の行を、1 日ぶんのマス目のセルに当て戻す（→ 6 の #2「違反した所はセルの色に出る」／ issue #155）。
 * 背景は役割の色で使っているので、違反は文字のほうで出す（→ shell.js の violationMark）。
 * 返すのは { row, column } の配列で、どちらもマス目の中の 0 始まりの位置である（row はデータの行）。
 *
 *   枠 1 つが単位の違反（規則 1・4・5・同じ枠に二重）… その人の行の、その枠の列のセル
 *   その人のその日が単位の違反（規則 3）… その人の行の、学籍番号と氏名の 2 列（友達欄には付けない — 誰の違反かを指す列ではない）
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
 * 回答の行から (学籍番号 → 氏名) を作る。見出しに出すためだけの対応である。
 *
 * 同じ学籍番号が 2 行あるときは、後から来た行の氏名を採る
 * （→ ADR design-doc-0006・規則 2 の ③。出し直しで名乗りが変わったときに、新しいほうが出る）。
 * 畳み込みそのものはここでしない — ここが返すのは表示の対応であって、型 #6 ではない。
 */
function namesFromAnswers(rows) {
  return latestAnswerOf(rows, '氏名')
}

/**
 * 回答の行から (学籍番号 → 友達欄) を作る（→ issue #200）。氏名と同じく、見出しに出すためだけの対応である。
 *
 * 友達欄は自由記述である（「太郎君」「同期」「先輩」も書ける → form-definition.js）。
 * 担当者が読んで手で寄せるための列なので、書かれたとおりに出す — 学籍番号に解決しない・分けない。
 * 採るのは氏名と同じく後から来た行である。出し直しで友達欄を消した人は、空のまま出る
 * （空の行を飛ばすと、消した友達欄が前の回答から戻ってくる）。
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
    fixedNote, isFixedNote, conflictNote, seenGrid, missedEdits, fixedFromAssignmentGrid, gridNotes, roleColors, roleColorOf, gridBackgrounds, violationCells, namesFromAnswers,
    friendsFromAnswers,
  }
}
