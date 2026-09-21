#!/usr/bin/env node
// M2 の判定 — 前回の希望データのモックから案を 1 つ組み、違反と、名指しされていない未充足を数える。
//
//   使い方: node scripts/M2の判定.mjs
//   宣言:   scripts/M2の宣言.json（合格の線も入力の置き方もあちらが持つ。このファイルに書かない）
//
// 数えるのは 2 つである（→ docs/tech-requirements.md 7 の M2・5-4）。
//   違反                   … 置いた人が条件を破っている件数。合格の線は 0 件
//   名指しされていない未充足 … 案の側の不足のうち、検証結果に出ていない件数。合格の線は 0 件
// 未充足そのものは 0 でなくてよい。埋まらない枠が残ること自体は、落ちる理由にならない。
//
// あわせて、案を組んだ 1 周の所要時間を秒で残す（→ issue #153 の受け入れ条件）。
// 上限（360 秒）との突き合わせはここが持たない — scripts/生成の所要時間.mjs が中央値で見る（→ 6-1 の #2）。
//
// 規則も数え方も、判定の側で書き直さない。src/ の 9 本をそのまま走らせる
// （書き直した規則で 0 件になっても、M2 の答えにならない）。SpreadsheetApp は置かない。
//
// 未充足の行をそのまま数えない。名指しした側に名指しを採点させることになる（何件出ても 0 件になる）。
// 不足を案から数え直して、検証結果の行と両方向で突き合わせる（→ 宣言の「『名指しされていない未充足』をどう数えるか」）。
//
// 規則 3 の ⑥（複数日で偏らせない）は数えに入らない。入っていないことを出力に出す（→ 5-4 の但し書き）。
//
// 何も書き換えない。読むだけである。合格の線を 1 つでも外したら終了コード 1 で落ちる。

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const ここ = path.dirname(fileURLToPath(import.meta.url))
const 根 = path.dirname(ここ)
const 読む = (相対) => fs.readFileSync(path.join(根, 相対), 'utf8')

const 宣言 = JSON.parse(読む('scripts/M2の宣言.json'))

// ---- 実装を読む ------------------------------------------------------------
// SpreadsheetApp を文脈に置いていない。置かなくても通ることは src/core.test.mjs の側が見ている。

const 文脈 = vm.createContext({})
for (const 相対 of 宣言.入力.実装) {
  vm.runInContext(読む(相対), 文脈, { filename: path.basename(相対) })
}
const {
  build, builtInSteps, coreSteps, takeIn, expand, toDays, formatDateTime, takeConditions,
  readAssignments, allNeeds, requiredAt, rolesInOrder, sheetColumns, checkKind,
  violationRules, violationsNotCounted,
} = vm.runInContext(
  '({ build, builtInSteps, coreSteps, takeIn, expand, toDays, formatDateTime, takeConditions,'
    + ' readAssignments, allNeeds, requiredAt, rolesInOrder, sheetColumns, checkKind,'
    + ' violationRules, violationsNotCounted })',
  文脈,
)

// ---- 入力を組む ------------------------------------------------------------
// 枠も需要も刻み直さない。宣言の行を型に通して、出てきたものをそのまま食わせる。

/** 引用符の中のコンマを割らないだけの CSV の読み。友達欄が引用符付きで入っている。 */
function CSVを読む(文) {
  return 文.replace(/^﻿/, '').trim().split(/\r?\n/).map((行) => {
    const セル = []
    let 溜め = ''
    let 引用符の中 = false
    for (const 文字 of 行) {
      if (文字 === '"') 引用符の中 = !引用符の中
      else if (文字 === ',' && !引用符の中) { セル.push(溜め); 溜め = '' }
      else 溜め += 文字
    }
    セル.push(溜め)
    return セル
  })
}

/** モックを回答シートに貼ると、タイムスタンプのセルは日時になる（→ src/take-in.test.mjs の同じ手）。 */
function 回答シートの行にする(行) {
  const [年, 月, 日] = 行[0].split(' ')[0].split('/').map(Number)
  const [時, 分, 秒] = 行[0].split(' ')[1].split(':').map(Number)
  return [formatDateTime(new Date(年, 月 - 1, 日, 時, 分, 秒))].concat(行.slice(1))
}

/** 条件入力の「日ごとの営業時刻」の 4 行（→ 宣言の「入力」）。 */
function 営業時刻の行() {
  return Object.entries(宣言.入力.条件入力.日ごとの営業時刻)
    .filter(([鍵]) => /^\d{4}-\d{2}-\d{2}$/.test(鍵))
    .map(([日, 時刻]) => [日].concat(時刻))
}

/** 回答の行から、コアに渡す入力の一式を組む。回答以外は宣言のままである。 */
function 入力一式(回答の行) {
  return {
    '日ごとの営業時刻': 営業時刻の行(),
    '役割と必要人数': 宣言.入力.条件入力.役割と必要人数,
    '調理責任者の学年': 宣言.入力.条件入力.調理責任者の学年.map((学年) => [学年]),
    '委員会の指定枠': 宣言.入力.条件入力.委員会の指定枠,
    '準備・片付けのルール': Object.entries(宣言.入力.条件入力['準備・片付けのルール']).map(([項目, 値]) => [項目, 値]),
    '回答': 回答の行,
    '割り当て': [],
  }
}

const 回答の全行 = CSVを読む(読む(宣言.入力.回答)).slice(1).map(回答シートの行にする)
const 日ごと = toDays(営業時刻の行(), '日ごとの営業時刻')
const 希望 = takeIn(回答の全行)

// 終端 ≤ 始端の区間を書いた人は、展開の段が名指しして止まる（→ 宣言の「展開で止まる 3 人を外すこと」）。
// 外さないと 1 周が途中で止まり、案が出ない。誰を外したかは名指しで出す。
const 止まる人 = 希望
  .filter((一人) => {
    try {
      expand([一人], 日ごと)
      return false
    } catch (例外) {
      return true
    }
  })
  .map((一人) => 一人.studentId)

const 組む回答 = 回答の全行.filter((行) => 止まる人.indexOf(String(行[1]).toUpperCase()) === -1)
const 入力 = 入力一式(組む回答)

// ---- 案を 1 つ組む（秒を測りながら） ---------------------------------------
// 出すのは、いま判定した案を組んだ 1 周の秒である。上限の合否はここでは言わない（→ 宣言）。

/** 秒で返す。時刻の粒度で結果が変わらないように、ナノ秒で取ってから割る。 */
function 秒を測る(仕事) {
  const 始め = process.hrtime.bigint()
  const 返り = 仕事()
  const 終わり = process.hrtime.bigint()
  return { 秒: Number(終わり - 始め) / 1e9, 返り: 返り }
}

/** 段ごとの秒を溜めながら 1 周する。中身が入っている段だけを包む（未了の段は包む相手が無い）。 */
function 一周する(入力) {
  const 段の秒 = {}
  const 中身 = builtInSteps()
  const 包んだ段 = {}
  Object.keys(中身).forEach((名) => {
    包んだ段[名] = function () {
      const 測った = 秒を測る(() => 中身[名].apply(null, arguments))
      段の秒[名] = (段の秒[名] || 0) + 測った.秒
      return 測った.返り
    }
  })
  const 測った = 秒を測る(() => build(入力, 包んだ段))
  return { 全体の秒: 測った.秒, 段の秒: 段の秒, 出力: 測った.返り }
}

const 一周 = 一周する(入力)
const 出力 = 一周.出力

// ---- 検証結果を種別で分ける ------------------------------------------------
// 列の並びは src/sheet-layout.js が持つ。列の番号をここに書かない（→ 5-4 の「同じ 1 枚に種別で分けて並べる」）。

const 検証結果の列 = sheetColumns('検証結果')
const 列番号 = (名) => 検証結果の列.indexOf(名)
const 値 = (行, 名) => 行[列番号(名)]

const 検証結果 = 出力['検証結果']
const 違反の行 = 検証結果.filter((行) => 値(行, '種別') === checkKind.violation)
const 未充足の行 = 検証結果.filter((行) => 値(行, '種別') === checkKind.unmet)

/** 違反 1 件がどの規則のものか。内容の頭に付いている名前で分ける（→ src/count-violations.js の violationRow）。 */
function 違反の内訳() {
  const 内訳 = violationRules.map((規則) => ({
    label: 規則.label,
    what: 規則.what,
    件数: 違反の行.filter((行) => String(値(行, '内容')).indexOf(`${規則.label}: `) === 0).length,
  }))
  const 名前の付いた件数 = 内訳.reduce((合計, 一つ) => 合計 + 一つ.件数, 0)
  return { 内訳: 内訳, 名前の付かない件数: 違反の行.length - 名前の付いた件数 }
}

// ---- 不足を案から数え直して、名指しと突き合わせる --------------------------
// 未充足の行をそのまま数えない（名指しした側に名指しを採点させることになる → 宣言）。
// 要る人数は src/name-unmet.js の requiredAt が、置いた行の読み方は src/count-violations.js の
// readAssignments が持つ。数えて突き合わせるところだけが、この手の仕事である。

const 条件 = takeConditions(入力)
const 需要 = allNeeds(条件)
const 役割の並び = rolesInOrder(需要)
const 枠の鍵 = (日, 始, 終, 役割) => `${日} ${始}-${終} ${役割}`

/** 置いた行を (日・枠・役割) ごとに数える。読むのは readAssignments で、数えるのはここである。 */
function 置いた人数() {
  const 数え = {}
  readAssignments(出力['割り当て'], 条件).forEach((一つ) => {
    const 鍵 = 枠の鍵(一つ.date, 一つ.start, 一つ.end, 一つ.role)
    数え[鍵] = (数え[鍵] || 0) + 1
  })
  return 数え
}

/** 案の側の不足 — (日・30 分枠・役割) ごとに、要る人数より置いた人数が少ないもの。 */
function 案の不足() {
  const 置いた = 置いた人数()
  const 不足 = []
  let 需要のべ = 0
  let 需要の枠に置いた = 0
  const 超過 = []

  条件.days.forEach((一日) => {
    一日.slots.forEach((枠) => {
      役割の並び.forEach((役割) => {
        const 要る = requiredAt(需要, 一日.date, 枠, 役割)
        if (要る.count === 0) return
        const 鍵 = 枠の鍵(一日.date, 枠.start, 枠.end, 役割)
        const 置いた人数 = 置いた[鍵] || 0
        需要のべ += 要る.count
        需要の枠に置いた += Math.min(置いた人数, 要る.count)
        if (置いた人数 > 要る.count) {
          超過.push({ 鍵: 鍵, 要る: 要る.count, 置いた: 置いた人数 })
        }
        if (置いた人数 < 要る.count) {
          不足.push({ 鍵: 鍵, 日: 一日.date, 開始: 枠.start, 終了: 枠.end, 役割: 役割, あと何人: 要る.count - 置いた人数 })
        }
      })
    })
  })

  return { 不足: 不足, 需要のべ: 需要のべ, 需要の枠に置いた: 需要の枠に置いた, 超過: 超過 }
}

const 案 = 案の不足()

/** 検証結果の未充足の行を、(日・枠・役割) で引ける形にする。 */
const 名指し = {}
未充足の行.forEach((行) => {
  const 鍵 = 枠の鍵(値(行, '日'), 値(行, '開始'), 値(行, '終了'), 値(行, '役割'))
  名指し[鍵] = 行
})

// 両方向で突き合わせる（→ 宣言の「確かめること」）。
const 名指しされていない不足 = 案.不足.filter((一つ) => !名指し[一つ.鍵])
const 人数が食い違う不足 = 案.不足
  .filter((一つ) => 名指し[一つ.鍵])
  .filter((一つ) => Number(値(名指し[一つ.鍵], 'あと何人')) !== 一つ.あと何人)
const 不足の鍵 = {}
案.不足.forEach((一つ) => { 不足の鍵[一つ.鍵] = true })
const 空の名指し = 未充足の行.filter((行) => !不足の鍵[枠の鍵(値(行, '日'), 値(行, '開始'), 値(行, '終了'), 値(行, '役割'))])

// 合格の線に当てるのは「名指しされていない未充足」である。
// あと何人が食い違う行は、枠は名指しされていても人数が名指しされていないので、こちらに数える。
const 名指しされていない未充足 = 名指しされていない不足.length + 人数が食い違う不足.length

// ---- 突き合わせ（2 つの数えが同じ需要に乗っているか） ----------------------

const あと何人の合計 = 未充足の行.reduce((合計, 行) => 合計 + Number(値(行, 'あと何人') || 0), 0)
const 突き合わせ = [
  {
    何: '需要のべ ＝ 需要の枠に置いた ＋ あと何人の合計',
    左: 案.需要のべ,
    右: 案.需要の枠に置いた + あと何人の合計,
    式: `${案.需要のべ} ＝ ${案.需要の枠に置いた} ＋ ${あと何人の合計}`,
  },
  {
    何: '要る人数より多く置いた枠（超過）',
    左: 0,
    右: 案.超過.length,
    式: `0 ＝ ${案.超過.length} 枠`,
  },
]
const 揃わなかった突き合わせ = 突き合わせ.filter((一つ) => 一つ.左 !== 一つ.右)

// ---- 入力が、本文の規模と同じかを見る --------------------------------------
// 件数より先に見る。違う入力で 0 件でも、M2 の答えにならない（→ 宣言の「入力の期待値」）。

const 期待 = 宣言.入力の期待値
const 実際 = {
  '回答の行': 回答の全行.length,
  '取り込んだ人数': 希望.length,
  '展開で止まる人数': 止まる人.length,
  '組む人数': 希望.length - 止まる人.length,
  '枠': 日ごと.reduce((合計, 一日) => 合計 + 一日.slots.length, 0),
  '日ごとの枠': 日ごと.map((一日) => 一日.slots.length),
  '需要のべ': 案.需要のべ,
}
const 外れた入力 = Object.keys(実際).filter((名) => JSON.stringify(実際[名]) !== JSON.stringify(期待[名]))

// ---- 本文（宣言が写した言葉が載っているかだけを見る） ----------------------

const 本文 = 読む(宣言.本文.ファイル)
const 本文に無い言葉 = 宣言.本文.載っているはずの言葉.filter((言葉) => 本文.indexOf(言葉) === -1)

// ---- 出す ------------------------------------------------------------------

const 秒で = (値) => `${値.toFixed(3)} 秒`

function 主処理() {
  console.log('')
  console.log('M2 の判定 — 前回の希望データのモックから案を 1 つ組み、違反と、名指しされていない未充足を数える')
  console.log('')
  console.log('合格の線（原本は scripts/M2の宣言.json。出どころは docs/tech-requirements.md 7 の M2）')
  console.log(`  違反 ${宣言.合格の線.違反} 件 ／ 名指しされていない未充足 ${宣言.合格の線.名指しされていない未充足} 件`)
  console.log(`  未充足そのもの: ${宣言.合格の線.未充足そのもの}`)
  console.log(`  所要時間: ${宣言.合格の線.所要時間}`)
  console.log('')
  console.log('実装（判定の側で書き直さない。SpreadsheetApp を置かずにそのまま走らせる）')
  console.log(`  ${宣言.入力.実装.join(' / ')}`)
  console.log('')
  console.log('宣言（原本は scripts/M2の宣言.json）')
  宣言.宣言.forEach((一つ) => {
    console.log(`  ・${一つ.何}: ${一つ.決め}`)
    console.log(`      なぜ宣言が要るか: ${一つ.なぜ宣言が要るか}`)
    console.log(`      確かめること: ${一つ.確かめること}`)
  })

  console.log('')
  console.log('入力（件数より先に見る。違う入力で 0 件でも、M2 の答えにならない）')
  Object.keys(実際).forEach((名) => {
    const 印 = JSON.stringify(実際[名]) === JSON.stringify(期待[名]) ? 'OK ' : 'NG '
    console.log(`  ${印}  ${名}: ${JSON.stringify(実際[名])}（期待 ${JSON.stringify(期待[名])}）`)
  })
  console.log(`      展開で止まった人: ${止まる人.join(' / ')}（終端 ≤ 始端。外してから組んだ → 宣言）`)

  console.log('')
  console.log('数えに入らないもの（入っていないことを隠さない → docs/tech-requirements.md 5-4 の但し書き）')
  violationsNotCounted.forEach((一つ) => {
    console.log(`  ・${一つ.rule}（${一つ.what}）… 違反に数えていない`)
    console.log(`      ${一つ.why}`)
  })
  宣言.数えに入らないもの.slice(1).forEach((一つ) => {
    console.log(`  ・${一つ.何} … ${一つ.なぜ}`)
    console.log(`      どこが持つか: ${一つ.どこが持つか}`)
  })
  const 未了の段 = 出力.notBuilt.map((段) => `${段.name}（→ issue #${段.issue}）`)
  console.log(`  ・未了の段: ${未了の段.length === 0 ? '無い（コアの段は全部入っている）' : 未了の段.join(' / ')}`)

  console.log('')
  console.log('組んだ案')
  console.log(`  割り当ての行: ${出力['割り当て'].length}`)
  console.log(`  需要のべ ${案.需要のべ} ＝ 需要の枠に置いた ${案.需要の枠に置いた} ＋ あと何人 ${あと何人の合計}`)

  const 違反 = 違反の内訳()
  console.log('')
  console.log(`違反（置いた人が条件を破っている。合格の線 ${宣言.合格の線.違反} 件）`)
  違反.内訳.forEach((一つ) => {
    console.log(`  ${一つ.件数 === 0 ? 'OK ' : 'NG '}  ${一つ.label}: ${一つ.件数} 件 … ${一つ.what}`)
  })
  if (違反.名前の付かない件数 !== 0) {
    console.log(`  NG   どの規則の名前も付いていない違反: ${違反.名前の付かない件数} 件（violationRules と内容が食い違っている）`)
  }
  console.log(`      通し: ${違反の行.length} 件`)
  違反の行.slice(0, 20).forEach((行) => {
    console.log(`      ・${値(行, '日')} ${値(行, '開始')}-${値(行, '終了')} ${値(行, '役割')} ${値(行, '学籍番号')} … ${値(行, '内容')}`)
  })
  if (違反の行.length > 20) console.log(`      …（残り ${違反の行.length - 20} 件）`)

  console.log('')
  console.log(`未充足（人数が足りない枠。そのものは 0 でなくてよい → ${宣言.合格の線.未充足そのもの}）`)
  console.log(`      名指しされた枠: ${未充足の行.length} 件 ／ あと何人の合計: ${あと何人の合計} 人`)
  console.log(`      案の側の不足:   ${案.不足.length} 件 ／ あと何人の合計: ${案.不足.reduce((合計, 一つ) => 合計 + 一つ.あと何人, 0)} 人`)
  console.log(`         （不足は案から数え直したものである。未充足の行をそのまま数えていない → 宣言）`)

  console.log('')
  console.log(`名指しされていない未充足（合格の線 ${宣言.合格の線.名指しされていない未充足} 件）`)
  console.log(`  ${名指しされていない不足.length === 0 ? 'OK ' : 'NG '}  不足が有るのに名指しが無い: ${名指しされていない不足.length} 件`)
  console.log(`  ${人数が食い違う不足.length === 0 ? 'OK ' : 'NG '}  名指しは有るが あと何人 が食い違う: ${人数が食い違う不足.length} 件`)
  console.log(`  ${空の名指し.length === 0 ? 'OK ' : 'NG '}  不足が無いのに名指しが有る（空の名指し）: ${空の名指し.length} 件`)
  名指しされていない不足.slice(0, 20).forEach((一つ) => {
    console.log(`      ・${一つ.日} ${一つ.開始}-${一つ.終了} ${一つ.役割} … あと ${一つ.あと何人} 人（検証結果に行が無い）`)
  })
  人数が食い違う不足.slice(0, 20).forEach((一つ) => {
    console.log(`      ・${一つ.鍵} … 案では あと ${一つ.あと何人} 人、名指しは あと ${値(名指し[一つ.鍵], 'あと何人')} 人`)
  })
  空の名指し.slice(0, 20).forEach((行) => {
    console.log(`      ・${値(行, '日')} ${値(行, '開始')}-${値(行, '終了')} ${値(行, '役割')} … 足りているのに名指しされている`)
  })

  console.log('')
  console.log('突き合わせ（2 つの数えが同じ需要に乗っているか。件数とは別に見る → 宣言の「突き合わせ」）')
  突き合わせ.forEach((一つ) => {
    console.log(`  ${一つ.左 === 一つ.右 ? 'OK ' : 'NG '}  ${一つ.何}: ${一つ.式}`)
  })
  案.超過.slice(0, 20).forEach((一つ) => {
    console.log(`      ・${一つ.鍵} … 要る ${一つ.要る} 人に対して ${一つ.置いた} 人を置いている`)
  })

  console.log('')
  console.log('所要時間（いま判定した案を組んだ 1 周。1 回目なので温まりが乗る → 宣言）')
  coreSteps.forEach((段) => {
    if (一周.段の秒[段.name] === undefined) return
    console.log(`  ${段.name.padEnd(12, '　')} ${秒で(一周.段の秒[段.name])}`)
  })
  console.log(`  ${'コアを 1 周'.padEnd(12, '　')} ${秒で(一周.全体の秒)}`)
  console.log(`      上限（360 秒）との突き合わせはここが持たない（→ scripts/生成の所要時間.mjs ／ 6-1 の #2）`)

  console.log('')
  console.log('本文（宣言が写した言葉が載っているかだけを見る。本文は解析しない）')
  if (本文に無い言葉.length === 0) {
    console.log(`  OK   ${宣言.本文.載っているはずの言葉.join(' / ')} は ${宣言.本文.ファイル} に載っている`)
  } else {
    console.log(`  NG   ${宣言.本文.ファイル} に載っていない: ${本文に無い言葉.join(' / ')}`)
  }

  const 線を外した = 違反の行.length !== 宣言.合格の線.違反
    || 名指しされていない未充足 !== 宣言.合格の線.名指しされていない未充足
    || 空の名指し.length !== 0
  const 判定できない = 外れた入力.length !== 0 || 揃わなかった突き合わせ.length !== 0 || 本文に無い言葉.length !== 0

  if (判定できない) {
    console.log('')
    console.log('判定できない（件数の合否より先に、入力と突き合わせを見る → 宣言）')
    if (外れた入力.length > 0) console.log(`  ・入力が期待と違う: ${外れた入力.join(' / ')} — ${期待.ここが外れたら}`)
    if (揃わなかった突き合わせ.length > 0) console.log(`  ・突き合わせが揃わない: ${揃わなかった突き合わせ.map((一つ) => 一つ.何).join(' / ')} — ${宣言.突き合わせ.揃わなかったら}`)
    if (本文に無い言葉.length > 0) console.log(`  ・本文に載っていない言葉がある: ${本文に無い言葉.join(' / ')}`)
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
    `結果: 違反 ${違反の行.length} 件（線 ${宣言.合格の線.違反}）`
      + ` ／ 名指しされていない未充足 ${名指しされていない未充足} 件（線 ${宣言.合格の線.名指しされていない未充足}）`
      + ` ／ 未充足 ${未充足の行.length} 件・あと ${あと何人の合計} 人（線を当てない）`
      + ` ／ 所要時間 ${秒で(一周.全体の秒)}`,
  )
  console.log(`      規則 3 の ⑥（複数日で偏らせない）は数えに入っていない（→ docs/tech-requirements.md 5-4 の但し書き）`)
  console.log('')

  return 線を外した || 判定できない ? 1 : 0
}

process.exit(主処理())
