#!/usr/bin/env node
// フォームの定義の検査 — src/form-definition.js を、docs/tech-requirements.md 4-1〜4-3 の表と突き合わせる。
//
//   使い方: node src/form-definition.test.mjs
//
// 見るものは 6 つある。
//   ① 前回の日付と営業時刻を入れたとき、4-1 の表と 1 行ずつ突き合わせて差分が 0
//      （設問 9 つ ＋ 画像アイテム 1 つ・順序・形式・必須・選択肢。→ 仕様 #2 の判定）
//   ② 正規表現が 3 箇所で、希望時間の 4 設問は同じ 1 本である（→ 4-2）
//   ③ エラーメッセージの句点の揺れ ◎ を揃えずに写している（→ 4-3）
//   ④ 説明文が、記録にある例 3 つと営業時間を持っている（→ 4-2）
//   ⑤ 入る側から数え直すと 6 項目である（→ 5 の #3）。締切は定義に無い（→ 4-1）
//   ⑦ 今年の日付を入れれば題も営業時間も今年のものになり、4 行でなければ作らずに止まる（→ 4-1・4-2）
//
// 定義そのものは題も営業時間も持たない（→ 4-1・4-2）。持つのはラベル 4 つと、
// 日付・帯からそれを組む口である。だから①〜④は「入力を入れた後の形」を見る。
//
// 加えて、data/前回の希望データ-モック.csv の 50 行を正規表現と選択肢に通す。
// 定義が前回の回答を 1 件も弾かないことは、ここでしか数えていない。
//
// ここで分かるのは定義だけである。フォームの作り方（並べる順・回答先・画像）は
// build-form.test.mjs が、本物の Google フォームで正規表現とエラーメッセージが設定できるかは
// issue #145（6-1 の #1）が持つ。

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(here, '..', 'data')

// ラベル 4 つの値は sheet-layout.js が持つ（割り当ての 4 枚の名前と同じ 1 か所である → issue #213）
const context = vm.createContext({})
for (const name of ['sheet-layout.js', 'form-definition.js']) {
  vm.runInContext(fs.readFileSync(path.join(here, name), 'utf8'), context, { filename: name })
}
const { formItemsFor, wishTimeDescription, entrantItemNames, wishTimeLabels } = context
const { formItems, formItemKind, wishTimePattern, wishTimeExamples, dayLabels } = vm.runInContext(
  '({ formItems, formItemKind, wishTimePattern, wishTimeExamples, dayLabels })',
  context,
)

// ---- 前回の日付と営業時刻（→ 仕様 #2 の判定） -------------------------------
//
// 日付は 2025-11-01〜04（→ data/前回の確定シフト.md）。
// 5 時刻の置き方は 7「前回の 5 時刻の置き方」の M1 ①・フォームの側と同じである — 始まりの 4 つを
// その日の営業開始に、片付け終了を営業終了に置く。入力の行として残っているのは説明文の営業時間 ◎ の
// 1 本の帯だけだからである。説明文に出す帯は 準備開始〜片付け終了 なので、内訳を変えても出る帯は同じである。
// この 4 行を入れて 4-1 の表が出ることが、入力から組む側が壊れていないことの判定である。

const lastYear = [
  ['2025-11-01', '08:00', '21:00'],
  ['2025-11-02', '08:00', '20:00'],
  ['2025-11-03', '08:00', '20:00'],
  ['2025-11-04', '08:00', '15:00'],
].map(([date, open, close]) => ({
  date,
  prepStart: open,
  cookStart: open,
  cookEnd: open,
  cleanupStart: open,
  cleanupEnd: close,
}))

/** 今年の側。日付も営業時間も前回と 1 つも重ならない 4 日である。 */
const thisYear = [
  ['2026-10-29', '09:00', '22:00'],
  ['2026-10-30', '09:30', '19:00'],
  ['2026-10-31', '09:30', '19:30'],
  ['2026-11-01', '10:00', '16:00'],
].map(([date, open, close]) => ({
  date,
  prepStart: open,
  cookStart: open,
  cookEnd: open,
  cleanupStart: open,
  cleanupEnd: close,
}))

const lastYearItems = formItemsFor(lastYear)

const failed = []
const passed = []

function check(title, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed.push(title)
  else failed.push({ title, actual, expected })
}

// ---- ① 4-1 の表そのもの（写した相手） ---------------------------------------

// docs/tech-requirements.md 4-1 の表を、上から順にそのまま置いたものである。
// 定義を書き換えたらここも書き換わる、では突き合わせにならないので、
// 表の側は文字列で持つ（form-definition.js の値を 1 つも読まない）。
const tableInRequirements = [
  { number: 1, title: '学籍番号', kind: '短文回答', required: true, detail: '^[A-Za-z0-9]{10}$' },
  { number: 2, title: '氏名', kind: '短文回答', required: true, detail: '—' },
  { number: 3, title: '学年', kind: 'ラジオボタン', required: true, detail: '1年生／2年生／3年生／4年生' },
  { number: 4, title: '調理担当ですか？', kind: 'ラジオボタン', required: true, detail: 'はい／いいえ' },
  { number: null, title: '調理名簿', kind: '画像アイテム', required: false, detail: '委員会から来た名簿の画像' },
  { number: 5, title: '一緒に組みたいお友達', kind: '短文回答', required: false, detail: '^(?:[A-Za-z0-9]{10})(?:,[A-Za-z0-9]{10})*$' },
  { number: 6, title: '11月1日(準備日)', kind: '長文回答', required: true, detail: '→ 4-2 の正規表現' },
  { number: 7, title: '11月2日(学祭1日目)', kind: '長文回答', required: true, detail: '→ 4-2 の正規表現' },
  { number: 8, title: '11月3日(学祭2日目)', kind: '長文回答', required: true, detail: '→ 4-2 の正規表現' },
  { number: 9, title: '11月4日(片付け)', kind: '長文回答', required: true, detail: '→ 4-2 の正規表現' },
]

/** 定義の 1 行を、表の形に直す（並べ替えない。定義の順のまま）。 */
function asTableRow(item) {
  const detail = {
    [formItemKind.text]: item.pattern || '—',
    [formItemKind.radio]: (item.choices || []).join('／'),
    [formItemKind.paragraph]: '→ 4-2 の正規表現',
    [formItemKind.image]: '委員会から来た名簿の画像',
  }[item.kind]
  return {
    number: item.number === undefined ? null : item.number,
    title: item.title,
    kind: item.kind,
    required: item.required,
    detail,
  }
}

check(
  '① 前回の日付と営業時刻を入れると、4-1 の表と 1 行ずつ突き合わせて差分が 0（→ 仕様 #2）',
  lastYearItems.map(asTableRow),
  tableInRequirements,
)

check(
  '① 設問は 9 つ、画像アイテムは 1 つである',
  [
    lastYearItems.filter((item) => item.kind !== formItemKind.image).length,
    lastYearItems.filter((item) => item.kind === formItemKind.image).length,
  ],
  [9, 1],
)

check(
  '① 画像アイテムは設問ではないので、# を持たない',
  lastYearItems.filter((item) => item.kind === formItemKind.image).map((item) => item.number),
  [undefined],
)

check(
  '① 定義そのものは、題も営業時間も 1 つも持たない（今年の入力から出る → 4-1・4-2）',
  formItems.filter((item) => item.title || item.businessHours).map((item) => item.title),
  ['学籍番号', '氏名', '学年', '調理担当ですか？', '調理名簿', '一緒に組みたいお友達'],
)

// ---- ② 正規表現は 3 箇所で、希望時間は 1 本である（→ 4-2） ------------------

const itemsWithPattern = lastYearItems.filter((item) => item.pattern)
const wishTimeItems = lastYearItems.filter((item) => item.kind === formItemKind.paragraph)

check(
  '② 正規表現を持つのは 3 箇所である（学籍番号・友達欄・希望時間）',
  itemsWithPattern.map((item) => item.title),
  ['学籍番号', '一緒に組みたいお友達', '11月1日(準備日)', '11月2日(学祭1日目)', '11月3日(学祭2日目)', '11月4日(片付け)'],
)

check(
  '② 希望時間 4 設問の正規表現は、4 つとも同じ 1 本である',
  wishTimeItems.map((item) => item.pattern === wishTimePattern),
  [true, true, true, true],
)

check(
  '② 正規表現が 4-2 の 1 本と完全に一致する',
  wishTimePattern,
  '^(?:[0-9]|[01]\\d|2[0-3]):[0-5]\\d-(?:[0-9]|[01]\\d|2[0-3]):[0-5]\\d'
    + '(?:,(?:[0-9]|[01]\\d|2[0-3]):[0-5]\\d-(?:[0-9]|[01]\\d|2[0-3]):[0-5]\\d)*$',
)

const wishTime = new RegExp(wishTimePattern)
check(
  '② 時は 0-23、分は 00-59 まで通り、24 時と 60 分は通らない',
  ['0:00-23:59', '00:00-00:00', '10:00-12:00,13:00-15:00', '24:00-24:30', '10:60-11:00', '10:00〜12:00'].map((one) => wishTime.test(one)),
  [true, true, true, false, false, false],
)

// ---- ③ 句点の揺れ ◎ を揃えない（→ 4-3） ------------------------------------

check(
  '③ 4-3 の表どおりで、句点が付いているのは 11月3日(学祭2日目) だけである',
  wishTimeItems.map((item) => [item.title, item.errorMessage]),
  [
    ['11月1日(準備日)', '無効な書式です'],
    ['11月2日(学祭1日目)', '無効な書式です'],
    ['11月3日(学祭2日目)', '無効な書式です。'],
    ['11月4日(片付け)', '無効な書式です'],
  ],
)

check(
  '③ エラーメッセージを持つのは希望時間 4 設問だけである（記録に無い文言を発明していない）',
  lastYearItems.filter((item) => item.errorMessage).length,
  4,
)

// ---- ④ 説明文は、例 3 つと営業時間を持つ（→ 4-2） ---------------------------

check(
  '④ 説明文に書かれた例 ◎ が 3 つとも記録どおりである',
  wishTimeExamples,
  [
    { label: '例1', value: '10:00-15:00' },
    { label: '例2（複数指定）', value: '10:00-12:00,13:00-15:00' },
    { label: '例3（終日出れない場合）', value: '00:00-00:00' },
  ],
)

check(
  '④ 説明文に書かれた営業時間 ◎ が、日ごとに記録どおりである',
  wishTimeItems.map((item) => [item.title, item.businessHours]),
  [
    ['11月1日(準備日)', '8:00-21:00'],
    ['11月2日(学祭1日目)', '8:00-20:00'],
    ['11月3日(学祭2日目)', '8:00-20:00'],
    ['11月4日(片付け)', '8:00-15:00'],
  ],
)

check(
  '④ 組み上がった説明文に、例 3 つとその日の営業時間が入っている',
  wishTimeItems.map((item) => {
    const text = wishTimeDescription(item)
    return [
      text.includes(item.businessHours),
      ...wishTimeExamples.map((example) => text.includes(example.value)),
    ]
  }),
  [[true, true, true, true], [true, true, true, true], [true, true, true, true], [true, true, true, true]],
)

// ---- ⑤ 入る側から数えると 6 項目である（→ 5 の #3） -------------------------

check(
  '⑤ 入る側から数え直すと 6 項目である（設問は 9 つに割れているだけ）',
  entrantItemNames(),
  ['学籍番号', '氏名', '学年', '調理可否', '友達欄', '希望時間'],
)

check(
  '⑤ 希望時間の 4 設問は、入る側から見ると 1 項目である',
  wishTimeItems.map((item) => item.entrantItem),
  ['希望時間', '希望時間', '希望時間', '希望時間'],
)

check(
  '⑤ 画像アイテムは入る側が答えるものではない（回答として回収されない ◎）',
  lastYearItems.filter((item) => item.kind === formItemKind.image).map((item) => item.entrantItem),
  [null],
)

check(
  '⑤ 締切が定義に無い（毎回決める入力で、フォーム側は締切で閉じない ◎ → 4-1）',
  lastYearItems.filter((item) => /締切/.test(item.title)).length,
  0,
)

// ---- ⑥ data/ の希望データのモック 50 行が、定義を通る ----------------------

/** 引用符の中のコンマを割らないだけの CSV の読み。友達欄が引用符付きで入っている。 */
function readCsv(text) {
  return text.replace(/^﻿/, '').trim().split(/\r?\n/).map((line) => {
    const cells = []
    let cell = ''
    let quoted = false
    for (const character of line) {
      if (character === '"') quoted = !quoted
      else if (character === ',' && !quoted) { cells.push(cell); cell = '' }
      else cell += character
    }
    cells.push(cell)
    return cells
  })
}

const answerRows = readCsv(fs.readFileSync(path.join(dataDir, '前回の希望データ-モック.csv'), 'utf8'))
const answerHeader = answerRows[0]
const answers = answerRows.slice(1)

check(
  '⑥ 前回の希望データ（モック）の見出しが、前回の日付で組んだ題 9 つ ＋ タイムスタンプと同じである',
  answerHeader,
  ['タイムスタンプ', ...lastYearItems.filter((item) => item.kind !== formItemKind.image).map((item) => item.title)],
)

/** 列の並びは見出しと同じである（上の検査が見ている）。 */
function columnOf(title) {
  return answerHeader.indexOf(title)
}

const rejected = []
answers.forEach((row, index) => {
  lastYearItems.forEach((item) => {
    if (item.kind === formItemKind.image) return
    const value = row[columnOf(item.title)]
    if (item.pattern && value !== '' && !new RegExp(item.pattern).test(value)) {
      rejected.push([`${index + 2} 行目`, item.title, value])
    }
    if (item.choices && item.choices.indexOf(value) === -1) {
      rejected.push([`${index + 2} 行目`, item.title, value])
    }
    if (item.required && value === '') rejected.push([`${index + 2} 行目`, item.title, '空'])
  })
})

check(
  '⑥ 前回の回答 50 行を、正規表現も選択肢も必須も 1 件も弾かない',
  [answers.length, rejected],
  [50, []],
)

// ---- ⑦ 今年の日付を入れると、今年のものになる（→ 4-1・4-2） ----------------

const thisYearItems = formItemsFor(thisYear)
const thisYearWishItems = thisYearItems.filter((item) => item.kind === formItemKind.paragraph)

check(
  '⑦ 題の日付が今年のものになり、ラベル 4 つは転記のまま動かない ◎',
  thisYearWishItems.map((item) => item.title),
  ['10月29日(準備日)', '10月30日(学祭1日目)', '10月31日(学祭2日目)', '11月1日(片付け)'],
)

check(
  '⑦ 説明文の営業時間が、その日の 準備開始〜片付け終了 になる（帯は 1 日の端から端まで）',
  thisYearWishItems.map((item) => item.businessHours),
  ['9:00-22:00', '9:30-19:00', '9:30-19:30', '10:00-16:00'],
)

check(
  '⑦ 組み上がった説明文に、今年の営業時間が入り、前回の値が 1 つも残っていない',
  thisYearWishItems.map((item) => {
    const text = wishTimeDescription(item)
    return [text.includes(item.businessHours), /8:00-(21|20|15):00/.test(text)]
  }),
  [[true, false], [true, false], [true, false], [true, false]],
)

check(
  '⑦ 希望時間の 4 設問以外は、今年の入力で 1 文字も動かない（残り 5 設問 ＋ 画像アイテム）',
  thisYearItems.filter((item) => item.kind !== formItemKind.paragraph),
  lastYearItems.filter((item) => item.kind !== formItemKind.paragraph),
)

check(
  '⑦ ラベル 4 つは定義側の固定である ◎（学祭は例年この 4 日 → 4-1）',
  wishTimeLabels(),
  ['準備日', '学祭1日目', '学祭2日目', '片付け'],
)

check(
  '⑦ ラベルの値は 1 か所である — 割り当ての 4 枚の名前と同じものを見ている（→ issue #213）',
  wishTimeLabels(),
  dayLabels,
)

check(
  '⑦ 表の側はラベルを持たない。何日目かだけを持ち、ラベルは組むときに付く（→ formItemsFor）',
  [
    formItems.filter((item) => item.dayIndex !== undefined).map((item) => item.dayIndex),
    formItems.filter((item) => item.label !== undefined).length,
  ],
  [[0, 1, 2, 3], 0],
)

/** 止まることを見る。止まらなければ null が返る。 */
function whyItStopped(work) {
  try {
    work()
    return null
  } catch (error) {
    return error.message
  }
}

const stoppedOnEmpty = whyItStopped(() => formItemsFor([]))
check(
  '⑦ 「日ごとの営業時刻」が空なら、区画を名指しして止まる（→ 2 の止まる箇所 9）',
  [stoppedOnEmpty?.includes('「日ごとの営業時刻」が空である'), stoppedOnEmpty?.includes('4 日ぶん入れて')],
  [true, true],
)

check(
  '⑦ 4 行でなければ、何行あるかを名指しして止まる（3 行でも 5 行でも）',
  [thisYear.slice(0, 3), thisYear.concat(thisYear[0])].map((days) => {
    const stopped = whyItStopped(() => formItemsFor(days))
    return [stopped?.includes(`${days.length} 行である`), stopped?.includes('準備日 / 学祭1日目 / 学祭2日目 / 片付け')]
  }),
  [[true, true], [true, true]],
)

// ---- 結果 -------------------------------------------------------------------

console.log('フォームの定義の検査（src/form-definition.js／4-1〜4-3 と突き合わせ）')
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
  process.exit(0)
}
console.log(`結果: 不一致 ${failed.length} 件 ／ 一致 ${passed.length} 件`)
process.exit(1)
