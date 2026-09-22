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
 *
 * 希望時間 4 設問の題と説明文の営業時間だけは、ここが値を持たない（→ 4-1・4-2）。
 *   題の日付も営業時間も今年の入力から出る（→ 条件入力の「日ごとの営業時刻」1 か所・5-1 の #1）。
 *   ここが持つのはラベル 4 つ（転記 ◎）と、日付・帯から題と説明文を組む口である（→ formItemsFor）。
 *   4-1・4-2 の表にある `11月1日(準備日)` や `8:00-21:00` は前回の値であって、既定ではない。
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

/**
 * 4-1. 希望時間 4 設問のラベル。定義側が固定で持つ ◎。
 *
 * 学祭は例年この 4 日である ◎（2026-09-21 → docs/interviews/02-作る側.md）。
 * 毎年変わるのは日付のほうだけで、日数と並びは変わらない ◎ ので、ここは転記のままでよい。
 * 上から順に、条件入力の「日ごとの営業時刻」の 4 行と 1 対 1 で当てる（→ formItemsFor）。
 *
 * 値そのものは sheet-layout.js が持つ（→ dayLabels）。割り当ての 4 枚の名前も同じ 4 つで、
 * 同じ値を 2 か所に書かせると、食い違ったときにどちらが正かが決まらない（→ issue #213）。
 * 関数にしてあるのは、他のファイルの値をこのファイルの最上位で使わないためである。
 */
function wishTimeLabels() {
  return dayLabels
}

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
 *   title        4-1 の「項目」。希望時間 4 設問だけは持たない — 今年の入力から組む（→ formItemsFor）
 *   dayIndex     希望時間 4 設問が、上から何日目か。ラベル ◎（→ wishTimeLabels）と題は
 *                ここから引く（→ formItemsFor）。この表はラベルを持たない — 値は 1 か所である
 *   kind         4-1 の「形式」
 *   required     4-1 の「必須」
 *   pattern      4-1・4-2 の正規表現（2 箇所 — 学籍番号と希望時間。無い設問は持たない。友達欄は持たない → issue #200）
 *   errorMessage 4-3 のエラーメッセージ（記録にあるのは希望時間 4 設問だけである）
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
    // 正規表現を持たない。自由記述である（「太郎君」「同期」「先輩」も書ける → issue #200）。
    // 割り当ての材料にしない（→ 5-2）ので、機械が読める形を求める理由が無い。読むのは担当者で、
    // マス目の 3 列目に書かれたとおりに出る（→ assignment-grid.js の friendsFromAnswers）。
    // 記録の正規表現（10 桁英数字のカンマ区切り ◎）は、期待を書いた 2 人の答えを弾く形だった（→ ADR 入る側-0012）。
    entrantItem: '友達欄',
  },
  // ここから 4 つが希望時間である。題（日付）も説明文の営業時間も、この表は持たない
  // — 今年の入力から組む（→ formItemsFor）。持つのはラベル ◎ のほうである。
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
    // 句点が付いているのはこの 1 設問だけである ◎（→ 4-3）。揃えない。
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

/**
 * 定義に今年の日付と営業時刻を入れて、フォームに置ける形にする（→ 4-1・4-2）。
 *
 * days は型 #1（枠）である（→ input-types.js の toDays）。時刻が HH:MM であることも、
 * 5 つが早い順であることも、そちらが見てから来る — ここは並べ直さない。
 * 希望時間 4 設問だけが変わり、残り 5 設問と画像アイテムは表のまま通る。
 *
 * 4 行でなければ、どのラベルがどの日に当たるかが決まらないので、ここで名指しして止まる
 * （→ 2 の止まる箇所 9）。止まるのはフォームを 1 つも作る前である（→ build-form.js）。
 */
function formItemsFor(days) {
  checkDaysForForm(days)

  const labels = wishTimeLabels()
  return formItems.map((item) => {
    if (item.dayIndex === undefined) return item
    const day = days[item.dayIndex]
    // 表の行はそのまま持ち上げて、ラベルと題と営業時間だけを足す。表の側を書き換えない。
    return Object.assign({}, item, {
      label: labels[item.dayIndex],
      title: wishTimeTitle(day.date, labels[item.dayIndex]),
      businessHours: businessHoursOf(day),
    })
  })
}

/**
 * 条件入力の「日ごとの営業時刻」が、ラベル 4 つと 1 対 1 で当たる形かを見る。
 * 空のまま押されたときと、行数が違うときで言うことが違う — 担当者がやることが違うからである。
 */
function checkDaysForForm(days) {
  const labels = wishTimeLabels()
  const rows = (days || []).length
  if (rows === 0) {
    throw new Error(
      '条件入力の「日ごとの営業時刻」が空である。'
        + '設問の題の日付も、説明文の営業時間も、ここから出る（→ 4-1・4-2）ので、'
        + `先に ${labels.length} 日ぶん入れてから、もう一度「フォームを作る」を押す（→ 2 の一覧 5）`,
    )
  }
  if (rows !== labels.length) {
    throw new Error(
      `条件入力の「日ごとの営業時刻」が ${rows} 行である。`
        + `ラベル ${labels.length} つ（${labels.join(' / ')}）と上から順に当てる（→ 4-1）ので、`
        + `${labels.length} 行でなければ、どのラベルがどの日かが決まらない。フォームを 1 つも作らずに止まる`,
    )
  }
}

/**
 * 設問の題 — `<月>月<日>日(<ラベル>)`（→ 4-1）。
 * 日付は条件入力の「日ごとの営業時刻」の `日付` 列（YYYY-MM-DD）から来る。
 * 前回の日付（2025-11-01）を入れれば `11月1日(準備日)` が出る（→ 仕様 #2 の判定）。
 */
function wishTimeTitle(date, label) {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日(${label})`
}

/**
 * 説明文に出す営業時間 — その日の `準備開始`〜`片付け終了` である（→ 4-2）。
 * 1 日の端から端までであって、調理の帯ではない。
 * 時の先頭の 0 を落とすのは、記録の書き方が `8:00-21:00` だからである ◎（→ 4-2 の表）。
 */
function businessHoursOf(day) {
  return `${withoutLeadingZero(day.prepStart)}-${withoutLeadingZero(day.cleanupEnd)}`
}

/** `08:00` を `8:00` にする。分のほうは落とさない（`8:05` は `8:05` である）。 */
function withoutLeadingZero(time) {
  return time.charAt(0) === '0' ? time.slice(1) : time
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
    formItemKind, wishTimePattern, wishTimeLabels, wishTimeExamples, formItems,
    formItemsFor, checkDaysForForm, wishTimeTitle, businessHoursOf, wishTimeDescription, entrantItemNames,
  }
}
