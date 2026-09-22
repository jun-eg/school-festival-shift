/**
 * 入力の型 — docs/tech-requirements.md 5-1 の 7 種類（issue #140）。
 *
 * 殻が読んだ行の配列を 7 種類の型に直す。ここを通った先には 7 種類の外の値が無い（→ 5 の #1）。
 * 来るのは殻が表現を揃えた行である（→ core.js の checkRepresentation）。
 * 揃っていない値は黙って直さず、区画・行・列を名指しして止まる。
 * 例外は学籍番号で、大文字に揃えて型に乗せる（→ readStudentId）。
 *
 * SpreadsheetApp を掴まない（→ 6 の #8）。他のファイルの値を最上位で使わない（→ core.js の同じ注意）。
 */

/** 枠の刻み幅（→ 規則 1 の ①）。 */
const slotMinutes = 30

/** 学年の選択肢。フォームの転記である（→ 4-1 の #3）。 */
const grades = ['1年生', '2年生', '3年生', '4年生']

/** `調理担当ですか？` の選択肢（→ 4-1 の #4）。 */
const cookAnswers = { はい: true, いいえ: false }

/** 準備・片付けのルールの区画に書ける項目（→ 5-1 の #5）。 */
const prepCleanupItems = { noonBoundary: '午前と午後の境目' }

/** 置き方のルールの区画に書ける項目（→ 5-1 の #7）。 */
const placementItems = { minRun: '連続して入る最小の長さ' }

/**
 * 「連続して入る最小の長さ」の、担当者が書かなかった年の既定（→ 5-1 の #7）。
 * 書いた年はこの値を見ない。定数にすると、長さを変えたい年にコードを直すことになる。
 */
const defaultMinRun = '1:00'

/** 学籍番号の形式。フォームの正規表現の転記である（→ 4-1 の #1）。 */
const studentIdPattern = /^[A-Za-z0-9]{10}$/

/**
 * 型 #6（希望）の、名前で取る列（→ 5-1 の #6）。
 * 日ごとの回答 4 列は列名が毎年変わるので位置で取る（→ dayAnswerColumns）。
 */
const wishColumns = { studentId: '学籍番号', grade: '学年', canCook: '調理担当ですか？' }

/**
 * 回答シートにあるが、型 #6 に入らない列。
 *   タイムスタンプ … 規則 2 の畳み込みのキーで、畳んだ後には残らない
 *   氏名           … 表示用。割り当てと指標の氏名は殻が回答から引く（→ shell.js）
 *   一緒に組みたいお友達 … 割り当ての材料にしない（→ 5-2）
 */
const columnsOutsideWish = ['タイムスタンプ', '氏名', '一緒に組みたいお友達']

/**
 * 7 種類の型（→ 5-1）。並びは 5-1 の表の #1〜#7 と同じである。
 *
 *   key    … コアが条件を持つときのキー（→ core.js の takeConditions）
 *   source … 行が来る区画の見出し、またはシートの名前
 *   build  … 行の配列をその型に直す関数
 *   fields … その型に現れてよい名前の全部
 *
 * 型 #6 の build を呼ぶのは、規則 2 の畳み込み（取り込む ／ #146）の段である。
 * rowIndex はどの型でも区画（シート）の中の何行目かで、見出しの行は数えない。
 */
const inputTypes = [
  {
    number: 1,
    name: '枠',
    key: 'days',
    build: toDays,
    source: '日ごとの営業時刻',
    fields: ['date', 'prepStart', 'cookStart', 'cookEnd', 'cleanupStart', 'cleanupEnd', 'slots', 'start', 'end'],
  },
  {
    number: 2,
    name: '役割と必要人数',
    key: 'roleNeeds',
    build: toNeeds,
    source: '役割と必要人数',
    fields: ['date', 'start', 'end', 'role', 'count'],
  },
  {
    number: 3,
    name: '調理責任者の学年条件',
    key: 'cookLeaderGrades',
    build: toCookLeaderGrades,
    source: '調理責任者の学年',
    fields: [],
  },
  {
    number: 4,
    name: '委員会の指定枠',
    key: 'committeeNeeds',
    build: toNeeds,
    source: '委員会の指定枠',
    fields: ['date', 'start', 'end', 'role', 'count'],
  },
  {
    number: 5,
    name: '準備・片付けのルール',
    key: 'prepCleanupRule',
    build: toPrepCleanupRule,
    source: '準備・片付けのルール',
    fields: ['noonBoundary'],
  },
  {
    number: 6,
    name: '希望',
    key: 'wishes',
    build: toWishes,
    source: '回答',
    fields: ['studentId', 'grade', 'canCook', 'answers'],
  },
  {
    number: 7,
    name: '置き方のルール',
    key: 'placementRule',
    build: toPlacementRule,
    source: '置き方のルール',
    fields: ['minRun'],
  },
]

/** 行の配列を、その型に直す。どの区画の行かは型が持っている（→ source）。 */
function toType(type, rows) {
  return type.build(rows, type.source)
}

/** 条件入力の 6 区画（型 #1〜#5 と #7）。型 #6 は畳み込みを通ってから直すので入らない。 */
function conditionTypes() {
  return inputTypes.filter((type) => type.source !== '回答')
}

/**
 * 型 #1（枠）— 日ごとの営業時刻と、そこから刻んだ 30 分枠の列（→ 5-1 の #1）。
 *
 * 時刻と時刻のあいだごとに刻むので、枠が 準備開始／調理開始／調理終了／片付け開始 をまたがない。
 * 30 分に足りない端は枠にならない（→ 3 の境界値の表）。
 */
function toDays(rows, source) {
  const section = conditionSection(source)
  const columns = section.columns
  const days = []

  eachFilledRow(source, section, rows, (row, rowIndex) => {
    const day = {
      date: readDate(source, columns, row, rowIndex, '日付'),
      prepStart: readTime(source, columns, row, rowIndex, '準備開始'),
      cookStart: readTime(source, columns, row, rowIndex, '調理開始'),
      cookEnd: readTime(source, columns, row, rowIndex, '調理終了'),
      cleanupStart: readTime(source, columns, row, rowIndex, '片付け開始'),
      cleanupEnd: readTime(source, columns, row, rowIndex, '片付け終了'),
    }
    if (days.some((seen) => seen.date === day.date)) {
      throw new Error(`${whereIs(source, rowIndex)}の「${day.date}」が、すでに上の行にある（1 日 1 行である）`)
    }
    checkAscending(source, rowIndex, day)
    day.slots = cutSlots(day)
    days.push(day)
  })

  return days
}

/** 時刻が早い順に並んでいるかを見る。 */
function checkAscending(source, rowIndex, day) {
  const order = ['準備開始', '調理開始', '調理終了', '片付け開始', '片付け終了']
  const times = [day.prepStart, day.cookStart, day.cookEnd, day.cleanupStart, day.cleanupEnd]

  for (let i = 1; i < times.length; i++) {
    if (toMinutes(times[i - 1]) <= toMinutes(times[i])) continue
    throw new Error(
      `${whereIs(source, rowIndex)}の時刻が早い順でない（「${order[i - 1]}」が ${times[i - 1]}、「${order[i]}」が ${times[i]}）`,
    )
  }
}

/** 1 日ぶんの 30 分枠を刻む。時刻と時刻のあいだごとに、頭から 30 分ずつ取る。 */
function cutSlots(day) {
  const boundaries = [day.prepStart, day.cookStart, day.cookEnd, day.cleanupStart, day.cleanupEnd]
  const slots = []

  for (let i = 1; i < boundaries.length; i++) {
    const bandEnd = toMinutes(boundaries[i])
    for (let start = toMinutes(boundaries[i - 1]); start + slotMinutes <= bandEnd; start += slotMinutes) {
      slots.push({ start: toTimeText(start), end: toTimeText(start + slotMinutes) })
    }
  }
  return slots
}

/**
 * 型 #2（役割と必要人数）と型 #4（委員会の指定枠）— (日・時間帯・役割名・人数) の行の集合。
 *
 * 指定枠を別扱いにしないために同じ形にしてある（→ 5-1）。
 * 空の日・時間帯の読み方は枠に当てる側が持つ（→ name-unmet.js の needCovers）。ここは行の形だけを見る。
 */
function toNeeds(rows, source) {
  const section = conditionSection(source)
  const columns = section.columns
  const needs = []

  eachFilledRow(source, section, rows, (row, rowIndex) => {
    const need = {
      date: readDate(source, columns, row, rowIndex, '日', true),
      start: readTime(source, columns, row, rowIndex, '開始', true),
      end: readTime(source, columns, row, rowIndex, '終了', true),
      role: readText(source, columns, row, rowIndex, '役割名'),
      count: readCount(source, columns, row, rowIndex, '人数'),
    }
    if ((need.start === '') !== (need.end === '')) {
      throw new Error(`${whereIs(source, rowIndex)}の時間帯が片側しか無い（両方書くか、両方空ける）`)
    }
    if (need.start !== '' && toMinutes(need.end) <= toMinutes(need.start)) {
      throw new Error(`${whereIs(source, rowIndex)}の終了 ${need.end} が、開始 ${need.start} より後になっていない`)
    }
    needs.push(need)
  })

  return needs
}

/**
 * 型 #3（調理責任者の学年条件）— 学年の集合（→ 5-1 の #3）。同じ学年が 2 行あっても 1 つである。
 * セルには数字だけを書き（`3`）、型ではフォームの選択肢の形（`3年生`）で持つ（→ #237）。
 */
function toCookLeaderGrades(rows, source) {
  const section = conditionSection(source)
  const columns = section.columns
  const chosen = []

  eachFilledRow(source, section, rows, (row, rowIndex) => {
    const number = readText(source, columns, row, rowIndex, '学年')
    const grade = `${number}年生`
    if (grades.indexOf(grade) === -1) {
      throw new Error(
        `${whereIs(source, rowIndex)}の「${number}」が学年の数字でない（${grades.map((g) => g.replace('年生', '')).join(' / ')} のどれか）`,
      )
    }
    if (chosen.indexOf(grade) === -1) chosen.push(grade)
  })

  return chosen
}

/**
 * 型 #5（準備・片付けのルール）— 入力で来るのは境目 1 つだけである（→ 5-1 の #5）。
 * 空でもここでは止まらない。空を名指しするのは規則 3 を適用する段（→ #151）である。
 */
function toPrepCleanupRule(rows, source) {
  const section = conditionSection(source)
  const columns = section.columns
  const rule = { noonBoundary: '' }

  eachFilledRow(source, section, rows, (row, rowIndex) => {
    const item = readText(source, columns, row, rowIndex, '項目')
    if (item !== prepCleanupItems.noonBoundary) {
      throw new Error(
        `${whereIs(source, rowIndex)}の項目「${item}」は書けない（書けるのは ${prepCleanupItems.noonBoundary} だけ）`,
      )
    }
    if (rule.noonBoundary !== '') {
      throw new Error(`${whereIs(source, rowIndex)}の「${item}」が、すでに上の行にある`)
    }
    rule.noonBoundary = readTime(source, columns, row, rowIndex, '値')
  })

  return rule
}

/**
 * 型 #7（置き方のルール）— 生成が置くときのまとまりの長さ（→ 5-1 の #7）。規則ではない。
 * 書かれていなければ既定で走る（→ defaultMinRun）。止まるのは値が枠の刻みに乗らないときだけである。
 */
function toPlacementRule(rows, source) {
  const section = conditionSection(source)
  const columns = section.columns
  const rule = { minRun: toRunMinutes(defaultMinRun) }
  let written = false

  eachFilledRow(source, section, rows, (row, rowIndex) => {
    const item = readText(source, columns, row, rowIndex, '項目')
    if (item !== placementItems.minRun) {
      throw new Error(
        `${whereIs(source, rowIndex)}の項目「${item}」は書けない（書けるのは ${placementItems.minRun} だけ）`,
      )
    }
    if (written) {
      throw new Error(`${whereIs(source, rowIndex)}の「${item}」が、すでに上の行にある`)
    }
    rule.minRun = readRunLength(source, columns, row, rowIndex, '値')
    written = true
  })

  return rule
}

/**
 * 長さのセル（`1:00` のように書く）。分で返す。
 * 30 分の倍数でなければ、切り上げも切り捨てもせずに名指しして止まる。
 */
function readRunLength(source, columns, row, rowIndex, columnName) {
  const cell = cellOf(source, columns, row, rowIndex, columnName)
  const text = typeof cell.value === 'number' ? String(cell.value) : cell.value
  if (!/^\d{1,2}:[0-5]\d$/.test(text)) {
    throw new Error(`${cell.where}が 時:分 でない。いま: ${showBlankValue(text)}（${defaultMinRun} のように書く）`)
  }
  const minutes = toRunMinutes(text)
  if (minutes < slotMinutes || minutes % slotMinutes !== 0) {
    throw new Error(
      `${cell.where}の「${text}」が ${slotMinutes} 分の倍数でない`,
    )
  }
  return minutes
}

/** `1:00` のような長さを分にする。桁が揃っていないので toMinutes とは別にしてある。 */
function toRunMinutes(text) {
  const part = text.split(':')
  return Number(part[0]) * 60 + Number(part[1])
}

/**
 * 型 #6（希望）— 回答の行を 1 行 1 件の型にする（→ 5-1 の #6）。
 * 1 人に複数行あるうちどれを採るか（規則 2 の畳み込み）は、呼ぶ側の取り込む段（#146）が決める。
 */
function toWishes(rows) {
  const wishes = []
  eachFilledRow('回答', answerSection(), rows, (row, rowIndex) => { wishes.push(toWish(row, rowIndex)) })
  return wishes
}

/**
 * 回答 1 行を型にする。乗るのは 学籍番号（大文字）・学年・調理担当ですか？・日ごとの回答 4 つだけである。
 * 日ごとの回答は位置で取り、並びのまま乗せる。何日目かは「日ごとの営業時刻」の行の並びと同じである
 * （→ form-definition.js の formItemsFor）。
 */
function toWish(row, rowIndex) {
  const source = '回答'
  const section = answerSection()
  const columns = section.columns
  checkRowWidth(source, section, row, rowIndex)

  const studentId = readStudentId(source, columns, row, rowIndex)

  const grade = readText(source, columns, row, rowIndex, wishColumns.grade)
  if (grades.indexOf(grade) === -1) {
    throw new Error(
      `${whereIs(source, rowIndex)}の学年「${grade}」が選択肢の外である（${grades.join(' / ')} のどれか）`,
    )
  }

  const cookAnswer = readText(source, columns, row, rowIndex, wishColumns.canCook)
  if (!Object.prototype.hasOwnProperty.call(cookAnswers, cookAnswer)) {
    throw new Error(
      `${whereIs(source, rowIndex)}の${wishColumns.canCook}「${cookAnswer}」が選択肢の外である（${Object.keys(cookAnswers).join(' / ')} のどれか）`,
    )
  }

  return {
    studentId: studentId,
    grade: grade,
    canCook: cookAnswers[cookAnswer],
    answers: dayAnswerColumns().map((at) => readText(source, columns, row, rowIndex, at, true)),
  }
}

/** 日ごとの回答 4 つが、回答シートの何列目か（0 から数える。→ 4-1 の #6〜#9）。名前を持つ列の後ろに並ぶ。 */
function dayAnswerColumns() {
  const section = answerSection()
  const positions = []
  for (let i = 0; i < (section.yearlyColumns || 0); i++) positions.push(section.columns.length + i)
  return positions
}

/** 回答シートの区画（→ sheet-layout.js）。 */
function answerSection() {
  return sheetLayout.filter((layout) => layout.name === '回答')[0].sections[0]
}

/** 条件入力の区画 1 つ。 */
function conditionSection(heading) {
  const section = sheetLayout
    .filter((layout) => layout.name === '条件入力')[0]
    .sections.filter((candidate) => candidate.heading === heading)[0]
  if (!section) throw new Error(`条件入力の区画に「${heading}」が無い`)
  return section
}

/**
 * 中身のある行だけを、区画の中の行番号つきで渡す。
 * 空の行は飛ばすが番号は詰めない。詰めると名指しの「N 行目」がシートの行を指さなくなる。
 */
function eachFilledRow(source, section, rows, use) {
  rows.forEach((row, rowIndex) => {
    checkRowWidth(source, section, row, rowIndex)
    if (row.every((cell) => cell === '')) return
    use(row, rowIndex)
  })
}

/** 名指しの文の前半。区画の中の行番号と、担当者が直すシートの行番号を両方出す。 */
function whereIs(source, rowIndex) {
  const headerRows = headerRowsOf(source)
  if (headerRows === null) return `「${source}」の ${rowIndex + 1} 行目`
  return `「${source}」の ${rowIndex + 1} 行目（シートの ${rowIndex + 1 + headerRows} 行目）`
}

/**
 * 見出しが何行あるか（→ shell.js の headerRowCount）。
 * 割り当てだけは null を返す。日ごとの 4 枚にマス目で載るので、シートの行番号に読み替えられない（→ assignment-grid.js）。
 */
function headerRowsOf(source) {
  if (source === assignmentName) return null
  const layout = sheetLayout.filter((candidate) => (
    candidate.name === source || candidate.sections.some((section) => section.heading === source)
  ))[0]
  if (!layout) throw new Error(`シートの構成に「${source}」が無い`)
  return layout.hasSectionHeadings ? 2 : 1
}

/**
 * 行の列数が構成どおりかを見る。ずれたまま読むと隣の列を別の項目として読む。
 * 見るのは区画の幅である（→ sheet-layout.js の sectionWidth）。「回答」の後ろ 4 列は名前を持たない。
 * verify-structure.js の checkColumnCount と名前を分けてあるのは、.gs がグローバルを共有するからである。
 */
function checkRowWidth(source, section, row, rowIndex) {
  const width = sectionWidth(section)
  if (Array.isArray(row) && row.length === width) return
  throw new Error(
    `${whereIs(source, rowIndex)}の列数が構成と違う。`
      + `いま: ${Array.isArray(row) ? row.length : '配列でない'} ／ 構成: ${width}（${sectionColumnsText(section)}）`,
  )
}

/** 1 セルを取る。列は名前か、何列目か（0 から数える）で指す。 */
function cellOf(source, columns, row, rowIndex, column) {
  const at = typeof column === 'number' ? column : columns.indexOf(column)
  if (at === -1) throw new Error(`「${source}」の構成に「${column}」の列が無い`)
  const which = typeof column === 'number' ? `${at + 1} 列目` : `「${column}」`
  return { value: row[at], where: `${whereIs(source, rowIndex)}の${which}` }
}

/** 文字列のセル。空を許すかどうかだけを外から決める。 */
function readText(source, columns, row, rowIndex, column, blankAllowed) {
  const cell = cellOf(source, columns, row, rowIndex, column)
  const text = typeof cell.value === 'number' ? String(cell.value) : cell.value
  if (text === '' && !blankAllowed) throw new Error(`${cell.where}が空である`)
  return text
}

/**
 * 学籍番号のセル。10 桁の英数字かを見て、大文字に揃えて返す（→ 3 の規則 2 の ①）。
 * 大文字・小文字に意味は無い（→ docs/interviews/02-作る側.md）。揃えるのはここ 1 箇所で、以降は素の等値で比べる。
 */
function readStudentId(source, columns, row, rowIndex) {
  const studentId = readText(source, columns, row, rowIndex, wishColumns.studentId)
  if (!studentIdPattern.test(studentId)) {
    throw new Error(
      `${whereIs(source, rowIndex)}の学籍番号「${studentId}」が形式と違う（10 桁の英数字）`,
    )
  }
  return studentId.toUpperCase()
}

/** 日付のセル。YYYY-MM-DD である（→ shell.js の valueRepresentation）。 */
function readDate(source, columns, row, rowIndex, columnName, blankAllowed) {
  const cell = cellOf(source, columns, row, rowIndex, columnName)
  if (cell.value === '' && blankAllowed) return ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cell.value)) {
    throw new Error(`${cell.where}が YYYY-MM-DD でない。いま: ${showBlankValue(cell.value)}`)
  }
  return cell.value
}

/** 時刻のセル。HH:MM である（→ shell.js の valueRepresentation）。 */
function readTime(source, columns, row, rowIndex, columnName, blankAllowed) {
  const cell = cellOf(source, columns, row, rowIndex, columnName)
  if (cell.value === '' && blankAllowed) return ''
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cell.value)) {
    throw new Error(`${cell.where}が HH:MM でない。いま: ${showBlankValue(cell.value)}`)
  }
  return cell.value
}

/** 人数のセル。数のまま来る（→ shell.js の normalizeValue）。 */
function readCount(source, columns, row, rowIndex, columnName) {
  const cell = cellOf(source, columns, row, rowIndex, columnName)
  if (typeof cell.value !== 'number' || !isFinite(cell.value) || Math.floor(cell.value) !== cell.value || cell.value < 1) {
    throw new Error(`${cell.where}が 1 以上の整数でない。いま: ${showBlankValue(cell.value)}`)
  }
  return cell.value
}

/** HH:MM を分にする。 */
function toMinutes(time) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
}

/** 分を HH:MM に戻す。 */
function toTimeText(minutes) {
  const hour = Math.floor(minutes / 60)
  const minute = minutes - hour * 60
  return `${hour < 10 ? '0' : ''}${hour}:${minute < 10 ? '0' : ''}${minute}`
}

/** 空のセルを、文の中で見える形にする。 */
function showBlankValue(value) {
  return value === '' ? '（空）' : value
}

// Node から読むためだけの口。Apps Script では module が無いので通らない。
if (typeof module !== 'undefined') {
  module.exports = {
    slotMinutes, grades, cookAnswers, prepCleanupItems, placementItems, defaultMinRun, studentIdPattern,
    wishColumns, columnsOutsideWish, inputTypes,
    toType, conditionTypes, toDays, cutSlots, toNeeds, toCookLeaderGrades, toPrepCleanupRule,
    toPlacementRule, readRunLength, toRunMinutes, toWishes, toWish,
    dayAnswerColumns, answerSection, conditionSection, eachFilledRow, whereIs, readStudentId,
  }
}
