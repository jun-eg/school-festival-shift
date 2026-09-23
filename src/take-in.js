/**
 * 取り込む側 — 回答の行を 1 人 1 件に畳む（docs/tech-requirements.md 3 の規則 2。issue #146）。
 * ここを通った希望（型 #6）だけが下流へ行く。行を型に直すのは input-types.js の toWish で、
 * ここが持つのは「どの 1 行を型にするか」だけである。
 *
 * 規則 2 の 3 つ。
 *   ① 学籍番号でまとめる（大文字・小文字の違いは同じ人）
 *   ② タイムスタンプを見て 1 件に畳む
 *   ③ 採るのは後から来た行（→ foldDirection）
 *
 * 配列を受けて配列を返す。SpreadsheetApp を掴まない。
 * 他のファイルの値をこのファイルの最上位で使わない（→ core.js の同じ注意）。
 */
/**
 * 規則 2 の ③ — 同じ人の複数行のうち、どの 1 行を採るか（→ ADR design-doc-0006）。
 * 向きが動いたら、ここと 3 の規則 2 の ③ が一緒に動く。
 */
const foldDirection = {
  key: 'latest',
  label: '後から来た行を採る',
  why: '出し直しは希望そのものの修正である ◎（→ ADR 入る側-0006・design-doc-0006）',
}

/** 畳み込みのキーのうち、型 #6 に乗らないほうの列。畳んだ後の 1 件には残らない。 */
const timestampColumn = 'タイムスタンプ'

/** タイムスタンプの形（殻が揃えたあとの日時）。揃っていなければ名指しして止まる。 */
const timestampPattern = /^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/

/**
 * 回答シートの行の配列を、1 人 1 件の希望（型 #6）の配列にする（→ 仕様 #4）。
 *
 * 人の並びは、その人が最初に現れた行の順である（出し直した人だけが後ろへ動かないように）。
 * 畳んで落ちる行も型に直す。回答シートは手で書けるので、壊れた値を黙って通さない。
 */
function takeIn(rows) {
  const source = '回答'
  const section = answerSection()
  const columns = section.columns
  const order = []
  const kept = {}

  eachFilledRow(source, section, rows, (row, rowIndex) => {
    const coming = {
      wish: toWish(row, rowIndex),
      at: readTimestamp(source, columns, row, rowIndex),
      rowIndex: rowIndex,
    }
    // 学籍番号は toWish で大文字に揃っているので、大文字・小文字だけ違う 2 行は同じキーになる
    const studentId = coming.wish.studentId

    // ① 初めて出てきた人は、そのまま置く
    if (!kept[studentId]) {
      kept[studentId] = coming
      order.push(studentId)
      return
    }

    // ② タイムスタンプで畳む ／ ③ 採るのは後から来た行
    if (coming.at === kept[studentId].at) {
      // どちらを採るか決まらないので止まる。
      throw new Error(
        `学籍番号「${studentId}」の回答が、同じ時刻（${coming.at}）に 2 つあります`
          + `（${whereIs(source, kept[studentId].rowIndex)}と ${sheetRowOf(source, rowIndex)} 行目）。どちらかの行を消してください`,
      )
    }
    if (takesOver(coming.at, kept[studentId].at)) kept[studentId] = coming
  })

  return order.map((studentId) => kept[studentId].wish)
}

/** 後から来た行が、いま採ってある行を置き換えるか（→ foldDirection）。 */
function takesOver(coming, keeping) {
  return coming > keeping // 日時は YYYY-MM-DD HH:MM:SS なので、文字列のまま比べて時の順になる
}

/** タイムスタンプのセルを取る（表現は殻が揃え済み → shell.js の formatDateTime）。 */
function readTimestamp(source, columns, row, rowIndex) {
  const cell = cellOf(source, columns, row, rowIndex, timestampColumn)
  if (!timestampPattern.test(cell.value)) {
    // 同じ人の行を畳むのに使うので、直してから通す。
    throw new Error(
      `${whereIs(source, rowIndex)}のタイムスタンプが日時になっていません（今: ${showBlankValue(cell.value)}）。`
        + '直してから、もう一度押してください',
    )
  }
  return cell.value
}

// Node から読むためだけの口。Apps Script では module が無いので通らない。
if (typeof module !== 'undefined') {
  module.exports = {
    foldDirection, timestampColumn, timestampPattern,
    takeIn, takesOver, readTimestamp,
  }
}
