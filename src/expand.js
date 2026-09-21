/**
 * 展開する側 — 粗い希望を 30 分枠の集合にする（docs/tech-requirements.md 3 の規則 1 ／ 8 の 7。issue #149）。
 *
 * 受け取るのは 1 人 1 件に畳んだ希望（型 #6。→ take-in.js）と、その年の枠（型 #1。→ input-types.js）である。
 * 返すのは「その人がその日に入れる候補となる 30 分枠の集合」であって、割り当てではない（→ 仕様 #5）。
 * 役割も人数もここでは決まらない。候補からどの枠へ置くかは生成（#151）の仕事である（規則 1 の ⑤）。
 *
 * 規則 1 の順序（→ 3 の規則 1）。
 *   ① その日の営業 5 時刻から 30 分枠を刻む — 刻むのは型 #1 のほうである（→ input-types.js の cutSlots）。
 *      ここに来るのは刻み終わった枠の列で、枠を作り直さない
 *   ② 回答文字列を `,` で区切って区間に分ける
 *   ③ 区間ごとに、区間に完全に含まれる枠だけを取る（重なるだけの枠は取らない）
 *   ④ 複数区間は和集合を取る
 *
 * 境界値と特別扱いは 3 の表が持つ（→ wishBoundaries）。ここが足している規則は 1 つも無い。
 * 4 つのうち 3 つは、規則を足さなくてもそうなる — ① で刻んだ枠しか存在せず、③ が「完全に含まれる枠だけ」だからである。
 * 残る 1 つ（終端 ≤ 始端）だけが、黙って解釈しないために名指しして止まる。
 *
 * 配列を受けて配列を返す。SpreadsheetApp を 1 度も掴まない（→ 6 の #8）。
 * ここに判断を新しく書かない — 規則は 3 が、境界値の扱いも 3 が持つ（→ src/README.md）。
 *
 * 他のファイルの値をこのファイルの最上位で使わない（→ core.js の同じ注意）。
 */

/** 規則 1 の ② の区切り。回答文字列はこれで区間に分かれる（→ 4-2 の正規表現）。 */
const intervalSeparator = ','

/** 区間の中の、始端と終端の区切り。 */
const intervalDash = '-'

/**
 * 終日出れないの合図（→ 3 の境界値の表・4-2 の例3 ◎）。
 * 時刻として展開しないので、③ に入る前に落とす。前回の回答データでも最頻値である（記録）。
 */
const allDayOff = '00:00-00:00'

/**
 * 回答文字列の 1 区間の形。4-2 の正規表現（→ form-definition.js の wishTimePattern）を 1 区間ぶんに切ったものである。
 * 時は 0-23 で先頭の 0 は無くてよく、分は 00-59 まで通る。
 *
 * 写してあるのは、フォームを通った文字列をシートの側から読むのがここだからである
 * （→ input-types.js の studentIdPattern と同じ置き方）。形が動いたら、4-2 とあちらとここが一緒に動く。
 */
const wishIntervalPattern = /^(?:[0-9]|[01]\d|2[0-3]):[0-5]\d-(?:[0-9]|[01]\d|2[0-3]):[0-5]\d$/

/**
 * 3 の「境界値と特別扱い」のうち、規則 1 に当たる 4 つ。
 * どう扱うかを決めたのは上流で、ここが持つのは名前だけである — 隠れたまま効かせない。
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
 * 希望（型 #6）を、人と日ごとの候補の枠にする（→ 3 の規則 1 ／ 仕様 #5）。
 *
 * 返すのは { studentId, date, slots: [{ start, end }] } の配列である（→ count-violations.js の wishedSlots）。
 * 役割は 1 つも付かない — 規則 1 の出力は 30 分枠の集合であって、割り当てではない（→ 仕様 #5）。
 *
 * 1 人 1 日に 1 件を出す。候補が 0 枠の日も件として返す
 * （`00:00-00:00` は「時刻として展開しない」のであって、その日が無くなるのではない → 3 の境界値の表）。
 *
 * 並びは、人の並び（取り込みが返した順）× 日の並び（条件入力の行の順）である。並べ直さない。
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
 * 1 人・1 日ぶんの回答文字列 1 件を、その日の候補の枠にする（規則 1 の ②〜④）。
 *
 * ③ と ④ を 1 度に取る — その日の枠を頭から見て、どれか 1 つの区間に完全に含まれていれば取る。
 * 同じ枠が 2 つの区間に入っても 1 つしか取らないので、それが和集合である（④）。
 * 並びはその日の枠の並びのままで、区間の書かれた順ではない。
 */
function slotsWished(answer, day, studentId) {
  const intervals = cutIntervals(answer, day, studentId)
  return (day.slots || []).filter((slot) => intervals.some((interval) => holdsSlot(interval, slot)))
}

/**
 * 回答文字列を区間に分ける（規則 1 の ②）。
 *
 * 通す形は 4-2 の正規表現と同じである（→ wishIntervalPattern）。
 * `00:00-00:00` は区間にしない（→ 3 の境界値の表）。終端 ≤ 始端は、黙って解釈せずに名指しして止まる（同）。
 * 営業時間の外へ伸びた区間は、ここでは弾かない — 外側が落ちるのは ③ の仕事である。
 */
function cutIntervals(answer, day, studentId) {
  const intervals = []

  String(answer).split(intervalSeparator).forEach((piece) => {
    if (!wishIntervalPattern.test(piece)) {
      throw new Error(
        `${whereWished(studentId, day)}の「${showBlankValue(piece)}」が HH:MM-HH:MM でない。`
          + 'フォームの正規表現 ◎（→ 4-2）を通った形ではないので、黙って解釈しない',
      )
    }

    const at = piece.indexOf(intervalDash)
    const interval = {
      start: withLeadingZero(piece.slice(0, at)),
      end: withLeadingZero(piece.slice(at + 1)),
    }

    // 終日出れない（→ 3 の境界値の表）。時刻として展開しないので、③ に入る前に落とす。
    // 先頭の 0 を揃えてから見るのは、`0:00-0:00` も同じことを言っているからである（→ 4-2 は両方通す）。
    if (`${interval.start}${intervalDash}${interval.end}` === allDayOff) return

    if (toMinutes(interval.end) <= toMinutes(interval.start)) {
      throw new Error(
        `${whereWished(studentId, day)}の区間「${piece}」の終端が、始端より後になっていない。`
          + '区間にならないので候補を作らない。黙って解釈し直さずに返す（→ 3 の境界値と特別扱い）',
      )
    }

    intervals.push(interval)
  })

  return intervals
}

/**
 * 枠が区間に完全に含まれているか（規則 1 の ③）。
 * 重なるだけの枠は取らない — 本人が居ない 15 分を割り当てないためである（判断は上流 → 3 の境界値の表）。
 * 委員会の指定枠だけが逆向き（重なる枠を取る）で、そちらは規則 6 の側が持つ（→ 5-4・#142）。
 */
function holdsSlot(interval, slot) {
  return toMinutes(slot.start) >= toMinutes(interval.start) && toMinutes(slot.end) <= toMinutes(interval.end)
}

/**
 * 回答の日ごとの列と、条件入力の「日ごとの営業時刻」の行が 1 対 1 で当たるかを見る。
 *
 * 当て方は上から順である（設問をその行から組んでいるからである → 4-1・input-types.js の toWish）。
 * 数が違えば、どの回答がどの日かが決まらない。黙って前から当てずに名指しして止まる
 * （→ form-definition.js の checkDaysForForm と同じ理由である）。
 */
function checkDayCount(wish, days) {
  const answers = (wish.answers || []).length
  if (answers === days.length) return
  throw new Error(
    `「${wish.studentId}」の回答が ${answers} 日ぶんなのに、条件入力の「日ごとの営業時刻」が ${days.length} 行である。`
      + '上から順に 1 対 1 で当てる（→ 4-1・5-1 の #6）ので、どの回答がどの日かが決まらない',
  )
}

/** 崩れている場所を名指しする文の前半。担当者が当たるのは、その人のその日の回答である。 */
function whereWished(studentId, day) {
  return `「${studentId}」の ${day.date} の回答`
}

/**
 * `8:00` を `08:00` にする。4-2 の正規表現は時の先頭の 0 を落として書けるので、ここで揃える。
 * 揃えるのは分で数えるためだけである（→ input-types.js の toMinutes は 2 桁の時を読む）。時刻そのものは動かない。
 */
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
