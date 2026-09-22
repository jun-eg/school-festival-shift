/**
 * 指標を出す側 — docs/tech-requirements.md 8 の 9 ／ 5 の #7（issue #154）。
 *
 * 人ごとに 合計時間・シフト回数・準備回数 ◎ の 3 つを、指標シートの行にする。
 * **並べるだけである。順位付けも閾値も出さない**（→ 5 の #7・上流の △ 5）。
 * 値で並べ替えない ／ 平均や差を出さない ／ 「偏っています」の類を書かない — どれも線を引くことになる。
 * 並びは学籍番号の昇順で、割り当ての 4 枚と同じである（→ assignment-grid.js の toAssignmentGrid）。
 *
 * 何を 1 と数えるかは 5-6 が持つ（→ metricDefinitions）。ここは写しである。
 *
 * 置いた行を読むのは count-violations.js の readAssignments である。
 * 同じ行を 2 通りに読むと、片方が古くなる（→ src/README.md）。
 *
 * 氏名はここで埋めない。型 #6 に氏名は無い（→ 5 の #1）ので、行の氏名は割り当ての行のまま（空）である。
 * 回答から引いて埋めるのは殻である（→ shell.js の writeOutputs・マス目の氏名と同じ手）。
 *
 * 配列を受けて配列を返す。SpreadsheetApp を 1 度も掴まない（→ 6 の #8）。
 * 他のファイルの値をこのファイルの最上位で使わない（→ core.js の同じ注意）。
 */

/**
 * 3 つの値と、それぞれ何を 1 と数えるか（→ 5-6）。
 * 列名は指標シートのものである（→ sheet-layout.js）。
 */
const metricDefinitions = [
  {
    column: '合計時間',
    counts: 'その人に置いた枠の長さの合計を、時間で出す（30 分枠 1 つ ＝ 0.5）。準備・片付けの枠も含める',
  },
  {
    column: 'シフト回数',
    counts: '塊の数。塊は、同じ人・同じ日で同じ役割が、時刻の続いた枠に続いた区間である（→ 5-5 の「まとまり」）。'
      + '役割が変われば別の塊である',
  },
  {
    column: '準備回数',
    counts: '準備か片付けに入った日の数。同じ日に何枠入っても 1 である',
  },
]

/**
 * 人ごとの 3 つの値を、指標シートの行にする（→ 5 の #7）。
 *
 * 受け取るもの
 *   assignments … 割り当ての行（生成する段の出力 → #151。手直しを積んだ後もこの形である → 5-3）
 *   conditions  … 条件入力の型（→ core.js の takeConditions）。枠に乗っているかを readAssignments が見る
 *   wishes      … 希望（型 #6。1 人 1 件）。**1 枠も置かれなかった人も 0 で並べる**ために受け取る
 *
 * 1 枠も置かれない人を落とさない — 落とすと、いちばん偏っている人が指標から消える。
 * 希望に無い学籍番号が割り当てにあれば（手直しで足された人）、その人も並べる。
 */
function fairnessMetrics(assignments, conditions, wishes) {
  const placed = readAssignments(assignments || [], conditions || {})
  const byPerson = {}

  ;(wishes || []).forEach((wish) => { byPerson[wish.studentId] = [] })
  placed.forEach((one) => {
    if (!byPerson[one.studentId]) byPerson[one.studentId] = []
    byPerson[one.studentId].push(one)
  })

  return Object.keys(byPerson)
    .sort()
    .map((studentId) => metricRow(studentId, byPerson[studentId]))
}

/**
 * 1 人ぶんの行。同じ枠・同じ役割に 2 行あっても 1 枠と数える
 * — 二重は違反の側が数えるもので（→ 5-4）、ここで 2 回数えると指標に二重が混ざる。
 */
function metricRow(studentId, rows) {
  const slots = distinctSlots(rows)
  const values = {
    '学籍番号': studentId,
    '氏名': rows.length > 0 ? rows[0].name : '',
    '合計時間': totalHours(slots),
    'シフト回数': countRuns(slots),
    '準備回数': countPrepCleanupDays(slots),
  }
  return sheetColumns('指標').map((name) => values[name])
}

/** (日・枠・役割) の重なりを 1 つに畳む。 */
function distinctSlots(rows) {
  const seen = {}
  const slots = []
  rows.forEach((one) => {
    const key = `${one.date} ${one.start}-${one.end} ${one.role}`
    if (seen[key]) return
    seen[key] = true
    slots.push(one)
  })
  return slots
}

/** 枠の長さの合計を時間で出す。30 分と決め打ちしない — 長さは枠の時刻そのものから出す。 */
function totalHours(slots) {
  const minutes = slots.reduce((sum, one) => sum + toMinutes(one.end) - toMinutes(one.start), 0)
  return minutes / 60
}

/**
 * 塊の数（→ 5-5 の「まとまり」）。同じ日・同じ役割の枠を時刻順に並べ、
 * **前の枠の終わりと次の枠の始まりが一致しなければ**、そこで塊が切れる。
 * 枠は帯ごとに刻んであるので、並びで隣でも時刻が飛ぶことがある（→ generate.js の nextRunSlot と同じ見方）。
 */
function countRuns(slots) {
  const byDayRole = {}
  slots.forEach((one) => {
    const key = `${one.date} ${one.role}`
    if (!byDayRole[key]) byDayRole[key] = []
    byDayRole[key].push(one)
  })

  let runs = 0
  Object.keys(byDayRole).forEach((key) => {
    const ordered = byDayRole[key].slice().sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
    ordered.forEach((one, index) => {
      if (index === 0 || ordered[index - 1].end !== one.start) runs += 1
    })
  })
  return runs
}

/** 準備か片付けに入った日の数（→ 3 の「規則が名指しする役割名」・count-violations.js の prepCleanupRoles）。 */
function countPrepCleanupDays(slots) {
  const roles = prepCleanupRoles()
  const days = []
  slots.forEach((one) => {
    if (roles.indexOf(one.role) === -1) return
    if (days.indexOf(one.date) === -1) days.push(one.date)
  })
  return days.length
}

// Node から読むためだけの口。Apps Script では module が無いので通らない。
if (typeof module !== 'undefined') {
  module.exports = {
    metricDefinitions, fairnessMetrics, metricRow, distinctSlots, totalHours, countRuns, countPrepCleanupDays,
  }
}
