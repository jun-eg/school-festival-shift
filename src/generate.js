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
 * 生成が踏む 3 段（→ 5-5 ／ 6 の #3）。踏む順である。
 * 名前で置いてあるのは、どこで何をしているかを隠さないためである。
 */
const generationOrder = [
  {
    key: 'fill',
    what: '制約のきつい枠から順に、営業の役割を埋める（貪欲法 → 5-5 の「埋める順」）',
  },
  {
    key: 'swap',
    what: '埋まらなかった枠を、同じ枠の中の役割の入れ替え 1 手で詰める（→ 6 の #3 の「局所的な入れ替え」）',
  },
  {
    key: 'prepCleanup',
    what: '規則 3 の ①〜⑤ を満たす 準備・片付け を置く（→ 3 の規則 3・5-5）',
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
      + '枠の中で誰を採るかの同点の順序は決めてあるが、均した量は測らず、順位も閾値も出さない（→ 5-5・5 の #7）',
  },
  {
    what: '5-3 の固定（担当者が割り当てシートに入れた手直し）',
    why: '積むのは別の段である（→ 8 の 11 ／ issue #156）。引数では受け取るが、いまは 1 行も見ない',
  },
  {
    what: '割り当ての 氏名',
    why: '型 #6 に氏名は無い（→ 5-1）。埋めると「6 種類の外を参照しない」（5 の #1）が破れるので、空で置く（→ 5-5）',
  },
]

/**
 * 候補・条件・希望から、割り当ての行を組む（→ 5 の #6 ／ 5-5）。
 *
 * 受け取るもの
 *   candidates … その人がその日に入れる候補の枠（展開する段の出力 → #149）
 *   conditions … 条件入力の 5 区画を直した型（→ core.js の takeConditions・input-types.js）
 *   wishes     … 希望（型 #6。取り込む段の出力 → #146）。規則 4 の学年と規則 5 の調理可否がここにある
 *   fixed      … 前の周の割り当ての行（→ 5-3）。いまは 1 行も見ない（→ generationNotAimed）
 *
 * 需要が 1 行も無い年・枠が 1 つも無い年は、置く先が無いので 0 行である（「解なし」では止まらない）。
 */
function generate(candidates, conditions, wishes, fixed) {
  const held = conditions || {}
  const days = held.days || []
  const needs = allNeeds(held) // → name-unmet.js。必要人数と委員会の指定枠を 1 本に並べる
  if (days.length === 0 || needs.length === 0) return []

  // 数えられない需要を黙って落とさない（未充足の側と同じ口で止まる → 5-4）。
  checkEveryNeedLands(needs, days)

  const boundary = noonBoundaryToPlaceBy(held)
  const people = peopleToPlace(candidates, wishes)
  const board = { placed: {} }
  const units = demandUnits(needs, days, people, held)

  fillTightestFirst(board, units, boundary)
  swapWithinSlot(board, units, boundary)
  addPrepCleanup(board, needs, days, people, boundary)

  return assignmentRows(needs, days, people)
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
 */
function prepCleanupStaysPossible(person, day, slot, boundary) {
  const after = dayStateOf(person, day, boundary, slot)
  if (!after.morning && !after.afternoon) return true

  let free = 0
  if (after.morning) free += freeBandSlots(person, day, ruleRoles.prep).length
  if (after.afternoon) free += freeBandSlots(person, day, ruleRoles.cleanup).length

  // これから置く枠が、要る帯の中にあるなら、その 1 枠はもう使えない。
  if (after.morning && isInBand(day, slot, ruleRoles.prep)) free -= 1
  else if (after.afternoon && isInBand(day, slot, ruleRoles.cleanup)) free -= 1

  return free > 0
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

/**
 * 準備・片付けの帯（→ 5-5 の「準備・片付けをどこに置くか」）。
 * 準備は `準備開始`〜`調理開始`、片付けは `片付け開始`〜`片付け終了` である。
 * 枠は時刻をまたがない（→ 5-1 の #1）ので、その枠が帯の中かは枠の側で決まる。
 */
function prepCleanupBands() {
  return [
    { role: ruleRoles.prep, from: 'prepStart', to: 'cookStart' },
    { role: ruleRoles.cleanup, from: 'cleanupStart', to: 'cleanupEnd' },
  ]
}

/** 規則 3 が置く 2 つの役割名（→ 3 の役割名の表）。枠の側から埋める役割と混ぜない。 */
function prepCleanupRoles() {
  return prepCleanupBands().map((band) => band.role)
}

/** その枠が、その役割の帯の中にあるか。 */
function isInBand(day, slot, role) {
  const band = prepCleanupBands().filter((one) => one.role === role)[0]
  if (!band) throw new Error(`準備・片付けの帯に「${role}」が無い（prepCleanupBands と食い違っている）`)
  return toMinutes(slot.start) >= toMinutes(day[band.from]) && toMinutes(slot.end) <= toMinutes(day[band.to])
}

/** その人が、その帯でまだ置ける枠（候補にあって、まだ置いていないもの）。並びはその日の枠の順である。 */
function freeBandSlots(person, day, role) {
  return (day.slots || []).filter((slot) => (
    isInBand(day, slot, role) && person.slots[whereKey(day.date, slot)] && isFreeAt(person, day.date, slot)
  ))
}

/**
 * 制約のきつい枠から順に埋める（→ generationOrder の 1 段目・6 の #3）。
 * 置ける人が尽きたら、その枠はそこまでである。埋めずに次へ行く（→ 5 の #6）。
 */
function fillTightestFirst(board, units, boundary) {
  units.forEach((unit) => {
    while (placedCount(board, unit.day.date, unit.slot, unit.role) < unit.required) {
      const person = nextToPlace(unit, boundary)
      if (!person) return
      place(board, person, unit.day.date, unit.slot, unit.role)
    }
  })
}

/**
 * その枠に次に置く 1 人（→ 5-5 の「枠の中で誰を採るか」）。
 *
 * 置ける人（規則 1・4・5）のうち、その枠がまだ空いていて、規則 3 を満たせなくならない人から、
 * 置いた数が少ない順・同数なら候補に出てきた順で 1 人取る。
 * 均した量は測らない。⑥ の線はここで引いていない（→ generationNotAimed・5-4 の但し書き）。
 */
function nextToPlace(unit, boundary) {
  const ready = unit.able.filter((person) => (
    isFreeAt(person, unit.day.date, unit.slot) && prepCleanupStaysPossible(person, unit.day, unit.slot, boundary)
  ))
  ready.sort((a, b) => a.count - b.count || a.order - b.order)
  return ready.length === 0 ? null : ready[0]
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
 */
function swapOnce(board, unit, units, boundary) {
  const movable = unit.able.filter((person) => {
    const role = person.at[whereKey(unit.day.date, unit.slot)]
    return role && role !== unit.role && prepCleanupRoles().indexOf(role) === -1
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
  const ready = giving.able.filter((person) => (
    person !== mover
      && isFreeAt(person, giving.day.date, giving.slot)
      && prepCleanupStaysPossible(person, giving.day, giving.slot, boundary)
  ))
  ready.sort((a, b) => a.count - b.count || a.order - b.order)
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

/** 置く。台帳と、その人の持ち分の両方を動かす。 */
function place(board, person, date, slot, role) {
  person.at[whereKey(date, slot)] = role
  person.count += 1
  const key = roleSlotKey(date, slot.start, slot.end, role) // → name-unmet.js
  board.placed[key] = (board.placed[key] || 0) + 1
}

/** 外す。入れ替えのときだけ呼ぶ（→ swapOnce）。外した役割を返す。 */
function unplace(board, person, date, slot) {
  const role = person.at[whereKey(date, slot)]
  if (!role) throw new Error(`「${person.studentId}」の ${date} ${slot.start}-${slot.end} に、外す行が無い`)
  delete person.at[whereKey(date, slot)]
  person.count -= 1
  board.placed[roleSlotKey(date, slot.start, slot.end, role)] -= 1
  return role
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
 * 氏名は空である — 型 #6 に氏名は無く、埋めると 6 種類の外を参照することになる（→ 5 の #1・5-5）。
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
    generationOrder, generationNotAimed,
    generate, noonBoundaryToPlaceBy, peopleToPlace, demandUnits, canStandAt, prepCleanupStaysPossible,
    dayStateOf, markHalfOfDay, prepCleanupBands, prepCleanupRoles, isInBand, freeBandSlots,
    fillTightestFirst, nextToPlace, swapWithinSlot, swapOnce, takerFor, unitAt,
    addPrepCleanup, prepOrCleanupFor, wantedBandSlots, placeInBand,
    place, unplace, placedCount, isFreeAt, whereKey, assignmentRows, roleRank, assignmentRow,
  }
}
