/**
 * フォームの定義一式（docs/tech-requirements.md 4-1〜4-3）。記録からの転記なので、揃えない・直さない（→ 4-3）。
 *
 * 定義だけを持ち、FormApp も SpreadsheetApp も掴まない。作る側は build-form.js が持つ。
 * 希望時間 4 設問の題（日付）と説明文の営業時間は、今年の条件入力から組む（→ formItemsFor）。
 */

/** 4-1 の「形式」の列。 */
const formItemKind = {
  text: '短文回答',
  radio: 'ラジオボタン',
  paragraph: '長文回答',
  image: '画像アイテム',
}

/** 4-2. 希望時間 4 設問の正規表現。4 設問とも同じである（完全一致）。時は 0-23、分は 00-59。 */
const wishTimePattern =
  '^(?:[0-9]|[01]\\d|2[0-3]):[0-5]\\d-(?:[0-9]|[01]\\d|2[0-3]):[0-5]\\d'
  + '(?:,(?:[0-9]|[01]\\d|2[0-3]):[0-5]\\d-(?:[0-9]|[01]\\d|2[0-3]):[0-5]\\d)*$'

/**
 * 4-1. 希望時間 4 設問のラベル。学祭は例年この 4 日である（→ docs/interviews/02-作る側.md）。
 * 値は割り当ての 4 枚の名前と同じで、sheet-layout.js の dayLabels が持つ。
 * 関数なのは、他のファイルの値をこのファイルの最上位で使わないためである。
 */
function wishTimeLabels() {
  return dayLabels
}

/** 4-2. 設問の説明文に書かれた例 3 つ。 */
const wishTimeExamples = [
  { label: '例1', value: '10:00-15:00' },
  { label: '例2（複数指定）', value: '10:00-12:00,13:00-15:00' },
  { label: '例3（終日出れない場合）', value: '00:00-00:00' },
]

/**
 * 4-1 の表そのもの。上から順にフォームへ並ぶ。
 *
 *   number       4-1 の # の列（画像アイテムは持たない）
 *   title        4-1 の「項目」。希望時間 4 設問は持たない（今年の入力から組む → formItemsFor）
 *   dayIndex     希望時間 4 設問が上から何日目か。ラベルと題はここから引く
 *   kind         4-1 の「形式」
 *   required     4-1 の「必須」
 *   pattern      4-1・4-2 の正規表現（学籍番号と希望時間だけ）
 *   errorMessage 4-3 のエラーメッセージ（希望時間 4 設問だけ）
 *   entrantItem  入る側から数えたときの項目名（→ 5 の #3。希望時間の 4 設問は 1 項目である）
 */
const formItems = [
  {
    number: 1,
    title: '学籍番号',
    kind: formItemKind.text,
    required: true,
    pattern: '^[A-Za-z0-9]{10}$',
    entrantItem: '学籍番号',
  },
  {
    number: 2,
    title: '氏名',
    kind: formItemKind.text,
    required: true,
    entrantItem: '氏名',
  },
  {
    number: 3,
    title: '学年',
    kind: formItemKind.radio,
    required: true,
    choices: ['1年生', '2年生', '3年生', '4年生'],
    entrantItem: '学年',
  },
  {
    number: 4,
    title: '調理担当ですか？',
    kind: formItemKind.radio,
    required: true,
    choices: ['はい', 'いいえ'],
    entrantItem: '調理可否',
  },
  {
    // 設問ではない。検便名簿を貼って本人に確認させる（→ 4-1）。回答シートの列にも入る側の 6 項目にも現れない。
    // 画像は毎年別物なので中身を持たず、担当者が選んだものを build-form.js が差す。
    title: '調理名簿',
    kind: formItemKind.image,
    required: false,
    entrantItem: null,
  },
  {
    number: 5,
    title: '一緒に組みたいお友達',
    kind: formItemKind.text,
    required: false,
    // 正規表現を持たない自由記述である（→ issue #200）。割り当ての材料にせず（→ 5-2）、
    // 担当者が読むためにマス目の 3 列目へそのまま出る（→ assignment-grid.js の friendsFromAnswers）。
    entrantItem: '友達欄',
  },
  // ここから 4 つが希望時間である。題と営業時間は今年の入力から組む（→ formItemsFor）。
  {
    number: 6,
    dayIndex: 0,
    kind: formItemKind.paragraph,
    required: true,
    pattern: wishTimePattern,
    errorMessage: '無効な書式です',
    entrantItem: '希望時間',
  },
  {
    number: 7,
    dayIndex: 1,
    kind: formItemKind.paragraph,
    required: true,
    pattern: wishTimePattern,
    errorMessage: '無効な書式です',
    entrantItem: '希望時間',
  },
  {
    number: 8,
    dayIndex: 2,
    kind: formItemKind.paragraph,
    required: true,
    pattern: wishTimePattern,
    // 句点はこの 1 設問だけ。記録どおりで、揃えない（→ 4-3）。
    errorMessage: '無効な書式です。',
    entrantItem: '希望時間',
  },
  {
    number: 9,
    dayIndex: 3,
    kind: formItemKind.paragraph,
    required: true,
    pattern: wishTimePattern,
    errorMessage: '無効な書式です',
    entrantItem: '希望時間',
  },
]

/**
 * 希望時間 4 設問の説明文。記録にあるのは例 3 つと営業時間だけなので、その 2 つを並べる入れ物である（→ 4-2）。
 */
function wishTimeDescription(item) {
  return [
    `営業時間は ${item.businessHours} です。出られる時間帯を「10:00-15:00」のように書いてください。`,
    ...wishTimeExamples.map((example) => `${example.label} ${example.value}`),
  ].join('\n')
}

/**
 * 定義に今年の日付と営業時刻を入れて、フォームに置ける形にする（→ 4-1・4-2）。
 * days は input-types.js の toDays が時刻を確かめ済みのもの。変わるのは希望時間 4 設問だけである。
 * 4 行でなければ、フォームを作る前に止まる（→ checkDaysForForm）。
 */
function formItemsFor(days) {
  checkDaysForForm(days)

  const labels = wishTimeLabels()
  return formItems.map((item) => {
    if (item.dayIndex === undefined) return item
    const day = days[item.dayIndex]
    // 表の行は書き換えず、写しにラベルと題と営業時間を足す。
    return Object.assign({}, item, {
      label: labels[item.dayIndex],
      title: wishTimeTitle(day.date, labels[item.dayIndex]),
      businessHours: businessHoursOf(day),
    })
  })
}

/** 条件入力の「日ごとの営業時刻」が、ラベル 4 つと 1 対 1 で当たる形かを見る。 */
function checkDaysForForm(days) {
  const labels = wishTimeLabels()
  const rows = (days || []).length
  if (rows === 0) {
    throw new Error(
      '条件入力の「日ごとの営業時刻」が空です。'
        + `先に ${labels.length} 日分入れてから、もう一度「フォームを作る」を押してください`,
    )
  }
  if (rows !== labels.length) {
    throw new Error(
      `条件入力の「日ごとの営業時刻」が ${rows} 行です。`
        + `${labels.length} 行（上から ${labels.join('・')}）にしてください`,
    )
  }
}

/** 設問の題 `<月>月<日>日(<ラベル>)`（→ 4-1）。date は YYYY-MM-DD。 */
function wishTimeTitle(date, label) {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日(${label})`
}

/**
 * 説明文に出す営業時間。その日の `準備開始`〜`片付け終了` で、調理の帯ではない（→ 4-2）。
 * 時の先頭の 0 を落とすのは、記録の書き方（`8:00-21:00`）に合わせるためである。
 */
function businessHoursOf(day) {
  return `${withoutLeadingZero(day.prepStart)}-${withoutLeadingZero(day.cleanupEnd)}`
}

/** `08:00` を `8:00` にする。分のほうは落とさない（`8:05` は `8:05` である）。 */
function withoutLeadingZero(time) {
  return time.charAt(0) === '0' ? time.slice(1) : time
}

/** 入る側から数えた項目名（→ 5 の #3）。設問は 9 つだが、答える中身は 6 項目である。 */
function entrantItemNames() {
  return formItems
    .map((item) => item.entrantItem)
    .filter((name, index, all) => name !== null && all.indexOf(name) === index)
}

// Node から読むためだけの口。Apps Script では module が無いので通らない。
if (typeof module !== 'undefined') {
  module.exports = {
    formItemKind, wishTimePattern, wishTimeLabels, wishTimeExamples, formItems,
    formItemsFor, checkDaysForForm, wishTimeTitle, businessHoursOf, wishTimeDescription, entrantItemNames,
  }
}
