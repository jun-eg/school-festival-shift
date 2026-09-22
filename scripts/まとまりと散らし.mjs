#!/usr/bin/env node
// まとまりと散らし — M2 と同じ入力で案を 1 つ組み、塊の長さと、1 日の中の散らしを数える。
//
//   使い方: node scripts/まとまりと散らし.mjs
//   宣言:   scripts/まとまりと散らしの宣言.json（線も数え方の決めもあちらが持つ。このファイルに書かない）
//   入力:   scripts/判定の入力.mjs（M2 と同じ置き方である。原本は scripts/M2の宣言.json）
//
// 数えるのは 2 つである（→ issue #215）。
//   塊   … 同じ人・同じ日で、隣り合う枠に同じ役割が続いた区間。1 件 = 1 つの持ち場
//   散らし … その日に候補枠を持つ人のうち、何人が置かれ、1 人あたり何時間になったか
//
// 違反も未充足も、ここでは判定しない。合格の線を持つのは scripts/M2の判定.mjs である
// （同じ数を 2 か所で判定しない → M2の宣言.json の同じ置き方）。
//
// 例外の名前を、この手が持たない。src/generate.js の runExceptions をそのまま読む
// — 名前を 2 か所に持つと、片方が古くなる（→ src/README.md）。
//
// 何も書き換えない。読むだけである。合格の線を外したら終了コード 1 で落ちる。

import { 読む, 実装の文脈, 取り出す, 判定の入力 } from './判定の入力.mjs'

const 宣言 = JSON.parse(読む('scripts/まとまりと散らしの宣言.json'))

// ---- 実装を読む ------------------------------------------------------------

const 文脈 = 実装の文脈()
const {
  build, takeConditions, takeIn, expand, sheetColumns,
  allNeeds, requiredAt, rolesInOrder, roleSlotKey,
  peopleToPlace, canStandAt, prepCleanupStaysPossible, prepCleanupNotBothBands, prepCleanupRoles,
  noonBoundaryToPlaceBy, minRunSlotsToPlaceBy, runExceptions, slotMinutes,
} = 取り出す(文脈, [
  'build', 'takeConditions', 'takeIn', 'expand', 'sheetColumns',
  'allNeeds', 'requiredAt', 'rolesInOrder', 'roleSlotKey',
  'peopleToPlace', 'canStandAt', 'prepCleanupStaysPossible', 'prepCleanupNotBothBands', 'prepCleanupRoles',
  'noonBoundaryToPlaceBy', 'minRunSlotsToPlaceBy', 'runExceptions', 'slotMinutes',
])

// ---- 案を 1 つ組む ---------------------------------------------------------

const 組んだ = 判定の入力(文脈)
const 入力 = 組んだ.入力
const 出力 = build(入力, {})

const 条件 = takeConditions(入力)
const 需要 = allNeeds(条件)
const 役割の並び = rolesInOrder(需要)
const 境目 = noonBoundaryToPlaceBy(条件)
const まとまりの枠 = minRunSlotsToPlaceBy(条件)

const 希望 = takeIn(入力['回答'])
const 候補 = expand(希望, 条件.days)

const 割り当ての列 = sheetColumns('割り当て')
const 値 = (行, 名) => 行[割り当ての列.indexOf(名)]

/** 置いた行を (日 → 学籍番号 → 枠) で引ける形にする。読むのは割り当ての行だけである。 */
const 置いた役割 = {}
const 枠の人数 = {}
出力['割り当て'].forEach((行) => {
  const 日 = 値(行, '日')
  const 学籍番号 = 値(行, '学籍番号')
  const 役割 = 値(行, '役割')
  置いた役割[`${日} ${値(行, '開始')}-${値(行, '終了')} ${学籍番号}`] = 役割
  const 鍵 = roleSlotKey(日, 値(行, '開始'), 値(行, '終了'), 役割)
  枠の人数[鍵] = (枠の人数[鍵] || 0) + 1
})

/** 置く前の人（候補と希望から組む → src/generate.js）。「その日に置ける人」を見るのに使う。 */
const 置く前の人 = peopleToPlace(候補, 希望)
const 人を引く = {}
置く前の人.forEach((一人) => { 人を引く[一人.studentId] = 一人 })

// ---- 塊を数える ------------------------------------------------------------

/** 隣り合う枠か（時刻が続いているか）。枠は帯ごとに刻んであるので、配列で隣でも飛ぶことがある。 */
function 隣り合う(前, 後) {
  return Boolean(前) && Boolean(後) && 前.end === 後.start
}

/** その人のその日の塊を並べる。1 件 = 同じ役割が隣り合う枠に続いた区間である。 */
function 塊を切る(一日, 学籍番号) {
  const 塊 = []
  let いま = null
  一日.slots.forEach((枠, i) => {
    const 役割 = 置いた役割[`${一日.date} ${枠.start}-${枠.end} ${学籍番号}`]
    const 続き = いま && 役割 === いま.役割 && 隣り合う(一日.slots[i - 1], 枠)
    if (続き) { いま.終わり = i; return }
    いま = 役割 ? { 学籍番号: 学籍番号, 役割: 役割, 始め: i, 終わり: i } : null
    if (いま) 塊.push(いま)
  })
  return 塊
}

/** 塊の長さ（枠の数）。 */
const 長さ = (一つ) => 一つ.終わり - 一つ.始め + 1

/**
 * 塊の端を 1 つ見て、そこで止まった名前を返す（→ src/generate.js の runExceptions）。
 * どれにも当たらなければ null である — 伸ばせたのに伸びていない端であり、
 * 「例外に名前の付いた所以外の 1 時間未満の塊」はこれを数えたものである（→ 宣言）。
 */
function 端の名前(一日, 一つ, 向き) {
  const 人 = 人を引く[一つ.学籍番号]
  const at = 向き === 1 ? 一つ.終わり : 一つ.始め
  const 隣 = 一日.slots[at + 向き]
  const 続いている = 向き === 1 ? 隣り合う(一日.slots[at], 隣) : 隣り合う(隣, 一日.slots[at])
  if (!続いている) return '帯の切れ目'

  if (!canStandAt(人, 一日, 隣, 一つ.役割, 条件)) return '希望の切れ目'

  const 要る = requiredAt(需要, 一日, 隣, 一つ.役割).count
  if (要る === 0) return '需要の切れ目'

  if (!prepCleanupStaysPossible(人, 一日, 隣, 境目) || !prepCleanupNotBothBands(人, 一日, 一つ.役割)) {
    return '規則 3 の端'
  }

  const 置いてある = 枠の人数[roleSlotKey(一日.date, 隣.start, 隣.end, 一つ.役割)] || 0
  if (置いてある >= 要る) return 'そこしか置けないとき'

  return null
}

/** 中央値。件数が偶数なら真ん中 2 つの平均である。 */
function 中央(数の列) {
  const 並び = 数の列.slice().sort((a, b) => a - b)
  if (並び.length === 0) return 0
  const 半 = 並び.length / 2
  return 並び.length % 2 === 1 ? 並び[Math.floor(半)] : (並び[半 - 1] + 並び[半]) / 2
}

/** 枠の数を時間にする（枠の刻みは src/input-types.js が持つ）。 */
const 時間で = (枠の数) => 枠の数 * slotMinutes / 60

// ---- 散らしを数える --------------------------------------------------------

/**
 * その日に「置ける人」か（→ docs/tech-requirements.md 5-5 の「置かないほうに倒す所」）。
 *
 * 候補枠を持っているだけでは置けない。規則 3 の ②〜④ があるので、
 * **その日の準備帯・片付け帯に候補が 1 枠も無い人は、店の役割に置けない**
 * （置けば規則 1 か規則 3 のどちらかが破れる）。置く前の人で見る — 置いた後は狭まるだけである。
 *
 * 見る条件は段ごとに違う。ここで書き直さず、生成が置くときに見ているものをそのまま並べる。
 *   店の役割（1 段目） … 規則 1・4・5 ＋ 規則 3 を満たせるか
 *   準備・片付け（4 段目） … 規則 1・4・5 だけ（規則 3 は 3 段目で満たしてある → 5-5 の 4 段目）
 * 混ぜると、準備日・片付け日に「置けないはずの人が置かれている」が出る（役割が 準備・片付け しか無い日である）。
 */
function その日に置けるか(一人, 一日) {
  return 一日.slots.some((枠) => 役割の並び.some((役割) => {
    if (requiredAt(需要, 一日, 枠, 役割).count === 0) return false
    if (!canStandAt(一人, 一日, 枠, 役割, 条件)) return false
    if (!prepCleanupNotBothBands(一人, 一日, 役割)) return false
    if (prepCleanupRoles().indexOf(役割) !== -1) return true
    return prepCleanupStaysPossible(一人, 一日, 枠, 境目)
  }))
}

/** 日 1 つぶんを数える。 */
function 日ごとに数える(一日) {
  const 候補枠を持つ人 = 置く前の人.filter((一人) => (
    一日.slots.some((枠) => 一人.slots[`${一日.date} ${枠.start}-${枠.end}`])
  ))
  const 置ける人 = 候補枠を持つ人.filter((一人) => その日に置けるか(一人, 一日))

  const 塊 = []
  const 置かれた枠 = {}
  候補枠を持つ人.forEach((一人) => {
    塊を切る(一日, 一人.studentId).forEach((一つ) => {
      塊.push(一つ)
      置かれた枠[一人.studentId] = (置かれた枠[一人.studentId] || 0) + 長さ(一つ)
    })
  })

  const 短い塊 = 塊.filter((一つ) => 長さ(一つ) < まとまりの枠).map((一つ) => {
    const 端 = [端の名前(一日, 一つ, 1), 端の名前(一日, 一つ, -1)]
    return { 塊: 一つ, 端: 端, 名前が付かない: 端.some((名前) => 名前 === null) }
  })

  const 置かれた人 = Object.keys(置かれた枠)
  const ひとりぶんの枠 = 置かれた人.map((学籍番号) => 置かれた枠[学籍番号])

  return {
    日: 一日.date,
    塊: 塊.length,
    塊の長さ: 塊.reduce((合計, 一つ) => 合計 + 長さ(一つ), 0),
    短い塊: 短い塊,
    塊の中央: 中央(塊.map(長さ)),
    塊の最長: 塊.length === 0 ? 0 : Math.max.apply(null, 塊.map(長さ)),
    候補枠を持つ人: 候補枠を持つ人.length,
    置ける人: 置ける人.length,
    置かれた人: 置かれた人.length,
    規則3で置けない人: 候補枠を持つ人.length - 置ける人.length,
    置けるのに置かれない人: 置ける人.length - 置かれた人.length,
    ひとりぶんの中央: 中央(ひとりぶんの枠),
    ひとりぶんの最大: ひとりぶんの枠.length === 0 ? 0 : Math.max.apply(null, ひとりぶんの枠),
  }
}

const 日ごと = 条件.days.map(日ごとに数える)

// ---- 合計と、線に当てるもの ------------------------------------------------

const 短い塊の全部 = 日ごと.reduce((集め, 一日) => 集め.concat(一日.短い塊), [])
const 名前が付かない短い塊 = 短い塊の全部.filter((一つ) => 一つ.名前が付かない)

/** 例外の名前ごとの件数。塊 1 件は、端 2 つのうち先に当たった名前で数える（並びは runExceptions の順）。 */
const 例外の内訳 = runExceptions.map((例外) => ({
  what: 例外.what,
  why: 例外.why,
  件数: 短い塊の全部.filter((一つ) => (
    !一つ.名前が付かない
      && 例外の順位(一つ.端) === 例外.what
  )).length,
}))

function 例外の順位(端) {
  const 並び = runExceptions.map((例外) => 例外.what)
  const 付いた = 端.filter((名前) => 名前 !== null)
  付いた.sort((a, b) => 並び.indexOf(a) - 並び.indexOf(b))
  return 付いた[0]
}

const 実際 = {
  '割り当ての行': 出力['割り当て'].length,
  '塊': 日ごと.map((一日) => 一日.塊),
  '最小の長さに届かない塊': 日ごと.map((一日) => 一日.短い塊.length),
  '塊の中央（時間）': 日ごと.map((一日) => 時間で(一日.塊の中央)),
  '候補枠を持つ人': 日ごと.map((一日) => 一日.候補枠を持つ人),
  '置ける人': 日ごと.map((一日) => 一日.置ける人),
  '置かれた人': 日ごと.map((一日) => 一日.置かれた人),
  '置けるのに置かれない人': 日ごと.map((一日) => 一日.置けるのに置かれない人),
  '1 人あたりの中央（時間）': 日ごと.map((一日) => 時間で(一日.ひとりぶんの中央)),
  '1 人あたりの最大（時間）': 日ごと.map((一日) => 時間で(一日.ひとりぶんの最大)),
}
const 期待 = 宣言.期待値
const 外れた = Object.keys(実際).filter((名) => JSON.stringify(実際[名]) !== JSON.stringify(期待[名]))

// 塊の切り方が割り当ての行と同じものを数えているかを、件数とは別に見る（→ 宣言の「塊の切り方」）。
// どの行もちょうど 1 つの塊に入るので、長さの合計は割り当ての行数と揃う。
// 揃わなければ、数えた先が案と違う — 件数の合否を言う前に落ちる。
const 塊の長さの合計 = 日ごと.reduce(
  (合計, 一日) => 合計 + 一日.塊の長さ, 0,
)
const 突き合わせ = [
  {
    何: '塊の長さの合計 ＝ 割り当ての行数（どの行もちょうど 1 つの塊に入る）',
    左: 塊の長さの合計,
    右: 出力['割り当て'].length,
  },
]
const 揃わなかった突き合わせ = 突き合わせ.filter((一つ) => 一つ.左 !== 一つ.右)

// ---- 出す ------------------------------------------------------------------

function 主処理() {
  console.log('')
  console.log('まとまりと散らし — M2 と同じ入力で案を 1 つ組み、塊の長さと 1 日の中の散らしを数える')
  console.log('')
  console.log('合格の線（原本は scripts/まとまりと散らしの宣言.json。出どころは issue #215 の受け入れ条件）')
  console.log(`  例外に名前の付かない「最小の長さに届かない塊」 ${宣言.合格の線.名前が付かない短い塊} 件`)
  console.log(`  ${宣言.合格の線.違反と未充足}`)
  console.log('')
  console.log('入力（置き方の原本は scripts/M2の宣言.json。この手は持たない）')
  console.log(`  連続して入る最小の長さ: ${まとまりの枠} 枠（${時間で(まとまりの枠)} 時間）… 条件入力の「置き方のルール」から来る（→ 5-1 の #7）`)
  console.log(`  展開で止まった人: ${組んだ.止まる人.join(' / ')}（M2 と同じ扱いである）`)

  console.log('')
  console.log('宣言（原本は scripts/まとまりと散らしの宣言.json）')
  宣言.宣言.forEach((一つ) => {
    console.log(`  ・${一つ.何}: ${一つ.決め}`)
    console.log(`      なぜ宣言が要るか: ${一つ.なぜ宣言が要るか}`)
    console.log(`      確かめること: ${一つ.確かめること}`)
  })

  console.log('')
  console.log('塊（同じ人・同じ日で、隣り合う枠に同じ役割が続いた区間。1 件 = 1 つの持ち場）')
  日ごと.forEach((一日) => {
    console.log(
      `  ${一日.日}  塊 ${String(一日.塊).padStart(3)} 件`
        + ` ／ ${時間で(まとまりの枠)} 時間に届かない ${String(一日.短い塊.length).padStart(3)} 件`
        + ` ／ 中央 ${時間で(一日.塊の中央)}h ／ 最長 ${時間で(一日.塊の最長)}h`,
    )
  })

  console.log('')
  console.log('最小の長さに届かない塊の内訳（例外の名前は src/generate.js の runExceptions が持つ）')
  例外の内訳.forEach((一つ) => {
    console.log(`  ・${一つ.what}: ${一つ.件数} 件`)
    console.log(`      ${一つ.why}`)
  })
  console.log(
    `  ${名前が付かない短い塊.length === 宣言.合格の線.名前が付かない短い塊 ? 'OK ' : 'NG '}`
      + ` 例外に名前が付かない: ${名前が付かない短い塊.length} 件`
      + `（線 ${宣言.合格の線.名前が付かない短い塊}）`,
  )
  名前が付かない短い塊.slice(0, 20).forEach((一つ) => {
    const 一日 = 条件.days.filter((日) => 日.date === 日付を引く(一つ))[0]
    const 枠 = 一日.slots[一つ.塊.始め]
    console.log(
      `      ・${一日.date} ${枠.start} ${一つ.塊.役割} ${一つ.塊.学籍番号}`
        + ` … 端の名前 ${一つ.端.map((名前) => 名前 || '（無い）').join(' ／ ')}`,
    )
  })

  console.log('')
  console.log('散らし（その日に候補枠を持つ人のうち、何人が置かれたか）')
  日ごと.forEach((一日) => {
    console.log(
      `  ${一日.日}  候補枠を持つ人 ${String(一日.候補枠を持つ人).padStart(2)}`
        + ` ／ 置ける人 ${String(一日.置ける人).padStart(2)}`
        + ` ／ 置かれた人 ${String(一日.置かれた人).padStart(2)}`
        + ` ／ 1 人あたり 中央 ${時間で(一日.ひとりぶんの中央)}h・最大 ${時間で(一日.ひとりぶんの最大)}h`,
    )
    console.log(
      `                  規則 3 で置けない人 ${一日.規則3で置けない人} 人`
        + `（その日の準備帯・片付け帯に候補が 1 枠も無い → 5-5）`
        + ` ／ 置けるのに置かれない人 ${一日.置けるのに置かれない人} 人`,
    )
  })

  console.log('')
  console.log('期待値（線ではない。data/ と入力が動いたことに気づくためのものである → 宣言）')
  Object.keys(実際).forEach((名) => {
    const 印 = JSON.stringify(実際[名]) === JSON.stringify(期待[名]) ? 'OK ' : 'NG '
    console.log(`  ${印}  ${名}: ${JSON.stringify(実際[名])}（期待 ${JSON.stringify(期待[名])}）`)
  })

  console.log('')
  console.log('突き合わせ（数えた先が案と同じかを、件数とは別に見る → 宣言の「塊の切り方」）')
  突き合わせ.forEach((一つ) => {
    console.log(`  ${一つ.左 === 一つ.右 ? 'OK ' : 'NG '}  ${一つ.何}: ${一つ.左} ＝ ${一つ.右}`)
  })

  console.log('')
  console.log('ここで判定しないもの')
  宣言.数えに入らないもの.forEach((一つ) => {
    console.log(`  ・${一つ.何} … ${一つ.なぜ}`)
    console.log(`      どこが持つか: ${一つ.どこが持つか}`)
  })

  const 線を外した = 名前が付かない短い塊.length !== 宣言.合格の線.名前が付かない短い塊
  const 判定できない = 外れた.length !== 0 || 揃わなかった突き合わせ.length !== 0

  if (判定できない) {
    console.log('')
    console.log('判定できない（件数の合否より先に、入力と案の大きさを見る → 宣言）')
    if (外れた.length > 0) console.log(`  ・期待と違う: ${外れた.join(' / ')} — ${期待.ここが外れたら}`)
    if (揃わなかった突き合わせ.length > 0) {
      console.log(`  ・突き合わせが揃わない: ${揃わなかった突き合わせ.map((一つ) => 一つ.何).join(' / ')}`)
    }
  }

  if (線を外した) {
    console.log('')
    console.log(`次に何を動かすか — ${宣言.合格の線を外したら.この手が決めないこと}`)
    宣言.合格の線を外したら.分かれ道.forEach((枝) => {
      console.log(`  ・${枝.疑う先}: ${枝.どういうときか}`)
      console.log(`      動かす先: ${枝.動かす先}`)
    })
  }

  console.log('')
  console.log(
    `結果: 最小の長さに届かない塊 ${短い塊の全部.length} 件`
      + `（うち例外に名前が付かない ${名前が付かない短い塊.length} 件・線 ${宣言.合格の線.名前が付かない短い塊}）`
      + ` ／ 塊 ${日ごと.reduce((合計, 一日) => 合計 + 一日.塊, 0)} 件`
      + ` ／ 割り当て ${出力['割り当て'].length} 行`,
  )
  console.log('      違反と未充足の合否はここで言わない（→ node scripts/M2の判定.mjs）')
  console.log('')

  return 線を外した || 判定できない ? 1 : 0
}

/** 名前の付かない塊が、どの日のものか。塊は日ごとに切ってあるので、日ごとの束から引く。 */
function 日付を引く(一つ) {
  return 日ごと.filter((一日) => 一日.短い塊.indexOf(一つ) !== -1)[0].日
}

process.exit(主処理())
