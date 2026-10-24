#!/usr/bin/env node
// 構造の検証の検査 — src/shell/verify-structure.js を、読むだけの偽のスプレッドシートの上で走らせる。
//
//   使い方: node src/shell/verify-structure.test.mjs
//
// 見るものは 6 つある。
//   ① 構成どおりなら崩れは 0 箇所
//   ② シートを消す／列を挿す／見出しを書き換える、のそれぞれで名指しの行が出る
//   ③ 行の削除・生成シートの上書き・列をまとめて消す、でも名指しする
//   ④ セルが 1 つも変わっていない（黙って直さない）
//   ⑤ 読むのはシートごとに 1 回
//   ⑥ 崩れていれば checkStructure が止まり、崩れている箇所を全部文にして持っている
//
// 崩れた状態で生成が走らないことは src/shell/shell.test.mjs が見る。

import { check } from '../../test/check.mjs'
import { FakeSheet, FakeSpreadsheet, roundTrips } from '../../test/fakes/spreadsheet.mjs'
import { sectionRightEdge, sheetLayout } from '../core/sheet-layout.js'
import { breakageToText, checkStructure, nameBreakages } from './verify-structure.js'

// 偽のスプレッドシートは test/fakes/spreadsheet.mjs が持つ。
// 読むだけのシート（readOnly）は書こうとしたらそこで落ちる（「黙って直さない」を道具の側で確かめる）。

// ---- 読み込む ---------------------------------------------------------------
// headerRowCount と normalizeValue は shell.js にあるので一緒に読む。SpreadsheetApp は置かない。

function whyItStopped(work) {
  try {
    work()
    return null
  } catch (error) {
    return error.detail || error.message
  }
}

/** sheetLayout どおりに見出しを置いた空の 8 枚（テンプレートを組んだ直後の形）を作る。 */
function emptyTemplate() {
  const sheets = sheetLayout.map((layout) => {
    const sheet = new FakeSheet(layout.name, { readOnly: true })
    // マス目の 4 枚は既定の 26 列に収まらないので広げる（→ build-template.js の widenTo）
    sheet.maxColumns = Math.max(sheet.maxColumns, sectionRightEdge(layout))
    layout.sections.forEach((section) => {
      if (layout.hasSectionHeadings) sheet.put(1, section.startColumn, section.heading)
      const columnNameRow = layout.hasSectionHeadings ? 2 : 1
      section.columns.forEach((columnName, i) => sheet.put(columnNameRow, section.startColumn + i, columnName))
    })
    return sheet
  })
  return new FakeSpreadsheet(sheets)
}

function namedLines(book) {
  return nameBreakages(book).map(breakageToText)
}

// ---- ① 崩れていなければ 0 箇所 ----------------------------------------------

check('① 構成どおりに並んでいれば、崩れは 0 箇所である', namedLines(emptyTemplate()), [])

// 担当者が書く行を足しても、見出しだけを見ているので崩れない
const bookWithMoreRows = emptyTemplate()
bookWithMoreRows.getSheetByName('条件入力').put(3, 1, '2025-11-01').put(4, 1, '2025-11-02')
bookWithMoreRows.getSheetByName('準備日').put(2, 1, 'EED2349987').put(1, 4, '08:00')
check('① 担当者がデータの行を書き足しても崩れない（見るのは見出しの行だけである）', namedLines(bookWithMoreRows), [])

// ---- ② シートを消す／列を挿す／見出しを書き換える ---------------------------

const bookMissingASheet = emptyTemplate()
bookMissingASheet.sheets = bookMissingASheet.sheets.filter((s) => s.getName() !== '回答')

check(
  '② シートを 1 枚消すと、そのシートを名指しする',
  namedLines(bookMissingASheet),
  ['シート「回答」が見つかりません'],
)

const bookWithInsertedColumn = emptyTemplate()
bookWithInsertedColumn.getSheetByName('指標').insertColumn(2)

check(
  '② 列を 1 つ挿すと、ずれた列名と、右へ押し出された見出しを名指しする',
  namedLines(bookWithInsertedColumn),
  [
    '「指標」の 1 行目 1 列目から 5 列 が本来と違います。'
      + '今: 学籍番号 / （空） / 氏名 / 合計時間 / シフト回数'
      + ' ／ 本来: 学籍番号 / 氏名 / 合計時間 / シフト回数 / 準備回数',
    '「指標」の 1 行目 6 列目 に、本来ない「準備回数」があります',
  ],
)

// マス目の 4 枚は、名前のある 3 列だけを照らす（右の時刻の列は名前を持たない）。
const gridWithInsertedColumn = emptyTemplate()
gridWithInsertedColumn.getSheetByName('学祭1日目').put(1, 4, '08:00').put(1, 5, '08:30').insertColumn(2)

check(
  '② マス目の 4 枚は、名前のある 3 列だけを照らす（時刻の列は名前を持たないので出てこない）',
  namedLines(gridWithInsertedColumn),
  [
    '「学祭1日目」の 1 行目 1 列目から 3 列 が本来と違います。'
      + '今: 学籍番号 / （空） / 氏名 ／ 本来: 学籍番号 / 氏名 / 一緒に組みたいお友達',
  ],
)

// 条件入力は 5 区画が横に並ぶので、1 つ挿すと右の区画まで全部ずれる
const conditionsWithInsertedColumn = emptyTemplate()
conditionsWithInsertedColumn.getSheetByName('条件入力').insertColumn(2)
const conditionBreakages = nameBreakages(conditionsWithInsertedColumn)

check(
  '② 横に並んだ 5 区画のどれがずれたかも、区画ごとに名指しする',
  [
    conditionBreakages.every((breakage) => breakage.sheet === '条件入力' && breakage.row >= 1 && breakage.column >= 1),
    breakageToText(conditionBreakages[0]),
  ],
  [
    true,
    '「条件入力」の 2 行目 1 列目から 6 列 が本来と違います。'
      + '今: 日付 / （空） / 準備開始 / 調理開始 / 調理終了 / 片付け開始'
      + ' ／ 本来: 日付 / 準備開始 / 調理開始 / 調理終了 / 片付け開始 / 片付け終了',
  ],
)

const bookWithChangedHeading = emptyTemplate()
bookWithChangedHeading.getSheetByName('検証結果').put(1, 1, '区分')

check(
  '② 見出しを 1 つ書き換えると、その場所と、いまの中身と構成を並べて名指しする',
  namedLines(bookWithChangedHeading),
  [
    '「検証結果」の 1 行目 1 列目から 10 列 が本来と違います。'
      + '今: 区分 / 日 / 開始 / 終了 / 役割 / 学籍番号 / 氏名 / 内容 / あと何人 / 候補'
      + ' ／ 本来: 種別 / 日 / 開始 / 終了 / 役割 / 学籍番号 / 氏名 / 内容 / あと何人 / 候補',
  ],
)

// ---- ③ 行を消す／生成シートを上書きする -------------------------------------

const bookWithDeletedRow = emptyTemplate()
bookWithDeletedRow.getSheetByName('条件入力').deleteRow(1)

check(
  '③ 見出しの行を 1 つ消すと、区画の見出しの場所を名指しする（行の削除）',
  namedLines(bookWithDeletedRow)[0],
  '「条件入力」の 1 行目 1 列目 が本来と違います。今: 日付 ／ 本来: 日ごとの営業時刻',
)

const overwrittenBook = emptyTemplate()
overwrittenBook.getSheetByName('指標').clear()

check(
  '③ 生成シートを上書きして見出しが消えても名指しする（黙って置き直さない）',
  namedLines(overwrittenBook),
  [
    '「指標」の 1 行目 1 列目から 5 列 が本来と違います。'
      + '今: （空） / （空） / （空） / （空） / （空） ／ 本来: 学籍番号 / 氏名 / 合計時間 / シフト回数 / 準備回数',
  ],
)

// 列をまとめて消されたら、範囲外の例外より先に名指しする
const bookWithCutColumns = emptyTemplate()
bookWithCutColumns.getSheetByName('指標').cutColumnsTo(3)

check(
  '③ 列をまとめて消されても、範囲外で落ちずに列数を名指しする',
  namedLines(bookWithCutColumns),
  [
    'シート「指標」の列が 3 列しかありません（本来は 5 列です）',
    '「指標」の 1 行目 1 列目から 5 列 が本来と違います。'
      + '今: 学籍番号 / 氏名 / 合計時間 / （空） / （空）'
      + ' ／ 本来: 学籍番号 / 氏名 / 合計時間 / シフト回数 / 準備回数',
  ],
)

// マス目の 4 枚は 51 列を取る（→ sheet-layout.js の maxSlotsPerDay）。26 列のままなら名指しする
const gridNotWidened = emptyTemplate()
gridNotWidened.getSheetByName('片付け').cutColumnsTo(26)

check(
  '③ マス目の 4 枚が広げられていなければ、読む前に列数を名指しする',
  namedLines(gridNotWidened),
  ['シート「片付け」の列が 26 列しかありません（本来は 51 列です）'],
)

// 条件入力は 2 行目までが見出しなので、1 行しか残っていなければ列名の行が無い
const bookWithCutRows = emptyTemplate()
bookWithCutRows.getSheetByName('条件入力').cutRowsTo(1)

check(
  '③ 行をまとめて消されても、範囲外で落ちずに列名の行を名指しする',
  namedLines(bookWithCutRows)[0],
  '「条件入力」の 2 行目 1 列目から 6 列 が本来と違います。'
    + '今: （空） / （空） / （空） / （空） / （空） / （空）'
    + ' ／ 本来: 日付 / 準備開始 / 調理開始 / 調理終了 / 片付け開始 / 片付け終了',
)

// ---- ④ 黙って直していない ---------------------------------------------------

const bookLeftBroken = emptyTemplate()
bookLeftBroken.getSheetByName('検証結果').put(1, 1, '区分')
bookLeftBroken.getSheetByName('指標').insertColumn(2)
const snapshotBeforeChecking = bookLeftBroken.snapshot()
nameBreakages(bookLeftBroken)

check(
  '④ 照らしたあとも、セルが 1 つも変わっていない（黙って直した箇所が 0 である）',
  bookLeftBroken.snapshot(),
  snapshotBeforeChecking,
)

// ---- ⑤ 読むのはシートごとに 1 回 --------------------------------------------

roundTrips.reads = 0
nameBreakages(emptyTemplate())

check('⑤ 読むのはシートごとに 1 回である（8 枚で 8 回）', roundTrips.reads, sheetLayout.length)

roundTrips.reads = 0
nameBreakages(bookMissingASheet)

check('⑤ 無いシートは読まない（4 枚で 4 回）', roundTrips.reads, sheetLayout.length - 1)

// ---- ⑥ 崩れていれば止まる ---------------------------------------------------

check(
  '⑥ 崩れていなければ、構造を確かめる は 0 箇所を返して通す',
  checkStructure(emptyTemplate()),
  [],
)

const stopped = whyItStopped(() => checkStructure(bookWithInsertedColumn))

check(
  '⑥ 崩れていれば止まり、箇所数と戻し方を名指しする（「生成」とは言わない — 書き換え後にも画像の書き出しにも出る）',
  [
    stopped?.startsWith('シートの見出しや列が 2 か所変わっているため、処理できません。'),
    stopped?.includes('生成'),
    stopped?.includes('テンプレートをコピーし直して条件を入れ直してください'),
  ],
  [true, false, true],
)

check(
  '⑥ 止まったときの文に、崩れている箇所の行が全部入っている',
  namedLines(bookWithInsertedColumn).filter((line) => !stopped.includes(line)),
  [],
)
