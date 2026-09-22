#!/usr/bin/env node
// 前回の確定シフトを、従来のシフト表の形に敷き直す（issue #213）。
//
//   使い方: node scripts/前回のシフト表.mjs
//   宣言:   scripts/前回のシフト表の宣言.json（決めも期待値もあちらが持つ。このファイルに書かない）
//
// 見るのは 2 つである。
//   ① 記録が、この形にそのまま載るか。
//      前回の配布物 ◎ は行が人・列が 30 分枠・セルが役割名 1 つで、1 日 1 枚である。
//      同じ形が記録（data/ の 4 本）から出るなら、敷き方が記録の側と食い違っていない。
//   ② 敷いたマス目を配る画像にしたとき、粒度が落ちないか（M4「前回の配布物と同じ粒度」→ 5 の #9 ／ issue #157）。
//      画像の（名前・時刻・役割）が、マス目の（人・枠・役割）と 1 つも違わなければ、差分は 0 である。
//
// 敷くのは src/assignment-grid.js の toAssignmentGrid である。ここで敷き方を書き直さない
// （書き直した形で一致しても、答えにならない）。枠の刻み方も src/input-types.js のままである。
// 画像の中身を組むのも src/distribution-image.js の distributionTable のままである（canvas に塗る手前まで）。
//
// 記録は 1 文字も書き換えない。読むだけである。合格の線を 1 つでも外したら終了コード 1 で落ちる。

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { 営業時刻の行 } from './前回の5時刻.mjs'

const ここ = path.dirname(fileURLToPath(import.meta.url))
const 根 = path.dirname(ここ)
const 読む = (相対) => fs.readFileSync(path.join(根, 相対), 'utf8')

const 宣言 = JSON.parse(読む('scripts/前回のシフト表の宣言.json'))

// ---- 実装を読む ------------------------------------------------------------

const 文脈 = vm.createContext({})
for (const 名 of ['sheet-layout.js', 'input-types.js', 'core.js', 'assignment-grid.js', 'distribution-image.js']) {
  vm.runInContext(読む(path.join('src', 名)), 文脈, { filename: 名 })
}
const { toDays, toAssignmentGrid, distributionTable } = 文脈
const { dayLabels, assignmentColumns } = vm.runInContext('({ dayLabels, assignmentColumns })', 文脈)

const 分にする = (時刻) => Number(時刻.split(':')[0]) * 60 + Number(時刻.split(':')[1])

/** 割り当ての 1 行を、列の並びのとおりに組む。 */
function 割り当ての行(日, 枠, 役割, 学籍番号, 氏名) {
  const 値 = { '日': 日, '開始': 枠.start, '終了': 枠.end, '役割': 役割, '学籍番号': 学籍番号, '氏名': 氏名 }
  return assignmentColumns.map((列名) => 値[列名])
}

// ---- 記録を読み、区間を枠に当てる ------------------------------------------
// 当てる向きは「重なる枠」である（→ 宣言の決め）。記録には 30 分に乗らない区間が 3 行ある。

const 日ごと = toDays(営業時刻の行(), '日ごとの営業時刻')
const 枠のある日 = {}
日ごと.forEach((一日) => { 枠のある日[一日.date] = 一日 })

const 行 = []
const 枠に落ちなかった区間 = []

宣言.入力.記録.forEach((相対) => {
  JSON.parse(読む(相対)).results.forEach((一人) => {
    一人.assigned.forEach((一件) => {
      const 一日 = 枠のある日[一件.date]
      if (!一日) { 枠に落ちなかった区間.push(`${一件.date} ${一件.start}-${一件.end}`); return }

      const 重なる枠 = 一日.slots.filter((枠) => (
        分にする(枠.start) < 分にする(一件.end) && 分にする(一件.start) < 分にする(枠.end)
      ))
      if (重なる枠.length === 0) { 枠に落ちなかった区間.push(`${一件.date} ${一件.start}-${一件.end} ${一件.role}`); return }
      重なる枠.forEach((枠) => 行.push(割り当ての行(一件.date, 枠, 一件.role, 一人.memberId, 一人.name)))
    })
  })
})

// ---- 1 セルに 2 役割になる組を名指しする ------------------------------------
// マス目は 1 セル 1 役割である（→ 5 の #8）。記録の重なりはここに出る。

const 見た = {}
const 重なり = []
const 敷く行 = []
行.forEach((一行) => {
  const 鍵 = [一行[0], 一行[1], 一行[4]].join('|')
  const 役割 = 一行[3]
  if (見た[鍵] === undefined) { 見た[鍵] = 役割; 敷く行.push(一行); return }
  if (見た[鍵] === 役割) return // 同じ役割の区間が 2 本に割れているだけ。セルの中身は同じである
  重なり.push(`${一行[0]} ${一行[1]} の「${一行[5]}」（${一行[4]}）に ${見た[鍵]} と ${役割}`)
})

// ---- 日ごとに敷く -----------------------------------------------------------

const 学籍番号の列 = assignmentColumns.indexOf('学籍番号')
const 氏名の列 = assignmentColumns.indexOf('氏名')
const 氏名を引く = (() => {
  const 表 = {}
  行.forEach((一行) => { 表[一行[学籍番号の列]] = 一行[氏名の列] })
  return (学籍番号) => 表[学籍番号] || ''
})()

const 敷いた = 日ごと.map((一日, i) => {
  const マス目 = toAssignmentGrid(敷く行, 一日, 氏名を引く)
  const その日の行 = 敷く行.filter((一行) => 一行[0] === 一日.date)
  return {
    日: 一日.date,
    ラベル: dayLabels[i],
    枠: 一日.slots.length,
    行: マス目.rows.length,
    氏名の種類: new Set(マス目.rows.map((一行) => 一行[1])).size,
    役割: [...new Set(その日の行.map((一行) => 一行[3]))].sort(),
    セル: マス目.rows.reduce((数, 一行) => 数 + 一行.slice(2).filter((セル) => セル !== '').length, 0),
    マス目の三つ組: マス目の三つ組(マス目),
    画像の三つ組: 画像の三つ組(distributionTable(マス目.header, マス目.rows, 一日, dayLabels[i])),
  }
})

/** マス目の埋まったセルを（氏名・時刻・役割）にする。 */
function マス目の三つ組(マス目) {
  const 組 = []
  マス目.rows.forEach((一行) => 一行.slice(2).forEach((役割, j) => {
    if (役割 !== '') 組.push(`${一行[1]} ${マス目.header[2 + j]} ${役割}`)
  }))
  return 組.sort()
}

/** 配る画像の表を（名前・時刻・役割）にする。 */
function 画像の三つ組(表) {
  const 組 = []
  表.rows.forEach((一行) => 一行.cells.forEach((セル, j) => {
    if (セル.role !== '') 組.push(`${一行.name} ${表.times[j]} ${セル.role}`)
  }))
  return 組.sort()
}

// ---- 突き合わせる -----------------------------------------------------------

const 落ちた = []
const 通った = []

function 見る(題, 実測, 期待) {
  if (JSON.stringify(実測) === JSON.stringify(期待)) 通った.push(題)
  else 落ちた.push({ 題, 実測, 期待 })
}

宣言.期待値.日ごと.forEach((期待, i) => {
  const 実測 = 敷いた[i]
  見る(
    `${期待.ラベル}（${期待.日}）の 行 / 枠 / 役割 が宣言のとおりである`,
    [実測.ラベル, 実測.日, 実測.行, 実測.枠, 実測.役割],
    [期待.ラベル, 期待.日, 期待.行, 期待.枠, 期待.役割],
  )
  見る(
    `${期待.ラベル} は氏名で引くと ${期待.行 - 期待.氏名の種類} 行が潰れる（行の鍵は学籍番号である → ADR tech-requirements-0004）`,
    実測.氏名の種類,
    期待.氏名の種類,
  )
})

敷いた.forEach((一日) => {
  見る(
    `${一日.ラベル}（${一日.日}）を配る画像にしても、（人・枠・役割）の差分が 0 である（M4 → 5 の #9）`,
    一日.画像の三つ組,
    一日.マス目の三つ組,
  )
})

見る('区間が 1 本も枠から落ちていない（重なる枠を取る → 宣言の決め）', 枠に落ちなかった区間, [])
見る('1 セルに 2 役割になるセルの数が宣言のとおりである', 重なり.length, 宣言.期待値['1セルに2役割になるセル'])
見る(
  '役割名の顔ぶれが宣言のとおりである（5 役割 ◎ の外に出る 3 つも、規則 3 と規則 6 が名指ししている → 4-5）',
  [...new Set(行.map((一行) => 一行[3]))].sort(),
  宣言.期待値.役割名の顔ぶれ,
)

// ---- 出す -------------------------------------------------------------------

console.log('前回の確定シフトを、従来のシフト表の形に敷き直す（→ issue #213）')
console.log('')
console.log('敷いた形（1 日 1 枚。行が人、列が 30 分枠、セルが役割名 1 つ）')
敷いた.forEach((一日) => {
  console.log(
    `  ${一日.ラベル}（${一日.日}）　行 ${String(一日.行).padStart(2)} 人 ／ 列 ${String(一日.枠).padStart(2)} 枠`
      + ` ／ 埋まったセル ${String(一日.セル).padStart(3)}`
      + ` ／ 氏名の種類 ${一日.氏名の種類}`
      + ` ／ 役割 ${一日.役割.join('・')}`
      + ` ／ 画像に描いたセル ${一日.画像の三つ組.length}`,
  )
})

console.log('')
console.log('1 セルに 2 役割になるセル（マス目は 1 セル 1 役割である → 5 の #8）')
if (重なり.length === 0) console.log('  無し')
重なり.forEach((一つ) => console.log(`  ${一つ}`))
if (重なり.length > 0) {
  console.log('  ※ 敷くほうからは後ろの 1 件を外した。記録は 1 文字も書き換えていない（→ 宣言の決め）')
}

console.log('')
for (const 題 of 通った) console.log(`  OK   ${題}`)
for (const { 題, 実測, 期待 } of 落ちた) {
  console.log(`  NG   ${題}`)
  console.log(`         実測: ${JSON.stringify(実測)}`)
  console.log(`         期待: ${JSON.stringify(期待)}`)
}

console.log('')
if (落ちた.length === 0) {
  console.log(`結果: 記録は従来のシフト表の形にそのまま載る（${通った.length} 件とも宣言のとおり）`)
} else {
  console.log(`結果: 宣言と違う所が ${落ちた.length} 件（一致 ${通った.length} 件）`)
  process.exitCode = 1
}
