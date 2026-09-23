/**
 * 違反を数える側 — 置いた人が条件を破っている所を、検証結果シートの行にする（docs/tech-requirements.md 5-4）。
 *
 * 数えるのは 5 つで、規則 3 の ⑥（複数日で偏らせない）は数えない（→ violationsNotCounted）。
 * 未充足（人数が足りない）はここが数えない — 混ぜると、違反 0 の案が永久に出ない。
 * 数えるのは生成した案で、前回の確定シフトは食わせない。
 *
 * 配列を受けて配列を返す。SpreadsheetApp を掴まない。
 * 他のファイルの値をこのファイルの最上位で使わない（→ core.js の同じ注意）。
 */

/** 規則が名指しする役割名。割り当ての「役割」の値と突き合わせる（→ 3 の「規則が名指しする役割名」）。 */
const ruleRoles = {
  cookLeader: '調理責任者',
  cook: '調理',
  prep: '準備',
  cleanup: '片付け',
}

/** 規則 5 が見る「調理の枠」の役割名（調理責任者も含む）。 */
const cookRoles = [ruleRoles.cook, ruleRoles.cookLeader]

/**
 * 規則 3 が名指しする 2 つの役割名と、その帯（→ 5-5）。
 * name-unmet.js と generate.js も読むので、実体はここ 1 か所に置く。
 */
function prepCleanupBands() {
  return [
    { role: ruleRoles.prep, from: 'prepStart', to: 'cookStart' },
    { role: ruleRoles.cleanup, from: 'cleanupStart', to: 'cleanupEnd' },
  ]
}

/** 規則 3 が置く 2 つの役割名（→ 3 の役割名の表）。 */
function prepCleanupRoles() {
  return prepCleanupBands().map((band) => band.role)
}

/** その枠が、その役割の帯の中にあるか。 */
function isInBand(day, slot, role) {
  const band = prepCleanupBands().filter((one) => one.role === role)[0]
  if (!band) throw internalError(`準備・片付けの帯に「${role}」が無い（prepCleanupBands と食い違っている）`)
  return toMinutes(slot.start) >= toMinutes(day[band.from]) && toMinutes(slot.end) <= toMinutes(day[band.to])
}

/**
 * 数える違反 5 つ（→ 5-4）。label は検証結果の「内容」の頭に出る名前、what は何を見ているか。
 * label は作成者が読むので、規則の番号ではなく何の条件かで書く（→ issue #249）。key の rule1 などが規則の番号である。
 */
const violationRules = [
  { key: 'rule1', label: '希望時間外', what: '希望の時間の外に置いていない（→ 3 の規則 1）' },
  {
    key: 'rule3',
    label: '準備・片付け',
    what: '午前だけ → 準備 ／ 午後だけ → 片付け ／ 両方 → 片方だけ ／ どちらも無い → 入れない（①〜⑤）',
  },
  { key: 'rule4', label: '調理責任者の学年', what: '調理責任者の枠に置く人は 3 年生または 4 年生である' },
  { key: 'rule5', label: '調理担当', what: '調理の枠に置く人は 調理担当ですか？ が はい である' },
  {
    key: 'doubleBooked',
    label: '同じ時間に二重',
    what: '同じ人が同じ 30 分枠に 2 つ入っている（規則ではない。枠の定義から出る → 5-4）',
  },
]

/** 数えない違反。数えていないことを隠さないために名前で置く。決まったら violationRules へ移す。 */
const violationsNotCounted = [
  {
    rule: '規則 3 の ⑥',
    what: '複数日で偏らせない',
    why: '上流の △ 5（公平をどの指標で判定するか）が決まるまで、線をこちらで引かない（→ 5-4 の但し書き・9 の △ 5）',
  },
]

/**
 * 置いた人が条件を破っている所を、検証結果シートの行にする。
 *
 *   assignments … 割り当ての行（生成する段の出力）
 *   conditions  … 条件入力の 6 区画を直した型（→ core.js の takeConditions）
 *   wishes      … 希望（型 #6。取り込む段の出力）
 *   candidates  … その人がその日に入れる候補の枠（展開する段の出力。形は wishedSlots）
 *
 * 並びは、割り当ての行の順（規則 1 → 4 → 5 → 二重）→ 規則 3（日・学籍番号の順）。
 * 規則 3 は「その人のその日ぜんぶ」を見るので後ろに回す。
 */
function countViolations(assignments, conditions, wishes, candidates) {
  const placed = readAssignments(assignments || [], conditions || {})
  if (placed.length === 0) return []

  const wishBy = wishesByStudentId(wishes)
  const wished = wishedSlots(candidates)
  const firstAt = {}
  const violations = []

  placed.forEach((one) => {
    const key = slotKey(one.studentId, one.date, one.start, one.end)

    // 規則 1 — 希望の時間の外に置いていない
    if (!wished[key]) {
      violations.push(violationRow(
        labelOf('rule1'),
        wishBy[one.studentId]
          ? '希望していない時間に入っています'
          : '希望していない時間に入っています（この人の回答がありません）',
        one,
      ))
    }

    // 規則 4 — 調理責任者の枠に置く人は 3 年生または 4 年生である
    if (one.role === ruleRoles.cookLeader) {
      cookLeaderGradeBroken(one, conditions, wishBy).forEach((row) => violations.push(row))
    }

    // 規則 5 — 調理の枠に置く人は 調理担当ですか？ が はい である
    if (cookRoles.indexOf(one.role) !== -1) {
      cookAnswerBroken(one, wishBy).forEach((row) => violations.push(row))
    }

    // 規則ではない — 同じ人が同じ 30 分枠に二重に入っている
    if (firstAt[key]) {
      violations.push(violationRow(labelOf('doubleBooked'), `同じ時間に 2 つ目の役割が入っています（1 つ目は ${firstAt[key]}）`, one))
    } else {
      firstAt[key] = one.role
    }
  })

  return violations.concat(countPrepCleanupBroken(placed, conditions))
}

/**
 * 規則 4 を 1 行ぶん見る。学年は希望（型 #6）、可とする学年は条件入力（型 #3）が持つ。
 * 回答が無くて学年が分からないときも 1 件にする。
 */
function cookLeaderGradeBroken(one, conditions, wishBy) {
  const allowed = conditions.cookLeaderGrades || []
  if (allowed.length === 0) {
    throw new Error(cookLeaderGradesMissingText)
  }

  const wish = wishBy[one.studentId]
  if (wish && allowed.indexOf(wish.grade) !== -1) return []
  return [violationRow(
    labelOf('rule4'),
    `${ruleRoles.cookLeader}にできる学年（${allowed.join('・')}）ではありません`
      + `（今: ${wish ? wish.grade : 'この人の回答がありません'}）`,
    one,
  )]
}

/** 規則 5 を 1 行ぶん見る（希望の `調理担当ですか？`）。 */
function cookAnswerBroken(one, wishBy) {
  const wish = wishBy[one.studentId]
  if (wish && wish.canCook) return []
  return [violationRow(
    labelOf('rule5'),
    wish
      ? `調理担当ではない人が${one.role}に入っています`
      : `調理担当か分からない人が${one.role}に入っています（この人の回答がありません）`,
    one,
  )]
}

/** 条件入力の「調理責任者の学年」が空で、数えられないときの文。 */
const cookLeaderGradesMissingText = '条件入力の「調理責任者の学年」に学年を書いてください'

/** 条件入力の「午前と午後の境目」が空で、準備・片付けの置き方が決まらないときの文。 */
function noonBoundaryMissingText() {
  return `条件入力の「準備・片付けのルール」に「${prepCleanupItems.noonBoundary}」の時刻を書いてください`
}

/**
 * 規則 3 の ①〜⑤ を数える（→ 3 の規則 3）。
 *
 *   ① その人のその日の割り当てが午前か午後かを見る（境目は「午前と午後の境目」）
 *   ② 午前だけ → 準備 ／ ③ 午後だけ → 片付け
 *   ④ 両方 → 片方だけ ／ ⑤ どちらも無い → 入れない
 *
 * ① で準備・片付けの行は見ない（見ると、入れた結果が判定を動かす）。
 * 境目に半分かかる枠は、午前と午後の両方に数える。1 人 1 日につき 1 行にする。
 */
function countPrepCleanupBroken(placed, conditions) {
  const boundary = (conditions.prepCleanupRule || {}).noonBoundary || ''
  if (boundary === '') throw new Error(noonBoundaryMissingText())

  const perDay = {}
  const order = []
  placed.forEach((one) => {
    const key = `${one.date} ${one.studentId}`
    if (!perDay[key]) {
      perDay[key] = {
        date: one.date, studentId: one.studentId, name: one.name,
        morning: false, afternoon: false, prep: false, cleanup: false,
      }
      order.push(key)
    }
    const day = perDay[key]
    if (one.role === ruleRoles.prep) day.prep = true
    else if (one.role === ruleRoles.cleanup) day.cleanup = true
    else {
      if (toMinutes(one.start) < toMinutes(boundary)) day.morning = true
      if (toMinutes(one.end) > toMinutes(boundary)) day.afternoon = true
    }
  })

  const violations = []
  order.sort().forEach((key) => {
    const day = perDay[key]
    const broken = prepCleanupDetail(day, boundary)
    if (!broken) return
    violations.push(violationRow(labelOf('rule3'), broken, {
      date: day.date, start: '', end: '', role: '', studentId: day.studentId, name: day.name,
    }))
  })
  return violations
}

/**
 * その人のその日が規則 3 の ②〜⑤ を満たしていれば null、でなければ「どれが、どう違うか」の文を返す。
 * 文は作成者が読むので、②〜④ の番号は出さない（→ issue #249）。
 */
function prepCleanupDetail(day, boundary) {
  const now = `境目 ${boundary}。${prepCleanupHeldText(day)}`

  // ④ 両方 → 片方だけ
  if (day.morning && day.afternoon) {
    if (day.prep !== day.cleanup) return null
    return `午前も午後も入っているので、${ruleRoles.prep}か${ruleRoles.cleanup}のどちらか一方だけにしてください（${now}）`
  }
  // ② 午前だけ → 準備
  if (day.morning) {
    if (day.prep && !day.cleanup) return null
    return `午前だけ入っているので、${ruleRoles.prep}だけにしてください（${now}）`
  }
  // ③ 午後だけ → 片付け
  if (day.afternoon) {
    if (day.cleanup && !day.prep) return null
    return `午後だけ入っているので、${ruleRoles.cleanup}だけにしてください（${now}）`
  }
  // ⑤「どちらも無い → 入れない」は当たらなくなった（→ ADR tech-requirements/0009）。
  // 準備・片付けが需要になったので、店の役割が無い日に準備だけ置かれるのはそれ自体が仕事である。
  return null
}

/** 規則 3 の文の「今：準備あり／片付けなし」の部分。 */
function prepCleanupHeldText(day) {
  return `今：${ruleRoles.prep}${day.prep ? 'あり' : 'なし'}／${ruleRoles.cleanup}${day.cleanup ? 'あり' : 'なし'}`
}

/**
 * 検証結果の「内容」が、準備も片付けも入っている規則 3 の違反か（→ issue #258）。
 * 要る方は入っていて、もう一方が余分に入っているだけである。公平性を取るために作成者が意図的に入れる場合がある。
 */
function isPrepCleanupSurplus(content) {
  const text = String(content || '')
  const both = `${prepCleanupHeldText({ prep: true, cleanup: true })}）`
  return text.indexOf(`${labelOf('rule3')}: `) === 0 && text.slice(-both.length) === both
}

/**
 * 割り当ての行を、数えられる形にする（読み方は input-types.js の読み手を借りる）。
 * その日の 30 分枠に無い時間帯の行は、判定できないので名指しして止まる（規則を発明しない）。
 */
function readAssignments(rows, conditions) {
  const source = '割り当て'
  const section = sheetSection(source)
  const columns = section.columns
  const placed = []

  eachFilledRow(source, section, rows, (row, rowIndex) => {
    const one = {
      date: readDate(source, columns, row, rowIndex, '日'),
      start: readTime(source, columns, row, rowIndex, '開始'),
      end: readTime(source, columns, row, rowIndex, '終了'),
      role: readText(source, columns, row, rowIndex, '役割'),
      studentId: readStudentId(source, columns, row, rowIndex), // 大文字に揃う
      name: readText(source, columns, row, rowIndex, '氏名', true),
    }
    checkOnSlot(source, rowIndex, one, conditions.days)
    placed.push(one)
  })

  return placed
}

/** 行が、その日の 30 分枠のどれかに乗っているかを見る。 */
function checkOnSlot(source, rowIndex, one, days) {
  const day = (days || []).filter((candidate) => candidate.date === one.date)[0]
  if (!day) {
    throw internalError(
      `${whereIs(source, rowIndex)}の「${one.date}」が、条件入力の「日ごとの営業時刻」に無い`,
    )
  }
  if (day.slots.some((slot) => slot.start === one.start && slot.end === one.end)) return
  throw internalError(
    `${whereIs(source, rowIndex)}の ${one.start}-${one.end} が、その日の 30 分枠に無い`,
  )
}

/**
 * 希望（型 #6）を学籍番号で引ける形にする。規則 2 で 1 人 1 件に畳まれているはずなので、2 件あれば止まる。
 * 学籍番号は読むときに大文字へ揃っている（→ input-types.js の readStudentId）ので、素の等値で繋がる。
 */
function wishesByStudentId(wishes) {
  const all = wishes || []
  const byId = {}
  all.forEach((wish) => {
    if (byId[wish.studentId]) {
      throw internalError(
        `希望に学籍番号「${wish.studentId}」が 2 件ある（規則 2 で 1 人 1 件に畳まれていない）`,
      )
    }
    byId[wish.studentId] = wish
  })
  return byId
}

/**
 * 候補（{ studentId, date, slots: [{ start, end }] } の配列）を、枠で引ける形にする。
 * 同じ人・同じ日の行が 2 つあれば和集合として読む（規則 1 の ④）。
 */
function wishedSlots(candidates) {
  const all = candidates || []
  const wished = {}
  all.forEach((candidate) => {
    const slots = candidate.slots || []
    slots.forEach((slot) => { wished[slotKey(candidate.studentId, candidate.date, slot.start, slot.end)] = true })
  })
  return wished
}

/** 人と枠を 1 つの鍵にする（規則 1 と二重の見つけ方で共用する）。 */
function slotKey(studentId, date, start, end) {
  return `${studentId} ${date} ${start}-${end}`
}

/** 違反 1 件を、検証結果シートの行にする。「あと何人」は未充足の側が使うので空。 */
function violationRow(label, detail, at) {
  const found = {
    '種別': checkKind.violation,
    '日': at.date,
    '開始': at.start,
    '終了': at.end,
    '役割': at.role,
    '学籍番号': at.studentId,
    '氏名': at.name,
    '内容': `${label}: ${detail}`,
    'あと何人': '',
    '候補': '', // 希望から入れられる人は build が入れる（→ core.js の withCandidates）
  }
  return sheetColumns('検証結果').map((name) => found[name])
}

/** 数える違反 5 つのうち 1 つの名前を引く。表に無ければ、そこで止まる。 */
function labelOf(key) {
  const rule = violationRules.filter((row) => row.key === key)[0]
  if (!rule) throw internalError(`数える違反に「${key}」が無い（violationRules と countViolations が食い違っている）`)
  return rule.label
}

/** canCook の真偽を、フォームの選択肢の言葉に戻す（→ input-types.js の cookAnswers）。 */
function cookAnswerText(canCook) {
  return Object.keys(cookAnswers).filter((word) => cookAnswers[word] === canCook)[0]
}

// Node から読むためだけの口。Apps Script では module が無いので通らない。
if (typeof module !== 'undefined') {
  module.exports = {
    ruleRoles, cookRoles, violationRules, violationsNotCounted,
    prepCleanupBands, prepCleanupRoles, isInBand,
    countViolations, cookLeaderGradeBroken, cookAnswerBroken, countPrepCleanupBroken, prepCleanupDetail, prepCleanupHeldText, isPrepCleanupSurplus,
    readAssignments, checkOnSlot, wishesByStudentId, wishedSlots, slotKey, violationRow, labelOf, cookAnswerText,
  }
}
