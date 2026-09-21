/**
 * フォームの定義一式（docs/tech-requirements.md 4-1〜4-3）。
 *
 * 4 は「記録からの転記」である。写す。揃えない・直さない。
 * ここに判断を新しく書かない。変えたくなったら docs/design-doc.md に戻して判断を起こす
 * （→ 4-3 の「揃えるのは『変える判断』であって転記ではない」）。
 *
 * ここは値を持つ定義だけである。FormApp も SpreadsheetApp も 1 度も掴まない（→ 6 の #8）。
 * 作る側は build-form.js が持つ。
 *
 * 締切はここに含まれない（→ 4-1）。毎回決める入力で、フォーム側は締切で閉じない ◎。
 * 説明文に書かれた営業時間は前回の値であって既定ではない（→ 4-2）。
 *   日ごとの 4 時刻は毎年変わる ◎ ので、生成が使う営業時刻は条件入力シートから来る（→ 5-1 の #1）。
 *   ここの値をそちらの既定に流用しない。
 */

/** 4-1 の「形式」の列。値がそのまま表の言葉である。 */
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

/** 4-2. 設問の説明文に書かれた例 ◎。3 つとも記録にある。 */
const wishTimeExamples = [
  { label: '例1', value: '10:00-15:00' },
  { label: '例2（複数指定）', value: '10:00-12:00,13:00-15:00' },
  { label: '例3（終日出れない場合）', value: '00:00-00:00' },
]

/**
 * 4-1 の表そのもの。上から順にフォームへ並ぶ。
 *
 *   number       4-1 の # の列（画像アイテムは設問ではないので持たない）
 *   kind         4-1 の「形式」
 *   required     4-1 の「必須」
 *   pattern      4-1・4-2 の正規表現（3 箇所。無い設問は持たない）
 *   errorMessage 4-3 のエラーメッセージ（記録にあるのは希望時間 4 設問だけである）
 *   businessHours 4-2 の「説明文に書かれた営業時間」◎（前回の値。既定ではない）
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
    // 設問ではない。検便名簿をフォーム内に貼って本人に確認させている（→ 4-1）。
    // 回答として回収されないので、回答シートの列にも入る側の 6 項目にも現れない。
    // 画像そのものは毎年別物である ◎（委員会から降りてくる）ので、ここは中身を持たない。
    // 担当者が選んだ画像を差すのは build-form.js である（→ 2 の一覧 3）。
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
    // 学籍番号の形式に依存している（→ 4-1 の「識別キーは学籍番号である」◎）。
    pattern: '^(?:[A-Za-z0-9]{10})(?:,[A-Za-z0-9]{10})*$',
    entrantItem: '友達欄',
  },
  {
    number: 6,
    title: '11月1日(準備日)',
    kind: formItemKind.paragraph,
    required: true,
    pattern: wishTimePattern,
    errorMessage: '無効な書式です',
    businessHours: '8:00-21:00',
    entrantItem: '希望時間',
  },
  {
    number: 7,
    title: '11月2日(学祭1日目)',
    kind: formItemKind.paragraph,
    required: true,
    pattern: wishTimePattern,
    errorMessage: '無効な書式です',
    businessHours: '8:00-20:00',
    entrantItem: '希望時間',
  },
  {
    number: 8,
    title: '11月3日(学祭2日目)',
    kind: formItemKind.paragraph,
    required: true,
    pattern: wishTimePattern,
    // 句点が付いているのはこの 1 設問だけである ◎（→ 4-3）。揃えない。
    errorMessage: '無効な書式です。',
    businessHours: '8:00-20:00',
    entrantItem: '希望時間',
  },
  {
    number: 9,
    title: '11月4日(片付け)',
    kind: formItemKind.paragraph,
    required: true,
    pattern: wishTimePattern,
    errorMessage: '無効な書式です',
    businessHours: '8:00-15:00',
    entrantItem: '希望時間',
  },
]

/**
 * 希望時間 4 設問の説明文。
 *
 * 記録にあるのは「例 3 つ」と「営業時間」であって、文そのものではない（→ 4-2 の表）。
 * だからここが置くのは、その 2 つを並べる入れ物だけである。
 * 突き合わせ（仕様 #2 の差分 0）も、例と営業時間の側で行う（→ form-definition.test.mjs）。
 */
function wishTimeDescription(item) {
  return [
    `営業時間は ${item.businessHours} である。出られる時間帯を HH:MM-HH:MM で書く。`,
    ...wishTimeExamples.map((example) => `${example.label} ${example.value}`),
  ].join('\n')
}

/** 入る側から数えた項目名（→ 5 の #3）。設問は 9 つに割れているが、答える中身は 6 項目である。 */
function entrantItemNames() {
  return formItems
    .map((item) => item.entrantItem)
    .filter((name, index, all) => name !== null && all.indexOf(name) === index)
}

// Node から読むためだけの口。Apps Script では module が無いので通らない。
if (typeof module !== 'undefined') {
  module.exports = {
    formItemKind, wishTimePattern, wishTimeExamples, formItems, wishTimeDescription, entrantItemNames,
  }
}
