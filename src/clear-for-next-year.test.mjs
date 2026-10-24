#!/usr/bin/env node
// 「来年用に空にする」の検査 — src/clear-for-next-year.js を、偽のフォームと偽のスプレッドシートの上で走らせる。
//
//   使い方: node src/clear-for-next-year.test.mjs
//
// 見るものは 5 つある（→ issue #290 ／ ADR tech-requirements-0018）。
//   ① 回答シートとフォームの紐付けが外れ、回答の行と今年の題が消える
//   ② 割り当て 4 枚・検証結果・指標が、テンプレートの形に戻る（値・手直しの印・色・プルダウン・控え）
//   ③ 条件入力は 9〜10 行目の URL だけが空き、ほかの値は 1 つも動かない
//   ④ 空にしたファイルで、もう一度「フォームを作る」が通る（来年の担当者がやること）
//   ⑤ フォームが開けなければ、何も消さずに手で外す場所を名指しして止まる。紐付いていないファイルでも止まらない
//
// 本物のスプレッドシートとフォームでの振る舞いは実機が持つ（→ src/real-device-log.md の項目 24）。

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { check } from '../test/check.mjs'
import { FakeSpreadsheet } from '../test/fakes/spreadsheet.mjs'
import { createFormApp } from '../test/fakes/form.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

// 偽のスプレッドシートは test/fakes/spreadsheet.mjs、偽のフォームは test/fakes/form.mjs が持つ。
// 回答シートとフォームの紐付けは、setDestination で付き、removeDestination で外れる。
// シートは 40 行にしてある（もとの偽物がそうだった。割り当ての 4 枚の人の行は 2〜40 行目で、下の usedBook がその 39 行にプルダウンを置く）。

const books = {}
const { FormApp, forms } = createFormApp(books)

// ---- 読み込む ---------------------------------------------------------------

const context = vm.createContext({
  SpreadsheetApp: { ProtectionType: { SHEET: 'SHEET' }, BorderStyle: { SOLID_THICK: 'solid-thick' }, flush() {} },
  FormApp,
  console: { log() {}, error() {} },
})
for (const name of [
  'sheet-layout.js', 'form-definition.js', 'input-types.js', 'shell.js',
  'build-template.js', 'build-form.js', 'clear-for-next-year.js',
]) {
  vm.runInContext(fs.readFileSync(path.join(here, name), 'utf8'), context, { filename: name })
}
const { buildTemplateInto, buildFormOn, clearForNextYearOn, clearedText } = context
const { sheetLayout, formUrlBlock, dayLabels } = vm.runInContext('({ sheetLayout, formUrlBlock, dayLabels })', context)

// ---- 道具 -------------------------------------------------------------------

function whyItStopped(run) {
  try {
    run()
    return null
  } catch (error) {
    return error.detail || error.message
  }
}

const rosterImage = { bytes: [1], mimeType: 'image/png', fileName: '調理名簿.png' }

/** テンプレートを組み、条件入力の初期値のままフォームを作り、1 年使い終わった形にする。 */
function usedBook(id) {
  const book = new FakeSpreadsheet(['シート1'], { id, sheetOptions: { maxRows: 40 } })
  books[id] = book
  buildTemplateInto(book)
  buildFormOn(book, rosterImage)

  // 回答 3 行（モックの形。実データではない）。
  book.getSheetByName('回答').getRange(2, 1, 3, 3).setValues([
    ['2025/10/20 10:00:00', 'AAA0000001', '仮名 一'],
    ['2025/10/20 11:00:00', 'AAA0000002', '仮名 二'],
    ['2025/10/21 09:00:00', 'AAA0000003', '仮名 三'],
  ])
  // 割り当て 4 枚 — 時刻の見出し・人の行・手直しの印・色・プルダウン・控え。
  dayLabels.forEach((label) => {
    const sheet = book.getSheetByName(label)
    sheet.getRange(1, 4, 1, 2).setValues([['10:00', '10:30']])
    sheet.getRange(2, 1, 2, 5).setValues([
      ['AAA0000001', '仮名 一', '', '調理', '調理'],
      ['AAA0000002', '仮名 二', '仮名 一', '会計', ''],
    ])
    sheet.getRange(2, 4).setNote('シフト作成者による修正済み')
    sheet.getRange(2, 4, 2, 2).setBackgrounds([['#f4cccc', '#f4cccc'], ['#fff2cc', null]])
    sheet.getRange(2, 2, 39, 1).setDataValidation({ rule: '回答の氏名' })
    sheet.addDeveloperMetadata('seenGrid', '{"rows":[]}')
  })
  book.getSheetByName('検証結果').getRange(2, 1, 2, 3).setValues([['違反', '2025-11-02', '10:00'], ['未充足', '2025-11-03', '12:00']])
  book.getSheetByName('検証結果').getRange(2, 1, 2, 1).setBackgrounds([['#f4cccc'], ['#fff2cc']])
  book.getSheetByName('指標').getRange(2, 1, 2, 3).setValues([['AAA0000001', '仮名 一', 3], ['AAA0000002', '仮名 二', 1]])
  return book
}

/** 条件入力のセルを、URL 欄の C 列を除いて全部写す。 */
function inputCellsExceptUrls(book) {
  const sheet = book.getSheetByName('条件入力')
  const urlKeys = formUrlBlock.rows.map((one, i) => `${formUrlBlock.row + i},${formUrlBlock.urlColumn}`)
  return [...sheet.cells.entries()].filter(([key]) => urlKeys.indexOf(key) === -1).sort()
}

// ---- ①②③ 1 回通す ---------------------------------------------------------

const book = usedBook('used')
const answerSheetBefore = book.getSheetByName('回答')
const formUrlBefore = answerSheetBefore.getFormUrl()
const inputBefore = inputCellsExceptUrls(book)
const cleared = clearForNextYearOn(book)
const answers = book.getSheetByName('回答')

check(
  '① 「回答」とフォームの紐付けが外れた',
  [formUrlBefore !== null, answers.getFormUrl(), forms[0].linkedSheet],
  [true, null, null],
)

check('① 外したフォームの URL が返る（担当者にゴミ箱へ移してもらう）', cleared.formUrl, formUrlBefore)

check(
  '① 回答の行が 1 行も残っていない（氏名・学籍番号を来年に渡さない）',
  answers.getLastRow(),
  1,
)

check(
  '① 見出しは頭 6 列だけが残り、今年の題の 4 列は空いた（テンプレートと同じ形）',
  answers.getRange(1, 1, 1, 10).getValues()[0],
  [...sheetLayout.filter((layout) => layout.name === '回答')[0].sections[0].columns, '', '', '', ''],
)

check('① 「回答」は同じシートのまま残った（消して作り直さない）', answers === answerSheetBefore, true)

dayLabels.forEach((label) => {
  const sheet = book.getSheetByName(label)
  check(
    `② 「${label}」は列名の 3 つだけが残り、時刻の見出しも人の行も消えた`,
    [...sheet.cells.entries()].sort(),
    [['1,1', '学籍番号'], ['1,2', '氏名'], ['1,3', '一緒に組みたいお友達']],
  )
  check(
    `② 「${label}」の手直しの印・色・プルダウン・控えが消えた`,
    [
      [...sheet.notes.keys()].filter((key) => key !== '1,1'),
      sheet.backgrounds.size,
      sheet.validations.size,
      sheet.metadata.length,
    ],
    [[], 0, 0, 0],
  )
})

check(
  '② 検証結果と指標は見出しの行だけが残り、検証結果の行の色も消えた',
  [
    book.getSheetByName('検証結果').getLastRow(),
    book.getSheetByName('指標').getLastRow(),
    book.getSheetByName('検証結果').backgrounds.size,
  ],
  [1, 1, 0],
)

check(
  '③ 条件入力の 9〜10 行目の URL が空いた',
  book.getSheetByName('条件入力').getRange(formUrlBlock.row, formUrlBlock.urlColumn, 2, 1).getValues(),
  [[''], ['']],
)

check('③ 条件入力のほかのセルは 1 つも動いていない（来年の初期値になる）', inputCellsExceptUrls(book), inputBefore)

check(
  '③ シートは 8 枚のまま、構成の並びも変わっていない',
  book.getSheets().map((sheet) => sheet.getName()),
  sheetLayout.map((layout) => layout.name),
)

check(
  '③ 8 枚とも保護が 1 つずつかかったままである（空にしても外さない → #263）',
  book.getSheets().map((sheet) => [sheet.getName(), sheet.protections.length]),
  sheetLayout.map((layout) => [layout.name, 1]),
)

// ---- ④ もう一度フォームを作れる --------------------------------------------

const formsBefore = forms.length
const rebuilt = whyItStopped(() => buildFormOn(book, rosterImage))

check('④ 空にしたファイルで「フォームを作る」が止まらずに通る', rebuilt, null)
check('④ 新しいフォームが 1 つ作られ、「回答」はそれに紐付いた', [forms.length - formsBefore, book.getSheetByName('回答').getFormUrl()], [1, forms[forms.length - 1].getEditUrl()])

// ---- ⑤ 止まる・止まらない -------------------------------------------------

const lostForm = usedBook('lost-form')
lostForm.getSheetByName('回答').formUrl = 'https://forms.example/trashed/edit'
const lostStopped = whyItStopped(() => clearForNextYearOn(lostForm))

check(
  '⑤ フォームが開けなければ、手で外す場所を名指しして止まる',
  [lostStopped?.includes('フォームを開けませんでした'), lostStopped?.includes('フォームのリンクを解除')],
  [true, true],
)

check(
  '⑤ 止まったとき、回答も割り当ても URL も消していない',
  [
    lostForm.getSheetByName('回答').getLastRow(),
    lostForm.getSheetByName(dayLabels[0]).getLastRow(),
    lostForm.getSheetByName('条件入力').getRange(formUrlBlock.row, formUrlBlock.urlColumn).getValues()[0][0] !== '',
  ],
  [4, 3, true],
)

const twice = whyItStopped(() => clearForNextYearOn(book))
const unlinked = usedBook('unlinked')
unlinked.getSheetByName('回答').formUrl = null
const unlinkedResult = clearForNextYearOn(unlinked)

check('⑤ 紐付いていないファイルでも止まらず、回答は消える', [unlinkedResult.formUrl, unlinked.getSheetByName('回答').getLastRow()], [null, 1])

// 2 回目（④ で作り直したフォームに紐付いている）も止まらない。
check('⑤ 2 回押しても止まらない', twice, null)

check(
  '⑤ 終わりの文は、外したフォームをゴミ箱へ移すよう URL ごと名指しし、無ければその段を言わない',
  [
    clearedText('https://forms.example/1/edit').includes('https://forms.example/1/edit'),
    clearedText('https://forms.example/1/edit').includes('ゴミ箱'),
    clearedText(null).includes('ゴミ箱'),
  ],
  [true, true, false],
)
