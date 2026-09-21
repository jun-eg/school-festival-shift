/**
 * 担当者がコピーしたファイルを開いたときに出るメニュー。
 *
 * 項目は docs/tech-requirements.md 2「担当者がやることの全部」の
 * 操作 3・7・9 と同じ名前である。担当者に新しい操作を 1 つも増やさない。
 * 手直しの画面は作らない（→ 6 の #2）— 手直しはスプレッドシートそのもので行う。
 * 開くのは、名簿の画像を選ぶダイアログ 1 枚だけである（→ 2 の一覧 3・build-form.js）。
 *
 * 中身はそれぞれの issue が入れる。「フォームを作る」（→ build-form.js）と
 * 「生成」（→ shell.js ／ core.js）は入っている。
 * まだ入っていないものは、押したら「まだ作っていない」と名指しで言う（黙って走らない）。
 *
 * label は担当者に見える表示名、functionName は Apps Script が名前で呼ぶ関数である。
 * 表示名は日本語のまま、呼ぶ名前は英字である（→ src/README.md の「名前の線」）。
 */

const menuName = 'シフト'

const menuItems = [
  { label: 'フォームを作る', functionName: 'createForm' },
  { label: '生成', functionName: 'runGeneration' },
  { label: '画像を書き出す', functionName: 'exportImages', issue: 157 },
]

function onOpen() {
  const menu = SpreadsheetApp.getUi().createMenu(menuName)
  menuItems.forEach((item) => menu.addItem(item.label, item.functionName))
  menu.addToUi()
}

/** 画面を出すところまでが menu の仕事である。作るのは build-form.js（→ issue #144）。 */
function createForm() {
  openRosterPicker()
}

/**
 * 生成を 1 回走らせる（→ issue #151 ／ 8 の 8）。押す口はここだけである。
 *
 * 段が 1 つでも入っていなければ、殻は生成シートに 1 枚も書かない（→ shell.js の writeOutputs）。
 * 書かなかったことを黙って終わらせない — 何が入っていないかをそのまま名指しで出す。
 * 崩れ（シートが無い・見出しが違う・表現が揃っていない）は、ここで捕まえない。
 * 直すのは担当者のシートのほうなので、例外の文をそのまま見せる（→ src/README.md）。
 */
function runGeneration() {
  const notBuilt = runOnActiveSpreadsheet()
  if (notBuilt.length === 0) {
    SpreadsheetApp.getActive().toast('生成した（割り当て・検証結果・指標を書き換えた）', menuName, 5)
    return
  }
  SpreadsheetApp.getActive().toast(
    'まだ作っていない段があるので、1 枚も書いていない: '
      + notBuilt.map((step) => `${step.name}（issue #${step.issue}）`).join(' ／ '),
    menuName,
    10,
  )
}

function exportImages() {
  notBuiltYet('画像を書き出す')
}

/** 名指しで止まる。黙って走らない（→ 2 の「止まる箇所」#8）。 */
function notBuiltYet(label) {
  const pressed = menuItems.filter((item) => item.label === label)[0]
  SpreadsheetApp.getActive().toast(
    `「${label}」はまだ作っていない（issue #${pressed.issue}）`,
    menuName,
    5,
  )
}
