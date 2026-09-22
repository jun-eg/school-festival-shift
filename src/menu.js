/**
 * 担当者がコピーしたファイルを開いたときに出るメニュー。
 *
 * 項目は docs/tech-requirements.md 2「担当者がやることの全部」の
 * 操作 3・7・9 と同じ名前である。担当者に新しい操作を 1 つも増やさない。
 * 手直しの画面は作らない（→ 6 の #2）— 手直しはスプレッドシートそのもので行う。
 * 手直しの後の数え直しは、メニューにも出さない。マス目のセルを書き換えれば走る（→ onEdit ／ issue #155）。
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

/**
 * マス目のセルを書き換えると、その場で数え直す（→ 5 の #8 ／ 2 の一覧 8 ／ issue #155）。
 *
 * 単純トリガーである（onOpen と同じ）。インストール型のトリガーを作らないので、
 * 承認画面にもスコープの一覧にも何も増えない（→ src/README.md の「要求するのは 3 スコープである」）。
 * 何を数え直すか・何と言うかは殻が決める（→ shell.js の recountOnEdit）。ここは一言を出すだけである。
 * スプレッドシートはイベントから受ける — 単純トリガーでも自分が入っているファイルには触れる。
 */
function onEdit(e) {
  const said = recountOnEdit(e)
  if (said) e.source.toast(said.text, menuName, said.seconds)
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
 *
 * 残せなかった手直しがあれば、その数も言う（→ 5-3「食い違った固定は、名指しで返す」／ issue #156）。
 * 中身は検証結果の先頭と、そのセルのメモにある。
 */
function runGeneration() {
  const output = runOnActiveSpreadsheet()
  const notBuilt = output.notBuilt
  if (notBuilt.length === 0) {
    const kindAt = outputColumns('検証結果').indexOf('種別')
    const conflicts = output['検証結果'].filter((row) => row[kindAt] === checkKind.fixConflict).length
    SpreadsheetApp.getActive().toast(
      '生成した（割り当て・検証結果・指標を書き換えた。手直しの印があるセルは残した）'
        + (conflicts === 0 ? '' : `。残せなかった手直しが ${conflicts} 件ある — 検証結果の先頭と、そのセルのメモに理由がある`),
      menuName,
      conflicts === 0 ? 5 : 15,
    )
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
