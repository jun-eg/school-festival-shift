/**
 * 使い終わったファイルのコピーを、来年の担当者に渡せる形に戻す（→ issue #290 ／ ADR tech-requirements-0018）。
 *
 * 引き継ぎの予備である。本線は README の /copy リンクからテンプレートをコピーする形で、ここは通らない。
 * 押すのは前年の担当者で、自分のファイルを「ファイル → コピーを作成」したコピーの上で押す。
 *
 * やることは 4 つで、条件入力の値は残す（そのまま来年の初期値になる → ADR tech-requirements-0015）。
 *   ① 回答シートとフォームの紐付けを外す（コピーで黙って複製されたフォームである → issue #260）
 *   ② 回答の行を消す（氏名・学籍番号を来年に渡さない）
 *   ③ 割り当て 4 枚・検証結果・指標を、テンプレートの形に戻す
 *   ④ 条件入力の 9〜10 行目（フォームの URL → issue #255）を空にする
 * 複製されたフォームそのものはゴミ箱に移さない。消すにはドライブのスコープが要るので、担当者の手でやる。
 */

import {
  assignmentName, dividerColumn, dividerLine, formUrlBlock, gridLayouts, sectionWidth,
} from '../core/sheet-layout.ts'
import { findLayout, findSheet, headerRowCount, seenGridKey } from './shell.ts'
import type { Sheet, Spreadsheet } from './shell.ts'
import type { Layout } from '../core/sheet-layout.ts'

/** 空にした結果。formUrl はフォームに紐付いていたときだけ入る。 */
export type Cleared = { formUrl: string | null, log: string[] }

/** 押したときに出す確認。元のファイルで押すと、今年の回答が消える。 */
export const clearConfirmText = 'このファイルの回答・シフト表・検証結果・指標を消し、フォームとの紐付けを外します。'
  + '条件入力の値は残ります。\n\n'
  + '元のファイルではなく、「ファイル → コピーを作成」で作ったコピーで押していますか？'

/** メニュー「来年用に空にする」の入口。確かめてから空にし、複製されたフォームの後始末を伝える。 */
export function clearForNextYear(): void {
  const ui = SpreadsheetApp.getUi()
  if (ui.alert('来年用に空にする', clearConfirmText, ui.ButtonSet.YES_NO) !== ui.Button.YES) return

  const cleared = clearForNextYearOn(SpreadsheetApp.getActive())
  console.log(cleared.log.join('\n'))
  ui.alert('来年用に空にしました', clearedText(cleared.formUrl), ui.ButtonSet.OK)
}

/** 空にした後に伝える文。紐付いていたフォームがあれば、ゴミ箱に移すよう名指しする。 */
export function clearedText(formUrl: string | null): string {
  const handover = '次の担当者には、このファイルを渡してください（受け取った人はコピーして使います）。'
  if (!formUrl) return handover
  return 'このコピーと一緒に複製されたフォームの紐付けを外しました。'
    + 'そのフォームは使わないので、Google ドライブでゴミ箱に移してください。\n'
    + `${formUrl}\n\n`
    + handover
}

/**
 * 空にする本体。返すのは外したフォームの URL（紐付いていなければ null）と、やったことの記録である。
 * 紐付けを先に外す — ここで止まれば、まだ何も消していない。
 */
export function clearForNextYearOn(spreadsheet: Spreadsheet): Cleared {
  const log: string[] = []
  const formUrl = unlinkAnswerForm(spreadsheet, log)
  clearAnswers(spreadsheet, log)
  gridLayouts(assignmentName).forEach((layout) => clearGrid(findSheet(spreadsheet, layout.name), layout, log))
  ;['検証結果', '指標'].forEach((name) => clearOutput(spreadsheet, findLayout(name), log))
  clearFormUrls(spreadsheet, log)
  return { formUrl: formUrl, log: log }
}

/**
 * 回答シートに紐付いたフォームから、回答先を外す（スコープは forms のままで足りる）。
 * フォームが開けないとき（もうゴミ箱にある・持ち主でない）は、手で外す場所を名指しして止まる。
 */
function unlinkAnswerForm(spreadsheet: Spreadsheet, log: string[]): string | null {
  const sheet = findSheet(spreadsheet, findLayout('回答').name)
  const formUrl = sheet.getFormUrl()
  if (!formUrl) {
    log.push('「回答」はフォームに紐付いていなかった')
    return null
  }

  let form: GoogleAppsScript.Forms.Form
  try {
    form = FormApp.openByUrl(formUrl)
  } catch (error) {
    throw new Error(
      `「回答」シートに紐付いたフォームを開けませんでした（${formUrl}）。`
        + '「回答」タブの ▼ →「フォームのリンクを解除」を押してから、もう一度「来年用に空にする」を押してください',
    )
  }
  form.removeDestination()
  SpreadsheetApp.flush()
  log.push(`「回答」とフォームの紐付けを外した（${formUrl}）`)
  return formUrl
}

/**
 * 回答の行を消し、毎年名前が変わる後ろ 4 列の見出し（今年の日付の題）も空ける — テンプレートと同じ形に戻す。
 * 頭 6 列の見出しは残す。来年「フォームを作る」を押すと、このシートはフォームが作るシートに置き換わる（→ build-form.ts）。
 */
function clearAnswers(spreadsheet: Spreadsheet, log: string[]): void {
  const layout = findLayout('回答')
  const sheet = findSheet(spreadsheet, layout.name)
  const section = layout.sections[0]
  const headerRows = headerRowCount(layout)
  const width = Math.max(sectionWidth(section), sheet.getLastColumn())
  const lastRow = sheet.getLastRow()

  if (lastRow > headerRows) {
    sheet.getRange(headerRows + 1, 1, lastRow - headerRows, width).clearContent()
  }
  sheet.getRange(1, section.startColumn + section.columns.length, 1, width - section.columns.length).clearContent()
  log.push(`「${layout.name}」の回答を ${Math.max(lastRow - headerRows, 0)} 行消した`)
}

/**
 * マス目 1 枚を、テンプレートの形に戻す — 時刻の見出し・人の行・手直しの印（メモ）・色・氏名のプルダウン・前に見たマス目の控え。
 * 友達欄と時刻の列の境の線は、色と一緒に消えるので引き直す（→ build-template.ts の shapeColumns）。
 */
function clearGrid(sheet: Sheet, layout: Layout, log: string[]): void {
  const section = layout.sections[0]
  const namedCount = section.columns.length
  const width = sectionWidth(section)
  const headerRows = headerRowCount(layout)
  const maxRows = sheet.getMaxRows()
  const people = Math.max(sheet.getLastRow() - headerRows, 0)

  sheet.getRange(1, namedCount + 1, 1, width - namedCount).clearContent()
  if (maxRows > headerRows) {
    const body = sheet.getRange(headerRows + 1, 1, maxRows - headerRows, width)
    body.clearContent()
    body.clearNote()
    body.clearFormat()
    body.clearDataValidations()
    const divider = dividerColumn(section)
    if (divider !== null) {
      sheet.getRange(headerRows + 1, divider, maxRows - headerRows, 1)
        .setBorder(null, null, null, true, null, null, dividerLine.color, SpreadsheetApp.BorderStyle[dividerLine.style])
    }
  }
  sheet.getDeveloperMetadata()
    .filter((one) => one.getKey() === seenGridKey)
    .forEach((one) => one.remove())
  log.push(`「${layout.name}」を空にした（${people} 行）`)
}

/**
 * 検証結果・指標の行を消す。行の背景（検証結果の赤・水色・黄色 → shell.ts の paintCheckResults）も下の端まで外す。
 * clearFormat は使わない — 塗る側と同じく、数値や日付の書式まで消さない。
 */
function clearOutput(spreadsheet: Spreadsheet, layout: Layout, log: string[]): void {
  const sheet = findSheet(spreadsheet, layout.name)
  const width = sectionWidth(layout.sections[0])
  const headerRows = headerRowCount(layout)
  const lastRow = sheet.getLastRow()
  const maxRows = sheet.getMaxRows()

  if (lastRow > headerRows) {
    sheet.getRange(headerRows + 1, 1, lastRow - headerRows, width).clearContent()
  }
  if (maxRows > headerRows) sheet.getRange(headerRows + 1, 1, maxRows - headerRows, width).setBackground(null)
  log.push(`「${layout.name}」を ${Math.max(lastRow - headerRows, 0)} 行消した`)
}

/** 条件入力の URL 欄（C9 ／ C10）を空にする。見出しと枠は残す（→ sheet-layout.ts の formUrlBlock）。 */
function clearFormUrls(spreadsheet: Spreadsheet, log: string[]): void {
  const block = formUrlBlock
  const sheet = findSheet(spreadsheet, block.sheet)
  sheet.getRange(block.row, block.urlColumn, block.rows.length, 1).clearContent()
  log.push(`「${block.sheet}」の ${block.row}〜${block.row + block.rows.length - 1} 行目のフォームの URL を空にした`)
}
