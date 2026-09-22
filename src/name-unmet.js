/**
 * 未充足を名指しする側（→ docs/tech-requirements.md 5-4 ／ issue #142）。
 *
 * 人数が足りない枠を埋めずに残し、検証結果シートの行にする。合格の線は「名指しされていない未充足が 0 件」である。
 * 違反は数えない（→ count-violations.js）。混ぜると、足りない枠がそのまま違反になり、違反 0 の案が出ない。
 * 需要は希望と逆で「重なる枠すべて」に効く。置いた行の読みは count-violations.js の readAssignments に任せる。
 *
 * 配列を受けて配列を返し、SpreadsheetApp を掴まない。他のファイルの値をこのファイルの最上位で使わない（→ core.js）。
 */

/**
 * 未充足を数えるもと 2 つ（→ 5-4）。
 *
 *   key   … 条件の型のキー（→ input-types.js の inputTypes）
 *   label … 検証結果の「内容」の頭に出る名前
 *   what  … その 1 つが枠にどう効くか
 *
 * 区画の見出しは型が持つ（→ sectionOf）。
 */
const unmetSources = [
  {
    key: 'roleNeeds',
    label: '必要人数',
    what: '(日・時間帯・役割名・人数) の行。時間帯を空けた行は、その役割の帯に効く'
      + '（準備 → 準備帯 ／ 片付け → 片付け帯 ／ それ以外 → 調理帯。→ 5-1 の #2）',
  },
  {
    key: 'committeeNeeds',
    label: '委員会の指定枠',
    what: '重なる 30 分枠すべてで、その役割の必要人数を指定人数まで引き上げる（→ 規則 6 の ②）',
  },
]

/**
 * 人数が足りない枠を、検証結果シートの行にする（→ 5-4）。
 *
 *   assignments … 割り当ての行（生成する段の出力）
 *   conditions  … 条件入力の 6 区画を直した型（→ core.js の takeConditions）
 *
 * 足りているかは置いてある人数と要る人数だけで決まるので、希望は受け取らない。
 * (日・30 分枠・役割) ごとに 1 件で、枠の順 → 役割の順（需要を書いた順）に並ぶ。
 * 置いた行が 0 なら、要る枠が全部未充足になる。
 */
function nameUnmet(assignments, conditions) {
  const needs = allNeeds(conditions)
  if (needs.length === 0) return [] // 需要が 1 行も無ければ、足りない枠も無い

  const days = (conditions || {}).days || []
  checkEveryNeedLands(needs, days)

  const placedAt = placedPeople(readAssignments(assignments || [], conditions || {}))
  const roles = rolesInOrder(needs)
  const unmet = []

  days.forEach((day) => {
    day.slots.forEach((slot) => {
      roles.forEach((role) => {
        const required = requiredAt(needs, day, slot, role)
        if (required.count === 0) return
        const have = (placedAt[roleSlotKey(day.date, slot.start, slot.end, role)] || []).length
        if (have >= required.count) return
        unmet.push(unmetRow(day.date, slot, role, required, have))
      })
    })
  })

  return unmet
}

/** 2 つのもとの行を 1 本に並べる。指定枠を別の適用経路にしないためである（→ 5-1）。 */
function allNeeds(conditions) {
  const held = conditions || {}
  const needs = []
  unmetSources.forEach((source) => {
    (held[source.key] || []).forEach((need) => needs.push({ source: source, need: need }))
  })
  return needs
}

/**
 * 時間帯を空けた行が効く帯。役割で決まる（→ 5-1 の #2）。
 *
 *   `準備`   … その日の `準備開始`〜`調理開始`
 *   `片付け` … その日の `片付け開始`〜`片付け終了`
 *   それ以外 … その日の `調理開始`〜`調理終了`
 *
 * 帯の実体は count-violations.js の prepCleanupBands が持つ。
 * 「全枠」にすると、営業していない帯にまで店の役割の需要が立つ。
 */
function blankBandFor(day, role) {
  const band = prepCleanupBands().filter((one) => one.role === role)[0]
  if (band) return { from: day[band.from], to: day[band.to] }
  return { from: day.cookStart, to: day.cookEnd }
}

/**
 * 需要 1 行が、その枠に効くか。
 * 日の欄が空なら日で絞らず、時間帯の欄が空ならその役割の帯を使う（→ blankBandFor）。
 * 効くのは重なる枠すべてで、端が触れているだけの枠は重なっていない（→ 5-4）。
 */
function needCovers(need, day, slot) {
  if (need.date !== '' && need.date !== day.date) return false
  const span = need.start === '' ? blankBandFor(day, need.role) : { from: need.start, to: need.end }
  return toMinutes(span.from) < toMinutes(slot.end) && toMinutes(slot.start) < toMinutes(span.to)
}

/**
 * その枠・その役割に要る人数と、その数を決めたもとの名前を返す。
 * 効く行が複数あれば、足し合わせず最大を取る。指定枠は「指定人数まで引き上げる」ものだからである（→ 規則 6 の ②）。
 */
function requiredAt(needs, day, slot, role) {
  let count = 0
  const sources = []

  needs.forEach((held) => {
    if (held.need.role !== role) return
    if (!needCovers(held.need, day, slot)) return
    if (held.need.count > count) {
      count = held.need.count
      sources.length = 0
    }
    if (held.need.count === count && sources.indexOf(held.source.label) === -1) sources.push(held.source.label)
  })

  return { count: count, sources: sources }
}

/**
 * 置いてある人を、枠と役割で引ける形にする。
 * 同じ人は 1 回だけ数える。2 人ぶんに数えると、二重（違反の側が数える）が未充足を隠す。
 */
function placedPeople(placed) {
  const at = {}
  placed.forEach((one) => {
    const key = roleSlotKey(one.date, one.start, one.end, one.role)
    if (!at[key]) at[key] = []
    if (at[key].indexOf(one.studentId) === -1) at[key].push(one.studentId)
  })
  return at
}

/** 枠と役割を 1 つの鍵にする。 */
function roleSlotKey(date, start, end, role) {
  return `${date} ${start}-${end} ${role}`
}

/** 需要に出てくる役割名を、出てきた順に並べる。書いた順のほうが条件入力と見比べやすい。 */
function rolesInOrder(needs) {
  const roles = []
  needs.forEach((held) => { if (roles.indexOf(held.need.role) === -1) roles.push(held.need.role) })
  return roles
}

/**
 * どの 30 分枠にも重ならない需要があれば止まる。
 * 黙って落とすと、「名指しされていない未充足が 0 件」が数え落としのぶんだけ嘘になる。
 */
function checkEveryNeedLands(needs, days) {
  needs.forEach((held) => {
    const lands = days.some((day) => day.slots.some((slot) => needCovers(held.need, day, slot)))
    if (lands) return
    throw new Error(
      `条件入力の「${sectionOf(held.source)}」の行（${describeNeed(held.need)}）が、30 分枠に 1 つも重ならない。`
        + '日は「日ごとの営業時刻」にある日に、時間帯は営業時刻の中にすること',
    )
  })
}

/** 需要 1 行を、担当者が条件入力の上で見つけられる形の文にする。 */
function describeNeed(need) {
  const when = need.start === '' ? '時間帯を空けた行（その日の調理帯）' : `${need.start}-${need.end}`
  return `${need.date === '' ? '日を空けた行' : need.date} ／ ${when} ／ ${need.role} ／ ${need.count} 人`
}

/** そのもとが、条件入力のどの区画から来たか（→ input-types.js の inputTypes）。 */
function sectionOf(source) {
  const type = inputTypes.filter((candidate) => candidate.key === source.key)[0]
  if (!type) throw new Error(`入力の型に「${source.key}」が無い（unmetSources と inputTypes が食い違っている）`)
  return type.source
}

/** 未充足 1 件を、検証結果シートの行にする。枠の話なので学籍番号と氏名は空である。 */
function unmetRow(date, slot, role, required, have) {
  const found = {
    '種別': checkKind.unmet,
    '日': date,
    '開始': slot.start,
    '終了': slot.end,
    '役割': role,
    '学籍番号': '',
    '氏名': '',
    '内容': `${required.sources.join(' ／ ')}: ${required.count} 人に対して ${have} 人しか置いていない`,
    'あと何人': required.count - have,
  }
  return sheetColumns('検証結果').map((name) => found[name])
}

// Node から読むためだけの口。Apps Script では module が無いので通らない。
if (typeof module !== 'undefined') {
  module.exports = {
    unmetSources,
    nameUnmet, allNeeds, blankBandFor, needCovers, requiredAt, placedPeople, roleSlotKey, rolesInOrder,
    checkEveryNeedLands, describeNeed, sectionOf, unmetRow,
  }
}
