/**
 * 生成する側 — 違反 0 の案を 1 つ組み、満たせない枠は埋めずに残す
 * （docs/tech-requirements.md 5 の #6 ／ 8 の 8。方式は 6 の #3、適用の順序は 5-5。issue #151）。
 *
 * 受け取るのは候補（展開する段の出力 → #149）と条件入力の型と希望（型 #6）で、
 * 返すのは割り当てシートの行である（→ sheet-layout.js の「割り当て」）。
 *
 * 違反は 1 件も作らない。破るくらいなら置かない（→ 5-4）。
 * 埋まらなかった枠は、埋めずに残す — 名指しするのは未充足の側である（→ 5-4・name-unmet.js ／ #142）。
 * 「解なし」で止まらない（→ 5 の #6）。置けない枠があっても、そこまでの案をそのまま返す。
 *
 * 外部のソルバーを読まない（→ 6 の #3）。読むのは同じスクリプトの中の関数だけである。
 * 同じ入力からは同じ案が出る — 並べ替えの鍵に入力の外のもの（乱数・時刻・オブジェクトの列挙順）を使わない
 * （→ 6 の #3 の理由 ③）。
 *
 * 需要の読み方（どの枠に何人要るか）は未充足の側と同じ口を使う（→ name-unmet.js の allNeeds・requiredAt）。
 * 同じものを 2 通りに読むと、片方が古くなる（→ src/README.md）。
 *
 * 配列を受けて配列を返す。SpreadsheetApp を 1 度も掴まない（→ 6 の #8）。
 * ここに判断を新しく書かない — 規則は 3 が、方式は 6 の #3 が、適用の順序は 5-5 が持つ（→ src/README.md）。
 *
 * 他のファイルの値をこのファイルの最上位で使わない（→ core.js の同じ注意）。
 */

/**
 * 生成が踏む 5 段（→ 5-5 ／ 6 の #3 ／ 5-3）。踏む順である。
 * 名前で置いてあるのは、どこで何をしているかを隠さないためである。
 */
const generationOrder = [
  {
    key: 'fixed',
    what: '担当者の手直し（固定）を先に置く。条件を破る固定は置かず、名指しで返す（→ 5-3・placeFixed）。'
      + '空のセルの手直しは、その人をその枠の候補から外す',
  },
  {
    key: 'fill',
    what: '制約のきつい枠から順に、営業の役割を埋める（貪欲法 → 5-5 の「埋める順」）。'
      + '1 人を採ったら、隣り合う枠へ「連続して入る最小の長さ」まで伸ばす（→ 5-5 の「まとまり」・placeRun）',
  },
  {
    key: 'swap',
    what: '埋まらなかった枠を、同じ枠の中の役割の入れ替え 1 手で詰める（→ 6 の #3 の「局所的な入れ替え」）',
  },
  {
    key: 'prepCleanup',
    what: '規則 3 の ①〜④ を満たす 準備・片付け を置く（→ 3 の規則 3・5-5）',
  },
  {
    key: 'prepCleanupDemand',
    what: '準備・片付けの需要が残っていれば、帯の中で埋める（→ 5-5 の 4 段目）',
  },
]

/**
 * 生成が目的にしないもの・いま見ないもの。
 * ここに名前で置いてあるのは、やっていないことをコードの上で隠さないためである
 * （→ count-violations.js の violationsNotCounted と同じ置き方）。
 */
const generationNotAimed = [
  {
    what: '規則 3 の ⑥（複数日で偏らせない）',
    why: '上流の △ 5 が決まるまで、違反にも目的関数にも入れない（→ 5-4 の但し書き）。'
      + '枠の中で誰を採るかの同点の順序は決めてあるが、均した量は測らず、順位も閾値も出さない（→ 5-5・5 の #7）。'
      + '1 日の中の散らし（その日にまだ置いた枠が少ない人を先に採る → nextToPlace）は ⑥ を先取りしない'
      + ' — 見ているのはその日だけで、日をまたいだ偏りは測らない（→ issue #215）',
  },
  {
    what: '1 日の上限（例: 中央の 1.5 倍まで）',
    why: '上限を置くと、置けるのに置かない枠が出る（未充足が増える）。'
      + 'どこで切るかは上流の △ 5 に触る（→ 9 の △ 5・issue #215 の「決まっていないこと」）',
  },
  {
    what: '前の周に機械が置いたセル',
    why: '見るのは担当者が書き換えたセル（手直しの印 → assignment-grid.js の fixedNote）だけである。'
      + '前の周の案全体を初期解にすると、どこが人の意思でどこが機械の都合かが消える（→ 5-3 の却下した形）',
  },
  {
    what: '割り当ての 氏名',
    why: '型 #6 に氏名は無い（→ 5-1）。埋めると「7 種類の外を参照しない」（5 の #1）が破れるので、空で置く（→ 5-5）',
  },
]

/**
 * まとまりで置けない端（→ 5-5 の「まとまり」・issue #215）。
 *
 * **「連続して入る最小の長さ」に届かない塊は、必ず出る。**
 * ここに名前で置いてあるのは、どこが例外かをコードの上で隠さないためである
 * （→ violationsNotCounted と同じ置き方）。**規則ではない** — 違反にも未充足にも数えない。
 *
 * 数え直す手（scripts/まとまりと散らし.mjs）は、ここの名前をそのまま読む。
 * 名前を 2 か所に持つと、片方が古くなる（→ src/README.md）。
 */
const runExceptions = [
  {
    key: 'wish',
    what: '希望の切れ目',
    why: 'その人の候補が隣の枠に無い。希望から外れた割り当ては作らない（→ 規則 1・5 の #13）',
  },
  {
    key: 'band',
    what: '帯の切れ目',
    why: '準備帯・調理帯・片付け帯の端である。枠は時刻をまたがない（→ 規則 1 の ①・5-1 の #1）',
  },
  {
    key: 'demand',
    what: '需要の切れ目',
    why: '隣の枠にその役割の需要が無い。委員会の指定が 30 分に乗らないことがある ◎'
      + '（12:00-12:40 → 3 の境界値の表）。指定時間に人を欠かさない側が先である',
  },
  {
    key: 'rule3',
    what: '規則 3 の端',
    why: '伸ばすと、その人のその日の準備・片付けが置けなくなる（→ 5-5 の「置かないほうに倒す所」）。'
      + '3 段目が置く 1 枠も、規則 3 が要るのは「入っていること」なのでここに入る',
  },
  {
    key: 'full',
    what: 'そこしか置けないとき',
    why: '隣の枠は要る人数まで置いてある。まとまりのために超過を作らない。'
      + '人数が足りない枠を埋めるほうが先である（→ 5 の #6）— まとまりを守って未充足を増やさない',
  },
]

/**
 * 候補・条件・希望から、割り当ての行を組む（→ 5 の #6 ／ 5-5）。
 *
 * 受け取るもの
 *   candidates … その人がその日に入れる候補の枠（展開する段の出力 → #149）
 *   conditions … 条件入力の 6 区画を直した型（→ core.js の takeConditions・input-types.js）
 *   wishes     … 希望（型 #6。取り込む段の出力 → #146）。規則 4 の学年と規則 5 の調理可否がここにある
 *   fixed      … 担当者の手直し（→ 5-3。形は sheet-layout.js の fixedColumns）。先に置き、残りを生成する
 *
 * 枠が 1 つも無い年と、需要も手直しも 1 行も無い年は、置く先が無いので 0 行である（「解なし」では止まらない）。
 * 置けなかった手直しは、ここでは返さない — 名指しするのは「固定を照らす」の段である（→ nameFixedConflicts）。
 * どちらも generatePlan を通るので、ここで置かなかったものと、そこで名指しされるものは同じである。
 */
function generate(candidates, conditions, wishes, fixed) {
  return generatePlan(candidates, conditions, wishes, fixed).rows
}

/**
 * 生成の本体。割り当ての行（rows）と、置けなかった手直し（notPlaced。{ fix, why } の配列）の 2 つを返す。
 * 段の関数が返すのは行の配列だけなので（→ core.js の build）、出口を 2 つに分けてある（→ generate ／ nameFixedConflicts）。
 */
function generatePlan(candidates, conditions, wishes, fixed) {
  const held = conditions || {}
  const days = held.days || []
  const needs = allNeeds(held) // → name-unmet.js。必要人数と委員会の指定枠を 1 本に並べる
  if (days.length === 0 || (needs.length === 0 && (fixed || []).length === 0)) return { rows: [], notPlaced: [] }

  // 数えられない需要を黙って落とさない（未充足の側と同じ口で止まる → 5-4）。
  checkEveryNeedLands(needs, days)

  const boundary = noonBoundaryToPlaceBy(held)
  const minRun = minRunSlotsToPlaceBy(held)
  const people = peopleToPlace(candidates, wishes)
  const board = { placed: {} }
  // 需要の単位より先に置く。空のセルの手直しは候補から外すので、置ける人（able）が変わる。
  const notPlaced = placeFixed(board, people, fixed, days, held, wishes, boundary)
  const units = demandUnits(needs, days, people, held)

  fillTightestFirst(board, units, boundary, minRun)
  swapWithinSlot(board, units, boundary)
  // 店の役割が出そろったところで、規則 3 を満たせない日の手直しを外す（→ releaseFixesBreakingRule3）。
  // 外した枠は空くので、もう 1 度埋める。外していなければ、埋め直さない（手直しが無い年の案は動かない）。
  const released = releaseFixesBreakingRule3(board, people, days, boundary)
  if (released.length > 0) {
    fillTightestFirst(board, units, boundary, minRun)
    swapWithinSlot(board, units, boundary)
  }
  addPrepCleanup(board, needs, days, people, boundary)
  fillPrepCleanupDemand(board, prepCleanupUnits(needs, days, people, held), minRun)

  return { rows: assignmentRows(needs, days, people), notPlaced: notPlaced.concat(released) }
}

/**
 * 規則 3 の境目（→ 5-1 の #5）。入っていなければ、置き方が決まらないので止まる。
 * 黙って置くと、規則 3 の ①〜⑤ を満たしているかを見ないまま違反が作られる
 * （→ count-violations.js の同じ止まり方）。
 */
function noonBoundaryToPlaceBy(conditions) {
  const boundary = (conditions.prepCleanupRule || {}).noonBoundary || ''
  if (boundary !== '') return boundary
  throw new Error(
    `条件入力の「準備・片付けのルール」に「${prepCleanupItems.noonBoundary}」が無い。`
      + '規則 3 を満たす置き方が決まらないので、違反を作らずに止まる（→ 5-1 の #5）',
  )
}

/**
 * まとまりの長さを枠の数にする（→ 5-1 の #7・5-5 の「まとまり」）。
 *
 * 入っていなければ既定の 1 時間である（型のほうが既定を持つ → input-types.js の defaultMinRun）ので、
 * ここでは止まらない。枠の刻みに乗らない値で止まるのも型の側である。
 * ここがやるのは、分を枠の数に直すことだけである。
 */
function minRunSlotsToPlaceBy(conditions) {
  const minutes = ((conditions || {}).placementRule || {}).minRun
  if (minutes) return minutes / slotMinutes
  throw new Error(
    '条件入力の「置き方のルール」が型に乗っていない（→ 5-1 の #7）。'
      + `区画が空でも型は既定（${placementItems.minRun}）を持つので、ここが空なのは 6 区画を通っていないということである`,
  )
}

/**
 * 候補と希望を突き合わせて、置く相手 1 人 1 件にする。
 *
 * 候補は「その人がその日に入れる枠」しか持っていない（→ #149）ので、
 * 規則 4（学年）と規則 5（調理可否）を見るには希望（型 #6）が要る。
 * 候補にあって希望に無い学籍番号は、入力の食い違いである — 黙って落とさずに名指しして止まる。
 *
 * 並びは候補に出てきた順（＝ 取り込みが返した順）である。並べ直さない（→ 5-5 の同点の順序）。
 */
function peopleToPlace(candidates, wishes) {
  const wishBy = wishesByStudentId(wishes) // → count-violations.js（1 人 1 件であることも見る）
  const people = []
  const byStudentId = {}

  ;(candidates || []).forEach((candidate) => {
    const wish = wishBy[candidate.studentId]
    if (!wish) {
      throw new Error(
        `候補に学籍番号「${candidate.studentId}」があるのに、希望にその人が無い。`
          + '候補は希望から出るもの（→ 規則 1 ／ #149）なので、黙って落とさずに止まる',
      )
    }
    if (!byStudentId[candidate.studentId]) {
      byStudentId[candidate.studentId] = {
        studentId: candidate.studentId,
        grade: wish.grade,
        canCook: wish.canCook,
        order: people.length,
        slots: {}, // 「日 枠」→ true（候補にある）
        at: {}, // 「日 枠」→ 役割（置いた）
        count: 0,
        on: {}, // 日 → その日に置いた枠の数（散らしの鍵 → nextToPlace）
        fixed: {}, // 「日 枠」→ true（担当者の手直しで置いた。入れ替えで動かさない → swapOnce）
      }
      people.push(byStudentId[candidate.studentId])
    }
    const person = byStudentId[candidate.studentId]
    ;(candidate.slots || []).forEach((slot) => { person.slots[whereKey(candidate.date, slot)] = true })
  })

  return people
}

/**
 * 需要を (日・枠・役割) 1 つずつにほどき、制約のきつい順に並べる（→ 5-5 の「埋める順」）。
 *
 * きつさは「置ける人 − 要る人数」である。少ないほど先に埋める
 * — 後回しにすると、置ける人がほかの枠に取られて埋まらなくなる。
 * 同点は 日 → 枠 → 役割（担当者が需要を書いた順 → name-unmet.js の rolesInOrder）で、
 * 並びは入力だけで決まる（→ 6 の #3 の理由 ③）。
 *
 * 準備・片付けはここに入らない。規則 3 が「その人のその日」から決めるもので、
 * 枠の側から埋めるものではないからである（→ addPrepCleanup）。
 */
function demandUnits(needs, days, people, conditions) {
  const order = rolesInOrder(needs)
  const units = []

  days.forEach((day, dayIndex) => {
    day.slots.forEach((slot, slotIndex) => {
      order.forEach((role, roleIndex) => {
        // 準備・片付けはここに入らない。規則 3 が「その人のその日」から決めるもので、
        // 先に埋めると、まだ決まっていない店の役割の側が ②〜④ を動かす（→ addPrepCleanup）。
        // 需要が残っているぶんは、規則 3 を満たした後に 4 段目が埋める（→ fillPrepCleanupDemand）。
        if (prepCleanupRoles().indexOf(role) !== -1) return
        const required = requiredAt(needs, day, slot, role).count // → name-unmet.js
        if (required === 0) return
        const able = people.filter((person) => canStandAt(person, day, slot, role, conditions))
        units.push({
          day: day,
          dayIndex: dayIndex,
          slot: slot,
          slotIndex: slotIndex,
          role: role,
          roleIndex: roleIndex,
          required: required,
          able: able,
        })
      })
    })
  })

  units.sort((a, b) => (a.able.length - a.required) - (b.able.length - b.required)
    || a.dayIndex - b.dayIndex
    || a.slotIndex - b.slotIndex
    || a.roleIndex - b.roleIndex)
  return units
}

/**
 * その人をその枠のその役割に置けるか — 規則 1・4・5 を 1 か所で見る（→ 3 の規則）。
 *
 *   規則 1 … その枠が、その人のその日の候補にある（→ #149）
 *   規則 4 … 調理責任者の枠は、条件入力の「調理責任者の学年」にある学年の人だけ
 *   規則 5 … 調理の枠（調理責任者を含む → 3 の役割名の表）は、`調理担当ですか？` が はい の人だけ
 *
 * 規則 3 はここで見ない。枠 1 つではなく、その人のその日ぜんぶで決まる（→ prepCleanupStaysPossible）。
 * 役割名は弾かない — 需要に書かれた名前にそのまま置く（→ 規則 6 の ③・5-5）。
 */
function canStandAt(person, day, slot, role, conditions) {
  if (!person.slots[whereKey(day.date, slot)]) return false
  // 準備・片付けは帯の中だけに置く（→ 5-5）。帯の外に書かれた需要は、埋めずに名指しで残す。
  if (prepCleanupRoles().indexOf(role) !== -1 && !isInBand(day, slot, role)) return false
  if (cookRoles.indexOf(role) !== -1 && !person.canCook) return false
  if (role !== ruleRoles.cookLeader) return true

  const allowed = (conditions || {}).cookLeaderGrades || []
  if (allowed.length === 0) {
    throw new Error(
      `条件入力の「調理責任者の学年」に 1 行も無いのに、${ruleRoles.cookLeader} の必要人数が書いてある。`
        + '規則 4 を満たす置き方が決まらないので、違反を作らずに止まる（→ 5-1 の #3）',
    )
  }
  return allowed.indexOf(person.grade) !== -1
}

/**
 * その人をその枠に置いても、規則 3 の ①〜⑤ を満たせるか（→ 3 の規則 3）。
 *
 * 置いた後のその日が午前・午後のどちらに掛かるかを見て、要る帯（準備 ／ 片付け）を決め、
 * その帯に「候補にあって、まだ置いていない」枠が 1 つ以上残るかを見る。
 * 残らないなら置かない — 「破るくらいなら置かない」（→ 5-4）。
 *
 * 置くたびにこれを見ておくと、帯の枠が最後まで 1 つ残る。
 * 後から準備・片付けを置く段（→ addPrepCleanup）が置き場所に困らないのは、このためである。
 *
 * role を渡すと、その役割で置いたものとして見る（→ whyPrepCleanupBreaks）。渡さなければ店の役割である。
 */
function prepCleanupStaysPossible(person, day, slot, boundary, role) {
  return whyPrepCleanupBreaks(person, day, slot, boundary, role) === null
}

/**
 * 規則 3 を満たせなくなるなら、どう満たせないかの文を返す。満たせるなら null である。
 *
 * 準備・片付けにもう入っているなら、向きはそこで決まっている（→ count-violations.js の prepCleanupDetail）。
 * 入っているのは担当者の手直しだけである — 生成が準備・片付けを置くのは 3 段目からで、店の役割より後だからである。
 * 手直しは後から外さないので、向きが合わない置き方はしない
 * （午前だけの日に片付けが固定されている人を、午前の枠にだけ置く、など）。
 */
function whyPrepCleanupBreaks(person, day, slot, boundary, role) {
  const toBand = prepCleanupRoles().indexOf(role) !== -1
  const after = dayStateOf(person, day, boundary, toBand ? null : slot)
  if (role === ruleRoles.prep) after.prep = true
  if (role === ruleRoles.cleanup) after.cleanup = true
  if (!after.morning && !after.afternoon) return null
  if (after.prep || after.cleanup) return prepCleanupDetail(after, boundary)

  let free = 0
  if (after.morning) free += freeBandSlots(person, day, ruleRoles.prep).length
  if (after.afternoon) free += freeBandSlots(person, day, ruleRoles.cleanup).length

  // これから置く枠が、要る帯の中にあるなら、その 1 枠はもう使えない。
  if (after.morning && isInBand(day, slot, ruleRoles.prep)) free -= 1
  else if (after.afternoon && isInBand(day, slot, ruleRoles.cleanup)) free -= 1

  if (free > 0) return null
  const bands = [after.morning ? ruleRoles.prep : null, after.afternoon ? ruleRoles.cleanup : null].filter(Boolean)
  return `その日の ${bands.join(' ／ ')} の帯に、希望にあって空いている枠が残らない`
}

/**
 * その人のその日が、いまどうなっているか（→ 規則 3 の ①）。
 *
 * 午前・午後を見るのに、準備・片付けの行そのものを見ない — 見ると、入れた結果が入れるかどうかの判定を動かす
 * （→ 3 の「規則が名指しする役割名」・count-violations.js の countPrepCleanupBroken と同じ見方）。
 * 境目に半分かかる枠は、午前と午後の両方に数える。
 * alsoAt を渡すと、その枠にこれから置いたものとして数える。
 */
function dayStateOf(person, day, boundary, alsoAt) {
  const state = { morning: false, afternoon: false, prep: false, cleanup: false }

  day.slots.forEach((slot) => {
    const role = person.at[whereKey(day.date, slot)]
    if (!role) return
    if (role === ruleRoles.prep) { state.prep = true; return }
    if (role === ruleRoles.cleanup) { state.cleanup = true; return }
    markHalfOfDay(state, slot, boundary)
  })
  if (alsoAt) markHalfOfDay(state, alsoAt, boundary)

  return state
}

/** 枠 1 つが午前・午後のどちらに掛かるかを立てる。境目に半分かかる枠は両方に立つ。 */
function markHalfOfDay(state, slot, boundary) {
  if (toMinutes(slot.start) < toMinutes(boundary)) state.morning = true
  if (toMinutes(slot.end) > toMinutes(boundary)) state.afternoon = true
}

// 帯の定義（prepCleanupBands ／ prepCleanupRoles ／ isInBand ／ rule3Applies）は count-violations.js が持つ。
// 数える側（name-unmet.js）も同じものを読むので、規則の側に 1 つだけ置いてある（→ src/README.md）。

/** その人が、その帯でまだ置ける枠（候補にあって、まだ置いていないもの）。並びはその日の枠の順である。 */
function freeBandSlots(person, day, role) {
  return (day.slots || []).filter((slot) => (
    isInBand(day, slot, role) && person.slots[whereKey(day.date, slot)] && isFreeAt(person, day.date, slot)
  ))
}

/**
 * 制約のきつい枠から順に埋める（→ generationOrder の 1 段目・6 の #3）。
 * 置ける人が尽きたら、その枠はそこまでである。埋めずに次へ行く（→ 5 の #6）。
 *
 * 1 人採ったら、その場で隣の枠へ伸ばす（→ placeRun）。枠ごとに採り直すと、
 * 同じ人が 30 分ごとに持ち場を変える案になる（→ issue #215 の ①）。
 */
function fillTightestFirst(board, units, boundary, minRun) {
  const canTake = (person, unit) => isOpenFor(person, unit, boundary)
  units.forEach((unit) => {
    while (placedCount(board, unit.day.date, unit.slot, unit.role) < unit.required) {
      const person = nextToPlace(unit, boundary)
      if (!person) return
      placeRun(board, units, person, unit, canTake, minRun)
    }
  })
}

/**
 * 1 人を、その枠から「連続して入る最小の長さ」まで伸ばして置く（→ 5-5 の「まとまり」・5-1 の #7）。
 *
 * **同じ日・同じ役割の、隣り合う枠**にだけ伸ばす。前へ伸ばすのは、後ろで届かなかったぶんだけである
 * （枠は日の頭から順に埋まるので、ふつうは後ろで足りる）。
 *
 * 届かないことは必ずある。**どこで止まったかは名前で持ってある**（→ runExceptions）。
 * 届かないからといって置かない、はしない — **人数が足りない枠を埋めるほうが先である**（→ 5 の #6）。
 * 置いた枠の数を返す。
 *
 * 「隣に置けるか」は段から受け取る。段ごとに見るものが違う（1 段目は規則 3 まで見るが、
 * 4 段目は規則 3 の後なので見ない → fillPrepCleanupDemand）ので、
 * 伸ばす側だけ別の見方をすると、最初の 1 枠と続きの枠で置ける条件が食い違う。
 */
function placeRun(board, units, person, unit, canTake, minRun) {
  place(board, person, unit.day.date, unit.slot, unit.role)
  let run = 1
  run += extendRun(board, units, person, unit, canTake, minRun - run, 1)
  if (run < minRun) run += extendRun(board, units, person, unit, canTake, minRun - run, -1)
  return run
}

/**
 * まとまりを片側へ伸ばす。step は 1 が後ろ、-1 が前である。置けた枠の数を返す。
 *
 * 止まる先は runExceptions の 5 つである — 隣の枠が無い（帯の切れ目）／候補に無い（希望の切れ目）／
 * その役割の需要が無い（需要の切れ目）／規則 3 を満たせなくなる（規則 3 の端）／
 * すでに要る人数まで置いてある（そこしか置けないとき）。
 * **超過を作らない** — まとまりのために、要る人数より多く置くことはしない（→ 5-4 の突き合わせ）。
 */
function extendRun(board, units, person, unit, canTake, howMany, step) {
  let added = 0
  let at = unit.slotIndex

  while (added < howMany) {
    const next = nextRunSlot(unit.day, at, step)
    if (!next) return added // 帯の切れ目（隣り合う枠が無い）
    const nextUnit = unitAt(units, unit.day.date, next.slot, unit.role)
    if (!nextUnit) return added // 需要の切れ目
    if (placedCount(board, unit.day.date, next.slot, unit.role) >= nextUnit.required) return added // 埋まっている
    if (nextUnit.able.indexOf(person) === -1) return added // 希望の切れ目（規則 1・4・5 もここに入る）
    if (!canTake(person, nextUnit)) return added // 空いていない ／ 規則 3 の端

    place(board, person, unit.day.date, next.slot, unit.role)
    at = next.index
    added += 1
  }

  return added
}

/**
 * 隣り合う枠（→ 5-5 の「まとまり」）。**時刻が続いている枠だけが隣である。**
 *
 * 枠の列は帯ごとに刻んである（→ 5-1 の #1）ので、配列で隣でも時刻が飛んでいることがある
 * （調理終了 と 片付け開始 のあいだ）。飛んでいる所は帯の切れ目で、まとまりはそこで終わる。
 */
function nextRunSlot(day, index, step) {
  const here = day.slots[index]
  const there = day.slots[index + step]
  if (!here || !there) return null
  const joined = step === 1 ? here.end === there.start : there.end === here.start
  return joined ? { slot: there, index: index + step } : null
}

/**
 * 準備・片付けの枠に置くとき、その日のもう片方の帯に入っている人は取らない。
 * 規則 3 の ④（両方ある → 片方だけ）と同じ向きである。
 * 規則 3 が当たらない日にも、1 人が同じ日の 準備 と 片付け の両方に入ることはしない。
 */
function prepCleanupNotBothBands(person, day, role) {
  if (prepCleanupRoles().indexOf(role) === -1) return true
  const other = prepCleanupRoles().filter((one) => one !== role)[0]
  return !(day.slots || []).some((slot) => person.at[whereKey(day.date, slot)] === other)
}

/**
 * その枠に次に置く 1 人（→ 5-5 の「枠の中で誰を採るか」）。
 *
 * 置ける人（規則 1・4・5）のうち、その枠がまだ空いていて、規則 3 を満たせなくならない人から、
 * その日にまだ置いた枠が少ない順・同数なら通しで置いた数が少ない順・同数なら候補に出てきた順で
 * 1 人取る（→ sortToTake）。
 * 均した量は測らない。⑥ の線はここで引いていない（→ generationNotAimed・5-4 の但し書き）。
 */
function nextToPlace(unit, boundary) {
  const ready = unit.able.filter((person) => isOpenFor(person, unit, boundary))
  sortToTake(ready, unit.day.date)
  return ready.length === 0 ? null : ready[0]
}

/**
 * その人が、その単位の枠でいま空いていて、置いても規則 3 を満たせるか。
 * 置ける人（規則 1・4・5）かどうかは単位の able が持つ（→ demandUnits）ので、ここでは見ない。
 * 採る側（nextToPlace ／ takerFor）と、まとまりを伸ばす側（extendRun）が同じここを読む。
 */
function isOpenFor(person, unit, boundary) {
  return isFreeAt(person, unit.day.date, unit.slot)
    && prepCleanupStaysPossible(person, unit.day, unit.slot, boundary, unit.role)
    && prepCleanupNotBothBands(person, unit.day, unit.role)
}

/**
 * 埋まらなかった枠を、同じ枠の中の役割の入れ替えで詰める（→ generationOrder の 2 段目・6 の #3）。
 *
 * 見るのは 1 手だけである。深く探さない — 決定的であること（6 の #3 の理由 ③）と、
 * 実行時間の上限に当たらないこと（6-1 の #2）のほうを取る。
 */
function swapWithinSlot(board, units, boundary) {
  units.forEach((unit) => {
    while (placedCount(board, unit.day.date, unit.slot, unit.role) < unit.required) {
      if (!swapOnce(board, unit, units, boundary)) return
    }
  })
}

/**
 * 入れ替えを 1 手だけ試す。できたら true を返す。
 *
 * 埋まらない枠に置ける人が、同じ枠の別の役割に入っていて、
 * その役割を代わりに引き受けられる人がその枠で空いているときに、2 人を入れ替える。
 * 枠も日も動かさないので、午前・午後（規則 3 の ①）は動かない。
 * 新しく置く側だけ、帯が残るかを見る（→ prepCleanupStaysPossible）。
 *
 * 準備・片付けに入っている人は動かさない。動かすと、その人のその日の規則 3 が崩れる。
 * 手直しで置いた人も動かさない。担当者が意図して置いた 1 手である（→ 5-3）。
 */
function swapOnce(board, unit, units, boundary) {
  const movable = unit.able.filter((person) => {
    const key = whereKey(unit.day.date, unit.slot)
    const role = person.at[key]
    return role && role !== unit.role && prepCleanupRoles().indexOf(role) === -1 && !person.fixed[key]
  })
  movable.sort((a, b) => a.order - b.order)

  for (let i = 0; i < movable.length; i++) {
    const mover = movable[i]
    const giving = unitAt(units, unit.day.date, unit.slot, mover.at[whereKey(unit.day.date, unit.slot)])
    if (!giving) continue
    const taker = takerFor(giving, mover, boundary)
    if (!taker) continue

    const role = unplace(board, mover, unit.day.date, unit.slot)
    place(board, mover, unit.day.date, unit.slot, unit.role)
    place(board, taker, unit.day.date, unit.slot, role)
    return true
  }
  return false
}

/** 入れ替えで空く側を引き受ける 1 人。選び方は nextToPlace と同じである。 */
function takerFor(giving, mover, boundary) {
  const ready = giving.able.filter((person) => person !== mover && isOpenFor(person, giving, boundary))
  sortToTake(ready, giving.day.date)
  return ready.length === 0 ? null : ready[0]
}

/** (日・枠・役割) の単位を引く。需要の無い役割には単位が無いので、見つからないことがある。 */
function unitAt(units, date, slot, role) {
  return units.filter((unit) => (
    unit.day.date === date && unit.slot.start === slot.start && unit.slot.end === slot.end && unit.role === role
  ))[0]
}

/**
 * 規則 3 の ①〜⑤ を満たす 準備・片付け を置く（→ generationOrder の 3 段目・3 の規則 3）。
 *
 *   ② 午前だけ → 準備に入れる ／ ③ 午後だけ → 片付けに入れる
 *   ④ 両方ある → 片方だけに入れる ／ ⑤ どちらも無い → どちらにも入れない
 *
 * 置く先はその日の帯の中である（→ 5-5）。需要の残っている枠を先に取り、
 * 残っていなければ 1 枠だけ置く — 規則 3 が要るのは「入っていること」であって、帯を全部埋めることではない。
 */
function addPrepCleanup(board, needs, days, people, boundary) {
  days.forEach((day) => {
    people.forEach((person) => {
      const state = dayStateOf(person, day, boundary)
      if (!state.morning && !state.afternoon) return // ⑤ どちらも無い日は、どちらにも入れない
      // 手直しで準備・片付けに入っていて、もう満たしている日は足さない（→ placeFixed・whyPrepCleanupBreaks）。
      if (prepCleanupDetail(state, boundary) === null) return

      const role = prepOrCleanupFor(board, needs, person, day, state)
      if (!role) {
        throw new Error(
          `「${person.studentId}」の ${day.date} に、${ruleRoles.prep} にも ${ruleRoles.cleanup} にも置ける枠が無い。`
            + '置く前の見張りと食い違っている（→ prepCleanupStaysPossible）',
        )
      }
      placeInBand(board, needs, person, day, role)
    })
  })
}

/**
 * 準備・片付けの需要を (日・枠・役割) 1 つずつにほどく（→ 5-5 の 4 段目）。
 * 並びは 日 → 枠 → 役割（担当者が需要を書いた順）で、入力だけで決まる（→ 6 の #3 の理由 ③）。
 * きつさで並べ替えない — 走るのは規則 3 の後で、置ける人はもう動かないからである。
 */
function prepCleanupUnits(needs, days, people, conditions) {
  const order = rolesInOrder(needs).filter((role) => prepCleanupRoles().indexOf(role) !== -1)
  const units = []

  days.forEach((day) => {
    day.slots.forEach((slot, slotIndex) => {
      order.forEach((role) => {
        const required = requiredAt(needs, day, slot, role).count // → name-unmet.js
        if (required === 0) return
        units.push({
          day: day,
          slot: slot,
          // まとまりを伸ばすのに、枠が日の何番目かが要る（→ extendRun）。1 段目の単位と同じ形にしてある。
          slotIndex: slotIndex,
          role: role,
          required: required,
          able: people.filter((person) => canStandAt(person, day, slot, role, conditions)),
        })
      })
    })
  })
  return units
}

/**
 * 規則 3 を満たしたうえで、まだ足りていない 準備・片付け の枠を埋める（→ generationOrder の 4 段目・5-5）。
 *
 * 走るのは addPrepCleanup の後である。**規則 3 が要る人には、そこで先に 1 枠置いてある。**
 * だからここで置くのは、次の 2 つのどちらかだけになる。
 *   ・すでにその帯に入っている人に、同じ帯の枠をもう 1 つ足す
 *   ・**その日に店の役割へ就いていない人**を帯に置く（準備日・片付け日がこれである）
 *
 * 規則 3 の ②〜④ は崩れない — 店の役割に就いた人はもう片方の帯に入っているので、
 * prepCleanupNotBothBands がその人をここで取らない。
 * 午前・午後は店の役割の行からしか立たない（→ dayStateOf）ので、ここで置いても ①〜④ の判定は動かない。
 *
 * 置ける人が尽きたら、その枠はそこまでである。埋めずに次へ行き、未充足として名指しで残る（→ 5 の #6）。
 */
function fillPrepCleanupDemand(board, units, minRun) {
  // 規則 3 はここで見ない。走るのは 3 段目の後で、①〜④ はもう満たしてある（→ 5-5 の 4 段目）。
  const canTake = (person, unit) => (
    isFreeAt(person, unit.day.date, unit.slot) && prepCleanupNotBothBands(person, unit.day, unit.role)
  )
  units.forEach((unit) => {
    while (placedCount(board, unit.day.date, unit.slot, unit.role) < unit.required) {
      const ready = unit.able.filter((person) => canTake(person, unit))
      sortToTake(ready, unit.day.date)
      if (ready.length === 0) return
      // ここでもまとまりで置く（→ placeRun）。準備日・片付け日は役割が 1 つしか無いので交代は起きないが、
      // 学祭 2 日の準備帯・片付け帯は店の役割と同じ日にある（→ issue #215 の「対象外」）。
      placeRun(board, units, ready[0], unit, canTake, minRun)
    }
  })
}

/**
 * その人のその日を、準備と片付けのどちらに入れるか（規則 3 の ②〜④）。
 * 両方ある日（④）は片方だけである。需要が残っているほうを先に取り、
 * どちらも残っていなければ準備を取る（並びは prepCleanupBands の順である）。
 */
function prepOrCleanupFor(board, needs, person, day, state) {
  const wanted = []
  if (state.morning) wanted.push(ruleRoles.prep)
  if (state.afternoon) wanted.push(ruleRoles.cleanup)

  const canDo = wanted.filter((role) => freeBandSlots(person, day, role).length > 0)
  if (canDo.length === 0) return null

  const stillWanted = canDo.filter((role) => wantedBandSlots(board, needs, person, day, role).length > 0)
  return (stillWanted.length > 0 ? stillWanted : canDo)[0]
}

/** その帯のうち、まだ人数が足りていない枠（→ name-unmet.js と同じ数え方である）。 */
function wantedBandSlots(board, needs, person, day, role) {
  return freeBandSlots(person, day, role).filter((slot) => (
    requiredAt(needs, day, slot, role).count > placedCount(board, day.date, slot, role)
  ))
}

/** 帯の中に置く。足りていない枠が 1 つでもあればそこを全部取り、無ければ帯の頭の 1 枠だけ取る。 */
function placeInBand(board, needs, person, day, role) {
  const wanted = wantedBandSlots(board, needs, person, day, role)
  const slots = wanted.length > 0 ? wanted : [freeBandSlots(person, day, role)[0]]
  slots.forEach((slot) => place(board, person, day.date, slot, role))
}

/**
 * 担当者の手直し（固定）を先に置く（→ generationOrder の 1 段目・5-3 ／ issue #156）。
 * 返すのは、置けなかった手直しと、その理由である（{ fix, why } の配列）。
 *
 * **5-3 の 3 つの決めのとおりである。**
 *   ・固定を優先して条件を破ることはしない — 規則 1・4・5 と同じ枠に二重はここで、規則 3 は店の割り当てが出そろってから
 *     （→ releaseFixesBreakingRule3）、生成と同じ見方で見て、破るなら置かない
 *   ・固定を黙って外すこともしない — 置かなかったものは理由と一緒に返り、「固定を照らす」の段が名指しする
 *   ・食い違った固定は、名指しで返す
 *
 * 置く順は 外す印 → 店の役割 → 準備・片付け で、同じ中は 日 → 枠 → 入力の順である（並びは入力だけで決まる → 6 の #3）。
 * 外す印が先なのは、候補から外してから置くためである。準備・片付けが後なのは、同じ日に両方の手直しがあるとき、
 * 名指しされるのが日の後ろのほうに決まるようにするためである（→ whyFixedCannotStay の ④）。
 *
 * **規則 3 は、ここでは見ない。** 規則 3 はその人のその日ぜんぶで決まり、店の割り当てが出そろうまで決まらない
 * — 午前だけの店の手直しでも、生成が午後の枠を足せば ④ で満たす（準備の帯が 0 枠の日でも、片付けで満たせる）。
 * ここで外すと、満たせたはずの 1 手を外すことになる。置いておけば、生成は満たせる向きにしか店の枠を足さない
 * （→ whyPrepCleanupBreaks）。出そろっても満たせない日の手直しは、3 段目の前に外して名指しする
 * （→ releaseFixesBreakingRule3）。
 *
 * 見ないものが 2 つある。**人数の超過**と**帯の外の準備・片付け**である。どちらも違反ではない（→ 5-4）
 * — 超過も帯も生成の置き方であって規則ではなく、担当者の 1 手のほうが先である。
 * 超過になった枠には、生成は人を足さない（要る人数に届いているので → fillTightestFirst）。
 */
function placeFixed(board, people, fixed, days, conditions, wishes, boundary) {
  const byStudentId = {}
  people.forEach((person) => { byStudentId[person.studentId] = person })
  const wishBy = wishesByStudentId(wishes) // → count-violations.js
  const claimed = {}
  const notPlaced = []

  fixedToPlace(fixed, days).forEach((one) => {
    const person = byStudentId[one.studentId]
    const claimKey = `${one.studentId} ${one.date} ${one.start}`

    // 空のセルの手直し — その人をその枠の候補から外す。外す先が無ければ（いまの枠に無い・回答に無い）何もしない。
    if (one.role === '') {
      claimed[claimKey] = true
      if (person && one.slot) delete person.slots[whereKey(one.date, one.slot)]
      return
    }

    const why = whyFixedCannotStay(one, person, wishBy[one.studentId], conditions, boundary, claimed[claimKey])
    claimed[claimKey] = true
    if (why) {
      notPlaced.push({ fix: one, why: why })
      return
    }
    place(board, person, one.date, one.slot, one.role)
    person.fixed[whereKey(one.date, one.slot)] = true
  })

  return notPlaced
}

/** 手直しの行をほどき、置く順に並べる（→ placeFixed の注意）。 */
function fixedToPlace(fixed, days) {
  const at = (row, name) => row[fixedColumns.indexOf(name)]
  const stage = (one) => {
    if (one.role === '') return 0
    return prepCleanupRoles().indexOf(one.role) === -1 ? 1 : 2
  }
  // いまの枠に無い見出しは、その日の枠の後ろに回す（名指しが枠の順に並ぶ）。
  const slotRank = (one) => (one.slotIndex === -1 ? Number.MAX_SAFE_INTEGER : one.slotIndex)

  return (fixed || [])
    .map((row, index) => {
      const date = String(at(row, '日'))
      const start = String(at(row, '開始'))
      const dayIndex = days.map((day) => day.date).indexOf(date)
      const day = days[dayIndex]
      const slotIndex = day ? day.slots.map((slot) => slot.start).indexOf(start) : -1
      return {
        index: index,
        date: date,
        start: start,
        role: String(at(row, '役割')).trim(),
        studentId: String(at(row, '学籍番号')).trim().toUpperCase(),
        day: day,
        dayIndex: dayIndex,
        slot: slotIndex === -1 ? null : day.slots[slotIndex],
        slotIndex: slotIndex,
      }
    })
    .sort((a, b) => stage(a) - stage(b) || a.dayIndex - b.dayIndex || slotRank(a) - slotRank(b) || a.index - b.index)
}

/**
 * 手直し 1 つを置けない理由を返す。置けるなら null である。
 * 見る順は 枠 → 二重 → 規則 1 → 規則 5 → 規則 4 → 規則 3 の ④（準備と片付けの両方）で、最初に当たった 1 つだけを返す。
 * 規則 3 の残り（向きと帯の空き）はここで見ない（→ placeFixed の注意）。
 * 文の頭の名前は、違反を数える側と同じである（→ count-violations.js の violationRules）。
 */
function whyFixedCannotStay(one, person, wish, conditions, boundary, alreadyClaimed) {
  if (!one.slot) {
    return `いまの ${one.date} の枠に「${one.start === '' ? '（空）' : one.start}」が無い`
      + '（条件入力の「日ごとの営業時刻」が動いた）'
  }
  if (alreadyClaimed) return `${labelOf('doubleBooked')}: 同じ人の同じ 30 分枠に、手直しがもう 1 つある`
  if (!wish) return `${labelOf('rule1')}: この人の回答が無い`
  if (!person || !person.slots[whereKey(one.date, one.slot)]) return `${labelOf('rule1')}: 希望の時間の外である`
  if (cookRoles.indexOf(one.role) !== -1 && !person.canCook) {
    return `${labelOf('rule5')}: 調理の枠（${one.role}）だが、${wishColumns.canCook} が ${cookAnswerText(false)} である`
  }
  if (one.role === ruleRoles.cookLeader) {
    const allowed = (conditions || {}).cookLeaderGrades || []
    if (allowed.length === 0) {
      throw new Error(
        `条件入力の「調理責任者の学年」に 1 行も無いのに、${ruleRoles.cookLeader} の手直しがある。`
          + '規則 4 を満たすかが決まらないので、違反を作らずに止まる（→ 5-1 の #3）',
      )
    }
    if (allowed.indexOf(person.grade) === -1) {
      return `${labelOf('rule4')}: ${ruleRoles.cookLeader} の枠だが、学年が ${allowed.join(' / ')} でない（いま: ${person.grade}）`
    }
  }
  if (!prepCleanupNotBothBands(person, one.day, one.role)) {
    const other = prepCleanupRoles().filter((role) => role !== one.role)[0]
    return `${labelOf('rule3')}: その日の ${other} にも手直しで入っていて、片方だけにならない`
  }
  // 規則 3 の残り（向きと帯の空き）は、店の割り当てが出そろってから見る（→ placeFixed の注意・releaseFixesBreakingRule3）。
  return null
}

/**
 * 店の役割が出そろった後で、規則 3 を満たせない日の手直しを外す（→ 5-3 ／ 3 の規則 3）。
 * 返すのは外した手直しと、その理由である（placeFixed と同じ { fix, why } の形）。
 *
 * 満たせないのは、手直しだけで決まった日である。生成は、満たせない向きには店の枠を足さない（→ whyPrepCleanupBreaks）
 * — だから満たせない日に入っているのは手直しだけで、外せば元に戻る。
 *
 * 外す順は、外す手直しが少ないほうからである。
 *   ① 向きの合わない準備・片付け（午前だけの日の片付け ／ 午後だけの日の準備 → ②③）
 *   ② 午前にかかる店の役割（残りが午後だけになり、片付けで満たせるなら）
 *   ③ 午後にかかる店の役割（残りが午前だけになり、準備で満たせるなら）
 *   ④ その日の店の役割ぜんぶ
 * 外した後は、3 段目がその日の正しい側を置く。
 */
function releaseFixesBreakingRule3(board, people, days, boundary) {
  const released = []
  days.forEach((day) => {
    people.forEach((person) => {
      const fixedSlots = day.slots.filter((slot) => person.fixed[whereKey(day.date, slot)])
      if (fixedSlots.length === 0) return
      const gap = rule3Gap(person, day, boundary)
      if (gap === null) return
      const why = `${labelOf('rule3')}: ${gap}`

      const state = dayStateOf(person, day, boundary)
      const misfit = state.morning && !state.afternoon ? ruleRoles.cleanup : ruleRoles.prep
      const isShop = (slot) => prepCleanupRoles().indexOf(person.at[whereKey(day.date, slot)]) === -1
      const tries = [
        fixedSlots.filter((slot) => person.at[whereKey(day.date, slot)] === misfit && (state.morning !== state.afternoon)),
        fixedSlots.filter((slot) => isShop(slot) && toMinutes(slot.start) < toMinutes(boundary)),
        fixedSlots.filter((slot) => isShop(slot) && toMinutes(slot.end) > toMinutes(boundary)),
        fixedSlots.filter(isShop),
      ]
      for (let i = 0; i < tries.length; i++) {
        if (tries[i].length === 0) continue
        const taken = tries[i].map((slot) => ({ slot: slot, role: unplace(board, person, day.date, slot) }))
        if (rule3Gap(person, day, boundary) === null || i === tries.length - 1) {
          taken.forEach((one) => {
            delete person.fixed[whereKey(day.date, one.slot)]
            released.push({
              fix: { date: day.date, start: one.slot.start, role: one.role, studentId: person.studentId, slot: one.slot },
              why: why,
            })
          })
          return
        }
        taken.forEach((one) => place(board, person, day.date, one.slot, one.role))
      }
    })
  })
  return released
}

/**
 * その人のその日が、規則 3 を満たせないなら、どう満たせないかの文を返す。満たせるなら null である。
 * 「満たせる」は、3 段目が準備・片付けを置けば満たすことを含む（帯に、希望にあって空いている枠がある）。
 */
function rule3Gap(person, day, boundary) {
  const state = dayStateOf(person, day, boundary)
  if (!state.morning && !state.afternoon) return null
  if (state.prep || state.cleanup) return prepCleanupDetail(state, boundary)

  const prepFree = freeBandSlots(person, day, ruleRoles.prep).length > 0
  const cleanupFree = freeBandSlots(person, day, ruleRoles.cleanup).length > 0
  if (state.morning && state.afternoon && (prepFree || cleanupFree)) return null
  if (state.morning && !state.afternoon && prepFree) return null
  if (!state.morning && state.afternoon && cleanupFree) return null

  const half = state.morning && state.afternoon ? '午前と午後の両方' : (state.morning ? '午前だけ' : '午後だけ')
  const bands = [state.morning ? ruleRoles.prep : null, state.afternoon ? ruleRoles.cleanup : null].filter(Boolean)
  return `その日の割り当てが${half}にあるが、${bands.join(' ／ ')} の帯に希望にあって空いている枠が無い`
}

/**
 * 「固定を照らす」の段の中身（→ core.js の coreSteps ／ 5-3「食い違った固定は、名指しで返す」／ issue #156）。
 * いまの入力で置けない手直しを、検証結果の行にする。種別は「食い違った固定」である（→ sheet-layout.js の checkKind）。
 *
 * 置けるかどうかは、生成そのもの（generatePlan）を通して見る — 見方を 2 通りに持たない（→ src/README.md）。
 * 規則 3 は、店の割り当てが出そろうまで置けるかが決まらない（→ releaseFixesBreakingRule3）ので、
 * 途中までを別に写すと食い違う。手直しがあるときだけ、生成をもう 1 回通すことになる（手直しが無ければ通さない）。
 * 生成は置けなかった手直しを返さないので、名指しはここだけが持つ。
 * 違反にも未充足にも数えない — 置いていないので、どの枠の人数にも、どの人の割り当てにも入っていない。
 */
function nameFixedConflicts(fixed, candidates, conditions, wishes) {
  if ((fixed || []).length === 0) return []
  return generatePlan(candidates, conditions, wishes, fixed).notPlaced.map((one) => fixedConflictRow(one.fix, one.why))
}

/** 置けなかった手直し 1 つを、検証結果の行にする。終了は、いまの枠に無ければ空である。 */
function fixedConflictRow(one, why) {
  const found = {
    '種別': checkKind.fixConflict,
    '日': one.date,
    '開始': one.start,
    '終了': one.slot ? one.slot.end : '',
    '役割': one.role,
    '学籍番号': one.studentId,
    '氏名': '',
    '内容': why,
    'あと何人': '',
  }
  return sheetColumns('検証結果').map((name) => found[name])
}

/** 置く。台帳と、その人の持ち分（通しの数とその日の数）の両方を動かす。 */
function place(board, person, date, slot, role) {
  person.at[whereKey(date, slot)] = role
  person.count += 1
  person.on[date] = (person.on[date] || 0) + 1
  const key = roleSlotKey(date, slot.start, slot.end, role) // → name-unmet.js
  board.placed[key] = (board.placed[key] || 0) + 1
}

/** 外す。入れ替えのときだけ呼ぶ（→ swapOnce）。外した役割を返す。 */
function unplace(board, person, date, slot) {
  const role = person.at[whereKey(date, slot)]
  if (!role) throw new Error(`「${person.studentId}」の ${date} ${slot.start}-${slot.end} に、外す行が無い`)
  delete person.at[whereKey(date, slot)]
  person.count -= 1
  person.on[date] -= 1
  board.placed[roleSlotKey(date, slot.start, slot.end, role)] -= 1
  return role
}

/** その人が、その日にいま何枠置いてあるか（散らしの鍵 → nextToPlace）。 */
function placedOn(person, date) {
  return person.on[date] || 0
}

/**
 * その枠で誰を先に採るかの並び（→ 5-5 の「枠の中で誰を採るか」）。
 *
 *   ① **その日にまだ置いた枠が少ない人**（1 日の中の散らし。→ issue #215）
 *   ② 通しで置いた数が少ない人
 *   ③ 候補に出てきた順（＝ 取り込みが返した順）
 *
 * ① を足しただけである。**規則にしていない** — 違反にも未充足にも数えない（→ 5-4・generationNotAimed）。
 * 均した量は測らず、順位も閾値も出さない。**規則 3 の ⑥（日をまたいだ偏り）とは別である** — 見るのはその日だけで、
 * ② が残っているので、日をまたいだ同点の順序は動いていない。
 */
function sortToTake(ready, date) {
  ready.sort((a, b) => placedOn(a, date) - placedOn(b, date) || a.count - b.count || a.order - b.order)
  return ready
}

/** その枠のその役割に、いま何人置いてあるか。 */
function placedCount(board, date, slot, role) {
  return board.placed[roleSlotKey(date, slot.start, slot.end, role)] || 0
}

/** その人が、その枠でまだ空いているか（同じ枠に 2 つ置かない → 5-4 の二重）。 */
function isFreeAt(person, date, slot) {
  return !person.at[whereKey(date, slot)]
}

/** 人と枠の鍵。候補にあるか・すでに置いたかを、同じ鍵で引く。 */
function whereKey(date, slot) {
  return `${date} ${slot.start}-${slot.end}`
}

/**
 * 置いた結果を、割り当てシートの行にする（列は sheet-layout.js の「割り当て」）。
 * 並びは 日 → 枠 → 役割（担当者が需要を書いた順）→ 候補に出てきた順である。
 * 需要に無い役割（規則 3 で置いた準備・片付け）は、その枠の後ろに回る。
 */
function assignmentRows(needs, days, people) {
  const order = rolesInOrder(needs) // → name-unmet.js
  const rows = []

  days.forEach((day) => {
    day.slots.forEach((slot) => {
      const here = []
      people.forEach((person) => {
        const role = person.at[whereKey(day.date, slot)]
        if (role) here.push({ role: role, person: person })
      })
      here.sort((a, b) => roleRank(order, a.role) - roleRank(order, b.role) || a.person.order - b.person.order)
      here.forEach((one) => rows.push(assignmentRow(day.date, slot, one.role, one.person.studentId)))
    })
  })

  return rows
}

/** 役割の並び順。需要に無い名前は後ろに回る。 */
function roleRank(order, role) {
  const at = order.indexOf(role)
  return at === -1 ? order.length : at
}

/**
 * 割り当て 1 件を行にする。
 * 氏名は空である — 型 #6 に氏名は無く、埋めると 7 種類の外を参照することになる（→ 5 の #1・5-5）。
 */
function assignmentRow(date, slot, role, studentId) {
  const found = {
    '日': date,
    '開始': slot.start,
    '終了': slot.end,
    '役割': role,
    '学籍番号': studentId,
    '氏名': '',
  }
  return sheetColumns('割り当て').map((name) => found[name])
}

// Node から読むためだけの口。Apps Script では module が無いので通らない。
if (typeof module !== 'undefined') {
  module.exports = {
    generationOrder, generationNotAimed, runExceptions,
    generate, noonBoundaryToPlaceBy, minRunSlotsToPlaceBy, peopleToPlace, demandUnits, canStandAt,
    prepCleanupStaysPossible, whyPrepCleanupBreaks,
    generatePlan, placeFixed, fixedToPlace, whyFixedCannotStay, releaseFixesBreakingRule3, rule3Gap, nameFixedConflicts, fixedConflictRow,
    dayStateOf, markHalfOfDay, freeBandSlots, prepCleanupNotBothBands,
    prepCleanupUnits, fillPrepCleanupDemand,
    fillTightestFirst, placeRun, extendRun, nextRunSlot, nextToPlace, isOpenFor, sortToTake, placedOn,
    swapWithinSlot, swapOnce, takerFor, unitAt,
    addPrepCleanup, prepOrCleanupFor, wantedBandSlots, placeInBand,
    place, unplace, placedCount, isFreeAt, whereKey, assignmentRows, roleRank, assignmentRow,
  }
}
