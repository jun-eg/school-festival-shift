/**
 * 入力の型 — docs/tech-requirements.md 5-1 の 6 種類（issue #140 ／ 8 の 4）。
 *
 * 殻が読んだ行の配列を、6 種類の型に直す。ここが通った先には、6 種類の外の値が 1 つも無い
 * （→ 5 の #1）。友達欄が割り当ての材料にならない（→ 5-2）のも、氏名が型に入らないのも、
 * 「型に無いものは型に無い」というだけのことである。
 *
 * ここは判断を新しく書かない。型の実体は 5-1 が、規則は 3 が、列の並びは sheet-layout.js が持つ。
 * 値の表現（YYYY-MM-DD ／ HH:MM ／ 数）を揃えるのは殻の仕事で、ここに来るのは揃った行である
 * （→ core.js の checkRepresentation）。
 *
 * 黙って直さない。揃っていない値は、区画・行・列を名指しして止まる
 * （「満たせない枠は黙って埋めない」→ 5 の #6 と同じ扱いである）。
 *
 * 例外が 1 つある。学籍番号は大文字に揃えて型に乗せる（→ readStudentId・3 の規則 2 の ①）。
 * 直しているのではなく、大文字・小文字に意味が無い ◎ ので、識別キーの形を 1 つに決めている。
 *
 * SpreadsheetApp を 1 度も掴まない（→ 6 の #8）。
 * 他のファイルの値をこのファイルの最上位で使わない（→ core.js の同じ注意）。
 */

/** 枠の刻み幅（→ 5-1 の #1・規則 1 の ①）。 */
const slotMinutes = 30

/** 学年の選択肢。フォームのラジオボタン 4 つの転記である（→ 4-1 の #3）。 */
const grades = ['1年生', '2年生', '3年生', '4年生']

/** `調理担当ですか？` の選択肢（→ 4-1 の #4）。規則 5 が見るのはこの値である。 */
const cookAnswers = { はい: true, いいえ: false }

/** 準備・片付けのルールの区画に書く項目（→ 5-1 の #5・規則 3）。いまは境目 1 つだけである。 */
const prepCleanupItems = { noonBoundary: '午前と午後の境目' }

/** 学籍番号の形式。フォームの正規表現の転記である（→ 4-1 の #1）。識別キーはこれである ◎。 */
const studentIdPattern = /^[A-Za-z0-9]{10}$/

/**
 * 型 #6（希望）が回答シートのどの列から来るか（→ 5-1 の #6）。
 *
 * ここに名前で書けるのは、列名が毎年同じ列だけである。
 * 日ごとの回答文字列 4 つは列名が毎年変わる（列名＝設問の題である → 4-1）ので、
 * 名前ではなく位置で当てる（→ dayAnswerColumns）。
 */
const wishColumns = { studentId: '学籍番号', grade: '学年', canCook: '調理担当ですか？' }

/**
 * 回答シートに名前で並んでいるが、型 #6 に入らない列。
 *   タイムスタンプ … 規則 2 の畳み込みのキーで、畳んだ後の 1 件には残らない（→ 5-1 の #6）
 *   氏名           … 表示のための列である。割り当て・指標の氏名をどこから埋めるかは #151／#154 が決める
 *   一緒に組みたいお友達 … 割り当ての材料にしない（→ 5-2）
 */
const columnsOutsideWish = ['タイムスタンプ', '氏名', '一緒に組みたいお友達']

/**
 * 6 種類の型（→ 5-1）。並びは 5-1 の表の #1〜#6 と同じである。
 *
 *   key    … コアが条件を持つときのキー（→ core.js の takeConditions）
 *   source … その型に直す行がどこから来るか。区画の見出し、またはシートの名前である
 *   build  … 行の配列をその型に直す関数
 *   fields … その型のどこかに現れてよい名前の全部。ここに無い名前が型に出たら、それは 6 種類の外である
 *
 * 型 #6 だけ、build を呼ぶのが core.js の build の入口ではない — 規則 2 の畳み込み（取り込む ／ #146）を
 * 通ってから 1 人 1 件になるので、呼ぶのはその段である。
 *
 * rowIndex は、どの型でも「その区画（シート）の中の何行目か」である。見出しの行は数に入らない。
 * 名指しの文には、シートの行番号も併せて出す（→ whereIs）。
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
]

/**
 * 行の配列を、その型に直す。どの区画から来た行かは型のほうが持っている（→ inputTypes の source）ので、
 * 呼ぶ側は型 1 つと行を渡すだけでよい。
 */
function toType(type, rows) {
  return type.build(rows, type.source)
}

/**
 * 条件入力の 5 区画（型 #1〜#5）。build の入口で行から直すのはここまでである
 * （→ core.js の takeConditions）。型 #6 は規則 2 の畳み込みを通ってからなので、ここに入らない。
 */
function conditionTypes() {
  return inputTypes.filter((type) => type.source !== '回答')
}

/**
 * 型 #1（枠）— 日ごとの営業時刻と、そこから刻んだ 30 分枠の列（→ 5-1 の #1）。
 *
 * 刻むのは時刻と時刻のあいだごとである。枠が 準備開始／調理開始／調理終了／片付け開始 をまたがないので、
 * 「その枠は準備の帯か」が枠の側で決まる。
 * 30 分に足りない端は枠にならない — 規則を足していない。営業時刻から刻んだ枠しか存在しない、
 * というだけである（→ 3 の境界値の表「営業時間の外へ伸びた区間」と同じ形）。
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

/** 時刻が早い順に並んでいるかを見る。逆に書かれた日は、刻む向きが決まらない。 */
function checkAscending(source, rowIndex, day) {
  const order = ['準備開始', '調理開始', '調理終了', '片付け開始', '片付け終了']
  const times = [day.prepStart, day.cookStart, day.cookEnd, day.cleanupStart, day.cleanupEnd]

  for (let i = 1; i < times.length; i++) {
    if (toMinutes(times[i - 1]) <= toMinutes(times[i])) continue
    throw new Error(
      `${whereIs(source, rowIndex)}の時刻が早い順でない。`
        + `「${order[i - 1]}」が ${times[i - 1]} で、「${order[i]}」が ${times[i]} である`,
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
 * 型 #2（役割と必要人数）と 型 #4（委員会の指定枠）— (日・時間帯・役割名・人数) の行の集合。
 *
 * 2 つを同じ形にしてあるのは、指定枠を別扱いにしないためである（→ 5-1 の「#2 と #4 を同じ形式にした理由」）。
 * 空の欄は「絞らない」である — 日と時間帯を空けた行は全枠に効く（→ 5-1 の #2）。
 * 役割名が #2 に無い名前でもよいのは #4 だけだが、それは名前を照らす側（生成 ／ #151）の話で、型は同じである。
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
 * 型 #3（調理責任者の学年条件）— 学年の集合（→ 5-1 の #3・規則 4）。
 * 同じ学年が 2 行あっても集合は 1 つである。どの学年を可とするかだけを持ち、人の学年は型 #6 が持つ。
 */
function toCookLeaderGrades(rows, source) {
  const section = conditionSection(source)
  const columns = section.columns
  const chosen = []

  eachFilledRow(source, section, rows, (row, rowIndex) => {
    const grade = readText(source, columns, row, rowIndex, '学年')
    if (grades.indexOf(grade) === -1) {
      throw new Error(
        `${whereIs(source, rowIndex)}の「${grade}」が学年でない。`
          + `フォームの選択肢は ${grades.join(' / ')} である（→ 4-1 の #3）`,
      )
    }
    if (chosen.indexOf(grade) === -1) chosen.push(grade)
  })

  return chosen
}

/**
 * 型 #5（準備・片付けのルール）— 規則 3 のうち、入力で来るのは境目 1 つだけである（→ 5-1 の #5）。
 * ①〜⑤ は規則そのもの（→ 3 の規則 3）で、⑥ の線は決まっていない（→ 9 の △ 5）。
 *
 * 空のまま走らせても、ここでは止まらない。境目が要るのは規則 3 を適用する段（→ #151）で、
 * 入っていないことを名指しするのはそちらである。
 */
function toPrepCleanupRule(rows, source) {
  const section = conditionSection(source)
  const columns = section.columns
  const rule = { noonBoundary: '' }

  eachFilledRow(source, section, rows, (row, rowIndex) => {
    const item = readText(source, columns, row, rowIndex, '項目')
    if (item !== prepCleanupItems.noonBoundary) {
      throw new Error(
        `${whereIs(source, rowIndex)}の項目「${item}」は決めていない。`
          + `いま書けるのは ${prepCleanupItems.noonBoundary} だけである（→ 5-1 の #5）`,
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
 * 型 #6（希望）— 回答の行を、1 行 1 件の型にする（→ 5-1 の #6）。
 *
 * 呼ぶのは取り込む段（#146）である。1 人に複数行あるうちどれを採るか（規則 2 の畳み込み。
 * キーは学籍番号 ＋ タイムスタンプ ◎）は、ここではなくその段が決める — ここがやるのは形を直すことだけである。
 * 畳み込みに要るタイムスタンプは型に乗らないので、採る 1 行を選ぶのは行のうちである。
 */
function toWishes(rows) {
  const wishes = []
  eachFilledRow('回答', answerSection(), rows, (row, rowIndex) => { wishes.push(toWish(row, rowIndex)) })
  return wishes
}

/**
 * 回答 1 行を型にする。
 * 型に乗るのは 学籍番号・学年・調理担当ですか？・日ごとの回答文字列 4 つだけで、
 * 氏名も友達欄もタイムスタンプも乗らない（→ columnsOutsideWish）。
 * 学籍番号は大文字で乗る（→ readStudentId・3 の規則 2 の ①）。
 *
 * 名前で取るのは前の 6 列だけである。後ろ 4 列は列名が毎年変わる（→ 4-1）ので位置で取り、
 * 型には並びのまま乗せる — 何日目かは、条件入力の「日ごとの営業時刻」の 4 行と同じ並びである
 * （設問をその 4 行から組んでいるからである → form-definition.js の formItemsFor）。
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
      `${whereIs(source, rowIndex)}の学年「${grade}」が選択肢の外である。`
        + `${grades.join(' / ')} である（→ 4-1 の #3）`,
    )
  }

  const cookAnswer = readText(source, columns, row, rowIndex, wishColumns.canCook)
  if (!Object.prototype.hasOwnProperty.call(cookAnswers, cookAnswer)) {
    throw new Error(
      `${whereIs(source, rowIndex)}の${wishColumns.canCook}「${cookAnswer}」が選択肢の外である。`
        + `${Object.keys(cookAnswers).join(' / ')} である（→ 4-1 の #4・規則 5）`,
    )
  }

  return {
    studentId: studentId,
    grade: grade,
    canCook: cookAnswers[cookAnswer],
    answers: dayAnswerColumns().map((at) => readText(source, columns, row, rowIndex, at, true)),
  }
}

/**
 * 日ごとの回答文字列 4 つが、回答シートの何列目か（0 から数える。→ 4-1 の #6〜#9・5-1 の #6）。
 * 構成が名前を持っている列の後ろに、毎年名前が変わる列が並ぶ（→ sheet-layout.js の「回答」）。
 */
function dayAnswerColumns() {
  const section = answerSection()
  const positions = []
  for (let i = 0; i < (section.yearlyColumns || 0); i++) positions.push(section.columns.length + i)
  return positions
}

/** 回答シートの区画。並びの実体は 4-1 である（後ろ 4 列は名前を持たない → sheet-layout.js）。 */
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
 *
 * 途中の空の行は読み飛ばす（担当者が区画のあいだに行を空けることはある）が、番号は詰めない。
 * 詰めると、名指しの「N 行目」が担当者のシートの行を指さなくなる（→ shell.js の readSection）。
 */
function eachFilledRow(source, section, rows, use) {
  rows.forEach((row, rowIndex) => {
    checkRowWidth(source, section, row, rowIndex)
    if (row.every((cell) => cell === '')) return
    use(row, rowIndex)
  })
}

/**
 * 崩れている場所を名指しする文の前半。
 * 区画の中の行番号と、担当者のシートの行番号を両方出す — 担当者が直すのはシートの上である。
 */
function whereIs(source, rowIndex) {
  return `「${source}」の ${rowIndex + 1} 行目（シートの ${rowIndex + 1 + headerRowsOf(source)} 行目）`
}

/** 見出しが何行あるか。区画の見出しを置くシートは 2 行、置かないシートは 1 行である（→ shell.js の headerRowCount）。 */
function headerRowsOf(source) {
  const layout = sheetLayout.filter((candidate) => (
    candidate.name === source || candidate.sections.some((section) => section.heading === source)
  ))[0]
  if (!layout) throw new Error(`シートの構成に「${source}」が無い`)
  return layout.hasSectionHeadings ? 2 : 1
}

/**
 * 行の列数が構成どおりかを見る。ずれたまま読むと、隣の列を別の項目として読むことになる。
 * 見るのは区画の幅であって、列名の数ではない（→ sheet-layout.js の sectionWidth）
 * — 「回答」の後ろ 4 列のように、位置だけ取ってある列があるからである。
 * 名前が verify-structure.js の checkColumnCount と別なのは、Apps Script が .gs で
 * 1 つのグローバルを共有するからである（→ build-template.js の同じ注意）。
 */
function checkRowWidth(source, section, row, rowIndex) {
  const width = sectionWidth(section)
  if (Array.isArray(row) && row.length === width) return
  throw new Error(
    `${whereIs(source, rowIndex)}の列数が構成と違う。`
      + `いま: ${Array.isArray(row) ? row.length : '配列でない'} ／ 構成: ${width}（${sectionColumnsText(section)}）`,
  )
}

/**
 * 1 セルを取る。列の名前で取るのは、構成が名前を持っている列だけである。
 * 名前が毎年変わる列は、何列目か（0 から数える）を渡して位置で取る（→ dayAnswerColumns）。
 */
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
 * 学籍番号のセル。大文字に揃えて返す（→ 3 の規則 2 の ①）。
 *
 * 学籍番号の大文字・小文字に意味は無い ◎（2026-09-22。→ docs/interviews/02-作る側.md）ので、
 * `eed2349987` と `EED2349987` は同じ人である。揃えるのは読むこの 1 箇所で、
 * 以降は素の等値で比べる（→ take-in.js の畳み込み・count-violations.js の照合）。
 *
 * 形式を見るのはここである（→ 4-1 の #1）。10 桁の英数字でなければ名指しして止まる。
 */
function readStudentId(source, columns, row, rowIndex) {
  const studentId = readText(source, columns, row, rowIndex, wishColumns.studentId)
  if (!studentIdPattern.test(studentId)) {
    throw new Error(
      `${whereIs(source, rowIndex)}の学籍番号「${studentId}」が形式と違う。`
        + '10 桁の英数字である（→ 4-1 の #1）',
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

/** HH:MM を分にする。刻むのも、前後を見るのも分で行う。 */
function toMinutes(time) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
}

/** 分を HH:MM に戻す。24:00 を越える値は作らない（時刻が早い順であることを先に見ている）。 */
function toTimeText(minutes) {
  const hour = Math.floor(minutes / 60)
  const minute = minutes - hour * 60
  return `${hour < 10 ? '0' : ''}${hour}:${minute < 10 ? '0' : ''}${minute}`
}

/** 空のセルは、文の中で見えないと場所が読めない（→ verify-structure.js の showBlank）。 */
function showBlankValue(value) {
  return value === '' ? '（空）' : value
}

// Node から読むためだけの口。Apps Script では module が無いので通らない。
if (typeof module !== 'undefined') {
  module.exports = {
    slotMinutes, grades, cookAnswers, prepCleanupItems, studentIdPattern,
    wishColumns, columnsOutsideWish, inputTypes,
    toType, conditionTypes, toDays, cutSlots, toNeeds, toCookLeaderGrades, toPrepCleanupRule, toWishes, toWish,
    dayAnswerColumns, answerSection, conditionSection, eachFilledRow, whereIs, readStudentId,
  }
}
