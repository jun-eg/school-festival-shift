/**
 * 配る画像の中身を組む（docs/tech-requirements.md 5 の #9・#10 ／ 6 の #5 ／ issue #157）。
 *
 * 形は前回の配布物 ◎ と同じである（→ issue #213 の「従来のレイアウト」）。
 *   ・1 日 1 枚の 4 枚。表題に日が入る（前回は `11月1日シフト表` 〜 `11月4日シフト表`）
 *   ・行が人、見出しは名前の 1 列だけ。学籍番号は載せない（前回の配布物に無い ◎ — 氏名だけが外へ出るのは Before と同じ → 2）
 *   ・列が 30 分枠、セルが役割名 1 つで、役割ごとに背景色が付く（→ assignment-grid.js の roleColors）
 *
 * 描く元は割り当てのマス目 4 枚そのものである — 担当者が手直しした後のセルを、そのまま描く（→ 5-3）。
 * 形がマス目と同じなので、ここは並べ替えない。落とすのは学籍番号の列と、その日に 1 枠も入っていない行だけである
 * （前回の配布物の行は「その日に 1 枠でも入っている人」である ◎ → issue #213 の ② ／ ADR tech-requirements-0010）。
 *
 * 描く位置まで、ここで決める。ダイアログ（export-images.html）は、返った図形を canvas に塗るだけである。
 * 位置を決める側をコアに置くのは、手元の検査で形まで見るためである（→ distribution-image.test.mjs）。
 * 文字の幅は canvas で測らず、全角 1 字 ＝ 1 文字ぶん・半角 1 字 ＝ 半分で見積もる。
 * 字体は端末に依存してよい（→ 2 の「止まる箇所」#7）ので、塗る側は見積もった幅に収めて描く（fillText の maxWidth）。
 *
 * コアの側である。配列を受けて値を返し、SpreadsheetApp を 1 度も掴まない（→ 6 の #8）。
 * 他のファイルの値をこのファイルの最上位で使わない（→ core.js の同じ注意）。
 */

/**
 * 描く寸法（px）。canvas には、これを imageScale 倍して塗る（スマホで拡大して読まれる ◎ — 入る側 ACTION 6）。
 * セルの幅は役割名で決めない — 決めると、長い役割名が 1 つある日だけ表が横に伸びる。
 * 収まらない役割名は、塗る側が字を詰める（→ export-images.html の fillText）。
 */
const imageMetrics = {
  padding: 16,
  titleSize: 20,
  titleGap: 12,
  fontSize: 13,
  rowHeight: 26,
  slotWidth: 56,
  cellPadding: 6,
  minNameWidth: 72,
  gridLine: '#999999',
  headerFill: '#eeeeee',
  background: '#ffffff',
  text: '#202124',
}

/** 塗るときの倍率。見積もった寸法はそのままで、画素だけを増やす。 */
const imageScale = 2

/** 文字列の幅を見積もる。半角（ASCII と半角カナ）は半分、それ以外は 1 文字ぶんである。 */
function estimateTextWidth(text, size) {
  let width = 0
  for (const char of String(text)) {
    const code = char.charCodeAt(0)
    const half = code < 0x80 || (code >= 0xff61 && code <= 0xff9f)
    width += half ? size * 0.55 : size
  }
  return Math.ceil(width)
}

/** `2025-11-01` を `11月1日` にする。前回の表題の書き方である ◎（→ issue #213）。 */
function monthDayOf(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date))
  if (!match) throw new Error(`日付「${date}」が YYYY-MM-DD でない（→ 条件入力の「日ごとの営業時刻」）`)
  return `${Number(match[2])}月${Number(match[3])}日`
}

/**
 * マス目 1 枚から、配る 1 枚の表を組む。返すのは { fileName, title, times, rows } である。
 *
 *   times … 見出しの時刻（見出しが空の右側の列は落とす — 48 列のうち、その日に刻んだ枠だけが時刻を持つ）
 *   rows  … 1 人 1 行。{ name, cells: [{ role, color }] }（cells は times と同じ数・同じ並び）
 *
 * header と dataRows はシートから読んだとおりである（→ shell.js の readGrid）。day は条件入力のその日の行で、
 * 表題の日付にだけ使う（label は `準備日` などのシート名 → sheet-layout.js の dayLabels）。
 *
 * 黙って捨てない。氏名の無い人に役割が入っていたら、名指しして止まる — 名前の列が空の行は、配っても誰の行か読めない。
 * 氏名は生成のたびに回答から入る（→ assignment-grid.js の namesFromAnswers）ので、空なのは回答に無い学籍番号である。
 */
function distributionTable(header, dataRows, day, label) {
  const named = gridNamedColumns()
  const nameColumn = named.indexOf('氏名')
  const studentIdColumn = named.indexOf('学籍番号')

  let lastTime = header.length - 1
  while (lastTime >= named.length && String(header[lastTime] || '') === '') lastTime--
  const times = header.slice(named.length, lastTime + 1).map((time) => String(time || ''))

  const rows = []
  dataRows.forEach((row, rowIndex) => {
    const roles = row.slice(named.length, named.length + times.length).map((cell) => String(cell || '').trim())
    while (roles.length < times.length) roles.push('')
    if (roles.every((role) => role === '')) return

    const name = String(row[nameColumn] || '').trim()
    if (name === '') {
      throw new Error(
        `シート「${label}」の ${rowIndex + 2} 行目（学籍番号「${String(row[studentIdColumn] || '')}」）に役割が入っているが、氏名が空である。`
          + '配る画像には氏名しか載らないので、誰の行か読めない。回答にその学籍番号があるかを見て、メニューの「生成」を押す'
          + '（氏名は生成のたびに回答から入る）',
      )
    }
    const blank = times.map((time, index) => (time === '' && roles[index] !== '' ? index : -1)).filter((index) => index !== -1)
    if (blank.length > 0) {
      throw new Error(
        `シート「${label}」の ${rowIndex + 2} 行目の ${named.length + blank[0] + 1} 列目に「${roles[blank[0]]}」が入っているが、`
          + '見出しの時刻が空である。何時の枠か描けない',
      )
    }
    rows.push({ name: name, cells: roles.map((role) => ({ role: role, color: roleColorOf(role) })) })
  })

  const monthDay = monthDayOf(day.date)
  return {
    fileName: `${monthDay}シフト表.png`,
    title: `${monthDay}（${label}）シフト表`,
    times: times,
    rows: rows,
  }
}

/**
 * 表 1 枚を、塗る図形の一覧にする。返すのは { width, height, scale, boxes, texts } である。
 *
 *   boxes … { x, y, w, h, fill }（fill が null の箱は塗らない）。罫線は lines が持つ
 *   lines … { x1, y1, x2, y2 }（色は imageMetrics.gridLine）
 *   texts … { x, y, text, size, bold, align, maxWidth }（y は文字の中心。align は 'left' か 'center'）
 *
 * 寸法は imageMetrics の px で、塗る側が scale 倍する。
 */
function distributionDrawing(table) {
  const m = imageMetrics
  const nameWidth = Math.max(
    m.minNameWidth,
    ...table.rows.map((row) => estimateTextWidth(row.name, m.fontSize) + m.cellPadding * 2),
  )
  const tableWidth = nameWidth + m.slotWidth * table.times.length
  const titleWidth = estimateTextWidth(table.title, m.titleSize)
  const width = m.padding * 2 + Math.max(tableWidth, titleWidth)
  const top = m.padding + m.titleSize + m.titleGap
  const tableHeight = m.rowHeight * (table.rows.length + 1)
  const height = top + tableHeight + m.padding

  const boxes = [{ x: 0, y: 0, w: width, h: height, fill: m.background }]
  const lines = []
  const texts = [{
    x: m.padding, y: m.padding + m.titleSize / 2, text: table.title, size: m.titleSize, bold: true, align: 'left', maxWidth: width - m.padding * 2,
  }]

  const left = m.padding
  const slotX = (index) => left + nameWidth + m.slotWidth * index
  const rowY = (index) => top + m.rowHeight * index

  boxes.push({ x: left, y: top, w: tableWidth, h: m.rowHeight, fill: m.headerFill })
  texts.push({
    x: left + m.cellPadding, y: top + m.rowHeight / 2, text: '名前', size: m.fontSize, bold: true, align: 'left', maxWidth: nameWidth - m.cellPadding * 2,
  })
  table.times.forEach((time, index) => {
    texts.push({
      x: slotX(index) + m.slotWidth / 2, y: top + m.rowHeight / 2, text: time, size: m.fontSize, bold: true, align: 'center', maxWidth: m.slotWidth - m.cellPadding,
    })
  })

  table.rows.forEach((row, rowIndex) => {
    const y = rowY(rowIndex + 1)
    texts.push({
      x: left + m.cellPadding, y: y + m.rowHeight / 2, text: row.name, size: m.fontSize, bold: false, align: 'left', maxWidth: nameWidth - m.cellPadding * 2,
    })
    row.cells.forEach((cell, index) => {
      if (cell.role === '') return
      boxes.push({ x: slotX(index), y: y, w: m.slotWidth, h: m.rowHeight, fill: cell.color })
      texts.push({
        x: slotX(index) + m.slotWidth / 2, y: y + m.rowHeight / 2, text: cell.role, size: m.fontSize, bold: false, align: 'center', maxWidth: m.slotWidth - m.cellPadding,
      })
    })
  })

  for (let index = 0; index <= table.rows.length + 1; index++) {
    lines.push({ x1: left, y1: rowY(index), x2: left + tableWidth, y2: rowY(index) })
  }
  lines.push({ x1: left, y1: top, x2: left, y2: top + tableHeight })
  for (let index = 0; index <= table.times.length; index++) {
    lines.push({ x1: slotX(index), y1: top, x2: slotX(index), y2: top + tableHeight })
  }

  return {
    width: width, height: height, scale: imageScale, boxes: boxes.filter((box) => box.fill), lines: lines, texts: texts,
    colors: { line: m.gridLine, text: m.text },
  }
}

/**
 * マス目 4 枚から、配る画像の中身を日の順に組む（→ 2 の一覧 9）。grids は殻が読んだ { layout, grid } の配列である。
 * 返すのは 1 枚ごとに { label, fileName, title, times, rows, drawing } で、1 人も入っていない日は rows が空のまま返る
 * — 描くかどうかは塗る側が言う（黙って落とさない）。
 *
 * 4 枚とも 1 人も入っていなければ、描くものが無いので止まる。生成の前に押したときである。
 */
function distributionImages(grids, days) {
  const images = grids
    .slice()
    .sort((a, b) => a.layout.grid.dayIndex - b.layout.grid.dayIndex)
    .map((one) => {
      const label = one.layout.name
      const day = days[one.layout.grid.dayIndex]
      if (!day) {
        if (one.grid.rows.length === 0) return { label: label, fileName: '', title: '', times: [], rows: [], drawing: null }
        throw new Error(
          `シート「${label}」に中身があるが、条件入力の「日ごとの営業時刻」にその日の行が無い。表題の日付が決まらない（→ 4-1）`,
        )
      }
      const table = distributionTable(one.grid.header, one.grid.rows, day, label)
      return {
        label: label, fileName: table.fileName, title: table.title, times: table.times, rows: table.rows,
        drawing: table.rows.length === 0 ? null : distributionDrawing(table),
      }
    })

  if (images.every((image) => image.rows.length === 0)) {
    throw new Error('割り当ての 4 枚に、役割の入ったセルが 1 つも無い。先にメニューの「生成」を押す（→ 2 の一覧 7）')
  }
  return images
}

// Node から読むためだけの口。Apps Script では module が無いので通らない。
if (typeof module !== 'undefined') {
  module.exports = {
    imageMetrics, imageScale, estimateTextWidth, monthDayOf, distributionTable, distributionDrawing, distributionImages,
  }
}
