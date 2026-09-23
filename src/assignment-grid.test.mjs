#!/usr/bin/env node
// 敷き方の検査 — src/assignment-grid.js を、スプレッドシートを 1 つも作らずに走らせる（issue #213）。
//
//   使い方: node src/assignment-grid.test.mjs
//
// 見るものは 10 ある。
//   ① 従来の形に敷ける（行が人・列が 30 分枠・セルが役割名 1 つ）
//   ② 行の並びは学籍番号の昇順で、入力から決まる
//   ③ 敷いて戻すと元の行に戻る
//   ④ 当てるのは位置ではなく見出しの時刻である
//   ⑤ 載らないものは黙って捨てず、名指しして止まる
//   ⑥ 違反の行を、塗るセルに当て戻せる
//   ⑦ 背景は役割の色である（8 役割・7 色）
//   ⑧ 手直しの印が付いたセルだけを手直しとして読み、書き戻すときに印を付け直す
//   ⑨ 友達欄は回答に書かれたとおりに並ぶが、戻すときには読まない
//   ⑩ 氏名から学籍番号を引ける（表記の完全一致。同姓同名は 2 つ返り、出し直しは 1 つに数える → issue #271）
//
// 前回の確定シフトが本当にこの形に敷けるかは scripts/前回のシフト表.mjs が見る。

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// ---- 読み込む ---------------------------------------------------------------
// SpreadsheetApp は置かない（敷く側はコアなので掴まない）。

const context = vm.createContext({})
for (const name of ['sheet-layout.js', 'input-types.js', 'core.js', 'assignment-grid.js']) {
  vm.runInContext(fs.readFileSync(path.join(here, name), 'utf8'), context, { filename: name })
}
const {
  toAssignmentGrid, fromAssignmentGrid, namesFromAnswers, friendsFromAnswers, studentIdsFromAnswers, toDays, violationCells, outputColumns, gridBackgrounds, roleColorOf,
  fixedFromAssignmentGrid, gridNotes, isFixedNote, conflictNote,
} = context
const { dayLabels, assignmentColumns, checkKind, roleColors, fixedNote } = vm.runInContext(
  '({ dayLabels, assignmentColumns, checkKind, roleColors, fixedNote })',
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
// 前回の 2025-11-02 と同じ 5 時刻。枠は 24 になる。

const days = toDays([['2025-11-02', '08:00', '10:00', '18:00', '18:00', '20:00']], '日ごとの営業時刻')
const day = days[0]

/** 割り当ての 1 行を、列の並びのとおりに組む（氏名は空）。 */
function row(date, start, end, role, studentId) {
  const values = { '日': date, '開始': start, '終了': end, '役割': role, '学籍番号': studentId, '氏名': '' }
  return assignmentColumns.map((name) => values[name])
}

const assignments = [
  row('2025-11-02', '10:00', '10:30', '調理', 'EED2402549'),
  row('2025-11-02', '10:30', '11:00', '調理', 'EED2402549'),
  row('2025-11-02', '10:00', '10:30', '呼び込み', 'ECK2626643'),
  row('2025-11-02', '08:00', '08:30', '準備', 'LTS2390333'),
  // 別の日の行は、この日のマス目に落ちない
  row('2025-11-03', '10:00', '10:30', '調理', 'EED2402549'),
]

// 友達欄は自由記述で、書かれたとおりに出る。
const answers = [
  ['2025-10-01 10:00:00', 'eed2402549', '高木琴音', '3年生', 'はい', '太郎君、同期', '', '', '', ''],
  ['2025-10-01 11:00:00', 'ECK2626643', '森田咲良', '2年生', 'いいえ', '', '', '', '', ''],
]
const nameOf = namesFromAnswers(answers)
const friendsOf = friendsFromAnswers(answers)

// 名前のある列（学籍番号・氏名・友達欄）の数。時刻の列はこの右から始まる。
const named = 3

// ---- ① 従来の形に敷ける -----------------------------------------------------

const grid = toAssignmentGrid(assignments, day, nameOf, [], friendsOf)

check(
  '① 見出しは 学籍番号 / 氏名 / 一緒に組みたいお友達 ＋ その日の枠の開始時刻である（24 枠 → 27 列）',
  [grid.header.slice(0, 5), grid.header.length, day.slots.length],
  [['学籍番号', '氏名', '一緒に組みたいお友達', '08:00', '08:30'], 27, 24],
)

check(
  '① 1 人 1 行で、セルに入るのは役割名 1 つである（配布物 ◎ と同じ形 → issue #213）',
  grid.rows.map((one) => [one[0], one[1], one.slice(named).filter((cell) => cell !== '')]),
  [
    ['ECK2626643', '森田咲良', ['呼び込み']],
    ['EED2402549', '高木琴音', ['調理', '調理']],
    ['LTS2390333', '', ['準備']],
  ],
)

check(
  '① 役割は、その枠の列に落ちる（10:00-10:30 は 5 つ目の枠 ＝ 8 列目）',
  [grid.rows[1][named + 4], grid.rows[1][named + 5], grid.rows[2][named]],
  ['調理', '調理', '準備'],
)

check(
  '① 別の日の行は、この日のマス目に落ちない（1 日 1 枚である）',
  grid.rows.map((one) => one.slice(named).filter((cell) => cell !== '').length).reduce((a, b) => a + b, 0),
  4,
)

check(
  '① 氏名は回答から引く。大文字・小文字が違っても同じ人である（→ 規則 2 の ①）',
  [nameOf('EED2402549'), nameOf('eed2402549'), nameOf('LTS2390333')],
  ['高木琴音', '高木琴音', ''],
)

// ---- ② 並びが入力から決まる -------------------------------------------------

check(
  '② 行の並びは学籍番号の昇順である（生成の出てきた順ではない → 5 の #11）',
  grid.rows.map((one) => one[0]),
  ['ECK2626643', 'EED2402549', 'LTS2390333'],
)

check(
  '② 割り当ての順を入れ替えても、同じマス目が出る（決定的である → 6 の #3）',
  JSON.stringify(toAssignmentGrid(assignments.slice().reverse(), day, nameOf, [], friendsOf)),
  JSON.stringify(grid),
)

// ---- ③ 敷いて戻すと元に戻る -------------------------------------------------

const backAgain = fromAssignmentGrid(grid.header, grid.rows, day, dayLabels[1])

check(
  '③ 敷いて戻すと、その日の行がそのまま戻る（往復で増えも減りもしない）',
  backAgain.slice().sort(),
  assignments.filter((one) => one[0] === '2025-11-02').slice().sort(),
)

check(
  '③ 戻した行の氏名は空である（表示のための列で、生成は見ない → 5 の #1）',
  backAgain.map((one) => one[assignmentColumns.indexOf('氏名')]),
  ['', '', '', ''],
)

check(
  '③ 空のマス目は 0 行に戻る（手直しが無いだけで、止まらない）',
  fromAssignmentGrid(grid.header, [], day, dayLabels[1]),
  [],
)

check(
  '③ 条件入力にその日の行が無くても、マス目が空なら止まらない',
  fromAssignmentGrid(['学籍番号', '氏名', '一緒に組みたいお友達'], [], undefined, dayLabels[3]),
  [],
)

// ---- ④ 当てるのは見出しの時刻である -----------------------------------------

// 見出しを 1 列ずらしても、時刻で当てるので役割は同じ枠に戻る（位置で当てていない）
const shiftedHeader = ['学籍番号', '氏名', '一緒に組みたいお友達'].concat(day.slots.map((slot) => slot.start))
const shiftedRows = [['EED2402549', '高木琴音', ''].concat(day.slots.map((slot) => (slot.start === '13:00' ? '会計' : '')))]

check(
  '④ 当てるのは見出しに書いてある時刻である（列の位置ではない）',
  fromAssignmentGrid(shiftedHeader, shiftedRows, day, dayLabels[1]),
  [row('2025-11-02', '13:00', '13:30', '会計', 'EED2402549')],
)

// ---- ⑨ 友達欄 ---------------------------------------------------------------

check(
  '⑨ 友達欄は回答に書かれたとおりに並ぶ（学籍番号に解決しない・分けない。書いていない人は空 → issue #200）',
  grid.rows.map((one) => [one[0], one[2]]),
  [['ECK2626643', ''], ['EED2402549', '太郎君、同期'], ['LTS2390333', '']],
)

check(
  '⑨ 友達欄を渡さなければ、列は空のまま残る（列の数は変わらない）',
  toAssignmentGrid(assignments, day, nameOf).rows.map((one) => [one.length, one[2]]),
  [[27, ''], [27, ''], [27, '']],
)

check(
  '⑨ 出し直しでは後から来た行を採る。友達欄を消して出し直した人は空になる（前の回答から戻さない）',
  (() => {
    const resubmitted = friendsFromAnswers([
      ['2025-10-01 10:00:00', 'EED2402549', '高木琴音', '3年生', 'はい', '先輩', '', '', '', ''],
      ['2025-10-02 10:00:00', 'EED2402549', '高木琴音', '3年生', 'はい', '', '', '', '', ''],
      ['2025-10-01 11:00:00', 'ECK2626643', '森田咲良', '2年生', 'いいえ', '同期の女', '', '', '', ''],
      ['2025-10-02 11:00:00', 'eck2626643', '森田咲良', '2年生', 'いいえ', '同期の女の子', '', '', '', ''],
    ])
    return [resubmitted('EED2402549'), resubmitted('ECK2626643')]
  })(),
  ['', '同期の女の子'],
)

check(
  '⑨ 戻すときは友達欄を読まない（担当者が書き換えても、割り当ての行は変わらない → 5-2）',
  fromAssignmentGrid(
    grid.header,
    grid.rows.map((one) => one.map((cell, column) => (column === 2 ? '調理' : cell))),
    day,
    dayLabels[1],
  ).slice().sort(),
  backAgain.slice().sort(),
)

// ---- ⑤ 載らないものは名指しして止まる ---------------------------------------

check(
  '⑤ 1 セルに 2 役割は置けない（同じ人が同じ枠に 2 つ入っているのは違反である → 5-4）',
  whyItStopped(() => toAssignmentGrid(
    assignments.concat([row('2025-11-02', '10:00', '10:30', '会計', 'EED2402549')]),
    day,
    nameOf,
  ))?.includes('1 セルに入るのは役割 1 つである'),
  true,
)

check(
  '⑤ その日の枠に無い時間帯は、黙って落とさずに名指しする',
  whyItStopped(() => toAssignmentGrid([row('2025-11-02', '09:45', '10:15', '調理', 'EED2402549')], day, nameOf))
    ?.includes('その日の枠に無い'),
  true,
)

check(
  '⑤ 学籍番号が空の行に役割が入っていれば、誰の行かが決まらないので止まる',
  whyItStopped(() => fromAssignmentGrid(
    grid.header,
    [['', '', ''].concat(day.slots.map((slot) => (slot.start === '10:00' ? '調理' : '')))],
    day,
    dayLabels[1],
  ))?.includes('学籍番号が空です'),
  true,
)

check(
  '⑤ 学籍番号が 10 桁英数字でなければ名指しする（→ 4-1 の #1）',
  whyItStopped(() => fromAssignmentGrid(
    grid.header,
    [['あ', '', ''].concat(day.slots.map((slot) => (slot.start === '10:00' ? '調理' : '')))],
    day,
    dayLabels[1],
  ))?.includes('10 桁の英数字で書いてください'),
  true,
)

// 営業時刻を動かしたあとのマス目。前の周の見出し（07:00）が、いまの枠に無い
check(
  '⑤ 見出しの時刻がいまの枠に無ければ、黙って別の枠へ移さずに名指しする（→ 5-3）',
  whyItStopped(() => fromAssignmentGrid(
    ['学籍番号', '氏名', '一緒に組みたいお友達', '07:00'],
    [['EED2402549', '高木琴音', '', '調理']],
    day,
    dayLabels[1],
  ))?.includes('今の営業時刻に合いません'),
  true,
)

check(
  '⑤ 条件入力にその日の行が無いのにマス目に中身があれば、名指しして止まる',
  whyItStopped(() => fromAssignmentGrid(
    ['学籍番号', '氏名', '一緒に組みたいお友達', '08:00'],
    [['EED2402549', '高木琴音', '', '準備']],
    undefined,
    dayLabels[3],
  ))?.includes('の日の行がありません'),
  true,
)

// ---- ⑥ 違反の行を、塗るセルに当て戻す ---------------------------------------
// 行の位置はシートの行そのもので、途中の空の行も詰めない。

/** 検証結果の 1 行を、列の並びのとおりに組む。 */
function checkRow(kind, date, start, studentId) {
  const values = { '種別': kind, '日': date, '開始': start, '終了': '', '役割': '', '学籍番号': studentId, '氏名': '', '内容': '', 'あと何人': '' }
  return outputColumns('検証結果').map((name) => values[name])
}

const paintedHeader = ['学籍番号', '氏名', '一緒に組みたいお友達', '10:00', '10:30', '11:00']
const paintedRows = [
  ['ECK2626643', '森田咲良', '', '呼び込み', '', ''],
  ['', '', '', '', '', ''],
  ['eed2402549', '高木琴音', '太郎君', '調理', '調理', ''],
]

check(
  '⑥ 枠 1 つの違反はその枠のセルに、その人のその日の違反（規則 3）は学籍番号と氏名の 2 列に当たる（友達欄には当てない）',
  violationCells(paintedHeader, paintedRows, day, [
    checkRow(checkKind.violation, '2025-11-02', '10:30', 'EED2402549'),
    checkRow(checkKind.violation, '2025-11-02', '', 'ECK2626643'),
  ]),
  [{ row: 2, column: 4 }, { row: 0, column: 0 }, { row: 0, column: 1 }],
)

check(
  '⑥ 未充足・別の日・どの行にも列にも当たらない違反は塗らない（検証結果の行は残っている）',
  violationCells(paintedHeader, paintedRows, day, [
    checkRow(checkKind.unmet, '2025-11-02', '10:00', ''),
    checkRow(checkKind.violation, '2025-11-03', '10:00', 'EED2402549'),
    checkRow(checkKind.violation, '2025-11-02', '10:00', 'LTS2390333'),
    checkRow(checkKind.violation, '2025-11-02', '12:00', 'EED2402549'),
  ]),
  [],
)

check(
  '⑥ 同じセルに違反が 2 つあっても 1 回だけ塗る。同じ学籍番号の行が 2 つあれば両方に当たる',
  violationCells(paintedHeader, paintedRows.concat([['EED2402549', '', '', '', '', '']]), day, [
    checkRow(checkKind.violation, '2025-11-02', '10:00', 'EED2402549'),
    checkRow(checkKind.violation, '2025-11-02', '10:00', 'EED2402549'),
  ]),
  [{ row: 2, column: 3 }, { row: 3, column: 3 }],
)

// ---- ⑦ 背景は役割の色である -----------------------------------------------
// 色の値は記録に無いので、名前と重なりだけを見る。

check(
  '⑦ 記録の 8 役割に 7 色が付いている（準備と片付けは同じグレー）',
  roleColors.map((one) => `${one.roles.join('・')}=${one.name}`),
  ['準備・片付け=グレー', '調理=黄', '調理責任者=橙', '会計=水', '呼び込み=桃', '列整理=紫', 'クリーンパトロール=緑'],
)

check(
  '⑦ 色の値は 7 つとも違う（見分けが付く）',
  new Set(roleColors.map((one) => one.color)).size,
  roleColors.length,
)

check(
  '⑦ 背景の行列は、名前のある 3 列と空のセルと表に無い役割名を塗らず、幅に届かない右を null で埋める',
  gridBackgrounds([['EED2402549', '高木琴音', '調理', '調理', '', ' 準備 ', '委員会の見回り']], 8),
  [[null, null, null, roleColorOf('調理'), null, roleColorOf('準備'), null, null]],
)

// ---- ⑧ 手直しの印 -----------------------------------------------------------
// 上の grid にメモだけを足す。EED2402549 の 10:00・10:30 と LTS2390333 の空の 08:30 に印、
// ECK2626643 の 10:00 には担当者が自分で書いたメモ（印ではない）がある。

const withNotes = grid.rows.map((one) => one.map(() => ''))
const column = (time) => grid.header.indexOf(time)
const rowOf = (studentId) => grid.rows.findIndex((one) => one[0] === studentId)
withNotes[rowOf('EED2402549')][column('10:00')] = fixedNote
withNotes[rowOf('EED2402549')][column('10:30')] = `${fixedNote}（担当者が書き足した）`
withNotes[rowOf('ECK2626643')][column('10:00')] = '森田さんは 10 時から来られないかも'
withNotes[rowOf('LTS2390333')][column('08:30')] = fixedNote

check(
  '⑧ 印の付いたセルだけが手直しになる。空のセルの印は役割が空で乗り、担当者が自分で書いたメモは印にならない',
  fixedFromAssignmentGrid(grid.header, grid.rows, withNotes, day, dayLabels[2]),
  [
    ['2025-11-02', '10:00', '調理', 'EED2402549'],
    ['2025-11-02', '10:30', '調理', 'EED2402549'],
    ['2025-11-02', '08:30', '', 'LTS2390333'],
  ],
)

check(
  '⑧ 印かどうかは頭の文字で見る（残せなかった手直しのメモは印にならない）',
  [isFixedNote(fixedNote), isFixedNote(`  ${fixedNote}`), isFixedNote(conflictNote('調理', '規則 5: …')), isFixedNote('')],
  [true, true, false, false],
)

check(
  '⑧ 印の文言は「シフト作成者による修正済み」1 つに揃える（issue #230）。前の文言「手直し — …」は印にならない',
  [fixedNote, isFixedNote(`${fixedNote}（担当者が書き足した）`), isFixedNote('手直し — 生成し直しても残る（このメモを消すと、次の生成で組み直す）')],
  ['シフト作成者による修正済み', true, false],
)

check(
  '⑧ 見出しがいまの枠に無い印は、止まらずにそのまま乗る（名指しは生成の側 → generate.js の placeFixed）',
  fixedFromAssignmentGrid(['学籍番号', '氏名', '一緒に組みたいお友達', '07:00'], [['EED2402549', '', '', '会計']], [['', '', '', fixedNote]], day, dayLabels[2]),
  [['2025-11-02', '07:00', '会計', 'EED2402549']],
)

check(
  '⑧ 誰の行か決まらない印は、fromAssignmentGrid と同じに名指しして止まる',
  whyItStopped(() => fixedFromAssignmentGrid(grid.header, [['', '', '', '調理']], [['', '', '', fixedNote]], day, dayLabels[2]))
    ?.includes('学籍番号が空です'),
  true,
)

const fixedRows = [['2025-11-02', '10:00', '調理', 'EED2402549'], ['2025-11-02', '12:00', '', 'LTS2403003']]
const conflictRow = outputColumns('検証結果').map(() => '')
conflictRow[outputColumns('検証結果').indexOf('種別')] = checkKind.fixConflict
conflictRow[outputColumns('検証結果').indexOf('日')] = '2025-11-02'
conflictRow[outputColumns('検証結果').indexOf('開始')] = '07:00'
conflictRow[outputColumns('検証結果').indexOf('役割')] = '会計'
conflictRow[outputColumns('検証結果').indexOf('学籍番号')] = 'LTS2403003'
conflictRow[outputColumns('検証結果').indexOf('内容')] = 'いまの 2025-11-02 の枠に「07:00」が無い'
const regrid = toAssignmentGrid(assignments, day, nameOf, ['LTS2403003'])
const notes = gridNotes(regrid, day, fixedRows, [conflictRow])

check(
  '⑧ 1 枠も置いていない人でも、手直しがあれば行が残る（印を載せるセルが無くならない）',
  regrid.rows.map((one) => one[0]),
  ['ECK2626643', 'EED2402549', 'LTS2390333', 'LTS2403003'],
)

check(
  '⑧ 書き戻すメモ — 残せた手直しはそのセルに印、残せなかったものは理由（いまの枠に無ければ学籍番号のセル）',
  notes.flatMap((one, r) => one.map((note, c) => [r, regrid.header[c], note]).filter(([, , note]) => note !== '')),
  [
    [1, '10:00', fixedNote],
    [3, '学籍番号', conflictNote('会計', 'いまの 2025-11-02 の枠に「07:00」が無い')],
    [3, '12:00', fixedNote],
  ],
)

// ---- ⑩ 氏名から学籍番号を引く（→ issue #271） --------------------------------

const studentIdsOf = studentIdsFromAnswers([
  ['2025-10-01 10:00:00', 'EED2402549', '高木琴音', '3年生', 'はい', '', '', '', '', ''],
  ['2025-10-01 11:00:00', 'ESA0000001', '佐藤花', '1年生', 'いいえ', '', '', '', '', ''],
  ['2025-10-01 12:00:00', 'ESA0000002', '佐藤花', '2年生', 'いいえ', '', '', '', '', ''],
  ['2025-10-02 10:00:00', 'eed2402549', ' 高木琴音 ', '3年生', 'はい', '', '', '', '', ''],
  ['2025-10-02 11:00:00', '', '学籍番号なし', '1年生', 'いいえ', '', '', '', '', ''],
])

check(
  '⑩ 氏名が 1 人なら学籍番号 1 つ（出し直しは大文字に揃えて 1 つに数え、両端の空白は落とす）',
  [studentIdsOf('高木琴音'), studentIdsOf(' 高木琴音')],
  [['EED2402549'], ['EED2402549']],
)

check(
  '⑩ 同姓同名は学籍番号が 2 つ返る（どちらかは決めない）',
  studentIdsOf('佐藤花'),
  ['ESA0000001', 'ESA0000002'],
)

check(
  '⑩ 表記が 1 字でも違えば引けない。回答に無い氏名・学籍番号の無い行・オブジェクトの持ち物の名前も空である',
  [studentIdsOf('高木 琴音'), studentIdsOf('山田太郎'), studentIdsOf('学籍番号なし'), studentIdsOf('constructor')],
  [[], [], [], []],
)

// ---- 結果 ------------------------------------------------------------------

console.log('敷き方の検査（src/assignment-grid.js）')
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
