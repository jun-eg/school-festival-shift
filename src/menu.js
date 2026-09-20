/**
 * The menu that comes up when the staff open the file they copied.
 *
 * The items carry the same names as operations 3, 7 and 9 of
 * docs/tech-requirements.md 2「担当者がやることの全部」. Not one new operation is added for the staff.
 * Not a single screen is built (→ 6 の #2) — the hand edits happen in the spreadsheet itself.
 *
 * The contents are put in by their own issues. Anything not in yet says「まだ作っていない」by name
 * when it is pressed (it never runs silently).
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

/** Stop by name. Never run silently (→ 2 の「止まる箇所」#8). */
function notBuiltYet(label) {
  const pressed = menuItems.filter((item) => item.label === label)[0]
  SpreadsheetApp.getActive().toast(
    `「${label}」はまだ作っていない（issue #${pressed.issue}）`,
    menuName,
    5,
  )
}
