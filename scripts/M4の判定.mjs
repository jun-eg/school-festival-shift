#!/usr/bin/env node
// M4 の判定 — 希望を足してもう一度通す操作が、初回の 7〜9 と同じ手数で回り、手直しのセルが戻らないかを見る。
//
//   使い方: node scripts/M4の判定.mjs
//   宣言:   scripts/M4の宣言.json（合格の線・周の切り方・手直しの選び方の原本）
//
// 数えるのは 3 つで、合格の線は 3 つとも 0（→ docs/tech-requirements.md 7 の M4）。
//   ① 再実行の手数 − 初回の 7〜9 の手数
//   ② 再実行で戻った手直しのセル数（食い違いとして名指しで返されたものは除く）
//   ③ 書き出した画像と、その周のマス目の粒度の差分
//
// src/ をそのまま走らせ、担当者が押すのと同じ口（メニューの関数と onEdit）を呼ぶ。偽にするのは Google 側の器だけ。
// 読むだけ。線を 1 つでも外したら終了コード 1。

import path from 'node:path'
import vm from 'node:vm'
import { 読む, 判定の入力, 宣言 as M2の宣言 } from './判定の入力.mjs'

const 宣言 = JSON.parse(読む('scripts/M4の宣言.json'))
const 境目 = JSON.parse(読む('scripts/件数の期待値.json')).境目

// ---- 偽の器 ------------------------------------------------------------------
// Google がやることのうち、この経路が通るところだけを真似る。
// M1 ② の偽と違い、メモを持つ（手直しの印はセルのメモ → src/assignment-grid.js の fixedNote）。

class 偽の範囲 {
  constructor(シート, 行, 列, 行数, 列数) {
    Object.assign(this, { シート, 行, 列, 行数, 列数 })
  }
  表(地図) {
    const 表 = []
    for (let r = this.行; r < this.行 + this.行数; r++) {
      const 一行 = []
      for (let c = this.列; c < this.列 + this.列数; c++) 一行.push(地図.get(`${r},${c}`) ?? '')
      表.push(一行)
    }
    return 表
  }
  置く(地図, 表) {
    表.forEach((一行, i) => 一行.forEach((値, j) => {
      const 鍵 = `${this.行 + i},${this.列 + j}`
      if (値 === '' || 値 === null) 地図.delete(鍵)
      else 地図.set(鍵, 値)
    }))
    return this
  }
  消す(地図) {
    for (let r = this.行; r < this.行 + this.行数; r++) {
      for (let c = this.列; c < this.列 + this.列数; c++) 地図.delete(`${r},${c}`)
    }
    return this
  }
  getValues() { return this.表(this.シート.cells) }
  setValues(表) { return this.置く(this.シート.cells, 表) }
  clearContent() { return this.消す(this.シート.cells) }
  getNotes() { return this.表(this.シート.notes) }
  setNotes(表) { return this.置く(this.シート.notes, 表) }
  clearNote() { return this.消す(this.シート.notes) }
  getSheet() { return this.シート }
  getRow() { return this.行 }
  getColumn() { return this.列 }
  getLastRow() { return this.行 + this.行数 - 1 }
  getLastColumn() { return this.列 + this.列数 - 1 }
  // 書式は値もメモも動かさないので捨てる。
  setFontWeight() { return this }
  setNote() { return this }
  setHorizontalAlignment() { return this }
  clearFormat() { return this }
  setBackgrounds() { return this }
}

class 偽の保護 {
  constructor(シート) { Object.assign(this, { シート, description: null, warningOnly: false }) }
  setDescription(文) { this.description = 文; return this }
  setWarningOnly(値) { this.warningOnly = 値; return this }
  remove() { this.シート.protections = this.シート.protections.filter((p) => p !== this) }
}

let 次のシート番号 = 1

class 偽のシート {
  // 1000 行 26 列は新しいスプレッドシートの既定の大きさ
  constructor(name) {
    Object.assign(this, {
      name, id: 次のシート番号++, cells: new Map(), notes: new Map(), protections: [],
      frozenRows: 0, frozenColumns: 0, maxRows: 1000, maxColumns: 26,
    })
  }
  getName() { return this.name }
  setName(name) { this.name = name; return this }
  getSheetId() { return this.id }
  getRange(行, 列, 行数 = 1, 列数 = 1) { return new 偽の範囲(this, 行, 列, 行数, 列数) }
  getRangeList() { return { setFontColor() { return this }, setFontWeight() { return this } } }
  setFrozenRows(数) { this.frozenRows = 数 }
  setFrozenColumns(数) { this.frozenColumns = 数 }
  insertColumnsAfter(後ろ, 数) { this.maxColumns = Math.max(this.maxColumns, 後ろ + 数) }
  getProtections() { return [...this.protections] }
  protect() { const p = new 偽の保護(this); this.protections.push(p); return p }
  getFormUrl() { return null }
  getMaxRows() { return this.maxRows }
  getMaxColumns() { return this.maxColumns }
  getLastRow() { return [...this.cells.keys()].reduce((最大, 鍵) => Math.max(最大, Number(鍵.split(',')[0])), 0) }
  getLastColumn() { return [...this.cells.keys()].reduce((最大, 鍵) => Math.max(最大, Number(鍵.split(',')[1])), 0) }
  // 書き換えの控えを置く見えない記録（→ src/shell.js の keepSeenGrid）。
  getDeveloperMetadata() {
    const シート = this
    return (this.metadata ?? []).map((一つ) => ({
      getKey() { return 一つ.key },
      getValue() { return 一つ.value },
      setValue(値) { 一つ.value = String(値); return this },
      remove() { シート.metadata = シート.metadata.filter((他) => 他 !== 一つ) },
    }))
  }
  addDeveloperMetadata(key, value) { this.metadata = [...(this.metadata ?? []), { key, value: String(value) }]; return this }
}

// ---- 担当者に向いた口を見張る ------------------------------------------------
// 担当者が見るもの・答えさせられるものを積み、周ごとに切って数える。

const 画面 = { ダイアログ: [], 一言: [], 一覧に無い操作: [] }

class 偽のスプレッドシート {
  constructor(名前たち) {
    Object.assign(this, { sheets: 名前たち.map((n) => new 偽のシート(n)), id: 'this-spreadsheet', name: '学祭シフト' })
    this.activeSheet = this.sheets[0]
  }
  getId() { return this.id }
  getName() { return this.name }
  getSheets() { return [...this.sheets] }
  getSheetByName(名前) { return this.sheets.filter((s) => s.getName() === 名前)[0] ?? null }
  insertSheet(名前) { const s = new 偽のシート(名前); this.sheets.push(s); return s }
  deleteSheet(シート) { this.sheets = this.sheets.filter((s) => s !== シート) }
  setActiveSheet(シート) { this.activeSheet = シート }
  moveActiveSheet(位置) {
    this.sheets = this.sheets.filter((s) => s !== this.activeSheet)
    this.sheets.splice(位置 - 1, 0, this.activeSheet)
  }
  toast(文) { 画面.一言.push(String(文)) }
}

const 偽のUI = {
  createMenu() {
    const 組み立て = { addItem() { return 組み立て }, addToUi() { return 組み立て } }
    return 組み立て
  },
  showModalDialog(中身, 題) { 画面.ダイアログ.push({ 題, ファイル: 中身.ファイル }) },
  alert(文) { 画面.一覧に無い操作.push(`確認の画面（alert）: ${文}`) },
  prompt(文) { 画面.一覧に無い操作.push(`入力を求める画面（prompt）: ${文}`); return { getResponseText: () => '' } },
}

// ---- src を読む --------------------------------------------------------------

let 帳 = null

const 文脈 = vm.createContext({
  SpreadsheetApp: {
    ProtectionType: { SHEET: 'SHEET' },
    flush() {},
    getActive() { return 帳 },
    getUi() { return 偽のUI },
  },
  HtmlService: {
    createHtmlOutputFromFile(名前) {
      const 出力 = { ファイル: 名前, setWidth() { return 出力 }, setHeight() { return 出力 } }
      return 出力
    },
  },
  console: { log() {} },
})
for (const 相対 of 宣言.入力.実装) {
  vm.runInContext(読む(相対), 文脈, { filename: path.basename(相対) })
}
const 取り出す = (名前) => vm.runInContext(`({ ${名前.join(', ')} })`, 文脈)
const {
  menuItems, sheetLayout, gridLayouts, assignmentName, outputColumns, checkKind, isFixedNote, sectionWidth,
} = 取り出す([
  'menuItems', 'sheetLayout', 'gridLayouts', 'assignmentName', 'outputColumns', 'checkKind', 'isFixedNote', 'sectionWidth',
])

/** メニューを表示名で押す（→ menu.js の menuItems）。 */
function メニューを押す(表示名) {
  const 項目 = menuItems.filter((一つ) => 一つ.label === 表示名)[0]
  if (!項目) throw new Error(`メニューに「${表示名}」が無い（src/menu.js の menuItems）`)
  return 文脈[項目.functionName]()
}

// ---- 入力を置く --------------------------------------------------------------

const 一式 = 判定の入力(文脈)
const 回答の見出し = CSVの見出し()

function CSVの見出し() {
  return 読む(M2の宣言.入力.回答).replace(/^﻿/, '').split(/\r?\n/)[0].split(',')
}

/** 「2025-10-25 の 24 時」を、タイムスタンプと文字列で比べられる形（翌日の 00:00:00）にする。 */
function 境目の時刻(値) {
  const [, 日付, 時] = /^(\d{4}-\d{2}-\d{2}) の (\d{1,2}) 時$/.exec(値)
  const 時刻 = new Date(`${日付}T00:00:00Z`)
  時刻.setUTCHours(Number(時))
  return `${時刻.toISOString().slice(0, 10)} ${時刻.toISOString().slice(11, 19)}`
}

const 回答の範囲 = {
  '締切まで': (行) => String(行[0]) < 境目の時刻(境目.締切.値),
  '配布まで': (行) => String(行[0]) < 境目の時刻(境目.配布.値),
  '全行': () => true,
}

/** 条件入力の 6 区画を区画の位置に入れる（初回の前に済んでいるので数えない）。 */
function 条件入力を入れる() {
  const 条件入力 = sheetLayout.filter((一枚) => 一枚.name === '条件入力')[0]
  const シート = 帳.getSheetByName('条件入力')
  条件入力.sections.forEach((区画) => {
    const 行 = 一式.入力[区画.heading] ?? []
    if (行.length === 0) return
    シート.getRange(3, 区画.startColumn, 行.length, 区画.columns.length).setValues(行)
  })
}

/** 回答シートの下に、まだ積まれていない行を積む（入る側がフォームに答えたのに当たる）。 */
function 回答を積む(範囲) {
  const シート = 帳.getSheetByName('回答')
  const 積んである = Math.max(シート.getLastRow() - 1, 0)
  const 積む = 一式.入力.回答.filter(回答の範囲[範囲]).slice(積んである)
  積む.forEach((行, i) => シート.getRange(2 + 積んである + i, 1, 1, 行.length).setValues([行]))
  return 積む
}

/** 条件入力のセルを全部写す。周の前後で動けば、担当者が入れ直したことになる。 */
function 条件入力の写し() {
  return JSON.stringify([...帳.getSheetByName('条件入力').cells.entries()].sort())
}

// ---- マス目を読む ------------------------------------------------------------
// 行も列も位置で当てず、（学籍番号・見出しの時刻）で当てる（→ 宣言の「1 セルとは」）。

const マス目の構成 = gridLayouts(assignmentName)

function マス目を読む() {
  return マス目の構成.map((構成) => {
    const シート = 帳.getSheetByName(構成.name)
    const 幅 = sectionWidth(構成.sections[0])
    const 名前の列 = 構成.sections[0].columns.length
    const 見出し = シート.getRange(1, 1, 1, 幅).getValues()[0].map(String)
    const 最終行 = シート.getLastRow()
    const 値 = 最終行 > 1 ? シート.getRange(2, 1, 最終行 - 1, 幅).getValues() : []
    const メモ = 最終行 > 1 ? シート.getRange(2, 1, 最終行 - 1, 幅).getNotes() : []
    const セル = []
    値.forEach((一行, i) => {
      for (let c = 名前の列; c < 幅 && 見出し[c] !== ''; c++) {
        セル.push({
          シート: 構成.name, 学籍番号: String(一行[0]), 氏名: String(一行[1]), 時刻: 見出し[c],
          値: String(一行[c] ?? ''), メモ: String(メモ[i][c] ?? ''), 行: 2 + i, 列: c + 1,
        })
      }
    })
    return { シート: 構成.name, セル }
  })
}

const セルの鍵 = (セル) => `${セル.シート}|${セル.学籍番号}|${セル.時刻}`

// ---- 担当者の手 --------------------------------------------------------------

const 回す先 = { '会計': '呼び込み', '呼び込み': '列整理', '列整理': '会計' }

/** セル 1 つを書き換え、onEdit を 1 回走らせる（→ 宣言の「1 手とは」）。 */
function セルを書き換える(セル, 新しい値) {
  const シート = 帳.getSheetByName(セル.シート)
  const 範囲 = シート.getRange(セル.行, セル.列)
  範囲.setValues([[新しい値]])
  文脈.onEdit({ range: 範囲, source: 帳, value: 新しい値, oldValue: セル.値 })
}

/** 宣言の「手直しの選び方」で選ぶ。印の無い、役割の入ったセルだけに番号を振る。 */
function 手直しを選ぶ() {
  const 候補 = マス目を読む().flatMap((一枚) => 一枚.セル).filter((セル) => セル.値 !== '' && !isFixedNote(セル.メモ))
  const 選んだ = []
  候補.forEach((セル, 番号) => {
    if (番号 % 7 === 0) 選んだ.push({ セル, 新しい値: 回す先[セル.値] ?? セル.値 })
    else if (番号 % 11 === 0) 選んだ.push({ セル, 新しい値: '' })
  })
  return 選んだ
}

/**
 * 狙って置く手直し（→ 宣言）。締切後・配布前に出し直して希望が 00:00-00:00 になった人の、
 * その日のセルを 1 つ、書いてあるとおりに固定する。
 */
function 狙う手直しを選ぶ() {
  const 締切内 = 一式.入力.回答.filter(回答の範囲['締切まで'])
  const 再実行で届く = 一式.入力.回答.filter((行) => 回答の範囲['配布まで'](行) && !回答の範囲['締切まで'](行))
  const 出し直し = 再実行で届く.filter((行) => 締切内.some((前) => 前[1] === 行[1]))
  const マス目 = マス目を読む()
  for (const 行 of 出し直し) {
    const 前 = 締切内.filter((一行) => 一行[1] === 行[1]).slice(-1)[0]
    for (let 日 = 0; 日 < マス目.length; 日++) {
      if (前[6 + 日] === '00:00-00:00' || 行[6 + 日] !== '00:00-00:00') continue
      const セル = マス目[日].セル.filter((一つ) => 一つ.学籍番号 === 行[1] && 一つ.値 !== '')[0]
      if (セル) return { 選んだ: { セル, 新しい値: セル.値 }, 誰: `${行[2]}（${行[1]}）`, 日: マス目[日].シート }
    }
  }
  return { 選んだ: null, 出し直し: 出し直し.map((行) => `${行[2]}（${行[1]}）`) }
}

// ---- 周を通す ----------------------------------------------------------------

const 検証結果の列 = outputColumns('検証結果')
const 列の値 = (行, 名前) => 行[検証結果の列.indexOf(名前)]

function 周を通す(周, 番号) {
  const 見たもの = { 周, 手: [], 一覧に無い操作: [] }
  const 画面の前 = { ダイアログ: 画面.ダイアログ.length, 一覧に無い操作: 画面.一覧に無い操作.length }
  const 条件入力の前 = 条件入力の写し()
  const フォームを作った前 = 画面.フォームを作った ?? 0

  // 周のあいだ — 入る側が答える（数えない）。
  見たもの.届いた回答 = 回答を積む(周.回答)
  const 届いた人 = [...new Set(見たもの.届いた回答.map((行) => String(行[1]).toUpperCase()))]

  // 生成の前の印を写す（→ 戻ったセルの相手）。
  const 前の印 = マス目を読む().flatMap((一枚) => 一枚.セル).filter((セル) => isFixedNote(セル.メモ))

  // 7 — メニュー「生成」。
  const 始め = process.hrtime.bigint()
  メニューを押す('生成')
  見たもの.生成の秒 = Number(process.hrtime.bigint() - 始め) / 1e9
  見たもの.手.push('7 生成')
  見たもの.生成の一言 = 画面.一言[画面.一言.length - 1]

  const 検証結果 = 帳.getSheetByName('検証結果')
  const 検証結果の行 = 検証結果.getLastRow() > 1
    ? 検証結果.getRange(2, 1, 検証結果.getLastRow() - 1, 検証結果の列.length).getValues() : []
  見たもの.違反 = 検証結果の行.filter((行) => 列の値(行, '種別') === checkKind.violation).length
  見たもの.未充足 = 検証結果の行.filter((行) => 列の値(行, '種別') === checkKind.unmet).length
  const 食い違い = 検証結果の行.filter((行) => 列の値(行, '種別') === checkKind.fixConflict)
  見たもの.食い違い = 食い違い.length

  // 届いた回答の人が指標に出ているか（1 枠も置かれない人も 0 で並ぶ）。
  const 指標 = 帳.getSheetByName('指標')
  const 指標の人 = new Set(
    (指標.getLastRow() > 1 ? 指標.getRange(2, 1, 指標.getLastRow() - 1, 1).getValues() : []).map((行) => String(行[0])),
  )
  見たもの.出てこない人 = 届いた人.filter((人) => !指標の人.has(人))
  if (見たもの.出てこない人.length > 0) {
    見たもの.一覧に無い操作.push(`届いた回答を読ませ直す（生成の結果に出てこない: ${見たもの.出てこない人.join(' / ')}）`)
  }

  // 戻ったセル — 生成の前に印のあったセルを、後のマス目で（シート・学籍番号・時刻）で引く。
  const 後 = new Map(マス目を読む().flatMap((一枚) => 一枚.セル).map((セル) => [セルの鍵(セル), セル]))
  const 名指し = new Set(食い違い.map((行) => `${列の値(行, '日')}|${列の値(行, '開始')}|${列の値(行, '学籍番号')}`))
  const 日付 = 一式.入力['日ごとの営業時刻'].map((行) => 行[0])
  const シートの日付 = Object.fromEntries(マス目の構成.map((構成) => [構成.name, 日付[構成.grid.dayIndex]]))
  見たもの.印 = { 前: 前の印.length, 残った: 0, 名指し: [], 戻った: [] }
  for (const セル of 前の印) {
    const いま = 後.get(セルの鍵(セル))
    if (名指し.has(`${シートの日付[セル.シート]}|${セル.時刻}|${セル.学籍番号}`)) {
      見たもの.印.名指し.push({ セル, メモ: いま ? いま.メモ : '（行が無い）' })
      continue
    }
    const 理由 = !いま ? '行ごと消えた' : いま.値 !== セル.値 ? `値が「${セル.値 || '空'}」→「${いま.値 || '空'}」` : !isFixedNote(いま.メモ) ? '印が落ちた' : ''
    if (理由 === '') 見たもの.印.残った += 1
    else 見たもの.印.戻った.push({ セル, 理由 })
  }

  // 8 — その周の手直し。初回だけ狙う手直しを 1 つ足す。
  const 選んだ = 手直しを選ぶ()
  if (番号 === 0) {
    見たもの.狙い = 狙う手直しを選ぶ()
    if (見たもの.狙い.選んだ) 選んだ.push(見たもの.狙い.選んだ)
  }
  選んだ.forEach((一つ) => セルを書き換える(一つ.セル, 一つ.新しい値))
  見たもの.手直し = 選んだ.length
  見たもの.手.push(`8 手直し（${選んだ.length} セル）`)
  見たもの.書き換えた後の違反 = 画面.一言[画面.一言.length - 1]

  // 9 — メニュー「画像を書き出す」。ダイアログが描く中身を取りに来る（→ menu.js の exportImagesFromDialog）。
  メニューを押す('画像を書き出す')
  const 画像 = 文脈.exportImagesFromDialog()
  見たもの.手.push('9 画像を書き出す')
  見たもの.粒度 = 粒度を比べる(画像)

  // 一覧に無い操作 — 画面・条件入力・フォーム。
  const 開いた画面 = 画面.ダイアログ.slice(画面の前.ダイアログ)
  if (開いた画面.length !== 1) 見たもの.一覧に無い操作.push(`開いた画面が ${開いた画面.length} 枚（開いてよいのは「画像を書き出す」の 1 枚）`)
  画面.一覧に無い操作.slice(画面の前.一覧に無い操作).forEach((一つ) => 見たもの.一覧に無い操作.push(一つ))
  if (条件入力の写し() !== 条件入力の前) 見たもの.一覧に無い操作.push('条件入力が周の中で動いた（入れ直しに当たる）')
  if ((画面.フォームを作った ?? 0) !== フォームを作った前) 見たもの.一覧に無い操作.push('フォームを作り直した')
  if (見たもの.粒度.差分 > 0) 見たもの.一覧に無い操作.push('画像がこの周のマス目を描いていない（描き直す手が要る）')

  見たもの.手数 = 見たもの.手.length + 見たもの.一覧に無い操作.length
  return 見たもの
}

/** 画像の（名前・時刻・役割）といまのマス目を突き合わせる（→ 宣言の「画像の粒度」）。 */
function 粒度を比べる(画像) {
  const マス目 = マス目を読む()
  const 画像の組 = new Set()
  const マス目の組 = new Set()
  画像.forEach((一枚, 日) => {
    一枚.rows.forEach((一行) => 一行.cells.forEach((セル, i) => {
      if (セル.role !== '') 画像の組.add(`${日}|${一行.name}|${一枚.times[i]}|${セル.role}`)
    }))
  })
  マス目.forEach((一枚, 日) => 一枚.セル.forEach((セル) => {
    if (セル.値 !== '') マス目の組.add(`${日}|${セル.氏名}|${セル.時刻}|${セル.値}`)
  }))
  const 片方だけ = [...画像の組].filter((組) => !マス目の組.has(組)).concat([...マス目の組].filter((組) => !画像の組.has(組)))
  return {
    枚数: 画像.filter((一枚) => 一枚.rows.length > 0).length,
    画像のセル: 画像の組.size,
    マス目のセル: マス目の組.size,
    差分: 片方だけ.length,
    例: 片方だけ.slice(0, 5),
  }
}

// ---- 本文に載っているかを見る ------------------------------------------------

function 本文を見る() {
  const 文 = 読む(宣言.本文.ファイル)
  return 宣言.本文.数字.filter((数字) => 文.indexOf(数字) === -1)
}

// ---- 出す --------------------------------------------------------------------

function 主処理() {
  帳 = new 偽のスプレッドシート(['シート1'])
  文脈.buildTemplateInto(帳)
  条件入力を入れる()
  帳.getSheetByName('回答').getRange(1, 1, 1, 回答の見出し.length).setValues([回答の見出し])

  // フォームを作り直したかを数えるため、メニュー「フォームを作る」の関数を見張る。
  const フォームの関数 = menuItems.filter((一つ) => 一つ.label === 'フォームを作る')[0].functionName
  const もとの関数 = 文脈[フォームの関数]
  文脈[フォームの関数] = () => { 画面.フォームを作った = (画面.フォームを作った ?? 0) + 1; return もとの関数() }

  const 周たち = 宣言.周.並び.map((周, 番号) => 周を通す(周, 番号))
  const 初回 = 周たち[0]
  const 再実行 = 周たち.slice(1)

  console.log('M4 の判定 — 希望を足してもう一度通す操作が、初回の 7〜9 と同じ手数で回り、手直しのセルが戻らないか')
  console.log('')
  console.log('実装（判定の側で書き直さない。偽で置き換えるのは Google 側の器だけである）')
  console.log(`  ${宣言.入力.実装.map((相対) => path.basename(相対)).join(' / ')}`)
  for (const 偽 of 宣言.偽で置き換えるもの) console.log(`  ・${偽.何}: ${偽.なぜ偽でよいか}`)
  console.log('')
  console.log(`入力 — ${宣言.入力.回答と条件入力}`)
  console.log(`  外した人（終端 ≤ 始端）: ${一式.止まる人.join(' / ')}`)
  console.log(`  周の切り方: ${宣言.周.切り方}`)
  console.log('')
  console.log(`手直しの選び方 — ${宣言.手直しの選び方.決め}`)
  const 狙い = 初回.狙い
  if (狙い.選んだ) {
    console.log(`  狙って置く手直し: ${狙い.誰} の ${狙い.日} ${狙い.選んだ.セル.時刻}「${狙い.選んだ.セル.値}」を、書いてあるとおりに固定した`)
  } else {
    console.log(`  狙って置く手直し: 狙う先が無い（出し直した人: ${狙い.出し直し.join(' / ') || '無い'}）— 除く道を踏んでいない`)
  }
  console.log('')
  console.log('見ないもの')
  for (const 一つ of 宣言.見ないもの) console.log(`  ・${一つ.何}: ${一つ.どこが持つか}`)

  console.log('')
  console.log('周ごと')
  for (const 周 of 周たち) {
    const 人数 = new Set(一式.入力.回答.filter(回答の範囲[周.周.回答]).map((行) => 行[1])).size
    console.log(`  ■ ${周.周.名前}（${周.周.何に当たるか}）`)
    console.log(`      届いた回答 ${周.届いた回答.length} 行 → 回答シートは ${人数} 人ぶん ／ 生成 ${周.生成の秒.toFixed(3)} 秒`)
    console.log(`      生成の後: 違反 ${周.違反} ／ 未充足 ${周.未充足} ／ 食い違った固定 ${周.食い違い}`)
    console.log(`      生成の前の印 ${周.印.前} → 残った ${周.印.残った} ／ 名指しで返った ${周.印.名指し.length} ／ 戻った ${周.印.戻った.length}`)
    周.印.名指し.slice(0, 3).forEach(({ セル, メモ }) => {
      console.log(`        名指し: ${セル.シート} ${セル.時刻} ${セル.氏名}（${セル.学籍番号}）「${セル.値 || '空'}」— メモ: ${メモ}`)
    })
    周.印.戻った.slice(0, 10).forEach(({ セル, 理由 }) => {
      console.log(`        戻った: ${セル.シート} ${セル.時刻} ${セル.氏名}（${セル.学籍番号}）— ${理由}`)
    })
    console.log(`      手: ${周.手.join(' → ')}${周.一覧に無い操作.length === 0 ? '' : ` ＋ 一覧に無い操作 ${周.一覧に無い操作.length}`}`)
    周.一覧に無い操作.forEach((一つ) => console.log(`        一覧に無い: ${一つ}`))
    console.log(`      画像: ${周.粒度.枚数} 枚 ／ （名前・時刻・役割）画像 ${周.粒度.画像のセル} ・マス目 ${周.粒度.マス目のセル} ／ 差分 ${周.粒度.差分}`)
    周.粒度.例.forEach((一つ) => console.log(`        片方だけ: ${一つ}`))
  }

  const 手数の差 = 再実行.map((周) => 周.手数 - 初回.手数)
  const 戻った = 再実行.reduce((和, 周) => 和 + 周.印.戻った.length, 0)
  const 名指しで除いた = 再実行.reduce((和, 周) => 和 + 周.印.名指し.length, 0)
  const 粒度の差分 = 周たち.reduce((和, 周) => 和 + 周.粒度.差分, 0)
  const 違反 = 周たち.reduce((和, 周) => 和 + 周.違反, 0)
  const 狙いを除いた = !狙い.選んだ || 再実行[0].印.名指し.some(({ セル }) => セルの鍵(セル) === セルの鍵(狙い.選んだ.セル))

  console.log('')
  console.log('見張り（外れたら、戻ったセル 0 を信用しない）')
  console.log(`  ${違反 === 0 ? 'OK ' : 'NG '}  生成の後の違反 ${違反} 件（固定を優先して条件を破っていない → 5-3）`)
  console.log(`  ${狙い.選んだ && 狙いを除いた ? 'OK ' : 'NG '}  狙って置いた手直しが、再実行で名指しで返った（除く道を踏んだ）`)

  console.log('')
  console.log('本文（宣言が写した値が載っているかだけを見る。本文は解析しない）')
  const 欠け = 本文を見る()
  if (欠け.length === 0) console.log(`  OK   ${宣言.本文.数字.length} 句が ${宣言.本文.ファイル} に載っている`)
  else console.log(`  NG   ${宣言.本文.ファイル} に載っていない: ${欠け.join(' / ')}`)

  const 線 = 宣言.合格の線
  const 通った = 手数の差.every((差) => 差 === 線.手数の差) && 戻った === 線.戻ったセル && 粒度の差分 === 線.粒度の差分
    && 違反 === 0 && Boolean(狙い.選んだ) && 狙いを除いた && 欠け.length === 0

  if (!通った) {
    console.log('')
    console.log(`次に何を動かすか — ${宣言.線を外したら.この手が決めないこと}`)
    for (const 枝 of 宣言.線を外したら.分かれ道) {
      console.log(`  ・${枝.疑う先}: ${枝.どういうときか}`)
      console.log(`      先に見るもの: ${枝.先に見るもの}`)
      console.log(`      動かす先: ${枝.動かす先}`)
    }
  }

  console.log('')
  console.log(
    `結果: 手数の差 ${手数の差.join(' ／ ')}（初回 ${初回.手数} 手。合格の線 ${線.手数の差}）`
      + ` ／ 戻ったセル ${戻った}（合格の線 ${線.戻ったセル}。名指しで返して除いたもの ${名指しで除いた}）`
      + ` ／ 粒度の差分 ${粒度の差分}（合格の線 ${線.粒度の差分}）`
      + (欠け.length === 0 ? '' : ` ／ 本文に載っていない句 ${欠け.length}`),
  )
  return 通った ? 0 : 1
}

process.exit(主処理())
