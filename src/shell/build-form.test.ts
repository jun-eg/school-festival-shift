#!/usr/bin/env node
// フォームの作り方の検査 — src/shell/build-form.ts を、偽のフォームと偽のスプレッドシートの上で走らせる。
//
//   使い方: node src/shell/build-form.test.ts
//
// 見るものは 7 つある。
//   ① 定義の順どおりに置かれる（設問 9 つ ＋ 画像アイテム 1 つ）
//   ② 選んだ画像が画像アイテムに入る（選ばれていなければ止まる）
//   ③ 回答先がこのスプレッドシート自身に向く
//   ④ フォームが作った回答シートが構成の「回答」になる
//   ⑤ 2 回目・回答がある・見出しが違う、で名指しして止まる
//   ⑥ 題と営業時間が「日ごとの営業時刻」から出る。不正な入力ならフォームを作らずに止まる
//   ⑦ 配る用と編集用の URL が「条件入力」の C9 ／ C10 に残る。URL 欄があっても、営業時刻は 8 行目までしか読まない（→ issue #255）
//
// 条件入力には前回の値を入れるので、出来上がるフォームは 4 の表と一致するはずである（→ 仕様 #2）。
// 本物の Google フォームでの振る舞いは実機が持つ（→ src/real-device-log.md）。

import { check } from '../../test/check.ts'
import { FakeSpreadsheet, asGas, gasGlobal } from '../../test/fakes/spreadsheet.ts'
import { FakeForm, createFormApp } from '../../test/fakes/form.ts'
import { buildFormOn, rosterImageFrom } from './build-form.ts'
import { buildTemplateInto } from './build-template.ts'
import { formItemsFor } from '../core/form-definition.ts'
import { toDays } from '../core/input-types.ts'
import { protectionNote, sheetLayout } from '../core/sheet-layout.ts'

// 偽のスプレッドシートは test/fakes/spreadsheet.ts、偽のフォームは test/fakes/form.ts が持つ。

// ---- 読み込む ---------------------------------------------------------------

const books = {}
const { FormApp, forms: createdForms } = createFormApp(books)

gasGlobal.SpreadsheetApp = { ProtectionType: { SHEET: 'SHEET' }, BorderStyle: { SOLID_THICK: 'solid-thick' }, flush() {} }
gasGlobal.FormApp = FormApp
gasGlobal.Utilities = {
  base64Decode(base64) {
    return [...base64].map((c) => c.charCodeAt(0))
  },
  newBlob(bytes, mimeType, fileName) {
    return { bytes, mimeType, fileName }
  },
}
console.log = () => {}

// ---- 道具 -------------------------------------------------------------------

function whyItStopped(run) {
  try {
    run()
    return null
  } catch (error: any) {
    return error.detail || error.message
  }
}

/** 前回の日付と営業時刻。始まりの 4 つを営業開始に、片付け終了を営業終了に置く（→ 仕様 #2）。 */
const lastYearRows = [
  ['2025-11-01', '08:00', '08:00', '08:00', '08:00', '21:00'],
  ['2025-11-02', '08:00', '08:00', '08:00', '08:00', '20:00'],
  ['2025-11-03', '08:00', '08:00', '08:00', '08:00', '20:00'],
  ['2025-11-04', '08:00', '08:00', '08:00', '08:00', '15:00'],
]

/**
 * 条件入力の「日ごとの営業時刻」に行を入れる（見出し 2 行の下から）。
 * テンプレートが置いた初期値（→ sheet-layout.ts の initialRows）は先に空ける — 重ねて書くと、空や 3 行の入力を作れない。
 */
function putBusinessHours(book, rows) {
  const sheet = book.getSheetByName('条件入力')
  sheet.getRange(3, 1, 4, 6).setValues(Array.from({ length: 4 }, () => Array(6).fill('')))
  rows.forEach((row, i) => sheet.getRange(3 + i, 1, 1, row.length).setValues([row]))
  return book
}

/** 組み立て済みのテンプレートに「日ごとの営業時刻」を入れて用意する。空にするなら rows に [] を渡す。 */
function freshTemplate(id = 'this-spreadsheet', rows = lastYearRows) {
  const book = new FakeSpreadsheet(['シート1'], { id })
  buildTemplateInto(asGas(book))
  books[id] = book
  return putBusinessHours(book, rows)
}

const rosterImage = { bytes: [1, 2, 3], mimeType: 'image/png', fileName: '調理名簿.png' }

// 前回の 4 行を入れたときに出るはずの定義。
const lastYearItems = formItemsFor(toDays(lastYearRows, '日ごとの営業時刻'))
const lastYearTitles = lastYearItems.filter((item) => item.kind !== '画像アイテム').map((item) => item.title)

// ---- ①②③④ 1 回通す --------------------------------------------------------

const book = freshTemplate()
const built = buildFormOn(book, asGas(rosterImage))
const form = createdForms[createdForms.length - 1]

check(
  '① 定義の順どおりに、設問 9 つ ＋ 画像アイテム 1 つが置かれた',
  form.items.map((item) => [item.kind, item.title]),
  [
    ['text', '学籍番号'],
    ['text', '氏名'],
    ['radio', '学年'],
    ['radio', '調理担当ですか？'],
    ['image', '調理名簿'],
    ['text', '一緒に組みたいお友達'],
    ['paragraph', '11月1日(準備日)'],
    ['paragraph', '11月2日(学祭1日目)'],
    ['paragraph', '11月3日(学祭2日目)'],
    ['paragraph', '11月4日(片付け)'],
  ],
)

check(
  '① 必須の設問が 4-1 の表どおりである（任意は友達欄だけ）',
  form.items.filter((item) => item.kind !== 'image').map((item) => [item.title, item.required]),
  lastYearItems.filter((item) => item.kind !== '画像アイテム').map((item) => [item.title, item.required]),
)

check(
  '① 選択肢が 4-1 の表どおりに入った',
  form.items.filter((item) => item.kind === 'radio').map((item) => [item.title, item.choices]),
  [
    ['学年', ['1年生', '2年生', '3年生', '4年生']],
    ['調理担当ですか？', ['はい', 'いいえ']],
  ],
)

check(
  '① 正規表現が 2 箇所に入り（友達欄には入らない → issue #200）、希望時間の 4 設問は同じ 1 本である',
  form.items.filter((item) => item.validation).map((item) => [item.title, item.validation.pattern]),
  lastYearItems.filter((item) => item.pattern).map((item) => [item.title, item.pattern]),
)

check(
  '① エラーメッセージの句点の揺れ ◎ が、揃わずにそのまま渡った（→ 4-3）',
  form.items.filter((item) => item.kind === 'paragraph').map((item) => [item.title, item.validation.helpText]),
  [
    ['11月1日(準備日)', '無効な書式です'],
    ['11月2日(学祭1日目)', '無効な書式です'],
    ['11月3日(学祭2日目)', '無効な書式です。'],
    ['11月4日(片付け)', '無効な書式です'],
  ],
)

check(
  '① 短文回答には、記録に無いエラーメッセージを付けていない（→ 4-3。検証が付くのは学籍番号だけ → issue #200）',
  form.items.filter((item) => item.kind === 'text' && item.validation).map((item) => [item.title, item.validation.helpText]),
  [['学籍番号', undefined]],
)

check(
  '① 長文回答の説明文に、その日の営業時間と例 3 つが入った（→ 4-2）',
  form.items.filter((item) => item.kind === 'paragraph').map((item) => [item.helpText.includes('8:00-'), item.helpText.includes('10:00-15:00'), item.helpText.includes('10:00-12:00,13:00-15:00'), item.helpText.includes('00:00-00:00')]),
  [
    [true, true, true, true],
    [true, true, true, true],
    [true, true, true, true],
    [true, true, true, true],
  ],
)

check(
  '② 担当者が選んだ画像が、そのまま画像アイテムに入った',
  form.items.filter((item) => item.kind === 'image').map((item) => item.image),
  [rosterImage],
)

check('② 画像が選ばれていなければ、フォームを 1 つも作らずに名指しで止まる', [whyItStopped(() => rosterImageFrom(null))?.includes('調理名簿の画像を選んでください'), whyItStopped(() => rosterImageFrom(asGas({ mimeType: 'image/png' })))?.includes('調理名簿の画像を選んでください')], [true, true])

check('③ 回答先が、このスプレッドシート自身に向いた（担当者が紐付けない）', form.destination, { type: 'SPREADSHEET', id: 'this-spreadsheet' })

check('③ フォームの名前は、担当者が付けたこのファイルの名前である（文言を発明しない）', form.title, book.getName())

check('③ 配る URL が返る（担当者が LINE ノートに貼る → 2 の一覧 4）', [built.url, built.editUrl], [form.getPublishedUrl(), form.getEditUrl()])

check(
  '④ シートは 5 枚のままで、構成の並びも変わっていない',
  book.getSheets().map((sheet) => sheet.getName()),
  sheetLayout.map((layout) => layout.name),
)

const answerSheet = book.getSheetByName('回答')

check('④ 「回答」はフォームが作ったシートで、紐付きを持っている', [answerSheet.getFormUrl(), answerSheet.frozenRows], [form.getEditUrl(), 1])

check('④ 「回答」の見出しが、タイムスタンプ ＋ 置いた設問の題 9 つである（後ろ 4 列は今年の題 → 4-1）', answerSheet.getRange(1, 1, 1, 10).getValues()[0], ['タイムスタンプ', ...lastYearTitles])

check('④ 「回答」の頭 6 列は、構成が名前で持っている列と一致する', answerSheet.getRange(1, 1, 1, 6).getValues()[0], sheetLayout.filter((layout) => layout.name === '回答')[0].sections[0].columns)

check(
  '④ 「回答」に警告のみの保護がかかっている（生成シートである）',
  answerSheet.protections.map((protection) => [protection.warningOnly, protection.description]),
  [[true, protectionNote]],
)

check(
  '④ 8 枚とも保護が 1 つずつかかったままである',
  book.getSheets().map((sheet) => [sheet.getName(), sheet.protections.length]),
  sheetLayout.map((layout) => [layout.name, 1]),
)

// ---- ⑤ 止まる ---------------------------------------------------------------

const formsBeforeSecondRun = createdForms.length
const secondRun = whyItStopped(() => buildFormOn(book, asGas(rosterImage)))

check('⑤ 2 回目は、すでに紐付いていることを名指しし、「来年用に空にする」へ向けて止まる（テンプレートには向けない → #263）', [secondRun?.includes('もうフォームがあります'), secondRun?.includes('「シフト」→「来年用に空にする」を押してから'), secondRun?.includes('テンプレート')], [true, true, false])

check('⑤ 止まったとき、フォームを 1 つも作っていない', createdForms.length, formsBeforeSecondRun)

const bookWithAnswers = freshTemplate('with-answers')
bookWithAnswers
  .getSheetByName('回答')
  .getRange(2, 1, 1, 2)
  .setValues([['2025/09/23 16:31:09', 'EED2349987']])
const stoppedOnAnswers = whyItStopped(() => buildFormOn(bookWithAnswers, asGas(rosterImage)))

check('⑤ 回答シートに中身があるときは、消さずに名指しし、「来年用に空にする」へ向けて止まる（→ #263）', [stoppedOnAnswers?.includes('すでに 1 行ある'), stoppedOnAnswers?.includes('フォームを作れません'), stoppedOnAnswers?.includes('「シフト」→「来年用に空にする」を押してから')], [true, true, true])

check('⑤ 止まったとき、書いてあった行を消していない', bookWithAnswers.getSheetByName('回答').getRange(2, 1, 1, 2).getValues()[0], ['2025/09/23 16:31:09', 'EED2349987'])

const bookWithoutAnswerSheet = freshTemplate('no-answer-sheet')
bookWithoutAnswerSheet.deleteSheet(bookWithoutAnswerSheet.getSheetByName('回答'))

check('⑤ 「回答」が無いときは、シートの名前を出して止まる', whyItStopped(() => buildFormOn(bookWithoutAnswerSheet, asGas(rosterImage)))?.includes('シート「回答」が見つかりません'), true)

// フォームが作るシートの見出しが構成と違う形（設問の題を 1 つ変えて作らせる）。
const bookWithOddHeader = freshTemplate('odd-header')
const stoppedOnHeader = whyItStopped(() => {
  const original = FormApp.create
  FormApp.create = (title) => {
    const odd = new FakeForm(title, books)
    const add = odd.add.bind(odd)
    odd.add = (kind) => {
      const item = add(kind)
      const setTitle = item.setTitle.bind(item)
      item.setTitle = (name) => setTitle(name === '氏名' ? '名前' : name)
      return item
    }
    createdForms.push(odd)
    return odd
  }
  try {
    buildFormOn(bookWithOddHeader, asGas(rosterImage))
  } finally {
    FormApp.create = original
  }
})

check('⑤ フォームが作った回答シートの見出しが、置いた題と違えば、繋がずに名指しして止まる', [stoppedOnHeader?.includes('いま置いた設問の題と違う'), stoppedOnHeader?.includes('名前'), stoppedOnHeader?.includes('繋がずに止まる')], [true, true, true])

check('⑤ 止まったとき、テンプレートの「回答」を消していない', [bookWithOddHeader.getSheetByName('回答') !== null, bookWithOddHeader.getSheetByName('フォームの回答 1') !== null], [true, true])

// ---- ⑥ 題と営業時間は「日ごとの営業時刻」から出る（→ 4-1・4-2） -------------

check(
  '⑥ 前回の日付と営業時刻を入れて作ったフォームが、4 の表の題と営業時間になる（→ 仕様 #2）',
  form.items.filter((item) => item.kind === 'paragraph').map((item) => [item.title, item.helpText.split('\n')[0]]),
  [
    ['11月1日(準備日)', '営業時間は 8:00-21:00 です。出られる時間帯を「10:00-15:00」のように書いてください。'],
    ['11月2日(学祭1日目)', '営業時間は 8:00-20:00 です。出られる時間帯を「10:00-15:00」のように書いてください。'],
    ['11月3日(学祭2日目)', '営業時間は 8:00-20:00 です。出られる時間帯を「10:00-15:00」のように書いてください。'],
    ['11月4日(片付け)', '営業時間は 8:00-15:00 です。出られる時間帯を「10:00-15:00」のように書いてください。'],
  ],
)

// 今年の日付を入れた側。題も説明文の営業時間も、入れた値のものになる。
const thisYearRows = [
  ['2026-10-29', '09:00', '10:00', '17:00', '17:00', '22:00'],
  ['2026-10-30', '09:30', '10:00', '17:00', '17:00', '19:00'],
  ['2026-10-31', '09:30', '10:00', '17:00', '17:00', '19:30'],
  ['2026-11-01', '10:00', '10:00', '10:00', '10:00', '16:00'],
]
const thisYearBook = freshTemplate('this-year', thisYearRows)
buildFormOn(thisYearBook, asGas(rosterImage))
const thisYearForm = createdForms[createdForms.length - 1]

check(
  '⑥ 今年の日付を入れると、題も説明文の営業時間も今年のものになる',
  thisYearForm.items.filter((item) => item.kind === 'paragraph').map((item) => [item.title, item.helpText.split('\n')[0]]),
  [
    ['10月29日(準備日)', '営業時間は 9:00-22:00 です。出られる時間帯を「10:00-15:00」のように書いてください。'],
    ['10月30日(学祭1日目)', '営業時間は 9:30-19:00 です。出られる時間帯を「10:00-15:00」のように書いてください。'],
    ['10月31日(学祭2日目)', '営業時間は 9:30-19:30 です。出られる時間帯を「10:00-15:00」のように書いてください。'],
    ['11月1日(片付け)', '営業時間は 10:00-16:00 です。出られる時間帯を「10:00-15:00」のように書いてください。'],
  ],
)

check('⑥ 列名が今年の題に変わっても、「回答」に繋がる（見出しは位置で当てる → 4-1）', thisYearBook.getSheetByName('回答').getRange(1, 1, 1, 10).getValues()[0], [
  'タイムスタンプ',
  '学籍番号',
  '氏名',
  '学年',
  '調理担当ですか？',
  '一緒に組みたいお友達',
  '10月29日(準備日)',
  '10月30日(学祭1日目)',
  '10月31日(学祭2日目)',
  '11月1日(片付け)',
])

check(
  '⑥ 残り 5 設問と画像アイテムは、今年の入力で 1 文字も動いていない',
  thisYearForm.items.filter((item) => item.kind !== 'paragraph').map((item) => [item.kind, item.title]),
  form.items.filter((item) => item.kind !== 'paragraph').map((item) => [item.kind, item.title]),
)

/** 「日ごとの営業時刻」をこう入れたら、フォームを 1 つも作らずに止まるか。 */
function stoppedOn(id, rows) {
  const book = freshTemplate(id, rows)
  const before = createdForms.length
  const stopped = whyItStopped(() => buildFormOn(book, asGas(rosterImage)))
  return { stopped, madeForms: createdForms.length - before, book }
}

const onEmpty = stoppedOn('no-hours', [])

check('⑥ 「日ごとの営業時刻」が空のまま押されたら、名指しして止まる（→ 2 の止まる箇所 9）', [onEmpty.stopped?.includes('「日ごとの営業時刻」が空です'), onEmpty.stopped?.includes('4 日分入れて')], [true, true])

const onThreeRows = stoppedOn('three-days', lastYearRows.slice(0, 3))

check('⑥ 4 行でなければ、何行あるかとラベル 4 つを名指しして止まる', [onThreeRows.stopped?.includes('3 行です'), onThreeRows.stopped?.includes('準備日・学祭1日目・学祭2日目・片付け')], [true, true])

const onReversed = stoppedOn('reversed', [
  ['2025-11-01', '08:00', '08:00', '08:00', '08:00', '21:00'],
  ['2025-11-02', '08:00', '08:00', '08:00', '08:00', '20:00'],
  ['2025-11-03', '08:00', '08:00', '08:00', '08:00', '20:00'],
  ['2025-11-04', '15:00', '08:00', '08:00', '08:00', '15:00'],
])

check('⑥ 5 時刻が早い順でなければ、行と時刻を名指しして止まる（黙って並べ替えない → 5-1 の #1）', [onReversed.stopped?.includes('左から早い順に書いてください'), onReversed.stopped?.includes('「準備開始」が 15:00')], [true, true])

check('⑥ 3 つとも、フォームを 1 つも作らずに止まっている（作りかけが残らない）', [onEmpty.madeForms, onThreeRows.madeForms, onReversed.madeForms], [0, 0, 0])

check(
  '⑥ 止まったとき、テンプレートの「回答」はそのままで、シートも 8 枚のままである',
  [onEmpty.book, onThreeRows.book, onReversed.book].map((one) => [one.getSheets().length, one.getSheetByName('回答') !== null, one.getSheetByName('回答').getFormUrl()]),
  [
    [8, true, null],
    [8, true, null],
    [8, true, null],
  ],
)

// ---- ⑦ URL 欄 ----------------------------------------------------------------

check('⑦ フォームを作ると、条件入力の C9 に配る用、C10 に編集用の URL が入る（見出しはそのまま）', book.getSheetByName('条件入力').getRange(9, 1, 2, 3).getValues(), [
  ['配布用googleフォームurl:', '', form.getPublishedUrl()],
  ['編集用googleフォームurl:', '', form.getEditUrl()],
])

check(
  '⑦ 止まったときは、URL 欄は空のままである（フォームが作られていない）',
  [onEmpty.book, onThreeRows.book, onReversed.book].map((one) => one.getSheetByName('条件入力').getRange(9, 3, 2, 1).getValues()),
  [
    [[''], ['']],
    [[''], ['']],
    [[''], ['']],
  ],
)

// 5 行目・6 行目（7・8 行目）は営業時刻として読む — 多すぎる行は名指しで止まる。9 行目より下は読まない。
const onSixRows = stoppedOn('six-days', [...lastYearRows, ['2025-11-05', '08:00', '08:00', '08:00', '08:00', '15:00'], ['2025-11-06', '08:00', '08:00', '08:00', '08:00', '15:00']])

check('⑦ 「日ごとの営業時刻」に 6 行（8 行目まで）書けば、6 行として名指しして止まる — URL 欄の 9 行目は数えない', [onSixRows.stopped?.includes('6 行です'), onSixRows.madeForms], [true, 0])
