#!/usr/bin/env node
// 生成の所要時間の実測 — コアを 1 周させて、スクリプトの実行時間の上限の中で終わるかを見る。
//
//   使い方: node scripts/生成の所要時間.mjs
//   宣言:   scripts/生成の所要時間の宣言.json（上限の秒も入力の置き方もあちらが持つ。このファイルに書かない）
//
// 測るのは「src/core.js の build を 1 周する時間（秒）」である。合格の線は 360 秒
// （Apps Script の 1 実行あたりの上限 6 分。→ docs/tech-requirements.md 6-1 の #2）。
//
// 実装は書き直さない。src/ の 9 本をそのまま走らせて、前回の希望データのモックを食わせる
// （書き直したコードが速くても、実機で走るコードの答えにならない）。SpreadsheetApp は置かない。
//
// 見るのは時間だけである。案の中身（違反 0 か・未充足が名指しされているか）は M2 の判定であり、
// この手は見ない（→ docs/tech-requirements.md 7 の M2・issue #153）。
//
// 何も書き換えない。読むだけである。中央値が上限を越えたら終了コード 1 で落ちる。

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { 営業時刻の行, 検める as 前回の5時刻を検める } from './前回の5時刻.mjs'

const ここ = path.dirname(fileURLToPath(import.meta.url))
const 根 = path.dirname(ここ)
const 読む = (相対) => fs.readFileSync(path.join(根, 相対), 'utf8')

const 宣言 = JSON.parse(読む('scripts/生成の所要時間の宣言.json'))

// ---- 実装を読む ------------------------------------------------------------
// SpreadsheetApp を文脈に置いていない。置かなくても通ることは src/core.test.mjs の側が見ている。

const 文脈 = vm.createContext({})
for (const 相対 of 宣言.入力.実装) {
  vm.runInContext(読む(相対), 文脈, { filename: path.basename(相対) })
}
const { build, builtInSteps, takeIn, expand, toDays, formatDateTime, coreSteps } = vm.runInContext(
  '({ build, builtInSteps, takeIn, expand, toDays, formatDateTime, coreSteps })',
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

// 条件入力の「日ごとの営業時刻」は、data/ の前回の確定シフトから毎回算出する
// （→ scripts/前回の5時刻.mjs ／ 宣言の「前回の 5 時刻の置き方」）。この手は刻み方も時刻も持たない。
const 時刻の検め = 前回の5時刻を検める()

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
const 日 = toDays(営業時刻の行(), '日ごとの営業時刻')
const 希望 = takeIn(回答の全行)

// 終端 ≤ 始端の区間を書いた人は、展開の段が名指しして止まる（→ 宣言の「展開で止まる 3 人を外すこと」）。
// 外さないと 1 周が途中で止まり、時間が測れない。誰を外したかは名指しで出す。
const 止まる人 = 希望
  .filter((一人) => {
    try {
      expand([一人], 日)
      return false
    } catch (例外) {
      return true
    }
  })
  .map((一人) => 一人.studentId)

const 組む回答 = 回答の全行.filter((行) => 止まる人.indexOf(String(行[1]).toUpperCase()) === -1)

// ---- 時間を測る ------------------------------------------------------------

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

/** 何回か回して、秒の並びを返す。 */
function 何回か回す(入力, 回数) {
  const 秒の並び = []
  let 最後の周 = null
  for (let i = 0; i < 回数; i++) {
    最後の周 = 一周する(入力)
    秒の並び.push(最後の周)
  }
  return { 秒の並び: 秒の並び, 最後の周: 最後の周 }
}

function 中央値(数の並び) {
  const 並べた = 数の並び.slice().sort((a, b) => a - b)
  const 真ん中 = Math.floor(並べた.length / 2)
  return 並べた.length % 2 === 1 ? 並べた[真ん中] : (並べた[真ん中 - 1] + 並べた[真ん中]) / 2
}

const 秒で = (値) => `${値.toFixed(3)} 秒`

// ---- 規模を増やす側 --------------------------------------------------------
// 希望の人数だけを増やす。枠・役割・需要は増やさない（→ 宣言の「規模を増やした側も測ること」）。

/**
 * 学籍番号を作り直した複製を足して、人数を増やす。10 桁の英数字に収める（→ src/input-types.js）。
 * 増えるのは回答の行なので、人数はちょうど倍にならない — 出し直しの行も、番号を振り直せば別人になる
 * （→ 3 の規則 2）。出すのは取り込んだ後の実際の人数である。
 */
function 人数を倍にする(回答, 倍率) {
  const 増やした = 回答.slice()
  for (let 複製 = 1; 複製 < 倍率; 複製++) {
    回答.forEach((行, 番号) => {
      const 写し = 行.slice()
      写し[1] = `Z${String(複製).padStart(2, '0')}${String(番号).padStart(7, '0')}`
      増やした.push(写し)
    })
  }
  return 増やした
}

// ---- 走らせる --------------------------------------------------------------

const 実測 = 何回か回す(入力一式(組む回答), 宣言.回す回数)
const 全体の秒の並び = 実測.秒の並び.map((周) => 周.全体の秒)
const 中央 = 中央値(全体の秒の並び)
const 最大 = Math.max.apply(null, 全体の秒の並び)
const 最小 = Math.min.apply(null, 全体の秒の並び)

const 段の中央値 = {}
Object.keys(実測.最後の周.段の秒).forEach((名) => {
  段の中央値[名] = 中央値(実測.秒の並び.map((周) => 周.段の秒[名] || 0))
})

const 規模ごと = 宣言.規模を増やす倍率.map((倍率) => {
  const 回答 = 人数を倍にする(組む回答, 倍率)
  const 周 = 何回か回す(入力一式(回答), 3)
  return {
    倍率: 倍率,
    人数: takeIn(回答).length,
    秒: 中央値(周.秒の並び.map((一周) => 一周.全体の秒)),
  }
})

// ---- 入力が、本文の規模と同じかを見る --------------------------------------
// 時間の値より先に見る。入力が違えば、時間は比べる相手にならない（→ 宣言の「入力の期待値」）。

const 期待 = 宣言.入力の期待値
const 実際 = {
  '回答の行': 回答の全行.length,
  '取り込んだ人数': 希望.length,
  '展開で止まる人数': 止まる人.length,
  '組む人数': 希望.length - 止まる人.length,
  '枠': 日.reduce((合計, 一日) => 合計 + 一日.slots.length, 0),
  '日ごとの枠': 日.map((一日) => 一日.slots.length),
}
const 外れた入力 = Object.keys(実際).filter((名) => JSON.stringify(実際[名]) !== JSON.stringify(期待[名]))

// ---- 出す ------------------------------------------------------------------

const 上限 = 宣言.合格の線.上限の秒
const 余裕の倍率 = 上限 / 中央
const 未了の段 = 実測.最後の周.出力.notBuilt.map((段) => `${段.name}（→ issue #${段.issue}）`)

console.log('\n生成の所要時間の実測（src/ のコアを Node で 1 周させる／スプレッドシート無し）\n')

console.log(`  上限: ${上限} 秒 — ${宣言.合格の線.出どころ}`)
console.log(`  比べる相手: ${宣言.合格の線.何と比べるか}\n`)

console.log('  入力')
Object.keys(実際).forEach((名) => {
  const 印 = JSON.stringify(実際[名]) === JSON.stringify(期待[名]) ? 'OK  ' : 'NG  '
  console.log(`    ${印} ${名}: ${JSON.stringify(実際[名])}（期待 ${JSON.stringify(期待[名])}）`)
})
console.log(`         展開で止まった人: ${止まる人.join(' / ')}（終端 ≤ 始端。外してから 1 周させた → 宣言）`)
console.log(`         需要のべ: ${期待.需要のべ}（枠 ${期待.枠} × 1 枠 ${期待.需要のべ / 期待.枠} 人 ◎ → 6 の #3 の理由 ②）`)

console.log('\n  日ごとの 5 時刻（data/ の前回の確定シフトから算出した値である → scripts/前回の5時刻.mjs）')
時刻の検め.算出.forEach((一日) => {
  const 帯 = `準備 ${一日.帯の枠['準備']} ／ 調理 ${一日.帯の枠['調理']} ／ 片付け ${一日.帯の枠['片付け']}`
  console.log(`         ${一日.日}  ${一日.時刻.join(' ')}  全 ${一日.全枠} 枠 = ${帯}`)
})
時刻の検め.確かめた.forEach((一つ) => console.log(`    ${一つ.合否 ? 'OK  ' : 'NG  '} ${一つ.何}`))
if (時刻の検め.外れ.length === 0) {
  console.log('    OK   算出した値が、scripts/前回の5時刻の宣言.json の期待値と 1 つも違わない')
} else {
  時刻の検め.外れ.forEach((一つ) => console.log(`    NG   5 時刻が期待と違う: ${一つ}`))
}
console.log('')

console.log(`  段ごとの中央値（${宣言.回す回数} 回）`)
coreSteps.forEach((段) => {
  if (段の中央値[段.name] === undefined) return
  console.log(`    ${段.name.padEnd(12, '　')} ${秒で(段の中央値[段.name])}`)
})
未了の段.forEach((名) => console.log(`    ${名} … まだ中身が入っていない（時間は乗っていない → 宣言の「測らないもの」）`))
console.log(`    ${'コアを 1 周'.padEnd(12, '　')} ${秒で(中央)}（最小 ${秒で(最小)} ／ 最大 ${秒で(最大)}）\n`)

console.log('  規模を増やした側（回答の行を複製して人数だけ増やす。枠は 88 のまま。3 回の中央値）')
規模ごと.forEach((一つ) => {
  console.log(`    回答 ×${一つ.倍率}  ${String(一つ.人数).padStart(4)} 人   ${秒で(一つ.秒)}`)
})
console.log('')

console.log(`  上限までの余裕: ${余裕の倍率.toFixed(0)} 倍（中央値 ${秒で(中央)} ／ 上限 ${上限} 秒）`)
console.log(`  実機（Apps Script の V8）で ${余裕の倍率.toFixed(0)} 倍より遅ければ当たる。手元の Node では測れない（→ 宣言の「測らないもの」）\n`)

const 越えた = 中央 > 上限
const 最大も越えていないか = 最大 <= 上限

if (外れた入力.length > 0) {
  console.log(`  入力が期待と違う: ${外れた入力.join(' / ')}`)
  console.log('  時間の値より先に、入力が 6 の #3 の理由 ② の規模と同じかを見る（→ 宣言の「入力の期待値」）\n')
}

if (時刻の検め.落ちた) {
  console.log('  算出した 5 時刻が検めを落ちた（→ node scripts/前回の5時刻.mjs で分かれ道が出る）')
  console.log(`  ${時刻の検め.ここが外れたら}\n`)
}

if (越えた) {
  console.log(`  判定: 上限に当たった（中央値 ${秒で(中央)} ＞ ${上限} 秒）`)
  console.log(`  ${宣言.上限に当たったら.この手が決めないこと}`)
  宣言.上限に当たったら.分かれ道.forEach((道) => {
    console.log(`    ・${道.疑う先}: ${道.どういうときか}`)
    console.log(`      → ${道.動かす先}`)
  })
} else {
  console.log(`  判定: 上限の中で終わった（中央値 ${秒で(中央)} ＜ ${上限} 秒。→ 6-1 の #2）`)
  if (!最大も越えていないか) console.log(`         ただし最大は ${秒で(最大)} で、上限の外である`)
}
console.log('')

process.exit(越えた || 外れた入力.length > 0 || 時刻の検め.落ちた ? 1 : 0)
