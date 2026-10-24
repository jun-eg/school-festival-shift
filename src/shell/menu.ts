/**
 * 担当者がコピーしたファイルを開いたときに出るメニュー。
 *
 * 項目の上 3 つは docs/agent/tech-requirements.md 2 の操作 3・7・9 と同じ名前で、担当者の操作を増やさない。
 * 4 つ目の「来年用に空にする」は、引き継ぎの予備で前年の担当者が 1 回だけ押す（→ clear-for-next-year.ts ／ ADR tech-requirements-0018）。
 * 本線（README の /copy リンク）では押さないので、2 の一覧は増えない。
 * 手直しはスプレッドシートそのもので行い、数え直しはセルを書き換えれば走る（→ onEdit）。
 * label は担当者に見える表示名、functionName は Apps Script が名前で呼ぶ関数である。
 */

import { openRosterPicker } from './build-form.ts'
import { checkKind, outputColumns } from '../core/sheet-layout.ts'
import { versionMessage } from './version.ts'
import { distributionImagesOn, recountOnEdit, runOnActiveSpreadsheet } from './shell.ts'

const menuName = 'シフト'

export const menuItems = [
  { label: 'フォームを作る', functionName: 'createForm' },
  { label: '生成', functionName: 'runGeneration' },
  { label: '画像を書き出す', functionName: 'exportImages' },
  // 回答を消す項目なので、区切り線の下に離して置く（押し間違えても、押す前に確認が出る）。
  { label: '来年用に空にする', functionName: 'clearForNextYear', separatorBefore: true },
  // 押さなくても困らない項目。引き継ぎで「これはどの版か」と聞かれたときに読む（→ version.ts）。
  { label: 'バージョン', functionName: 'showVersion', separatorBefore: true },
]

export function onOpen() {
  const menu = SpreadsheetApp.getUi().createMenu(menuName)
  menuItems.forEach((item) => {
    if (item.separatorBefore) menu.addSeparator()
    menu.addItem(item.label, item.functionName)
  })
  menu.addToUi()
}

/**
 * マス目のセルを書き換えると、その場で数え直す（→ issue #155）。
 * 単純トリガーなので、スコープは増えない。何と言うかは殻が決める（→ shell.ts の recountOnEdit）。
 */
export function onEdit(e: GoogleAppsScript.Events.SheetsOnEdit): void {
  const said = recountOnEdit(e)
  if (said) e.source.toast(said.text, menuName, said.seconds)
}

/** 名簿の画像を選ぶ画面を出す。作るのは build-form.ts である。 */
export function createForm() {
  openRosterPicker()
}

/**
 * 生成を 1 回走らせる（→ issue #151）。
 * 書かなかったとき（欠けた段がある）は開発者への連絡を促し、何が無いかは実行ログに出す。残せなかった手直しがあれば数も言う。
 * シートの崩れはここで捕まえず、例外の文をそのまま見せる。
 */
export function runGeneration() {
  const output = runOnActiveSpreadsheet()
  const notBuilt = output.notBuilt
  if (notBuilt.length === 0) {
    const kindAt = outputColumns('検証結果').indexOf('種別')
    const conflicts = output['検証結果'].filter((row) => row[kindAt] === checkKind.fixConflict).length
    SpreadsheetApp.getActive().toast('シフトを作成しました（修正済みのセルはそのまま残しています）' + (conflicts === 0 ? '' : `。修正済みのうち ${conflicts} 件は反映できませんでした。理由は「検証結果」シートの先頭と、そのセルのメモを見てください`), menuName, conflicts === 0 ? 5 : 15)
    return
  }
  // 段は全部そろっているので、ここに来るのはコードが食い違ったときだけである。何が欠けたかは実行ログに残す。
  console.error('まだ作っていない段: ' + notBuilt.map((step) => `${step.name}（issue #${step.issue}）`).join(' ／ '))
  SpreadsheetApp.getActive().toast('シフトを作成できませんでした。開発者に連絡してください', menuName, 10)
}

/**
 * 配る画像を書き出すダイアログを開く（→ issue #157）。
 * 中身はダイアログが開いてから取りに来る。開く前に投げると、止まった理由が担当者に出ないためである。
 */
export function exportImages() {
  const dialog = HtmlService.createHtmlOutputFromFile('export-images').setWidth(960).setHeight(640)
  SpreadsheetApp.getUi().showModalDialog(dialog, '画像を書き出す')
}

/** export-images.html から呼ばれる入口。返すのは日ごとの描く中身である。 */
export function exportImagesFromDialog() {
  return distributionImagesOn(SpreadsheetApp.getActive())
}

/** このスクリプトの版を、画面の隅に出す（→ version.ts）。 */
export function showVersion() {
  SpreadsheetApp.getActive().toast(versionMessage(), menuName, 10)
}
