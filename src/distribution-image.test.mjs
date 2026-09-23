#!/usr/bin/env node
// 配る画像の検査 — src/distribution-image.js を、スプレッドシートも canvas も使わずに走らせる（issue #157）。
//
//   使い方: node src/distribution-image.test.mjs
//
// 見るものは 7 つある。
//   ① 前回の配布物と同じ形である
//   ② 粒度が落ちない — マス目の（人・枠・役割）が画像と 1 つも違わない（→ M4）
//   ③ 学籍番号を描かない
//   ④ 1 枠も入っていない行を落とし、背景は役割の色である
//   ⑤ 図形がはみ出さず、同じ入力から同じ図形が出る
//   ⑥ 描けないものは名指しして止まる
//   ⑦ 描画のために外から読み込むファイルが 0 個である
//
// 前回の記録から描いたときの粒度は scripts/前回のシフト表.mjs が見る。

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// ---- 読み込む ---------------------------------------------------------------
// SpreadsheetApp は置かない（コアなので掴まずに通る）。

const context = vm.createContext({})
for (const name of ['sheet-layout.js', 'input-types.js', 'core.js', 'assignment-grid.js', 'distribution-image.js']) {
  vm.runInContext(fs.readFileSync(path.join(here, name), 'utf8'), context, { filename: name })
}
const {
  toDays, toAssignmentGrid, gridLayouts, roleColorOf, estimateTextWidth, monthDayOf,
  distributionTable, distributionImages,
} = context
const { assignmentColumns, assignmentName, imageMetrics } = vm.runInContext(
  '({ assignmentColumns, assignmentName, imageMetrics })',
  context,
)

const failed = []
const passed = []

function check(title, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed.push(title)
  else failed.push({ title, actual, expected })
}

function whyItStopped(work) {
  try {
    work()
    return null
  } catch (error) {
    return error.detail || error.message
  }
}

// ---- 材料 -------------------------------------------------------------------
// 前回の 2025-11-01 と 2025-11-02 の 5 時刻。3・4 日目は空にして、描かない日が消えないかを見る。

const days = toDays([
  ['2025-11-01', '08:00', '10:00', '17:00', '17:00', '21:00'],
  ['2025-11-02', '08:00', '10:00', '17:00', '17:00', '20:00'],
  ['2025-11-03', '08:00', '10:00', '17:00', '17:00', '20:00'],
  ['2025-11-04', '08:00', '08:30', '08:30', '08:30', '15:00'],
], '日ごとの営業時刻')

function assignment(date, start, end, role, studentId) {
  const values = { '日': date, '開始': start, '終了': end, '役割': role, '学籍番号': studentId, '氏名': '' }
  return assignmentColumns.map((name) => values[name])
}

const assignments = [
  assignment('2025-11-01', '08:00', '08:30', '準備', 'LTS2518500'),
  assignment('2025-11-01', '08:30', '09:00', '準備', 'LTS2518500'),
  assignment('2025-11-02', '10:00', '10:30', '調理', 'EED2386071'),
  assignment('2025-11-02', '10:30', '11:00', '調理責任者', 'EED2386071'),
  assignment('2025-11-02', '10:00', '10:30', 'クリーンパトロール', 'ECK2626643'),
  assignment('2025-11-02', '19:30', '20:00', '片付け', 'LTS2390333'),
  // 表に色の無い役割名（委員会の指定枠は年で増える）
  assignment('2025-11-02', '12:00', '12:30', '委員会の受付', 'LTS2390333'),
]
const names = { LTS2518500: '小林なんえい', EED2386071: '山本きた', ECK2626643: 'たなか風蔵', LTS2390333: '高木琴音' }
const nameOf = (studentId) => names[studentId] || ''
// 友達欄はマス目には並ぶが、配る画像には載らない。
const friends = { EED2386071: '太郎君、同期', LTS2390333: 'ECK2626643' }
const friendsOf = (studentId) => friends[studentId] || ''

// 殻が読むのと同じ形（見出しは 48 列ぶんで右の余りは空 → shell.js の readGrid）。
const layouts = gridLayouts(assignmentName)
const width = 3 + 48
function asRead(grid) {
  const pad = (row) => row.concat(new Array(width - row.length).fill(''))
  return { header: pad(grid.header), rows: grid.rows.map(pad), notes: [] }
}
const grids = layouts.map((layout, index) => ({
  layout: layout,
  // 2 日目には、1 枠も入っていない人（手直しで残る行）を 1 人混ぜる。
  grid: asRead(toAssignmentGrid(assignments, days[index], nameOf, index === 1 ? ['AAA0000001'] : [], friendsOf)),
}))

const images = distributionImages(grids, days)

// ---- ① 前回の配布物と同じ形 -------------------------------------------------

check('① 4 枚が日の順に並ぶ', images.map((image) => image.label), ['準備日', '学祭1日目', '学祭2日目', '片付け'])
check(
  '① ファイル名は前回の配布物の表題と同じ書き方である（`11月1日シフト表`）',
  images.map((image) => image.fileName),
  ['11月1日シフト表.png', '11月2日シフト表.png', '11月3日シフト表.png', '11月4日シフト表.png'],
)
check('① 表題に日とラベルが入る', images[1].title, '11月2日（学祭1日目）シフト表')
check('① 列はその日の 30 分枠だけで、見出しの空の右側を落とす', images[1].times.length, days[1].slots.length)
check('① 列の見出しは枠の開始時刻である', images[1].times.slice(0, 3), ['08:00', '08:30', '09:00'])

const drawing = images[1].drawing
const headerTexts = drawing.texts.filter((text) => text.bold).map((text) => text.text)
check(
  '① 見出しは表題・名前の 1 列・時刻だけである（学籍番号の列も友達欄の列も描かない）',
  headerTexts,
  [images[1].title, '名前'].concat(images[1].times),
)
check(
  '① 友達欄に書かれたことは、どの画像にも描かれない（→ issue #200）',
  images.flatMap((image) => (image.drawing ? image.drawing.texts : []).map((text) => text.text)).filter((text) => Object.values(friends).includes(text)),
  [],
)

// ---- ② 粒度が落ちない -------------------------------------------------------

function triplesOfGrid(grid) {
  const triples = []
  grid.rows.forEach((row) => {
    grid.header.slice(3).forEach((time, index) => {
      const role = row[3 + index]
      if (role !== '') triples.push(`${row[1]} ${time} ${role}`)
    })
  })
  return triples.sort()
}
function triplesOfImage(image) {
  const triples = []
  image.rows.forEach((row) => row.cells.forEach((cell, index) => {
    if (cell.role !== '') triples.push(`${row.name} ${image.times[index]} ${cell.role}`)
  }))
  return triples.sort()
}

images.forEach((image, index) => {
  check(`② ${image.label}: マス目と画像の（人・枠・役割）が 1 つも違わない`, triplesOfImage(image), triplesOfGrid(grids[index].grid))
})
check('② 記録どおり 7 セルが描かれる（色の無い役割名も落とさない）', images.reduce((sum, image) => sum + triplesOfImage(image).length, 0), 7)

const drawnRoles = drawing.texts.filter((text) => !text.bold).map((text) => text.text)
check(
  '② 描く文字に、役割名がセルの数だけ出る',
  drawnRoles.filter((text) => !Object.values(names).includes(text)).sort(),
  ['クリーンパトロール', '委員会の受付', '片付け', '調理', '調理責任者'].sort(),
)

// ---- ③ 学籍番号を描かない ---------------------------------------------------

const everyText = images.filter((image) => image.drawing).flatMap((image) => image.drawing.texts.map((text) => text.text))
check(
  '③ どの画像のどの文字にも、学籍番号が出てこない',
  everyText.filter((text) => /[A-Z]{3}\d{7}/.test(text)),
  [],
)
check('③ 表の行が持つのは名前とセルだけである', Object.keys(images[1].rows[0]).sort(), ['cells', 'name'])

// ---- ④ 落とす行と色 ---------------------------------------------------------

check('④ 1 枠も入っていない人の行は描かない', images[1].rows.map((row) => row.name), ['たなか風蔵', '山本きた', '高木琴音'])
check('④ 1 人も入っていない日は、描かずに空で返る（黙って落とさない）', images.map((image) => image.drawing === null), [false, false, true, true])

const cookBox = drawing.boxes.filter((box) => box.fill === roleColorOf('調理'))
check('④ セルの背景は役割の色である（調理 = 黄）', cookBox.length, 1)
check('④ 表に無い役割名のセルは塗らない（白のまま）', images[1].rows[2].cells.filter((cell) => cell.role === '委員会の受付').map((cell) => cell.color), [null])

// ---- ⑤ はみ出さない・決定的 -------------------------------------------------

const inside = (image) => image.drawing.boxes.every((box) => box.x >= 0 && box.y >= 0 && box.x + box.w <= image.drawing.width && box.y + box.h <= image.drawing.height)
  && image.drawing.texts.every((text) => text.x >= 0 && text.y >= 0 && text.x <= image.drawing.width && text.y <= image.drawing.height && text.maxWidth > 0)
  && image.drawing.lines.every((line) => Math.max(line.x1, line.x2) <= image.drawing.width && Math.max(line.y1, line.y2) <= image.drawing.height)
check('⑤ 箱も文字も線も、画像の中に収まる', images.filter((image) => image.drawing).every(inside), true)
check(
  '⑤ 名前の列は、いちばん長い名前が入る幅である',
  drawing.texts.filter((text) => text.text === 'たなか風蔵')[0].maxWidth >= estimateTextWidth('たなか風蔵', imageMetrics.fontSize),
  true,
)
check(
  '⑤ 高さは 表題 ＋ 見出しの行 ＋ 人の行 で決まる',
  drawing.height,
  imageMetrics.padding * 2 + imageMetrics.titleSize + imageMetrics.titleGap + imageMetrics.rowHeight * (images[1].rows.length + 1),
)
check('⑤ 同じ入力から同じ図形が出る', JSON.stringify(distributionImages(grids, days)), JSON.stringify(images))
check('⑤ 画素は 2 倍で塗る（拡大して読まれる ◎ — 入る側 ACTION 6）', drawing.scale, 2)

// ---- ⑥ 名指しして止まる -----------------------------------------------------

const noName = asRead({ header: grids[1].grid.header, rows: [['EED2386071', '', '', '', '', '', '', '', '', '', '', '', '調理']] })
check(
  '⑥ 役割が入っているのに氏名が空なら、行と学籍番号を名指しして止まる',
  whyItStopped(() => distributionTable(noName.header, noName.rows, days[1], '学祭1日目')),
  'シート「学祭1日目」の 2 行目（学籍番号「EED2386071」）の氏名が空のため、画像にできません。'
    + '「回答」シートにその学籍番号があるかを確かめてから、メニューの「生成」を押してください',
)

const emptyGrids = layouts.map((layout, index) => ({ layout: layout, grid: asRead(toAssignmentGrid([], days[index], nameOf)) }))
check(
  '⑥ 4 枚とも役割が 1 つも無ければ、生成を先に押すよう言って止まる',
  whyItStopped(() => distributionImages(emptyGrids, days)),
  'シフト表がまだ空です。先にメニューの「生成」を押してください',
)
check(
  '⑥ 日付が YYYY-MM-DD でなければ止まる',
  whyItStopped(() => monthDayOf('11/1')),
  '日付「11/1」が YYYY-MM-DD でない',
)
check(
  '⑥ 条件入力にその日の行が無いのに中身があれば止まる',
  whyItStopped(() => distributionImages(grids, days.slice(0, 1))),
  '条件入力の「日ごとの営業時刻」を 4 日分入れてください（学祭1日目 の日の行がありません）',
)

// ---- ⑦ 外から読み込むファイルが 0 個 ----------------------------------------

const dialog = fs.readFileSync(path.join(here, 'export-images.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
check(
  '⑦ ダイアログが外から読み込むもの（script の src・link・@import・url()・http）が 0 個である',
  // url( は大文字小文字を区別する — canvas の toDataURL( を拾わないためである。
  (dialog.match(/<script[^>]*\bsrc=|<link\b|@import|https?:\/\//gi) || []).concat(dialog.match(/\burl\(/g) || []),
  [],
)
check('⑦ ダイアログは canvas で PNG にする', /toDataURL\('image\/png'\)/.test(dialog), true)

// ---- 結果 ------------------------------------------------------------------

console.log('配る画像の検査（src/distribution-image.js ／ src/export-images.html）')
console.log('')
for (const title of passed) console.log(`  OK   ${title}`)
for (const { title, actual, expected } of failed) {
  console.log(`  NG   ${title}`)
  console.log(`         実測: ${JSON.stringify(actual)}`)
  console.log(`         期待: ${JSON.stringify(expected)}`)
}
console.log('')
if (failed.length === 0) {
  console.log(`結果: 全件一致（${passed.length} 件）`)
} else {
  console.log(`結果: 不一致 ${failed.length} 件 ／ 一致 ${passed.length} 件`)
  process.exitCode = 1
}
