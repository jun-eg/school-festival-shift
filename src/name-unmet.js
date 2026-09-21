/**
 * 未充足を名指しする側 — docs/tech-requirements.md 8 の 3（未充足の側）／ 5-4 ／ 規則 6（issue #142）。
 *
 * 人数が足りない枠を、検証結果シートの行にする。埋めずに残し、日・時間帯・役割・あと何人を出す（→ 5-4）。
 * 未充足そのものは 0 でなくてよい。合格の線は「名指しされていない未充足が 0 件」である。
 *
 * 違反（置いた人が条件を破っている）はここが数えない。別に数えて、同じ 1 枚に種別で分けて並べる
 * （→ 5-4・count-violations.js ／ #141）。分けないと、人数が足りない枠がそのまま必要人数の違反になり、
 * 違反 0 の案が永久に出ない。
 *
 * 数えるもとは 2 つで、どちらも (日・時間帯・役割名・人数) の行である（→ unmetSources）。
 * 切り方は希望と逆向きである — 希望は「完全に含まれる枠だけ」（規則 1 の ③）、
 * 需要は「重なる枠すべて」である（→ 5-4 の「未充足は、枠と役割ごとに 1 件である」・3 の境界値の表）。
 *
 * 置いた行を読むのは count-violations.js の readAssignments である。
 * 同じ行を 2 通りに読むと、片方が古くなる（→ src/README.md）。
 *
 * 配列を受けて配列を返す。SpreadsheetApp を 1 度も掴まない（→ 6 の #8）。
 * ここに判断を新しく書かない — 需要の形は 5-1 の #2・#4 が、引き上げ方は規則 6 が、
 * 数える単位は 5-4 が持つ（→ src/README.md）。
 *
 * 他のファイルの値をこのファイルの最上位で使わない（→ core.js の同じ注意）。
 */

/**
 * 未充足を数えるもと 2 つ（→ 5-4 の「未充足」の行）。
 *
 *   key   … 条件の型のキー（→ input-types.js の inputTypes ／ core.js の takeConditions）
 *   label … 検証結果の「内容」の頭に出る名前。言葉は 5-4 の表のものである
 *   what  … その 1 つが枠にどう効くか
 *
 * 区画の見出しはここに書かない。型のほうが持っている（→ sectionOf）。
 */
const unmetSources = [
  {
    key: 'roleNeeds',
    label: '必要人数',
    what: '(日・時間帯・役割名・人数) の行。時間帯を空けた行は、その日の 調理開始〜調理終了 の帯に効く（→ 5-1 の #2）',
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
 * 受け取るもの
 *   assignments … 割り当ての行（生成する段の出力 → #151）
 *   conditions  … 条件入力の 5 区画を直した型（→ core.js の takeConditions・input-types.js）
 *
 * 希望も候補も受け取らない。**足りているかどうかは、置いてある人数と要る人数だけで決まる。**
 * 誰を置けたかは生成の側の話である（→ 5 の #6）。
 *
 * 数える単位は (日・30 分枠・役割) 1 つにつき 1 件である。並びは 枠の順 → 役割の順で、
 * 役割の順は担当者が需要を書いた順である（→ rolesInOrder）。
 *
 * 置いた行が 1 つも無ければ、要る枠が全部未充足である。0 件にはしない
 * — 埋まっていないことを名指しするのがこの側の仕事である（違反の側とは逆である → count-violations.js）。
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

/**
 * 2 つのもとの行を、1 本に並べる（→ unmetSources）。
 * 指定枠を別の入れ物・別の適用経路にしない — #2 と #4 を同じ形式にしたのはそのためである（→ 5-1）。
 */
function allNeeds(conditions) {
  const held = conditions || {}
  const needs = []
  unmetSources.forEach((source) => {
    (held[source.key] || []).forEach((need) => needs.push({ source: source, need: need }))
  })
  return needs
}

/**
 * 需要 1 行が、その枠に効くか。日を受けるのであって、日付の文字列ではない（→ 空けた時間帯の読み）。
 *
 * 日の欄が空なら、日では絞らない（→ 5-1 の #2）。
 * 時間帯の欄が空なら、**その日の `調理開始`〜`調理終了` の帯**である（→ 5-1 の #2・5-4）。
 * 「全枠」ではない — 営業していない帯にまで店の役割の需要が立つ（準備日の朝に `呼び込み` が要ることになる）。
 * 帯の側で決まるので、準備日・片付け日は**調理帯が 0 枠なので需要が立たない**
 * （日ごとに書き分けなくてよい → ADR tech-requirements/0008）。
 *
 * 時間帯が決まったあとの切り方は 1 つである — **重なる枠すべて**に効く（→ 5-4）。
 * 端が触れているだけの枠は重なっていない。**空けた行と書いた行で、切り方を変えていない。**
 */
function needCovers(need, day, slot) {
  if (need.date !== '' && need.date !== day.date) return false
  const from = need.start === '' ? day.cookStart : need.start
  const to = need.start === '' ? day.cookEnd : need.end
  return toMinutes(from) < toMinutes(slot.end) && toMinutes(slot.start) < toMinutes(to)
}

/**
 * その枠・その役割に要る人数と、その数を決めたもとの名前を返す。
 * 受けるのは日そのものである（→ needCovers）。
 *
 * 効く行が複数あれば**最大**を取る。足し合わせない — 規則 6 の ② が「指定人数まで**引き上げる**」であり、
 * その日の調理帯に効く行（5-1 の #2）と時間帯を絞った行が同時に効くのは、
 * 広い 1 行を狭い 1 行が上書きする形だからである（→ 5-4）。
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
 * **同じ人を 2 回数えない** — 同じ枠に二重に入っているのは違反の側が数えるもので（→ 5-4）、
 * ここで 2 人ぶんに数えると、二重が未充足を隠す。
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

/**
 * 需要に出てくる役割名を、出てきた順に並べる。
 * 名前で並べ替えない — 並びが決まっていれば決定的である（→ 6 の #3 の理由 ③）し、
 * 担当者が書いた順のまま出るほうが、条件入力と見比べられる。
 */
function rolesInOrder(needs) {
  const roles = []
  needs.forEach((held) => { if (roles.indexOf(held.need.role) === -1) roles.push(held.need.role) })
  return roles
}

/**
 * どの 30 分枠にも重ならない需要が無いかを見る。
 *
 * 重ならない行は、数えようがないまま消える。黙って落とすと、
 * 「名指しされていない未充足が 0 件」（→ 5-4）が、数え落としのぶんだけ嘘になる。
 * 日が「日ごとの営業時刻」に無い ／ 時間帯が営業時刻の外 ／
 * **時間帯を空けた行なのに、効く日の調理帯が 1 つも立っていない**（→ needCovers）、のどれもここで止まる。
 */
function checkEveryNeedLands(needs, days) {
  needs.forEach((held) => {
    const lands = days.some((day) => day.slots.some((slot) => needCovers(held.need, day, slot)))
    if (lands) return
    throw new Error(
      `条件入力の「${sectionOf(held.source)}」の行（${describeNeed(held.need)}）が、30 分枠に 1 つも重ならない。`
        + '数えられない需要を黙って落とさない'
        + '（日は「日ごとの営業時刻」にあり、時間帯はそこから刻んだ枠に重なっていること。'
        + '時間帯を空けた行が効くのは、その日の 調理開始〜調理終了 の帯である）',
    )
  })
}

/**
 * 需要 1 行を、担当者が条件入力の上で見つけられる形の文にする。
 * 日の空欄は「絞らない」、時間帯の空欄は「その日の調理帯」と書く（→ needCovers）。
 */
function describeNeed(need) {
  const when = need.start === '' ? '時間帯を空けた行（その日の調理帯）' : `${need.start}-${need.end}`
  return `${need.date === '' ? '日を空けた行' : need.date} ／ ${when} ／ ${need.role} ／ ${need.count} 人`
}

/** そのもとが、条件入力のどの区画から来たか（→ input-types.js の inputTypes）。文字列を二重に持たない。 */
function sectionOf(source) {
  const type = inputTypes.filter((candidate) => candidate.key === source.key)[0]
  if (!type) throw new Error(`入力の型に「${source.key}」が無い（unmetSources と inputTypes が食い違っている）`)
  return type.source
}

/**
 * 未充足 1 件を、検証結果シートの行にする（列は 5-4）。
 * 学籍番号と氏名は空である — 未充足は枠の話であって、人の話ではない（人を名指しするのは違反の側である）。
 */
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
    nameUnmet, allNeeds, needCovers, requiredAt, placedPeople, roleSlotKey, rolesInOrder,
    checkEveryNeedLands, describeNeed, sectionOf, unmetRow,
  }
}
