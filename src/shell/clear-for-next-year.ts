/**
 * 使い終わったファイルのコピーを、来年の担当者に渡せる形に戻す（→ issue #290 ／ ADR tech-requirements-0018）。
 *
 * 引き継ぎの予備である。本線は README の /copy リンクからテンプレートをコピーする形で、ここは通らない。
 * 押すのは前年の担当者で、自分のファイルを「ファイル → コピーを作成」したコピーの上で押す。
 *
 * やることは 4 つで、条件入力の値は残す（そのまま来年の初期値になる → ADR tech-requirements-0015）。
 *   ① 回答シートとフォームの紐付けを外す（コピーで黙って複製されたフォームである → issue #260）
 *   ② 「回答」を作り直す（氏名・学籍番号を来年に渡さない。表のまま残さない）
 *   ③ 割り当て 4 枚・検証結果・指標を、テンプレートの形に戻す
 *   ④ 条件入力の 9〜10 行目（フォームの URL → issue #255）を空にする
 * 複製されたフォームそのものはゴミ箱に移さない。消すにはドライブのスコープが要るので、担当者の手でやる。
 */

import { assignmentName, dividerColumn, dividerLine, formUrlBlock, gridLayouts, sectionWidth, sheetLayout } from '../core/sheet-layout.ts'
import { buildSheet } from './build-template.ts'
import { findLayout, findSheet, headerRowCount, seenGridKey } from './shell.ts'
import type { Sheet, Spreadsheet } from './shell.ts'
import type { Layout } from '../core/sheet-layout.ts'

/** 空にした結果。formUrl ・ formTitle はフォームに紐付いていたときだけ入る（title は外す前に読む）。 */
export type Cleared = { formUrl: string | null; formTitle: string | null; log: string[] }

/** 外したフォーム 1 つ。 */
type Unlinked = { url: string; title: string }

/** 押したときに出す確認。元のファイルで押すと、今年の回答が消える。 */
export const clearConfirmText = 'このファイルの回答・シフト表・検証結果・指標を消し、フォームとの紐付けを外します。' + '条件入力の値は残ります。\n\n' + '元のファイルではなく、「ファイル → コピーを作成」で作ったコピーで押していますか？'

/** メニュー「来年用に空にする」の入口。確かめてから空にし、複製されたフォームの後始末を伝える。 */
export function clearForNextYear(): void {
  const ui = SpreadsheetApp.getUi()
  if (ui.alert('来年用に空にする', clearConfirmText, ui.ButtonSet.YES_NO) !== ui.Button.YES) return

  const cleared = clearForNextYearOn(SpreadsheetApp.getActive())
  console.log(cleared.log.join('\n'))
  ui.alert('来年用に空にしました', clearedText(cleared.formTitle), ui.ButtonSet.OK)
}

/**
 * 空にした後に伝える文。紐付いていたフォームがあれば、ゴミ箱に移すよう名指しする。
 * 名指しは URL でなく題名にする — ui.alert は折り返しを指定できず、ハイフンの無い URL はダイアログを横にスクロールさせる（実機で見た: 2026-10-25 ／ #351）。
 * 題名はドライブのファイル名であり、ドライブの検索で見つかる。毎年同じ名前かもしれないので、種類（フォーム）と「いま外したもの」であることも添える。
 */
export function clearedText(formTitle: string | null): string {
  const handover = '次の担当者には、このファイルを渡してください（受け取った人はコピーして使います）。'
  if (formTitle === null) return handover
  return (
    'このコピーと一緒に複製されたフォームの紐付けを外しました。' +
    'そのフォームは使わないので、Google ドライブでゴミ箱に移してください。\n' +
    `フォームの名前: 「${formTitle}」\n` +
    '（ドライブで名前を検索し、種類がフォームのものを選びます。同じ名前のスプレッドシートは、このファイルや元のファイルなので残します。）\n\n' +
    handover
  )
}

/**
 * 空にする本体。返すのは外したフォームの URL（紐付いていなければ null）と、やったことの記録である。
 * 紐付けを先に外す — ここで止まれば、まだ何も消していない。
 */
export function clearForNextYearOn(spreadsheet: Spreadsheet): Cleared {
  const log: string[] = []
  const unlinked = unlinkAnswerForm(spreadsheet, log)
  rebuildAnswers(spreadsheet, log)
  gridLayouts(assignmentName).forEach((layout) => {
    clearGrid(findSheet(spreadsheet, layout.name), layout, log)
  })
  ;['検証結果', '指標'].forEach((name) => {
    clearOutput(spreadsheet, findLayout(name), log)
  })
  clearFormUrls(spreadsheet, log)
  return { formUrl: unlinked ? unlinked.url : null, formTitle: unlinked ? unlinked.title : null, log: log }
}

/**
 * フォームに紐付いたシートの紐付けだけを外す（E2E の頭と終わりの後始末用 → shell/e2e.ts）。何も消さない。
 * 「回答」だけでなく、全シートを見る — 「フォームを作る」が setDestination の後で落ちると、紐付いているのは
 * 名前を付け替える前の「フォームの回答 1」で、「回答」は紐付いていない（→ build-form.ts）。
 * 紐付いたシートが無ければ（空に戻した直後のシート 1 枚だけを含む）何もせず null を返す。
 * 外したフォームの URL を返す（複数なら最初の 1 つ）。フォームが開けなければ、clearForNextYearOn と同じ文で止まる。
 */
export function unlinkAnswersOn(spreadsheet: Spreadsheet): string | null {
  const urls = spreadsheet
    .getSheets()
    .map((sheet) => unlinkSheetForm(sheet, []))
    .filter((one): one is Unlinked => one !== null)
    .map((one) => one.url)
  return urls.length > 0 ? urls[0] : null
}

/**
 * 回答シートに紐付いたフォームから、回答先を外す（スコープは forms のままで足りる）。
 * フォームが開けないとき（もうゴミ箱にある・持ち主でない）は、手で外す場所を名指しして止まる。
 */
function unlinkAnswerForm(spreadsheet: Spreadsheet, log: string[]): Unlinked | null {
  return unlinkSheetForm(findSheet(spreadsheet, findLayout('回答').name), log)
}

function unlinkSheetForm(sheet: Sheet, log: string[]): Unlinked | null {
  const formUrl = sheet.getFormUrl()
  if (!formUrl) {
    log.push(`「${sheet.getName()}」はフォームに紐付いていなかった`)
    return null
  }

  let form: GoogleAppsScript.Forms.Form
  try {
    form = FormApp.openByUrl(formUrl)
  } catch {
    throw new Error(`「${sheet.getName()}」シートに紐付いたフォームを開けませんでした（${formUrl}）。` + `「${sheet.getName()}」タブの ▼ →「フォームのリンクを解除」を押してから、もう一度「来年用に空にする」を押してください`)
  }
  const title = form.getTitle()
  form.removeDestination()
  SpreadsheetApp.flush()
  log.push(`「${sheet.getName()}」とフォームの紐付けを外した（${formUrl}）`)
  return { url: formUrl, title: title }
}

/**
 * 「回答」を作り直す — 回答の行（氏名・学籍番号）も、今年の日付の題の後ろ 4 列も消え、buildTemplate 直後と同じ形（見出し・保護・幅・並び）になる。
 * フォームが作ったシートは表（テーブル）になっていて、SpreadsheetApp には表を外す口が無い。
 * 見出しを clearContent しても、空けたセルに表が既定の名前（列 7〜列 10）を入れ直す（実機で見た: 2026-10-25）。だから消して、構成から作り直す。
 * 紐付けを外した後に呼ぶ（→ clearForNextYearOn）。来年「フォームを作る」を押すと、このシートはフォームが作るシートに置き換わる（→ build-form.ts）。
 */
function rebuildAnswers(spreadsheet: Spreadsheet, log: string[]): void {
  const layout = findLayout('回答')
  const sheet = findSheet(spreadsheet, layout.name)
  const rows = Math.max(sheet.getLastRow() - headerRowCount(layout), 0)

  spreadsheet.deleteSheet(sheet)
  buildSheet(spreadsheet, layout, sheetLayout.indexOf(layout), [])
  log.push(`「${layout.name}」の回答を ${rows} 行消した（表になっているので、シートを作り直した）`)
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
      sheet.getRange(headerRows + 1, divider, maxRows - headerRows, 1).setBorder(null, null, null, true, null, null, dividerLine.color, SpreadsheetApp.BorderStyle[dividerLine.style])
    }
  }
  sheet
    .getDeveloperMetadata()
    .filter((one) => one.getKey() === seenGridKey)
    .forEach((one) => {
      one.remove()
    })
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
