#!/usr/bin/env node
// M1 ② の判定 — フォームを配ってから型が出てくるまでの経路に、担当者の手が入る箇所があるかを見る。
//
//   使い方: node scripts/M1②の判定.mjs
//   宣言:   scripts/M1②の宣言.json（合格の線も経路も数えないものも、あちらが持つ。このファイルに書かない）
//
// 数えるのは「変換の途中で人の手が入った箇所」1 つである。合格の線は 0 箇所
// （→ docs/tech-requirements.md 7 の M1 ②。メニューを押す操作と名簿の画像を選ぶ操作は入力なので数えない）。
//
// 実装は書き直さない。src/ の 13 ファイルをそのまま走らせて、経路を 1 本通す
// （書き直したもので通っても、M1 ② の答えにならない）。
// 偽で置き換えるのは Google 側の器だけである（FormApp ／ SpreadsheetApp ／ Utilities ／ HtmlService）。
// 本物の上で通るかは実機の記録が持つ（→ src/real-device-log.md の項目 10〜12）。
//
// 入力は「複製したフォーム」ではない。テンプレートのスクリプトが 4 の定義から作ったフォームの
// 回答スプレッドシートである（→ 6 の #6 ／ issue #148）。複製した場合とは、回答先の紐付けが
// 手作業で残るかどうかが変わる（→ 経路の段 4）。
//
// 何も書き換えない。読むだけである。人の手が 1 箇所でもあれば終了コード 1 で落ちる。

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const ここ = path.dirname(fileURLToPath(import.meta.url))
const 根 = path.dirname(ここ)
const 読む = (相対) => fs.readFileSync(path.join(根, 相対), 'utf8')

const 宣言 = JSON.parse(読む('scripts/M1②の宣言.json'))

// ---- 偽の器 ------------------------------------------------------------------
// Google がやることのうち、この経路が通るところだけを真似る。src/ の側は 1 行も書き直さない。

class 偽の範囲 {
  constructor(シート, 行, 列, 行数, 列数) {
    Object.assign(this, { シート, 行, 列, 行数, 列数 })
  }
  位置() {
    const 鍵 = []
    for (let r = this.行; r < this.行 + this.行数; r++) {
      for (let c = this.列; c < this.列 + this.列数; c++) 鍵.push(`${r},${c}`)
    }
    return 鍵
  }
  getValues() {
    const 表 = []
    for (let r = this.行; r < this.行 + this.行数; r++) {
      const 行 = []
      for (let c = this.列; c < this.列 + this.列数; c++) 行.push(this.シート.cells.get(`${r},${c}`) ?? '')
      表.push(行)
    }
    return 表
  }
  setValues(表) {
    表.forEach((行, i) => 行.forEach((値, j) => this.シート.cells.set(`${this.行 + i},${this.列 + j}`, 値)))
    return this
  }
  clearContent() {
    this.位置().forEach((鍵) => this.シート.cells.delete(鍵))
    return this
  }
  setFontWeight() { return this }
  setNote() { return this }
}

class 偽の保護 {
  constructor(シート) { Object.assign(this, { シート, description: null, warningOnly: false }) }
  setDescription(文) { this.description = 文; return this }
  setWarningOnly(値) { this.warningOnly = 値; return this }
  remove() { this.シート.protections = this.シート.protections.filter((p) => p !== this) }
}

let 次のシート番号 = 1

class 偽のシート {
  // 1000 行 26 列は、新しいスプレッドシートの既定の大きさである
  constructor(name) {
    Object.assign(this, {
      name, id: 次のシート番号++, cells: new Map(), protections: [], frozenRows: 0, frozenColumns: 0, formUrl: null,
      maxRows: 1000, maxColumns: 26,
    })
  }
  getName() { return this.name }
  setName(name) { this.name = name; return this }
  getSheetId() { return this.id }
  getRange(行, 列, 行数 = 1, 列数 = 1) { return new 偽の範囲(this, 行, 列, 行数, 列数) }
  setFrozenRows(数) { this.frozenRows = 数 }
  setFrozenColumns(数) { this.frozenColumns = 数 }
  insertColumnsAfter(後ろ, 数) { this.maxColumns = Math.max(this.maxColumns, 後ろ + 数) }
  getProtections() { return [...this.protections] }
  protect() { const p = new 偽の保護(this); this.protections.push(p); return p }
  getFormUrl() { return this.formUrl }
  getMaxRows() { return this.maxRows }
  getMaxColumns() { return this.maxColumns }
  getLastRow() { return [...this.cells.keys()].reduce((最大, 鍵) => Math.max(最大, Number(鍵.split(',')[0])), 0) }
  getLastColumn() { return [...this.cells.keys()].reduce((最大, 鍵) => Math.max(最大, Number(鍵.split(',')[1])), 0) }
}

class 偽のスプレッドシート {
  constructor(名前たち, id = 'this-spreadsheet') {
    Object.assign(this, { sheets: 名前たち.map((n) => new 偽のシート(n)), id, name: '学祭シフト' })
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
}

class 偽の検証の組み立て {
  constructor(種別) { this.built = { 種別 } }
  requireTextMatchesPattern(正規表現) { this.built.pattern = 正規表現; return this }
  setHelpText(文) { this.built.helpText = 文; return this }
  build() { return this.built }
}

class 偽の設問 {
  constructor(種別) { Object.assign(this, { 種別, title: null, required: false, helpText: null, validation: null }) }
  setTitle(題) { this.title = 題; return this }
  setRequired(必須) { this.required = 必須; return this }
  setHelpText(文) { this.helpText = 文; return this }
  setValidation(検証) { this.validation = 検証; return this }
  setChoiceValues(選択肢) { this.choices = 選択肢; return this }
  setImage(画像) { this.image = 画像; return this }
}

class 偽のフォーム {
  constructor(題, 帳簿) { Object.assign(this, { title: 題, items: [], destination: null, 帳簿 }) }
  置く(種別) { const 設問 = new 偽の設問(種別); this.items.push(設問); return 設問 }
  addTextItem() { return this.置く('text') }
  addParagraphTextItem() { return this.置く('paragraph') }
  addMultipleChoiceItem() { return this.置く('radio') }
  addImageItem() { return this.置く('image') }
  getPublishedUrl() { return 'https://forms.example/viewform' }
  getEditUrl() { return 'https://forms.example/edit' }
  // 本物と同じように、回答先のスプレッドシートに回答シートを 1 枚作る
  //（名前は Google が決める「フォームの回答 1」、見出しはタイムスタンプ ＋ 設問の題である）。
  setDestination(種別, id) {
    this.destination = { 種別, id }
    const 帳簿 = this.帳簿[id]
    if (!帳簿) throw new Error(`偽のフォーム: 回答先 ${id} が無い`)
    const シート = 帳簿.insertSheet('フォームの回答 1')
    const 見出し = ['タイムスタンプ'].concat(
      this.items.filter((設問) => 設問.種別 !== 'image').map((設問) => 設問.title),
    )
    シート.getRange(1, 1, 1, 見出し.length).setValues([見出し])
    シート.formUrl = this.getPublishedUrl()
    return this
  }
}

// ---- 担当者に向いた口を見張る ------------------------------------------------
// 開いてよい画面は 1 枚だけである（→ 宣言の「画面の枚数」）。ほかに担当者へ聞く口が開いたら、
// それは 2 の一覧に無い操作である。

const 画面 = { ダイアログ: [], メニュー: [], 一覧に無い操作: [] }

const 偽のUI = {
  createMenu(名前) {
    const 項目 = []
    画面.メニュー.push({ 名前, 項目 })
    const 組み立て = {
      addItem(表示名, 関数名) { 項目.push({ 表示名, 関数名 }); return 組み立て },
      addToUi() { return 組み立て },
    }
    return 組み立て
  },
  showModalDialog(画面の中身, 題) { 画面.ダイアログ.push({ 題, ファイル: 画面の中身.ファイル }) },
  alert(文) { 画面.一覧に無い操作.push(`確認の画面（alert）: ${文}`) },
  prompt(文) { 画面.一覧に無い操作.push(`入力を求める画面（prompt）: ${文}`); return { getResponseText: () => '' } },
}

// ---- src を読む --------------------------------------------------------------

const 帳簿 = {}
const 作られたフォーム = []

const 文脈 = vm.createContext({
  SpreadsheetApp: {
    ProtectionType: { SHEET: 'SHEET' },
    flush() {},
    getActive() { return 帳簿['this-spreadsheet'] },
    getUi() { return 偽のUI },
  },
  FormApp: {
    DestinationType: { SPREADSHEET: 'SPREADSHEET' },
    create(題) { const f = new 偽のフォーム(題, 帳簿); 作られたフォーム.push(f); return f },
    createTextValidation() { return new 偽の検証の組み立て('text') },
    createParagraphTextValidation() { return new 偽の検証の組み立て('paragraph') },
  },
  HtmlService: {
    createHtmlOutputFromFile(名前) {
      const 出力 = { ファイル: 名前, setWidth() { return 出力 }, setHeight() { return 出力 } }
      return 出力
    },
  },
  Utilities: {
    base64Decode(base64) { return [...base64].map((c) => c.charCodeAt(0)) },
    newBlob(中身, mimeType, fileName) { return { 中身, mimeType, fileName } },
  },
  console: { log() {} },
})
for (const 相対 of 宣言.入力.src) {
  vm.runInContext(読む(相対), 文脈, { filename: path.basename(相対) })
}
const { onOpen, createForm, createFormFromPicker, buildTemplateInto, run } = 文脈
const { menuItems, sheetLayout } = vm.runInContext('({ menuItems, sheetLayout })', 文脈)

// ---- 入力を置く --------------------------------------------------------------

/** 引用符の中のコンマを割らないだけの CSV の読み。友達欄が引用符付きで入っている。 */
function CSVを読む(文) {
  return 文.replace(/^﻿/, '').trim().split(/\r?\n/).map((行) => {
    const セル = []
    let いま = ''
    let 引用符の中 = false
    for (const 文字 of 行) {
      if (文字 === '"') 引用符の中 = !引用符の中
      else if (文字 === ',' && !引用符の中) { セル.push(いま); いま = '' }
      else いま += 文字
    }
    セル.push(いま)
    return セル
  })
}

/**
 * モックの 1 行を、回答シートに貼った形にする。
 * 直すのはタイムスタンプの置き方だけである — 回答シートに貼れば日時のセルになる
 *（→ src/real-device-log.md の項目 8）ので、日時そのものを置く。値は 1 つも書き換えない。
 */
function 回答シートに貼る形(行) {
  const [年, 月, 日] = 行[0].split(' ')[0].split('/').map(Number)
  const [時, 分, 秒] = 行[0].split(' ')[1].split(':').map(Number)
  return [new Date(年, 月 - 1, 日, 時, 分, 秒)].concat(行.slice(1))
}

const モックの表 = CSVを読む(読む(宣言.入力.回答))
const モックの見出し = モックの表[0]
const モックの行 = モックの表.slice(1).map(回答シートに貼る形)

/** 条件入力の「日ごとの営業時刻」に入れる 4 行（→ 宣言の「入力」）。始まりの 4 つは営業開始である。 */
function 営業時刻の行() {
  return Object.entries(宣言.入力.条件入力.日ごとの営業時刻).map(([日, [開始, 終了]]) => (
    [日, 開始, 開始, 開始, 開始, 終了]
  ))
}

// ---- 経路を 1 本通す ---------------------------------------------------------

const 見たもの = { 止まった: [] }

function 経路を通す() {
  // テンプレートをコピーした直後の形にする（→ 2 の一覧 1）。
  const 帳 = new 偽のスプレッドシート(['シート1'])
  帳簿['this-spreadsheet'] = 帳
  buildTemplateInto(帳)

  // 2 の一覧 5 の入力 — フォームを作る前に「日ごとの営業時刻」を入れる（数えない → 宣言）。
  const 条件 = 帳.getSheetByName('条件入力')
  営業時刻の行().forEach((行, i) => 条件.getRange(3 + i, 1, 1, 行.length).setValues([行]))

  // 段 1 — 担当者が開くとメニューが出る。押すと名簿の画像を選ぶ画面が開く。
  try {
    onOpen()
    createForm()
  } catch (どこが) { 見たもの.止まった.push({ 段: 'メニューを押す', 文: String(どこが.message) }) }

  // 段 2〜5 — 画面が呼ぶのと同じ入口に、選んだ画像だけを渡す
  //（本物でもここを呼んだ → src/real-device-log.md の項目 12）。
  try {
    見たもの.作った = createFormFromPicker({ base64: 'abc', mimeType: 'image/png', fileName: '調理名簿.png' })
  } catch (どこが) { 見たもの.止まった.push({ 段: 'フォームを作る', 文: String(どこが.message) }) }

  見たもの.フォーム = 作られたフォーム[作られたフォーム.length - 1] ?? null
  見たもの.回答シート = 帳.getSheetByName('回答')
  見たもの.シートの並び = 帳.getSheets().map((s) => s.getName())

  // 段 6 — 入る側が送った回答が積まれる。判定では、モックの 50 行を貼るのがここに当たる（→ 宣言）。
  if (見たもの.回答シート) {
    見たもの.回答シートの見出し = 見たもの.回答シート.getRange(1, 1, 1, モックの見出し.length).getValues()[0]
    モックの行.forEach((行, i) => 見たもの.回答シート.getRange(2 + i, 1, 1, 行.length).setValues([行]))
  }

  // 段 7〜10 — 殻の 1 本（構造を照らす → 読む → コアを呼ぶ → 書く）をそのまま走らせる。
  // 取り込んだ型は、「展開する」の段に差し替えを渡して受け取る（→ core.js の build）。
  // 差し替えるのは、数えるのが「型 #6 が出てくるまで」だからである — 展開の中身は #149 が持つ。
  try {
    見たもの.notBuilt = run(帳, {
      '展開する': (希望) => { 見たもの.希望 = 希望; return [] },
    })
    見たもの.回答の行 = 文脈.readInputs(帳)['回答']
  } catch (どこが) { 見たもの.止まった.push({ 段: '回答シートを読む', 文: String(どこが.message) }) }

  見たもの.帳 = 帳
}

// ---- 段ごとに、人の手が入ったかを見る ----------------------------------------
// 返すのは { 運べた, 見たもの } である。運べなかった段が、そのまま「人の手が入った箇所」になる。

const 型に乗る項目 = ['answers', 'canCook', 'grade', 'studentId']

/**
 * 注釈を落とす（→ 宣言の「外に出す口」の探し方）。注釈に出てくる名前は呼び出しではない。
 * src/ の 13 ファイルに `://` は 1 つも無いので、// をそのまま注釈の始まりとして読める。
 */
function 注釈を落とす(中身) {
  return 中身.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

const 段の見方 = {
  'メニューを押す': () => {
    const メニュー = 画面.メニュー[0]
    const 押す先 = (メニュー?.項目 ?? []).filter((項目) => 項目.表示名 === menuItems[0].label)[0]
    const 開いた画面 = 画面.ダイアログ
    return {
      運べた: Boolean(押す先) && 開いた画面.length === 宣言.数え方.画面の枚数['この経路で開いてよい画面'],
      見たもの: `メニュー「${メニュー?.名前 ?? '無い'}」の「${押す先?.表示名 ?? '無い'}」→ ${押す先?.関数名 ?? '無い'}`
        + ` ／ 開いた画面 ${開いた画面.length} 枚（${開いた画面.map((一枚) => `${一枚.題}: ${一枚.ファイル}.html`).join(' / ') || '無い'}）`,
    }
  },

  '名簿の画像を選ぶ': () => {
    const 画像の設問 = (見たもの.フォーム?.items ?? []).filter((設問) => 設問.種別 === 'image')
    const 入った = 画像の設問.length === 1 && 画像の設問[0].image?.fileName === '調理名簿.png'
    return {
      運べた: 入った,
      見たもの: 入った
        ? `選んだ画像がそのまま画像アイテム「${画像の設問[0].title}」に入った（渡したのは画像 1 つだけである）`
        : `画像アイテムに入っていない（画像アイテム ${画像の設問.length} つ）`,
    }
  },

  'フォームを作る': () => {
    const 設問 = (見たもの.フォーム?.items ?? []).filter((一つ) => 一つ.種別 !== 'image')
    const 日付の入った題 = 設問.filter((一つ) => /^\d{1,2}月\d{1,2}日\(/.test(一つ.title))
    return {
      運べた: 設問.length === 9 && 日付の入った題.length === 4 && 見たもの.止まった.length === 0,
      見たもの: `スクリプトが設問 ${設問.length} つと画像アイテム 1 つを置いた`
        + `（題に今年の日付が入ったのは ${日付の入った題.length} つ: ${日付の入った題.map((一つ) => 一つ.title).join(' / ')}）`,
    }
  },

  '回答先を向ける': () => {
    const 向き先 = 見たもの.フォーム?.destination
    const 自分自身 = 向き先?.id === 見たもの.帳?.getId()
    const 紐付き = Boolean(見たもの.回答シート?.getFormUrl())
    return {
      運べた: 自分自身 && 紐付き,
      見たもの: 自分自身
        ? `回答先はこのスプレッドシート自身（${向き先.id}）で、回答シートに紐付きが付いている（${見たもの.回答シート.getFormUrl()}）`
        : `回答先が向いていない（いま: ${向き先?.id ?? '無い'}）`,
    }
  },

  '回答シートを構成に繋ぐ': () => {
    const 構成の並び = sheetLayout.map((一枚) => 一枚.name)
    const 見出し = 見たもの.回答シートの見出し ?? []
    const 並びが同じ = JSON.stringify(見たもの.シートの並び) === JSON.stringify(構成の並び)
    const 見出しが同じ = JSON.stringify(見出し) === JSON.stringify(モックの見出し)
    return {
      運べた: 並びが同じ && 見出しが同じ,
      見たもの: `シートは ${見たもの.シートの並び?.length} 枚（${見たもの.シートの並び?.join(' / ')}）`
        + ` ／ 見出し ${見出し.length} 列が ${path.basename(宣言.入力.回答)} の見出しと`
        + `${見出しが同じ ? '同じである（貼るときに並べ替える手が要らない）' : '違う'}`,
    }
  },

  '回答が積まれる': () => {
    const 同じ1枚 = 見たもの.回答シート === 見たもの.帳?.getSheetByName('回答')
    const 見つけた口 = []
    for (const 相対 of 宣言.入力.src) {
      const 中身 = 注釈を落とす(読む(相対))
      for (const 言葉 of 宣言.外に出す口.探す言葉) {
        if (中身.indexOf(言葉) !== -1) 見つけた口.push(`${path.basename(相対)} の ${言葉}`)
      }
    }
    return {
      運べた: 同じ1枚 && 見つけた口.length === 0,
      見たもの: `取り込みが読むシートと、フォームが作ったシートが${同じ1枚 ? '同じ 1 枚である' : '別物である'}`
        + ` ／ 外に出す口 ${見つけた口.length} 個（探した言葉: ${宣言.外に出す口.探す言葉.join(' / ')}）`
        + (見つけた口.length === 0 ? '' : `: ${見つけた口.join(' / ')}`),
    }
  },

  '構造を照らす': () => {
    const 崩れ = 文脈.nameBreakages(見たもの.帳)
    return {
      運べた: 崩れ.length === 0,
      見たもの: `崩れ ${崩れ.length} 箇所（シートの有無・見出し・列数を照らした）`,
    }
  },

  '回答シートを読む': () => {
    const 行 = 見たもの.回答の行 ?? []
    const 列数 = [...new Set(行.map((一行) => 一行.length))]
    return {
      運べた: 行.length === モックの行.length && 列数.length === 1 && 列数[0] === モックの見出し.length,
      見たもの: `貼った ${モックの行.length} 行が ${行.length} 行 ／ 列は ${列数.join(' と ')} 列で読めた`,
    }
  },

  '値の表現を揃える': () => {
    const 行 = 見たもの.回答の行 ?? []
    const 揃っていない = []
    行.forEach((一行, i) => 一行.forEach((セル, j) => {
      if (typeof セル !== 'string' && typeof セル !== 'number') 揃っていない.push(`${i + 2} 行目 ${j + 1} 列目`)
    }))
    const 日時 = 行.map((一行) => 一行[0])
    const 日時でない = 日時.filter((値) => !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(値)))
    return {
      運べた: 揃っていない.length === 0 && 日時でない.length === 0 && (見たもの.notBuilt ?? null) !== null,
      見たもの: `日時のセル ${日時.length} 個が YYYY-MM-DD HH:MM:SS になり（例: ${日時[0]}）、`
        + `コアの入口（表現の検査）を止まらずに通った`,
    }
  },

  '1 人 1 件に畳んで型にする': () => {
    const 希望 = 見たもの.希望 ?? null
    const 学籍番号 = (希望 ?? []).map((一件) => 一件.studentId)
    const 重複 = 学籍番号.length - new Set(学籍番号).size
    const 項目 = [...new Set((希望 ?? []).flatMap((一件) => Object.keys(一件)))].sort()
    return {
      運べた: Boolean(希望) && 重複 === 0 && JSON.stringify(項目) === JSON.stringify(型に乗る項目),
      見たもの: 希望
        ? `全 ${モックの行.length} 行が ${希望.length} 件になり、学籍番号の重複 ${重複} ／ 乗った項目は ${項目.join(' / ')}`
        : '取り込んだ型が下流へ渡っていない',
    }
  },
}

// ---- 本文に載っているかを見る ------------------------------------------------

/** 宣言が本文から写した値が、いまも本文に載っているか。載っているかだけを見る。本文は解析しない。 */
function 本文を見る() {
  const 文 = 読む(宣言.本文.ファイル)
  return 宣言.本文.数字.filter((数字) => 文.indexOf(数字) === -1)
}

// ---- 出す --------------------------------------------------------------------

function 主処理() {
  経路を通す()

  console.log('M1 ② の判定 — フォームを配ってから型が出てくるまでに、担当者の手が入る箇所があるか')
  console.log('')
  console.log('実装（判定の側で書き直さない。偽で置き換えるのは Google 側の器だけである）')
  console.log(`  ${宣言.入力.src.map((相対) => path.basename(相対)).join(' / ')}`)
  for (const 偽 of 宣言.偽で置き換えるもの) {
    console.log(`  ・${偽.何}: ${偽.なぜ偽でよいか}`)
    console.log(`      本物で見たのはどこか: ${偽.本物で見たのはどこか}`)
  }
  console.log('')
  console.log('入力')
  console.log(`  ・回答: ${宣言.入力.回答} — ${宣言.入力.回答をどう置くか}`)
  console.log(`  ・条件入力の「日ごとの営業時刻」: ${宣言.入力.条件入力.なぜ要るか}`)
  console.log(`      ${宣言.入力.条件入力.なぜ前回の値か}`)
  console.log('')
  console.log(`数え方 — ${宣言.数え方['1 箇所とは']}`)
  console.log(`  ${宣言.数え方.なぜ段で数えるか}`)
  console.log('')
  console.log('数えないもの')
  for (const 一つ of 宣言.数えないもの) console.log(`  ・${一つ.何}: ${一つ.なぜ}`)
  console.log('')
  console.log('見ない項目')
  for (const 一つ of 宣言.見ない項目) console.log(`  ・${一つ.項目}: ${一つ.なぜ見ないか}`)

  console.log('')
  console.log('経路の段（フォームを配ってから型が出てくるまで）')
  const 人の手 = []
  for (const 段 of 宣言.経路の段) {
    const 見方 = 段の見方[段.鍵]
    if (!見方) throw new Error(`経路の段「${段.鍵}」の見方が無い（宣言と判定が食い違っている）`)
    const 結果 = 見方()
    if (!結果.運べた) 人の手.push({ 段, 結果 })
    console.log(`  ${結果.運べた ? 'OK ' : 'NG '}  ${段.番号}. ${段.鍵}（${段.誰の手か}）`)
    console.log(`        ${結果.見たもの}`)
  }

  console.log('')
  console.log('担当者の操作（2「担当者がやることの全部」の一覧に無い操作が出ていないか）')
  const 一覧に無い操作 = 画面.一覧に無い操作.concat(
    画面.ダイアログ.slice(宣言.数え方.画面の枚数['この経路で開いてよい画面']).map((一枚) => `一覧に無い画面: ${一枚.題}`),
  )
  console.log(`  一覧にある操作: ${宣言.数え方.一覧にある操作.join(' ／ ')}`)
  if (一覧に無い操作.length === 0) console.log('  一覧に無い操作: 0 件')
  else for (const 操作 of 一覧に無い操作) console.log(`  ・${操作}`)

  console.log('')
  console.log('経路に残る未了の段（「まだ作っていない」は人の手ではない → 宣言の「数えないもの」）')
  for (const 段 of 見たもの.notBuilt ?? []) {
    console.log(`  ・${段.name}（issue #${段.issue}）— ${段.whatItDoes}`)
  }

  console.log('')
  console.log('本文（宣言が写した値が載っているかだけを見る。本文は解析しない）')
  const 欠け = 本文を見る()
  if (欠け.length === 0) console.log(`  OK   ${宣言.本文.数字.join(' / ')} は ${宣言.本文.ファイル} に載っている`)
  else console.log(`  NG   ${宣言.本文.ファイル} に載っていない: ${欠け.join(' / ')}`)

  if (見たもの.止まった.length > 0) {
    console.log('')
    console.log('止まったところ（止まった先は担当者の手になる）')
    for (const 一件 of 見たもの.止まった) console.log(`  ・${一件.段}: ${一件.文}`)
  }

  if (人の手.length > 0) {
    console.log('')
    console.log(`人の手が入った箇所（${人の手.length} 箇所）`)
    for (const { 段, 結果 } of 人の手) {
      console.log(`  ・${段.番号}. ${段.鍵}`)
      console.log(`      どういう形か: ${段.人の手が入る形}`)
      console.log(`      確かめること: ${段.確かめること}`)
      console.log(`      いま: ${結果.見たもの}`)
    }
    console.log('')
    console.log(`次に何を動かすか — ${宣言.人の手が出たら.この手が決めないこと}`)
    for (const 枝 of 宣言.人の手が出たら.分かれ道) {
      console.log(`  ・${枝.疑う先}: ${枝.どういうときか}`)
      console.log(`      先に見るもの: ${枝.先に見るもの}`)
      console.log(`      動かす先: ${枝.動かす先}`)
    }
  }

  console.log('')
  const 通った = 人の手.length === 宣言.合格の線.人の手が入った箇所
    && 一覧に無い操作.length === 宣言.合格の線.一覧に無い操作
    && 欠け.length === 0
  console.log(
    `結果: 人の手が入った箇所 ${人の手.length}（合格の線 ${宣言.合格の線.人の手が入った箇所} 箇所 ／ 見た段 ${宣言.経路の段.length}）`
      + ` ／ 一覧に無い操作 ${一覧に無い操作.length} 件（合格の線 ${宣言.合格の線.一覧に無い操作} 件）`
      + (欠け.length === 0 ? '' : ` ／ 本文に載っていない値 ${欠け.length} 件`),
  )
  return 通った ? 0 : 1
}

process.exit(主処理())
