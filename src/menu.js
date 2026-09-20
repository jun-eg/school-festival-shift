/**
 * 担当者がコピーしたファイルを開いたときに出るメニュー。
 *
 * 項目は docs/tech-requirements.md 2「担当者がやることの全部」の
 * 操作 3・7・9 と同じ名前である。担当者に新しい操作を 1 つも増やさない。
 * 画面は 1 枚も作らない（→ 6 の #2）— 手直しはスプレッドシートそのもので行う。
 *
 * 中身はそれぞれの issue が入れる。まだ入っていないものは、
 * 押したら「まだ作っていない」と名指しで言う（黙って走らない）。
 *
 * label は担当者に見える表示名、functionName は Apps Script が名前で呼ぶ関数である。
 * 表示名は日本語のまま、呼ぶ名前は英字である（→ src/README.md の「名前の線」）。
 */

const menuName = 'シフト'

const menuItems = [
  { label: 'フォームを作る', functionName: 'createForm', issue: 144 },
  { label: '生成', functionName: 'generate', issue: 151 },
  { label: '画像を書き出す', functionName: 'exportImages', issue: 157 },
]

function onOpen() {
  const menu = SpreadsheetApp.getUi().createMenu(menuName)
  menuItems.forEach((item) => menu.addItem(item.label, item.functionName))
  menu.addToUi()
}

function createForm() {
  notBuiltYet('フォームを作る')
}

function generate() {
  notBuiltYet('生成')
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
