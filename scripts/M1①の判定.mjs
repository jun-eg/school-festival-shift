#!/usr/bin/env node
// M1 ① の判定 — 前回の確定シフトのモック 4 本が、5-1 の型に乗るかを見る。
//
//   使い方: node scripts/M1①の判定.mjs
//   宣言:   scripts/M1①の宣言.json（合格の線も営業時刻の置き方もあちらが持つ。このファイルに書かない）
//
// 数えるのは「5-1 の型に乗らなかった行」1 つである。合格の線は 0 行（→ docs/tech-requirements.md 7 の M1 ①）。
//
// 型は書き直さない。src/input-types.js をそのまま走らせて、確定シフトの行を通す
// （書き直した型に乗っても、M1 ① の答えにならない）。SpreadsheetApp は置かない。
//
// 数えるのは生成した案ではなく、前回の記録である。見るのは型に乗るかだけで、
// 前回の記録が規則を満たしているかは見ない（→ docs/tech-requirements.md 5-4。違反を数えるのは
// src/count-violations.js の側で、入力は生成した案である）。
//
// 何も書き換えない。読むだけである。乗らなかった行が 1 行でもあれば終了コード 1 で落ちる。

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const ここ = path.dirname(fileURLToPath(import.meta.url))
const 根 = path.dirname(ここ)
const 読む = (相対) => fs.readFileSync(path.join(根, 相対), 'utf8')

const 宣言 = JSON.parse(読む('scripts/M1①の宣言.json'))

// ---- 型を読む --------------------------------------------------------------
// SpreadsheetApp を文脈に置いていない。置かなくても通ることは src/input-types.test.mjs の側が見ている。

const 文脈 = vm.createContext({})
for (const 相対 of 宣言.入力.型) {
  vm.runInContext(読む(相対), 文脈, { filename: path.basename(相対) })
}
const { toType, inputTypes, studentIdPattern } = vm.runInContext(
  '({ toType, inputTypes, studentIdPattern })',
  文脈,
)

// 型 #2（役割と必要人数）と 型 #4（委員会の指定枠）は同じ形（(日・時間帯・役割名・人数) の行）なので、
// 行を通すのはどちらでも同じである（→ docs/tech-requirements.md 5-1）。名指しの文が読みやすい #2 を使う。
const 型 = {
  枠: inputTypes[0],
  役割と必要人数: inputTypes[1],
}

// ---- 入力を読む ------------------------------------------------------------

/** 確定シフトのモック 4 本を、割り当て 1 行 = 1 要素に開く。どの行かを名指しできるところまで持つ。 */
function 確定シフトを読む() {
  const 行 = []
  for (const 相対 of 宣言.入力.確定シフト) {
    const j = JSON.parse(読む(相対))
    j.results.forEach((人, 人の番号) => {
      人.assigned.forEach((割り当て, 割り当ての番号) => {
        行.push({
          在処: `${path.basename(相対)} の results[${人の番号}].assigned[${割り当ての番号}]`,
          memberId: 人.memberId,
          date: 割り当て.date,
          start: 割り当て.start,
          end: 割り当て.end,
          role: 割り当て.role,
        })
      })
    })
  }
  return 行
}

// ---- 営業時刻を型 #1 に渡す形にする ----------------------------------------

/** 本文が 8:00 と書いている時刻を HH:MM に揃える。揃えるのは表現だけで、時刻は動かさない（→ 宣言）。 */
const 時刻を揃える = (文字列) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(文字列.trim())
  if (!m) throw new Error(`営業時刻が読めない: ${文字列}`)
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

/**
 * 前回の 5 時刻は記録に無い（→ 宣言の「営業時刻の置き方」）。
 * 始まりの 4 つを営業開始に、片付け終了を営業終了に置き、1 日を 1 本の帯として刻む。
 */
function 日ごとの枠() {
  const 行 = Object.entries(宣言.営業時刻.値).map(([日, [開始, 終了]]) => {
    const 頭 = 時刻を揃える(開始)
    return [日, 頭, 頭, 頭, 頭, 時刻を揃える(終了)]
  })
  return toType(型.枠, 行)
}

// ---- 乗るかを見る ----------------------------------------------------------

const 分 = (時刻) => Number(時刻.slice(0, 2)) * 60 + Number(時刻.slice(3, 5))

/** 重なりの定義: 端が接するだけは重なりに数えない（scripts/件数の検算.mjs と同じ向きである）。 */
const 重なる = (枠, 区間) => 分(枠.start) < 分(区間.end) && 分(区間.start) < 分(枠.end)

/**
 * 確定シフトの 1 行を、5-1 の 3 つに当てる（→ 宣言の「当て方」）。
 * 乗ったなら null、乗らなかったなら理由を返す。
 */
function 乗らない理由(行, 日ごと) {
  // 日 ＋ 時間帯 ＋ 役割名 — 型 #2／#4 の行の形で受け取れるか。人数は 1（確定シフトの 1 行は 1 人ぶんである）。
  try {
    toType(型.役割と必要人数, [[行.date, 行.start, 行.end, 行.role, 1]])
  } catch (どこが) {
    return `型 #2／#4 の (日・時間帯・役割名・人数) の行にならない — ${型が言ったこと(どこが)}`
  }

  // 学籍番号 — 型 #6 の識別キーの形か。
  if (!studentIdPattern.test(行.memberId)) {
    return `型 #6 の識別キー（学籍番号）が 10 桁の英数字でない — いま: ${行.memberId}`
  }

  // 日 ＋ 区間 — 型 #1 の 30 分枠に重なる枠があるか。
  const 日 = 日ごと.filter((一日) => 一日.date === 行.date)[0]
  if (!日) {
    return `型 #1 の枠に、その日（${行.date}）が無い`
  }
  const 重なる枠 = 日.slots.filter((枠) => 重なる(枠, 行))
  if (重なる枠.length === 0) {
    return `型 #1 の ${行.date} の枠に、${行.start}-${行.end} と重なる枠が 1 つも無い`
  }
  return null
}

/** 型が名指しした文から、区画と行番号（判定の側では意味を持たない）を落とす。 */
const 型が言ったこと = (どこが) => String(どこが.message).replace(/^「[^」]+」の \d+ 行目（シートの \d+ 行目）の?/, '')

/** 端が枠にそのまま分かれるか。分かれない行は、乗った側でも内訳に出す（→ 宣言の「30 分に乗らない区間の向き」）。 */
function 端が揃わない(行, 日ごと) {
  const 日 = 日ごと.filter((一日) => 一日.date === 行.date)[0]
  if (!日) return null
  const 重なる枠 = 日.slots.filter((枠) => 重なる(枠, 行))
  if (重なる枠.length === 0) return null
  const 頭 = 重なる枠[0]
  const 尻 = 重なる枠[重なる枠.length - 1]
  if (頭.start === 行.start && 尻.end === 行.end) return null
  return { 枠: `${頭.start} と ${尻.start} の ${重なる枠.length} 枠`, 区間: `${行.date} ${行.start}-${行.end} ${行.role}` }
}

// ---- 本文に載っているかを見る ----------------------------------------------

/** 宣言が本文から写した値が、いまも本文に載っているか。載っているかだけを見る。本文は解析しない。 */
function 本文を見る() {
  const 文 = 読む(宣言.営業時刻.本文.ファイル)
  return 宣言.営業時刻.本文.数字.filter((数字) => 文.indexOf(数字) === -1)
}

// ---- 出す --------------------------------------------------------------------

function 主処理() {
  const 日ごと = 日ごとの枠()
  const 行 = 確定シフトを読む()

  console.log('M1 ① の判定 — 前回の確定シフトのモック 4 本が、5-1 の型に乗るか')
  console.log('')
  console.log('型（判定の側で書き直さない。SpreadsheetApp を置かずにそのまま走らせる）')
  console.log(`  ${宣言.入力.型.join(' / ')}`)
  console.log('')
  console.log('宣言（原本は scripts/M1①の宣言.json）')
  for (const d of 宣言.宣言) {
    console.log(`  ・${d.何}: ${d.決め}`)
    console.log(`      なぜ宣言が要るか: ${d.なぜ宣言が要るか}`)
    if (d.確かめること) console.log(`      確かめること: ${d.確かめること}`)
  }
  console.log('')
  console.log('当て方（確定シフトの 1 行を、5-1 のどこに当てるか）')
  for (const a of 宣言.当て方) {
    console.log(`  ・${a['確定シフトの何を']} → ${a['5-1 の何に']}`)
    console.log(`      ${a.どう見るか}`)
  }
  console.log('')
  console.log('見ない項目（型に無いもの。無いことは乗らなかった行にならない）')
  for (const m of 宣言.見ない項目) console.log(`  ・${m.項目}: ${m.なぜ見ないか}`)
  console.log('')
  console.log('数えないもの（型に乗るかに効かないもの）')
  for (const m of 宣言.数えないもの) console.log(`  ・${m.何}: ${m.なぜ}`)

  const 乗らなかった = []
  const 揃わない端 = []
  const 日ごとの数え = new Map(日ごと.map((一日) => [一日.date, { 行: 0, 乗らなかった: 0 }]))

  for (const 一行 of 行) {
    const 数え = 日ごとの数え.get(一行.date) ?? { 行: 0, 乗らなかった: 0 }
    日ごとの数え.set(一行.date, 数え)
    数え.行++

    const 理由 = 乗らない理由(一行, 日ごと)
    if (理由) {
      数え.乗らなかった++
      乗らなかった.push({ ...一行, 理由 })
      continue
    }
    const 端 = 端が揃わない(一行, 日ごと)
    if (端) 揃わない端.push(端)
  }

  console.log('')
  console.log('日ごと（4 日とも通しで判定する → docs/tech-requirements.md 7）')
  for (const [日, 数え] of 日ごとの数え) {
    console.log(`  ${数え.乗らなかった === 0 ? 'OK ' : 'NG '}  [${日}] 行 ${数え.行} ／ 乗らなかった ${数え.乗らなかった}`)
  }
  console.log(`      通し  行 ${行.length} ／ 乗らなかった ${乗らなかった.length}`)

  console.log('')
  console.log('端が枠に揃わなかった行（乗った側。重なる枠を取る向きで数えた → 宣言）')
  if (揃わない端.length === 0) {
    console.log('  ・無い（全部の行が、そのまま枠に分かれた）')
  } else {
    const まとめ = new Map()
    for (const 端 of 揃わない端) {
      const 鍵 = `${端.区間} … ${端.枠}`
      まとめ.set(鍵, (まとめ.get(鍵) ?? 0) + 1)
    }
    for (const [鍵, 件数] of まとめ) console.log(`  ・${鍵} × ${件数} 行`)
  }

  console.log('')
  console.log('本文（宣言が写した値が載っているかだけを見る。本文は解析しない）')
  const 欠け = 本文を見る()
  if (欠け.length === 0) {
    console.log(`  OK   営業時間 ${宣言.営業時刻.本文.数字.join(' / ')} は ${宣言.営業時刻.本文.ファイル} に載っている`)
  } else {
    console.log(`  NG   ${宣言.営業時刻.本文.ファイル} に載っていない: ${欠け.join(' / ')}`)
  }

  if (乗らなかった.length > 0) {
    console.log('')
    console.log(`乗らなかった行（${乗らなかった.length} 行）`)
    for (const 一行 of 乗らなかった) {
      console.log(`  ・${一行.在処}`)
      console.log(`      ${一行.memberId} ${一行.date} ${一行.start}-${一行.end} ${一行.role}`)
      console.log(`      理由: ${一行.理由}`)
    }
    console.log('')
    console.log(`次に何を動かすか — ${宣言.乗らなかった行が出たら.この手が決めないこと}`)
    for (const 枝 of 宣言.乗らなかった行が出たら.分かれ道) {
      console.log(`  ・${枝.疑う先}: ${枝.どういうときか}`)
      console.log(`      先に見るもの: ${枝.先に見るもの}`)
      console.log(`      動かす先: ${枝.動かす先}`)
    }
  }

  console.log('')
  if (乗らなかった.length === 宣言.合格の線.乗らなかった行 && 欠け.length === 0) {
    console.log(`結果: 乗らなかった行 ${乗らなかった.length}（合格の線 ${宣言.合格の線.乗らなかった行} 行 ／ 判定した行 ${行.length}）`)
    return 0
  }
  console.log(
    `結果: 乗らなかった行 ${乗らなかった.length}（合格の線 ${宣言.合格の線.乗らなかった行} 行）`
      + ` ／ 本文に載っていない値 ${欠け.length} 件`,
  )
  return 1
}

process.exit(主処理())
