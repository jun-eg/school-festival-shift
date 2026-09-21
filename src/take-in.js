/**
 * 取り込む側 — 回答の行を 1 人 1 件に畳む（docs/tech-requirements.md 3 の規則 2 ／ 8 の 6。issue #146）。
 *
 * 回答シートの行は、そのまま先へ流れない。ここを通った希望（型 #6）だけが下流へ行く（→ core.js の build）。
 * 行を型に直すのは input-types.js の toWish である。ここが持つのは「どの 1 行を型にするか」だけである。
 *
 * 規則 2 の 3 つ（→ 3 の規則 2）。
 *   ① 学籍番号でまとめる（識別キーは学籍番号である ◎ → 5-1）
 *   ② タイムスタンプを見て 1 件に畳む（畳み込みのキーは 学籍番号 ＋ タイムスタンプ ◎）
 *   ③ 採る向きは後から来た行である（→ foldDirection）
 *
 * 担当者の手が 1 度も入らない（→ 7 の M1 ②「人の手が入った箇所 0 箇所」）。
 * 回答スプレッドシートと同じファイルの中に居るので、書き出しも読み込みも挟まらない（→ 6 の #1 の理由 ③）。
 *
 * 配列を受けて配列を返す。SpreadsheetApp を 1 度も掴まない（→ 6 の #8）。
 * ここに判断を新しく書かない — 規則は 3 が、採る向きは上流（ADR design-doc-0006）が持つ（→ src/README.md）。
 *
 * 他のファイルの値をこのファイルの最上位で使わない（→ core.js の同じ注意）。
 */

/**
 * 規則 2 の ③ — 同じ人の複数行のうち、どの 1 行を採るか。
 *
 * 決めたのは上流である（→ ADR design-doc-0006。それまでは 9 の △ 3 だった）。
 * 記録の側の裏付けは「出し直しは申し出ではなく希望そのものの修正である ◎」（→ ADR 入る側-0006）。
 * 向きが動いたら、ここと 3 の規則 2 の ③ が一緒に動く。
 */
const foldDirection = {
  key: 'latest',
  label: '後から来た行を採る',
  why: '出し直しは希望そのものの修正である ◎（→ ADR 入る側-0006・design-doc-0006）',
}

/**
 * 畳み込みのキーのうち、型 #6 に乗らないほうの列（→ input-types.js の columnsOutsideWish）。
 * 畳んだ後の 1 件には残らない。ここで見るだけである。
 */
const timestampColumn = 'タイムスタンプ'

/**
 * タイムスタンプの形。殻が揃えたあとの日時である（→ shell.js の valueRepresentation の dateTime）。
 * 揃っていない値は、黙って解釈し直さずに名指しして止まる（→ input-types.js の readTime と同じ扱い）。
 */
const timestampPattern = /^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/

/**
 * 回答の行を、1 人 1 件の希望（型 #6）にする（→ 5-1 の #6・仕様 #4）。
 *
 * 受け取るのは回答シートの行の配列、返すのは型 #6 の配列である。
 * 返した配列に、同じ学籍番号は 2 件と無い（→ 仕様 #4・count-violations.js の wishesByStudentId）。
 *
 * 人の並びは、その人が最初に現れた行の順である。採った行の位置で並べ直さない
 * — 出し直した人だけが後ろへ動くと、同じ回答シートから出てくる並びが提出の順でなくなる。
 *
 * 畳んで落ちる行も型に直す。落ちるほうに壊れた値が入っていても、黙って通さない
 * （回答シートは担当者が手で書ける — 保護は「警告のみ」である → src/README.md）。
 */
function takeIn(rows) {
  const source = '回答'
  const section = answerSection()
  const columns = section.columns
  const order = []
  const kept = {}
  const seenIds = {}

  eachFilledRow(source, section, rows, (row, rowIndex) => {
    const coming = {
      wish: toWish(row, rowIndex),
      at: readTimestamp(source, columns, row, rowIndex),
      rowIndex: rowIndex,
    }
    const studentId = coming.wish.studentId
    checkSameSpelling(source, studentId, rowIndex, seenIds)

    // ① 学籍番号でまとめる — 初めて出てきた人は、そのまま置く
    if (!kept[studentId]) {
      kept[studentId] = coming
      order.push(studentId)
      return
    }

    // ② タイムスタンプを見て 1 件に畳む ／ ③ 採るのは後から来た行である
    if (coming.at === kept[studentId].at) {
      throw new Error(
        `${whereIs(source, rowIndex)}の学籍番号「${studentId}」が、`
          + `${whereIs(source, kept[studentId].rowIndex)}と同じ${timestampColumn}「${coming.at}」である。`
          + '畳み込みのキー（学籍番号 ＋ タイムスタンプ ◎）で 1 行に決まらないので、黙って選ばずに止まる（→ 3 の規則 2）',
      )
    }
    if (takesOver(coming.at, kept[studentId].at)) kept[studentId] = coming
  })

  return order.map((studentId) => kept[studentId].wish)
}

/**
 * 後から来た行が、いま採ってある行を置き換えるかを見る（→ foldDirection）。
 * 向きを変えるのは、この 1 行と 3 の規則 2 の ③ である。
 */
function takesOver(coming, keeping) {
  return coming > keeping // 日時は YYYY-MM-DD HH:MM:SS なので、文字列のまま比べて時の順になる
}

/**
 * 同じ学籍番号が、大文字・小文字だけ違う形で 2 通り出ていないかを見る。
 *
 * まとめるのは学籍番号（① ／ 識別キー ◎）だが、フォームの正規表現は英字の大小を両方通す
 * （→ 4-1 の #1）。別の綴りが同じ人かどうかは記録に無いので、
 * 黙ってまとめず・黙って別人にもせずに名指しして止まる（→ src/README.md の「ここで決めていないこと」）。
 * 前回の希望データ（モック 50 行）には 1 件も無い（記録）。
 */
function checkSameSpelling(source, studentId, rowIndex, seenIds) {
  const sameLetters = studentId.toUpperCase()
  const before = seenIds[sameLetters]
  if (before && before.studentId !== studentId) {
    throw new Error(
      `${whereIs(source, rowIndex)}の学籍番号「${studentId}」が、`
        + `${whereIs(source, before.rowIndex)}の「${before.studentId}」と大文字・小文字だけ違う。`
        + '同じ人かどうかは記録に無いので、黙ってまとめずに止まる（→ 3 の規則 2 の ①）',
    )
  }
  if (!before) seenIds[sameLetters] = { studentId: studentId, rowIndex: rowIndex }
}

/**
 * タイムスタンプのセルを取る。値の表現を揃えるのは殻の仕事で、ここに来るのは揃った行である
 * （→ shell.js の formatDateTime・core.js の checkRepresentation）。
 */
function readTimestamp(source, columns, row, rowIndex) {
  const cell = cellOf(source, columns, row, rowIndex, timestampColumn)
  if (!timestampPattern.test(cell.value)) {
    throw new Error(
      `${cell.where}が YYYY-MM-DD HH:MM:SS でない。いま: ${showBlankValue(cell.value)}。`
        + '畳み込みのキーなので、無いまま畳まない（→ 3 の規則 2 の ②）',
    )
  }
  return cell.value
}

// Node から読むためだけの口。Apps Script では module が無いので通らない。
if (typeof module !== 'undefined') {
  module.exports = {
    foldDirection, timestampColumn, timestampPattern,
    takeIn, takesOver, checkSameSpelling, readTimestamp,
  }
}
