/**
 * 違反を数える側 — docs/tech-requirements.md 8 の 3（違反の側）／ 5-4（issue #141）。
 *
 * 置いた人が条件を破っている所を、検証結果シートの行にする。
 * 数えるのは 5 つで、規則 3 の ⑥（複数日で偏らせない）は数えない
 * （→ violationRules ／ violationsNotCounted）。
 * 数えていないことを隠さないために、数えない側も名前で置いてある（→ issue #141 の受け入れ条件）。
 *
 * 未充足（人数が足りない）はここが数えない。別に数えて、同じ 1 枚に種別で分けて並べる（→ 5-4・#142）。
 * 分けないと、人数が足りない枠がそのまま必要人数の違反になり、違反 0 の案が永久に出ない。
 *
 * 前回の確定シフトを、ここに食わせない。数えるのは生成した案であって、
 * 前回の記録は M1 ① の入力（型に乗るかだけを見る）である（→ 5-4 の但し書き・7）。
 *
 * 配列を受けて配列を返す。SpreadsheetApp を 1 度も掴まない（→ 6 の #8）。
 * ここに判断を新しく書かない — 規則は 3 が、数える／数えないの線は 5-4 が持つ（→ src/README.md）。
 *
 * 他のファイルの値をこのファイルの最上位で使わない（→ core.js の同じ注意）。
 */

/**
 * 規則が名指しする役割名（→ 3 の「規則が名指しする役割名」）。
 * 割り当ての「役割」の値と突き合わせる文字列である。値の出どころは要件定義書の側が持つ。
 */
const ruleRoles = {
  cookLeader: '調理責任者',
  cook: '調理',
  prep: '準備',
  cleanup: '片付け',
}

/** 規則 5 が見る「調理の枠」の役割名。調理責任者も調理の枠に置く人である（→ 3 の同じ表）。 */
const cookRoles = [ruleRoles.cook, ruleRoles.cookLeader]

/**
 * 規則 3 が名指しする 2 つの役割名と、その帯（→ 3 の役割名の表・5-5）。
 *
 * 帯の実体をここに置くのは、**数える側（name-unmet.js）と組む側（generate.js）の両方が読む**からである。
 * 2 か所に持つと、片方が古くなる（→ src/README.md）。
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
  if (!band) throw new Error(`準備・片付けの帯に「${role}」が無い（prepCleanupBands と食い違っている）`)
  return toMinutes(slot.start) >= toMinutes(day[band.from]) && toMinutes(slot.end) <= toMinutes(day[band.to])
}

/**
 * 数える違反 5 つ（→ 5-4 の「違反」の行）。
 * label は検証結果の「内容」の頭に出る名前で、what はその 1 行が何を見ているかである。
 */
const violationRules = [
  { key: 'rule1', label: '規則 1', what: '希望の時間の外に置いていない（→ 3 の規則 1）' },
  {
    key: 'rule3',
    label: '規則 3',
    what: '午前だけ → 準備 ／ 午後だけ → 片付け ／ 両方 → 片方だけ ／ どちらも無い → 入れない（①〜⑤）',
  },
  { key: 'rule4', label: '規則 4', what: '調理責任者の枠に置く人は 3 年生または 4 年生である' },
  { key: 'rule5', label: '規則 5', what: '調理の枠に置く人は 調理担当ですか？ が はい である' },
  {
    key: 'doubleBooked',
    label: '同じ枠に二重',
    what: '同じ人が同じ 30 分枠に 2 つ入っている（規則ではない。枠の定義から出る → 5-4）',
  },
]

/**
 * 数えない違反。ここに名前で置いてあるのは、数えていないことをコードの上で隠さないためである。
 * 待っているものが決まったら、violationRules のほうへ移る（→ 5-4 の但し書き）。
 */
const violationsNotCounted = [
  {
    rule: '規則 3 の ⑥',
    what: '複数日で偏らせない',
    why: '上流の △ 5（公平をどの指標で判定するか）が決まるまで、線をこちらで引かない（→ 5-4 の但し書き・9 の △ 5）',
  },
]

/**
 * 置いた人が条件を破っている所を、検証結果シートの行にする（→ 5-4）。
 *
 * 受け取るもの（どれも配列か、配列を持つ型である）
 *   assignments … 割り当ての行（生成する段の出力 → #151）
 *   conditions  … 条件入力の 6 区画を直した型（→ core.js の takeConditions・input-types.js）
 *   wishes      … 希望（型 #6。取り込む段の出力 → #146）
 *   candidates  … その人がその日に入れる候補の枠（展開する段の出力 → #149。形は wishedSlots）
 *
 * 並びは、割り当ての行の順（規則 1 → 4 → 5 → 二重）→ 規則 3（日・学籍番号の順）である。
 * 規則 3 が後ろなのは、行 1 つではなく「その人のその日ぜんぶ」を見る規則だからである。
 *
 * 置いた行が 1 つも無ければ、違反も 0 件である（生成が無いまま数える側だけを回せる → 8 の 3）。
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
          ? '希望の時間の外に置いている'
          : '希望の時間の外に置いている（この人の回答が無い）',
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

    // 規則ではない — 同じ人が同じ 30 分枠に二重に入っている（→ 5-4）
    if (firstAt[key]) {
      violations.push(violationRow(labelOf('doubleBooked'), `同じ 30 分枠に 2 つ目が入っている（1 つ目は ${firstAt[key]}）`, one))
    } else {
      firstAt[key] = one.role
    }
  })

  return violations.concat(countPrepCleanupBroken(placed, conditions))
}

/**
 * 規則 4 を 1 行ぶん見る。学年を持っているのは希望（型 #6）のほうで、
 * どの学年を可とするかを持っているのが条件入力（型 #3）である（→ 5-1 の #3）。
 * 学年が可の集合に無ければ 1 件、回答が無くて学年が分からなければ同じ 1 件になる（黙って通さない）。
 */
function cookLeaderGradeBroken(one, conditions, wishBy) {
  const allowed = conditions.cookLeaderGrades || []
  if (allowed.length === 0) {
    throw new Error(
      '条件入力の「調理責任者の学年」に 1 行も無い。'
        + '規則 4 を数えられないので、置いた行を黙って通さずに止まる（→ 5-1 の #3）',
    )
  }

  const wish = wishBy[one.studentId]
  if (wish && allowed.indexOf(wish.grade) !== -1) return []
  return [violationRow(
    labelOf('rule4'),
    `${ruleRoles.cookLeader} の枠に置いているが、学年が ${allowed.join(' / ')} でない`
      + `（いま: ${wish ? wish.grade : 'この人の回答が無い'}）`,
    one,
  )]
}

/** 規則 5 を 1 行ぶん見る。見るのは希望（型 #6）の中の `調理担当ですか？` である（→ 5-1 の #6）。 */
function cookAnswerBroken(one, wishBy) {
  const wish = wishBy[one.studentId]
  if (wish && wish.canCook) return []
  return [violationRow(
    labelOf('rule5'),
    `調理の枠（${one.role}）に置いているが、${wishColumns.canCook} が`
      + (wish ? ` ${cookAnswerText(false)} である` : '分からない（この人の回答が無い）'),
    one,
  )]
}

/**
 * 規則 3 の ①〜⑤ を数える（→ 3 の規則 3）。
 *
 *   ① その人のその日の割り当てが午前にあるか午後にあるかを見る（境目は条件入力の「午前と午後の境目」）
 *   ② 午前だけ → 準備に入れる ／ ③ 午後だけ → 片付けに入れる
 *   ④ 両方ある → 準備と片付けの片方だけに入れる ／ ⑤ どちらも無い → どちらにも入れない
 *
 * ① で準備・片付けの行そのものを見ない — 見ると、入れた結果が入れるかどうかの判定を動かす。
 * 境目に半分かかる枠は、午前と午後の両方に数える（枠は営業時刻から刻むので、境目に乗らない年がある）。
 *
 * 1 人 1 日につき 1 行にする。②〜⑤ が壊れているのは枠 1 つではなく、その人のその日のほうである。
 * ⑥（複数日で偏らせない）は数えない（→ violationsNotCounted）。
 */
function countPrepCleanupBroken(placed, conditions) {
  const boundary = (conditions.prepCleanupRule || {}).noonBoundary || ''
  if (boundary === '') {
    throw new Error(
      `条件入力の「準備・片付けのルール」に「${prepCleanupItems.noonBoundary}」が無い。`
        + '規則 3 を数えられないので、置いた行を黙って通さずに止まる（→ 5-1 の #5）',
    )
  }

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
 * その人のその日が規則 3 の ②〜⑤ を満たしているかを見る。
 * 満たしていれば null、満たしていなければ「どれが、どう違うか」の文を返す。
 */
function prepCleanupDetail(day, boundary) {
  const now = `いま: ${day.prep ? ruleRoles.prep + 'に入っている' : ruleRoles.prep + 'に入っていない'}`
    + ` ／ ${day.cleanup ? ruleRoles.cleanup + 'に入っている' : ruleRoles.cleanup + 'に入っていない'}`
  const where = `境目は ${boundary} である`

  if (day.morning && day.afternoon) {
    if (day.prep !== day.cleanup) return null
    return `④ その日の割り当てが午前と午後の両方にあるので、${ruleRoles.prep} と ${ruleRoles.cleanup} の片方だけに入れる。${where}。${now}`
  }
  if (day.morning) {
    if (day.prep && !day.cleanup) return null
    return `② その日の割り当てが午前だけなので、${ruleRoles.prep} に入れて ${ruleRoles.cleanup} には入れない。${where}。${now}`
  }
  if (day.afternoon) {
    if (day.cleanup && !day.prep) return null
    return `③ その日の割り当てが午後だけなので、${ruleRoles.cleanup} に入れて ${ruleRoles.prep} には入れない。${where}。${now}`
  }
  // ⑤「どちらも無い → 入れない」は、当たらなくなった（→ ADR tech-requirements/0009）。
  // ①〜④ が見ているのは「店の役割に就いた人に 準備・片付け を乗せるか」で、
  // 午前・午後は店の役割の行からしか立たない（準備・片付けの行そのものは見ない → ①）。
  // 準備・片付けが需要になった（→ 5-1 の #2・5-5 の 4 段目）ので、
  // 店の役割に就いていない日に 準備 だけ置かれている人は、置かれたことそのものが仕事である。
  // 記録もその形である — `2025-11-01` は `準備` 25 人・店の役割 0 行である（→ data/前回の確定シフト.md）。
  return null
}

/**
 * 割り当ての行を、数えられる形にする。
 *
 * 型にしない。割り当ては 5-1 の 7 種類に入らない — 生成の出力であり、5-3 の固定である。
 * 読むのは、数えるのに要る 6 列だけである（読み方は input-types.js の読み手を借りる）。
 *
 * その日の 30 分枠に無い時間帯の行は、数えずに名指しして止まる。
 * 枠に乗っていない行は規則 1 も規則 3 も判定できず、判定できる規則をここで作ると、
 * 3 に無い規則を発明することになる（→ 5-4「規則として足していない」）。
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
      studentId: readStudentId(source, columns, row, rowIndex), // 大文字に揃う（→ 3 の規則 2 の ①）
      name: readText(source, columns, row, rowIndex, '氏名', true),
    }
    checkOnSlot(source, rowIndex, one, conditions.days)
    placed.push(one)
  })

  return placed
}

/** 行が、その日の 30 分枠のどれかに乗っているかを見る（→ 5-1 の #1・規則 1 の ①）。 */
function checkOnSlot(source, rowIndex, one, days) {
  const day = (days || []).filter((candidate) => candidate.date === one.date)[0]
  if (!day) {
    throw new Error(
      `${whereIs(source, rowIndex)}の「${one.date}」が、条件入力の「日ごとの営業時刻」に無い`,
    )
  }
  if (day.slots.some((slot) => slot.start === one.start && slot.end === one.end)) return
  throw new Error(
    `${whereIs(source, rowIndex)}の ${one.start}-${one.end} が、その日の 30 分枠に無い。`
      + '枠に乗っていない行は、規則 1 も規則 3 も判定できない',
  )
}

/**
 * 希望（型 #6）を学籍番号で引ける形にする。識別キーは学籍番号である ◎（→ 5-1）。
 * 規則 2 の畳み込みを通っていれば 1 人 1 件なので、2 件あれば名指しして止まる（→ 仕様 #4）。
 *
 * 大文字・小文字はここで気にしない — 学籍番号は読むときに大文字へ揃っている
 * （→ input-types.js の readStudentId・3 の規則 2 の ①）ので、割り当ての行と素の等値で繋がる。
 */
function wishesByStudentId(wishes) {
  const all = wishes || []
  const byId = {}
  all.forEach((wish) => {
    if (byId[wish.studentId]) {
      throw new Error(
        `希望に学籍番号「${wish.studentId}」が 2 件ある。`
          + '規則 2 の畳み込みが 1 人 1 件にしていない（→ 仕様 #4）',
      )
    }
    byId[wish.studentId] = wish
  })
  return byId
}

/**
 * 候補（展開する段の出力 → #149）を、枠で引ける形にする。
 * 受けるのは { studentId, date, slots: [{ start, end }] } の配列である
 * — 規則 1 の出力が「その人がその日に入れる候補となる 30 分枠の集合」だからである（→ 仕様 #5）。
 * 同じ人・同じ日の行が 2 つあれば和集合として読む（規則 1 の ④ が和集合である）。
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

/** 人と枠を 1 つの鍵にする。規則 1 の照らし合わせと、二重の見つけ方が同じ鍵で済む。 */
function slotKey(studentId, date, start, end) {
  return `${studentId} ${date} ${start}-${end}`
}

/**
 * 違反 1 件を、検証結果シートの行にする（列は 5-4）。
 * 「あと何人」は空である — 数を出すのは未充足の側である（→ 5-4・#142）。
 */
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
  }
  return sheetColumns('検証結果').map((name) => found[name])
}

/** 数える違反 5 つのうち 1 つの名前を引く。表に無ければ、そこで止まる。 */
function labelOf(key) {
  const rule = violationRules.filter((row) => row.key === key)[0]
  if (!rule) throw new Error(`数える違反に「${key}」が無い（violationRules と countViolations が食い違っている）`)
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
    countViolations, cookLeaderGradeBroken, cookAnswerBroken, countPrepCleanupBroken, prepCleanupDetail,
    readAssignments, checkOnSlot, wishesByStudentId, wishedSlots, slotKey, violationRow, labelOf, cookAnswerText,
  }
}
