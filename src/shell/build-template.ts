/**
 * テンプレートを 1 つ作る（docs/agent/tech-requirements.md 8 の 1）。
 *
 * 実装者が 1 回だけ走らせ、出来上がったスプレッドシートを担当者にコピーさせる。
 * 担当者のメニュー（menu.ts）には出さない。
 * すでにあるシートの見出しが構成と違えば、上書きせずに名指しで止まる。
 */

import { assignmentName, dividerColumn, dividerLine, formUrlBlock, formUrlBorder, gridLayouts, handoverBlock, protectionKind, sectionLastRow, sectionRightEdge, sectionWidth, sheetLayout, widthBaseColumn } from '../core/sheet-layout.ts'
import type { Layout } from '../core/sheet-layout.ts'
import type { Cell } from '../core/types.ts'
import type { Sheet, Spreadsheet } from './shell.ts'

/** Apps Script のエディタから手で走らせる入口。 */
export function buildTemplate(): string {
  const log = buildTemplateInto(SpreadsheetApp.getActive())
  console.log(log.join('\n'))
  return log.join('\n')
}

/**
 * sheetLayout どおりにシートを作り、見出しと条件入力の初期値を置き、8 枚に保護をかける。
 * 何度走らせても同じ形になる（足りないものだけ足す）。
 * 名前をコアの build と重ねない（Apps Script は .gs で 1 つのグローバルを共有する）。
 */
export function buildTemplateInto(spreadsheet: Spreadsheet): string[] {
  const log: string[] = []

  sheetLayout.forEach((layout, index) => {
    buildSheet(spreadsheet, layout, index, log)
  })

  removeDefaultSheet(spreadsheet, log)
  spreadsheet.setActiveSheet(spreadsheet.getSheetByName(sheetLayout[0].name) as Sheet)
  const countOf = (kind: string) => sheetLayout.filter((c) => c.protect && c.protect.kind === kind).length
  log.push(
    `${sheetLayout.length} 枚のうち保護したのは ${sheetLayout.filter((c) => c.protect).length} 枚である` +
      `（${protectionKind.warningOnly} ${countOf(protectionKind.warningOnly)} 枚 ／ ${protectionKind.ownerOnly} ${countOf(protectionKind.ownerOnly)} 枚。` +
      `割り当ては日ごとの ${gridLayouts(assignmentName).length} 枚）`,
  )
  return log
}

/**
 * 構成の 1 枚を作る（無ければ作り、見出し・初期値・幅・固定・並び・保護を置く）。
 * 来年用に空にするが「回答」を作り直すときにも使う（→ clear-for-next-year.ts）。
 */
export function buildSheet(spreadsheet: Spreadsheet, layout: Layout, index: number, log: string[]): Sheet {
  let sheet = spreadsheet.getSheetByName(layout.name)
  if (!sheet) {
    sheet = spreadsheet.insertSheet(layout.name)
    log.push(`シート「${layout.name}」を作った`)
  }
  widenTo(sheet, layout, log)
  putHeaders(sheet, layout, log)
  putInitialRows(sheet, layout, log)
  putFormUrlBlock(sheet, layout, log)
  putHandoverBlock(sheet, layout, log)
  shapeColumns(sheet, layout, log)
  sheet.setFrozenRows(layout.frozenRows)
  sheet.setFrozenColumns(layout.frozenColumns || 0)
  spreadsheet.setActiveSheet(sheet)
  spreadsheet.moveActiveSheet(index + 1)
  applyProtection(sheet, layout, log)
  return sheet
}

/**
 * 構成が要る列数まで、シートを広げる（新しいシートは 26 列だが、マス目は 51 列を取る）。
 * 減らさない（余分な列は構造の崩れではない）。
 */
function widenTo(sheet: Sheet, layout: Layout, log: string[]): void {
  const rightEdge = sectionRightEdge(layout)
  const missing = rightEdge - sheet.getMaxColumns()
  if (missing <= 0) return

  sheet.insertColumnsAfter(sheet.getMaxColumns(), missing)
  log.push(`「${layout.name}」を ${rightEdge} 列に広げた（${missing} 列足した）`)
}

/**
 * 区画ごとに、見出しの行と列名の行を置く。中身が違うときは上書きせずに止まる。
 * 「回答」の後ろ 4 列は空のままにする（題は今年の日付から出るので、フォームを作るときに埋まる → build-form.ts）。
 */
function putHeaders(sheet: Sheet, layout: Layout, log: string[]): void {
  const columnNameRow = layout.hasSectionHeadings ? 2 : 1

  layout.sections.forEach((section) => {
    if (layout.hasSectionHeadings) {
      replaceValues(sheet, 1, section.startColumn, [section.heading as string], layout.name, log)
      sheet
        .getRange(1, section.startColumn)
        .setFontWeight('bold')
        .setNote(section.note as string)
    }
    replaceValues(sheet, columnNameRow, section.startColumn, section.columns, layout.name, log)
    const headingRange = sheet.getRange(columnNameRow, section.startColumn, 1, section.columns.length)
    headingRange.setFontWeight('bold')
    if (!layout.hasSectionHeadings) {
      sheet.getRange(columnNameRow, section.startColumn).setNote(section.note as string)
    }
  })
}

/**
 * 区画ごとに、列名の下へ初期値を置く（→ sheet-layout.ts の initialRows ／ issue #240）。
 *
 * 置くのは、区画の入力欄（列名の下から最下行 — lastRow を持つ区画はそこ — まで・区画の幅）が空のときだけである。
 * 1 セルでも中身があれば、その区画には置かない — 誰かが書いた値を初期値で上書きしない。
 * 2 回目に走らせたときも同じで、1 回目に置いた初期値がそのまま残る。
 */
function putInitialRows(sheet: Sheet, layout: Layout, log: string[]): void {
  const firstInputRow = (layout.hasSectionHeadings ? 2 : 1) + 1

  layout.sections.forEach((section) => {
    if (!section.initialRows) return
    const width = sectionWidth(section)
    const lastRow = sectionLastRow(section, sheet.getMaxRows())
    const inputArea = sheet.getRange(firstInputRow, section.startColumn, lastRow - firstInputRow + 1, width)
    if (!inputArea.getValues().every((row) => row.every((cell) => cell === ''))) return

    sheet.getRange(firstInputRow, section.startColumn, section.initialRows.length, width).setValues(section.initialRows)
    log.push(`「${layout.name}」の「${section.heading}」に初期値を ${section.initialRows.length} 行置いた`)
  })
}

/**
 * 条件入力の 9〜10 行目に、フォームの URL 欄を置く（→ sheet-layout.ts の formUrlBlock ／ issue #255）。
 * 見出しは A:B、URL は C:E を結合し、A9:E10 を太枠で囲う。URL は空のまま置き、埋めるのはフォームを作るとき（→ build-form.ts）。
 * すでに入っている URL は消さない — フォームを作った後に走らせ直しても、URL が残る。
 * 見出しが構成と違えば、上書きせずに止まる（→ replaceValues）。
 */
function putFormUrlBlock(sheet: Sheet, layout: Layout, log: string[]): void {
  if (layout.name !== formUrlBlock.sheet) return
  const block = formUrlBlock

  block.rows.forEach((one, i) => {
    const row = block.row + i
    replaceValues(sheet, row, block.labelColumn, [one.label], layout.name, log)
    sheet.getRange(row, block.labelColumn, 1, block.labelWidth).merge().setFontWeight('bold')
    sheet.getRange(row, block.urlColumn, 1, block.urlWidth).merge()
  })
  sheet.getRange(block.row, block.labelColumn, block.rows.length, block.urlColumn + block.urlWidth - block.labelColumn).setBorder(true, true, true, true, null, null, formUrlBorder.color, SpreadsheetApp.BorderStyle[formUrlBorder.style])
}

/**
 * 条件入力の 13 行目に、引き継ぎ書の所在を置く（→ sheet-layout.ts の handoverBlock ／ issue #274）。
 * 見出しは A:B、URL は C:E を結合し、A13:E13 をフォームの URL 欄と同じ太枠で囲う。
 * URL は固定なので、見出しと一緒にここで置く。どちらも構成と違えば、上書きせずに止まる（→ replaceValues）。
 */
function putHandoverBlock(sheet: Sheet, layout: Layout, log: string[]): void {
  if (layout.name !== handoverBlock.sheet) return
  const block = handoverBlock

  replaceValues(sheet, block.row, block.labelColumn, [block.label], layout.name, log)
  replaceValues(sheet, block.row, block.urlColumn, [block.url], layout.name, log)
  sheet.getRange(block.row, block.labelColumn, 1, block.labelWidth).merge().setFontWeight('bold')
  sheet.getRange(block.row, block.urlColumn, 1, block.urlWidth).merge()
  sheet.getRange(block.row, block.labelColumn, 1, block.urlColumn + block.urlWidth - block.labelColumn).setBorder(true, true, true, true, null, null, formUrlBorder.color, SpreadsheetApp.BorderStyle[formUrlBorder.style])
}

/**
 * 区画ごとに、広く取る列（wideColumns）の幅を置き、境の線（dividerAfter）を見出しから最下行まで引く（→ issue #245）。
 * 幅は物差しの列（広げない列のうち一番右 → sheet-layout.ts の widthBaseColumn。マス目なら時刻の列、検証結果なら「あと何人」）の何倍かで決める
 * — 物差しの列を担当者が広げていれば、それに合わせて広がる。広げる列そのものは物差しにしない（作り直すたびに倍々に伸びる → issue #246）。
 * 線は生成のたびに引き直される（→ shell.ts の paintGrids）。ここで引くのは、まだ生成していないテンプレートにも出すためである。
 */
function shapeColumns(sheet: Sheet, layout: Layout, log: string[]): void {
  layout.sections.forEach((section) => {
    const wide = section.wideColumns || {}
    Object.keys(wide).forEach((name) => {
      const column = section.startColumn + section.columns.indexOf(name)
      const width = sheet.getColumnWidth(widthBaseColumn(section)) * wide[name]
      if (sheet.getColumnWidth(column) === width) return
      sheet.setColumnWidth(column, width)
      log.push(`「${layout.name}」の「${name}」を ${width} px に広げた`)
    })

    const divider = dividerColumn(section)
    if (divider === null) return
    sheet.getRange(1, divider, sheet.getMaxRows(), 1).setBorder(null, null, null, true, null, null, dividerLine.color, SpreadsheetApp.BorderStyle[dividerLine.style])
  })
}

/**
 * 空なら書く。同じなら何もしない。違うなら名指しで止まる。
 * 中身のあるセルが全部構成と同じで、空のセルがあるだけなら、空のセルを埋める（後から足した列 → issue #246）。
 */
function replaceValues(sheet: Sheet, row: number, startColumn: number, values: Cell[], sheetName: string, log: string[]): void {
  const range = sheet.getRange(row, startColumn, 1, values.length)
  const actual = range.getValues()[0].map((cell) => String(cell))
  const wanted = values.map((cell) => String(cell))

  if (actual.join('\t') === wanted.join('\t')) return
  if (actual.every((cell, i) => cell === '' || cell === wanted[i])) {
    range.setValues([wanted])
    log.push(`「${sheetName}」の ${row} 行目 ${startColumn} 列目から見出しを置いた`)
    return
  }
  throw new Error(`「${sheetName}」の ${row} 行目 ${startColumn} 列目が構成と違う。` + `いま: ${actual.join(' / ')} ／ 構成: ${wanted.join(' / ')}。` + '中身を見てから決める（黙って直さない）')
}

/**
 * シートに保護をかける。かけ方は構成が持つ 2 つのどちらか（→ sheet-layout.ts の protectionKind）。
 * 持ち主を締め出せる保護は無いので、誰も手で書かないシートは「警告のみ」にする（→ src/README.md）。
 * 「持ち主だけ」は編集者を全部外す（持ち主と、走らせている人は外れない）。
 */
export function applyProtection(sheet: Sheet, layout: Layout, log: string[]): void {
  sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach((existing) => {
    existing.remove()
  })

  if (!layout.protect) return

  const protection = sheet.protect().setDescription(layout.protect.note)
  if (layout.protect.kind === protectionKind.ownerOnly) {
    protection.removeEditors(protection.getEditors())
    if (protection.canDomainEdit()) protection.setDomainEdit(false)
  } else {
    protection.setWarningOnly(true)
  }
  if (layout.protect.openInputs) protection.setUnprotectedRanges(inputRanges(sheet, layout))
  log.push(`シート「${layout.name}」に保護をかけた（${layout.protect.kind}` + `${layout.protect.openInputs ? `。区画 ${layout.sections.length} つの入力欄は外した` : ''}）`)
}

/**
 * 保護の外に出す入力欄 — 区画ごとに、列名の行の下からシートの最下行（lastRow を持つ区画はそこ）まで、区画の幅だけである。
 * 見出し・列名・区画のあいだの列・右端より右は保護の内に残る（→ verify-structure.ts が見る所である）。
 * フォームの URL 欄（→ formUrlBlock）も保護の内に残る。書くのはスクリプトだけである（→ issue #255）。
 * 引き継ぎ書の所在（→ handoverBlock）も同じく保護の内に残る（→ issue #274）。
 * 最下行より下に行を足すと、足した行は保護の内になる（警告が出るだけで、書ける）。
 */
function inputRanges(sheet: Sheet, layout: Layout) {
  const firstInputRow = (layout.hasSectionHeadings ? 2 : 1) + 1
  return layout.sections.map((section) => sheet.getRange(firstInputRow, section.startColumn, sectionLastRow(section, sheet.getMaxRows()) - firstInputRow + 1, sectionWidth(section)))
}

/** 新しいスプレッドシートに最初からある空のシートを消す。中身があれば残して名指しする。 */
function removeDefaultSheet(spreadsheet: Spreadsheet, log: string[]): void {
  const layoutNames = sheetLayout.map((layout) => layout.name)

  spreadsheet.getSheets().forEach((sheet) => {
    const name = sheet.getName()
    if (layoutNames.indexOf(name) !== -1) return

    if (sheet.getLastRow() === 0 && sheet.getLastColumn() === 0) {
      spreadsheet.deleteSheet(sheet)
      log.push(`空のシート「${name}」を消した`)
      return
    }
    log.push(`構成に無いシート「${name}」に中身があるので、残した`)
  })
}
