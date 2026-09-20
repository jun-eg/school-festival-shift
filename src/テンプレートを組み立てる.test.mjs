#!/usr/bin/env node
// 組み立ての検査 — src/テンプレートを組み立てる.js を、偽のスプレッドシートの上で走らせる。
//
//   使い方: node src/テンプレートを組み立てる.test.mjs
//
// 見るものは 4 つある。
//   ① 5 枚が構成の並びででき、最初からある空のシートが消える
//   ② 保護がかかるのは生成シートの 3 枚だけで、かかり方は「警告のみ」である
//   ③ 2 回走らせても形が変わらない（足りないものだけ足す）
//   ④ 見出しが構成と違うときは、上書きせずに名指しで止まる（黙って直さない）
//
// ここで分かるのは組み立ての手順だけである。
// 本物の Google スプレッドシートで保護が効くか・コピーでスクリプトが渡るかは分からない
// （→ src/README.md・issue #136）。

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const ここ = path.dirname(fileURLToPath(import.meta.url))

// ---- 偽のスプレッドシート ---------------------------------------------------

class 偽の範囲 {
  constructor(シート, 行, 列, 行数, 列数) {
    Object.assign(this, { シート, 行, 列, 行数, 列数 })
  }
  位置() {
    const 並び = []
    for (let r = this.行; r < this.行 + this.行数; r++) {
      for (let c = this.列; c < this.列 + this.列数; c++) 並び.push(`${r},${c}`)
    }
    return 並び
  }
  getValues() {
    const 表 = []
    for (let r = this.行; r < this.行 + this.行数; r++) {
      const 行 = []
      for (let c = this.列; c < this.列 + this.列数; c++) 行.push(this.シート.セル.get(`${r},${c}`) ?? '')
      表.push(行)
    }
    return 表
  }
  setValues(表) {
    表.forEach((行, i) => 行.forEach((値, j) => this.シート.セル.set(`${this.行 + i},${this.列 + j}`, 値)))
    return this
  }
  setFontWeight(太さ) {
    this.位置().forEach((鍵) => this.シート.太字.set(鍵, 太さ))
    return this
  }
  setNote(注記) {
    this.位置().forEach((鍵) => this.シート.注記.set(鍵, 注記))
    return this
  }
}

class 偽の保護 {
  constructor(シート) {
    this.シート = シート
    this.説明 = null
    this.警告のみ = false
  }
  setDescription(説明) { this.説明 = 説明; return this }
  setWarningOnly(値) { this.警告のみ = 値; return this }
  remove() { this.シート.保護 = this.シート.保護.filter((p) => p !== this) }
}

class 偽のシート {
  constructor(名前) {
    Object.assign(this, { 名前, セル: new Map(), 太字: new Map(), 注記: new Map(), 保護: [], 凍結行: 0 })
  }
  getName() { return this.名前 }
  getRange(行, 列, 行数 = 1, 列数 = 1) { return new 偽の範囲(this, 行, 列, 行数, 列数) }
  setFrozenRows(数) { this.凍結行 = 数 }
  getProtections() { return [...this.保護] }
  protect() { const p = new 偽の保護(this); this.保護.push(p); return p }
  getLastRow() { return [...this.セル.keys()].reduce((最大, 鍵) => Math.max(最大, Number(鍵.split(',')[0])), 0) }
  getLastColumn() { return [...this.セル.keys()].reduce((最大, 鍵) => Math.max(最大, Number(鍵.split(',')[1])), 0) }
}

class 偽のスプレッドシート {
  constructor(名前たち) {
    this.シートたち = 名前たち.map((名前) => new 偽のシート(名前))
    this.いまのシート = this.シートたち[0]
  }
  getSheets() { return [...this.シートたち] }
  getSheetByName(名前) { return this.シートたち.find((s) => s.getName() === 名前) ?? null }
  insertSheet(名前) { const s = new 偽のシート(名前); this.シートたち.push(s); return s }
  deleteSheet(シート) { this.シートたち = this.シートたち.filter((s) => s !== シート) }
  setActiveSheet(シート) { this.いまのシート = シート }
  moveActiveSheet(位置) {
    this.シートたち = this.シートたち.filter((s) => s !== this.いまのシート)
    this.シートたち.splice(位置 - 1, 0, this.いまのシート)
  }
}

// ---- 読み込む ---------------------------------------------------------------

const 文脈 = vm.createContext({
  SpreadsheetApp: { ProtectionType: { SHEET: 'SHEET' } },
  console: { log() {} },
})
for (const 名 of ['シート構成.js', 'テンプレートを組み立てる.js']) {
  vm.runInContext(fs.readFileSync(path.join(ここ, 名), 'utf8'), 文脈, { filename: 名 })
}
// const は文脈のプロパティにならないので、式で取り出す（function は文脈に出る）
const { 組み立てる } = 文脈
const { シートの構成, 保護の説明 } = vm.runInContext('({ シートの構成, 保護の説明 })', 文脈)

// ---- 検査 -------------------------------------------------------------------

const 落ちた = []
const 通った = []

function 見る(見出し, 実測, 期待) {
  if (JSON.stringify(実測) === JSON.stringify(期待)) 通った.push(見出し)
  else 落ちた.push({ 見出し, 実測, 期待 })
}

const 帳面 = new 偽のスプレッドシート(['シート1'])
組み立てる(帳面)

見る(
  '① 5 枚が構成の並びででき、空の「シート1」が消えた',
  帳面.getSheets().map((s) => s.getName()),
  シートの構成.map((c) => c.名前),
)

見る(
  '① 条件入力の 1 行目は区画の見出しで、2 行目が列名である',
  [
    帳面.getSheetByName('条件入力').getRange(1, 1, 1, 22).getValues()[0].filter((v) => v !== ''),
    帳面.getSheetByName('条件入力').getRange(2, 1, 1, 5).getValues()[0],
  ],
  [
    シートの構成[0].区画.map((k) => k.見出し),
    ['日付', '準備開始', '調理開始', '調理終了', '片付け開始'],
  ],
)

見る(
  '① 回答の 1 行目にフォームの 10 列が並んでいる',
  帳面.getSheetByName('回答').getRange(1, 1, 1, 10).getValues()[0],
  シートの構成[1].区画[0].列,
)

見る(
  '② 保護がかかったのは生成シートの 3 枚だけである',
  帳面.getSheets().filter((s) => s.保護.length > 0).map((s) => s.getName()),
  ['回答', '検証結果', '指標'],
)

見る(
  '② かかり方は「警告のみ」で、説明が付いている',
  帳面.getSheets().flatMap((s) => s.保護).map((p) => [p.警告のみ, p.説明]),
  [[true, 保護の説明], [true, 保護の説明], [true, 保護の説明]],
)

const 一回目の姿 = JSON.stringify(帳面.getSheets().map((s) => [s.getName(), [...s.セル], s.凍結行, s.保護.length]))
const 二回目の記録 = 組み立てる(帳面)
const 二回目の姿 = JSON.stringify(帳面.getSheets().map((s) => [s.getName(), [...s.セル], s.凍結行, s.保護.length]))

見る('③ 2 回目を走らせても形が変わらない', 二回目の姿, 一回目の姿)
見る(
  '③ 2 回目は何も作らない（記録に「作った」が出ない）',
  二回目の記録.filter((行) => 行.includes('作った') || 行.includes('置いた')),
  [],
)

const 壊した帳面 = new 偽のスプレッドシート(['シート1'])
組み立てる(壊した帳面)
壊した帳面.getSheetByName('指標').getRange(1, 3, 1, 1).setValues([['合計時間（時）']])
let 止まった = null
try {
  組み立てる(壊した帳面)
} catch (例外) {
  止まった = 例外.message
}

見る(
  '④ 見出しが構成と違うと、シート名を名指しして止まる',
  [止まった !== null, 止まった?.includes('「指標」'), 止まった?.includes('黙って直さない')],
  [true, true, true],
)
見る(
  '④ 止まったとき、書き換えられたセルを上書きしていない',
  壊した帳面.getSheetByName('指標').getRange(1, 3, 1, 1).getValues()[0],
  ['合計時間（時）'],
)

// ---- 結果 -------------------------------------------------------------------

console.log('組み立ての検査（src/テンプレートを組み立てる.js／偽のスプレッドシートの上）')
console.log('')
for (const 見出し of 通った) console.log(`  OK   ${見出し}`)
for (const { 見出し, 実測, 期待 } of 落ちた) {
  console.log(`  NG   ${見出し}`)
  console.log(`         実測: ${JSON.stringify(実測)}`)
  console.log(`         期待: ${JSON.stringify(期待)}`)
}
console.log('')
if (落ちた.length === 0) {
  console.log(`結果: 全件一致（${通った.length} 件）`)
  process.exit(0)
}
console.log(`結果: 不一致 ${落ちた.length} 件 ／ 一致 ${通った.length} 件`)
process.exit(1)
