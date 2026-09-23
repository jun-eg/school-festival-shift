/**
 * 展開する側。粗い希望を、人と日ごとの候補の 30 分枠にする（docs/tech-requirements.md 3 の規則 1 ／ issue #149）。
 * 役割も人数も決めない。どの枠へ置くかは生成の仕事である。
 *
 * 規則 1 の順序
 *   ① その日の営業 5 時刻から 30 分枠を刻む（刻むのは input-types.js の cutSlots。ここは作り直さない）
 *   ② 回答文字列を `,` で区切って区間に分ける
 *   ③ 区間ごとに、区間に完全に含まれる枠だけを取る
 *   ④ 複数区間は和集合を取る
 *
 * 配列を受けて配列を返し、SpreadsheetApp を掴まない。他のファイルの値をこのファイルの最上位で使わない（→ core.js）。
 */

/** 規則 1 の ② の区切り。 */
const intervalSeparator = ','

/** 区間の中の、始端と終端の区切り。 */
const intervalDash = '-'

/** 終日出れないの合図（→ 4-2 の例3）。時刻として展開せず、③ に入る前に落とす。 */
const allDayOff = '00:00-00:00'

/**
 * 回答文字列の 1 区間の形。form-definition.js の wishTimePattern を 1 区間ぶんに切ったもので、形が動いたら一緒に動かす。
 * 時は 0-23 で先頭の 0 は無くてよく、分は 00-59 まで通る。
 */
const wishIntervalPattern = /^(?:[0-9]|[01]\d|2[0-3]):[0-5]\d-(?:[0-9]|[01]\d|2[0-3]):[0-5]\d$/

/**
 * 3 の「境界値と特別扱い」のうち、規則 1 に当たる 4 つ。
 * 規則を足して扱うのは終端 ≤ 始端だけで、残り 3 つは ① と ③ からそのまま出る。
 */
const wishBoundaries = [
  {
    key: 'allDayOff',
    input: allDayOff,
    how: '候補は空集合。時刻として展開しない（③ に入る前に落とす）',
  },
  {
    key: 'outsideBusinessHours',
    input: '営業時間の外へ伸びた区間',
    how: '外側は落ちる。規則を足さない（① で刻んだ枠しか存在しないので、③ が落とす）',
  },
  {
    key: 'halfCoveredSlot',
    input: '区間の端に半分だけかかる枠',
    how: 'その枠を候補に入れない（③ が「完全に含まれる枠だけ」である）',
  },
  {
    key: 'endNotAfterStart',
    input: '終端 ≤ 始端の区間',
    how: '候補を作らない。担当者に名指しで返す。黙って解釈しない',
  },
]

/**
 * 希望（型 #6 → take-in.js）と枠（型 #1）から、{ studentId, date, slots: [{ start, end }] } の配列を返す。
 * 1 人 1 日に 1 件で、候補が 0 枠の日も件として返す。並びは人の順 × 日の順のままである。
 */
function expand(wishes, days) {
  const allDays = days || []
  const allWishes = wishes || []
  const candidates = []

  allWishes.forEach((wish) => {
    checkDayCount(wish, allDays)
    allDays.forEach((day, at) => {
      candidates.push({
        studentId: wish.studentId,
        date: day.date,
        slots: slotsWished(wish.answers[at], day, wish.studentId),
      })
    })
  })

  return candidates
}

/**
 * 1 人・1 日ぶんの回答文字列を、その日の候補の枠にする（規則 1 の ②〜④）。
 * 枠を頭から見て、どれかの区間に完全に含まれれば取る。これで ③ と ④（和集合）を 1 度に取る。
 */
function slotsWished(answer, day, studentId) {
  const intervals = cutIntervals(answer, day, studentId)
  return (day.slots || []).filter((slot) => intervals.some((interval) => holdsSlot(interval, slot)))
}

/**
 * 回答文字列を区間に分ける（規則 1 の ②）。
 * `00:00-00:00` は区間にせず、終端 ≤ 始端は止まる。営業時間の外へ伸びた区間は弾かない（③ で落ちる）。
 */
function cutIntervals(answer, day, studentId) {
  const intervals = []

  String(answer).split(intervalSeparator).forEach((piece) => {
    if (!wishIntervalPattern.test(piece)) {
      throw new Error(
        `${whereWished(studentId, day)}「${showBlankValue(piece)}」は、10:00-15:00 のような時間帯になっていません`,
      )
    }

    const at = piece.indexOf(intervalDash)
    const interval = {
      start: withLeadingZero(piece.slice(0, at)),
      end: withLeadingZero(piece.slice(at + 1)),
    }

    // 終日出れない。先頭の 0 を揃えてから見るので、`0:00-0:00` も落ちる。
    if (`${interval.start}${intervalDash}${interval.end}` === allDayOff) return

    if (toMinutes(interval.end) <= toMinutes(interval.start)) {
      throw new Error(
        `${whereWished(studentId, day)}「${piece}」は、終わりの時刻が始まりより前です`,
      )
    }

    intervals.push(interval)
  })

  return intervals
}

/**
 * 枠が区間に完全に含まれているか（規則 1 の ③）。
 * 重なるだけの枠を取らないのは、本人が居ない時間に割り当てないためである。
 */
function holdsSlot(interval, slot) {
  return toMinutes(slot.start) >= toMinutes(interval.start) && toMinutes(slot.end) <= toMinutes(interval.end)
}

/**
 * 回答の日ごとの列と、条件入力の「日ごとの営業時刻」の行が 1 対 1 で当たるかを見る。
 * 上から順に当てるので、数が違えばどの回答がどの日かが決まらない。
 */
function checkDayCount(wish, days) {
  const answers = (wish.answers || []).length
  if (answers === days.length) return
  throw new Error(
    `条件入力の「日ごとの営業時刻」を ${answers} 日分入れてください（今: ${days.length} 行）`,
  )
}

/** 崩れている場所を名指しする文の前半。 */
function whereWished(studentId, day) {
  return `「${studentId}」の ${day.date} の回答`
}

/** `8:00` を `08:00` にする。toMinutes が 2 桁の時を読むためである。 */
function withLeadingZero(time) {
  return time.length === 4 ? `0${time}` : time
}

// Node から読むためだけの口。Apps Script では module が無いので通らない。
if (typeof module !== 'undefined') {
  module.exports = {
    intervalSeparator, intervalDash, allDayOff, wishIntervalPattern, wishBoundaries,
    expand, slotsWished, cutIntervals, holdsSlot, checkDayCount, whereWished, withLeadingZero,
  }
}
