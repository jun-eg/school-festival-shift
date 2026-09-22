/**
 * 担当者がコピーしたファイルを開いたときに出るメニュー。
 *
 * 項目は docs/tech-requirements.md 2 の操作 3・7・9 と同じ名前で、新しい操作を増やさない。
 * 手直しはスプレッドシートそのもので行い、数え直しはセルを書き換えれば走る（→ onEdit）。
 * label は担当者に見える表示名、functionName は Apps Script が名前で呼ぶ関数である。
 */

const menuName = 'シフト'

const menuItems = [
  { label: 'フォームを作る', functionName: 'createForm' },
  { label: '生成', functionName: 'runGeneration' },
  { label: '画像を書き出す', functionName: 'exportImages' },
]

function onOpen() {
  const menu = SpreadsheetApp.getUi().createMenu(menuName)
  menuItems.forEach((item) => menu.addItem(item.label, item.functionName))
  menu.addToUi()
}

/**
 * マス目のセルを書き換えると、その場で数え直す（→ issue #155）。
 * 単純トリガーなので、スコープは増えない。何と言うかは殻が決める（→ shell.js の recountOnEdit）。
 */
function onEdit(e) {
  const said = recountOnEdit(e)
  if (said) e.source.toast(said.text, menuName, said.seconds)
}

/** 名簿の画像を選ぶ画面を出す。作るのは build-form.js である。 */
function createForm() {
  openRosterPicker()
}

/**
 * 生成を 1 回走らせる（→ issue #151）。
 * 書かなかったとき（欠けた段がある）は、何が無いかを名指しで出す。残せなかった手直しがあれば数も言う。
 * シートの崩れはここで捕まえず、例外の文をそのまま見せる。
 */
function runGeneration() {
  const output = runOnActiveSpreadsheet()
  const notBuilt = output.notBuilt
  if (notBuilt.length === 0) {
    const kindAt = outputColumns('検証結果').indexOf('種別')
    const conflicts = output['検証結果'].filter((row) => row[kindAt] === checkKind.fixConflict).length
    SpreadsheetApp.getActive().toast(
      '生成した（手直しの印があるセルは残した）'
        + (conflicts === 0 ? '' : `。残せなかった手直しが ${conflicts} 件（理由は検証結果の先頭と、そのセルのメモ）`),
      menuName,
      conflicts === 0 ? 5 : 15,
    )
    return
  }
  SpreadsheetApp.getActive().toast(
    'まだ作っていない段があるので、何も書いていない: '
      + notBuilt.map((step) => `${step.name}（issue #${step.issue}）`).join(' ／ '),
    menuName,
    10,
  )
}

/**
 * 配る画像を書き出すダイアログを開く（→ issue #157）。
 * 中身はダイアログが開いてから取りに来る。開く前に投げると、止まった理由が担当者に出ないためである。
 */
function exportImages() {
  const dialog = HtmlService.createHtmlOutputFromFile('export-images')
    .setWidth(960)
    .setHeight(640)
  SpreadsheetApp.getUi().showModalDialog(dialog, '画像を書き出す')
}

/** export-images.html から呼ばれる入口。返すのは日ごとの描く中身である。 */
function exportImagesFromDialog() {
  return distributionImagesOn(SpreadsheetApp.getActive())
}
