/**
 * 配る画像の中身を組む（docs/tech-requirements.md 5 の #9・#10 ／ issue #157）。
 *
 * 形は前回の配布物と同じ（→ issue #213）。1 日 1 枚、行が人（見出しは名前の 1 列。学籍番号は載せない）、
 * 列が 30 分枠、セルが役割名で、役割ごとに背景色が付く。
 * 描く元は手直し後のマス目そのもので、落とすのは学籍番号の列と、その日に 1 枠も入っていない行だけである。
 *
 * 描く位置までここで決め（手元の検査で形まで見るため）、export-images.html は canvas に塗るだけである。
 * 文字の幅は canvas で測らず見積もる。字体は端末に依存するので、塗る側は fillText の maxWidth で収める。
 *
 * コアの側である。SpreadsheetApp を掴まない。
 * 他のファイルの値をこのファイルの最上位で使わない（→ core.js の同じ注意）。
 */
/**
 * 描く寸法（px）。canvas には imageScale 倍して塗る（スマホで拡大して読まれるため）。
 * セルの幅は役割名で決めない（長い役割名がある日だけ表が伸びないように）。収まらない字は塗る側が詰める。
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

/** `2025-11-01` を `11月1日` にする（前回の表題の書き方）。 */
function monthDayOf(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date))
  if (!match) throw new Error(`日付「${date}」が YYYY-MM-DD でない`)
  return `${Number(match[2])}月${Number(match[3])}日`
}

/**
 * マス目 1 枚から、配る 1 枚の表 { fileName, title, times, rows } を組む。
 *
 *   times … 見出しの時刻（見出しが空の右側の列は落とす）
 *   rows  … 1 人 1 行。{ name, cells: [{ role, color }] }（cells は times と同じ並び）
 *
 * header と dataRows は shell.js の readGrid が読んだとおり。day は表題の日付にだけ使い、label はシート名である。
 * 氏名の無い人に役割が入っていたら、誰の行か読めないので名指しして止まる。
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
          + '回答にその学籍番号があるかを見て、メニューの「生成」を押す',
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
 * マス目 4 枚から、配る画像の中身を日の順に組む。grids は殻が読んだ { layout, grid } の配列である。
 * 1 枚ごとに { label, fileName, title, times, rows, drawing } を返す。1 人も入っていない日も rows を空にして返す。
 * 4 枚とも空なら（生成の前に押したとき）止まる。
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
          `シート「${label}」に中身があるが、条件入力の「日ごとの営業時刻」にその日の行が無い`,
        )
      }
      const table = distributionTable(one.grid.header, one.grid.rows, day, label)
      return {
        label: label, fileName: table.fileName, title: table.title, times: table.times, rows: table.rows,
        drawing: table.rows.length === 0 ? null : distributionDrawing(table),
      }
    })

  if (images.every((image) => image.rows.length === 0)) {
    throw new Error('割り当ての 4 枚に、役割の入ったセルが 1 つも無い。先にメニューの「生成」を押す')
  }
  return images
}

// Node から読むためだけの口。Apps Script では module が無いので通らない。
if (typeof module !== 'undefined') {
  module.exports = {
    imageMetrics, imageScale, estimateTextWidth, monthDayOf, distributionTable, distributionDrawing, distributionImages,
  }
}
