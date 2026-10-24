// E2E の 2 本目 — buildTemplate → モック投入 → 構造検証 → 生成 → 画像 → フォームを作る → 来年用に空にする → もう一度フォームを作る → 紐付けを外してフォームをゴミ箱へ、を 1 本の順で回す。
//
//   使い方: npm run e2e（run.mjs が clasp push と、前の回に残ったフォームの片付けまでやる）
//
// 見るのは「手元の検査と同じ入力で、同じ結果になるか」だけである（#167 の 2）。相手は次のとおり。
//   構造検証   … 崩して → breakageToText が組む名指しの行（手元 verify-structure.test.ts の ②）
//   生成       … 同じモックと条件入力を src/core/ の build に通した出力（手元 generate ／ count-violations ／ name-unmet がコアを見る）
//   画像       … 同じ出力から組んだマス目を distributionImages に通した値（手元 distribution-image）
//   フォーム   … formItemsFor が組む設問の題と記録（手元 build-form）
//   来年用に空 … buildTemplate 直後の各シートの値と構造（手元 clear-for-next-year ／ テンプレートの形に戻る。空にしたファイルで、もう一度フォームを作る）
// 画面でしか分からないもの（メニューの見た目・ダイアログ・初回承認・toast・onEdit・保護の見え方）はここでは見ない（→ src/real-device-log.md）。
//
// 入れるデータは data/ のモックだけで、氏名・学籍番号は作りものである。条件入力には手を入れない（buildTemplate の初期値のまま）。
// 作ったフォームは、来年用に空にするで紐付けを外した後に Node 側が Drive API でゴミ箱へ移す（e2e/drive.mjs）。

import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { formItemKind, formItemsFor } from '../src/core/form-definition.ts'
import { distributionImages } from '../src/core/distribution-image.ts'
import { assignmentName, formUrlBlock, gridLayouts, sheetLayout } from '../src/core/sheet-layout.ts'
import { breakageKind, breakageToText } from '../src/shell/verify-structure.ts'
import { formFileIdOf, forgetForm, rememberForm, trashForm } from './drive.mjs'
import { assertSandbox, loadEnv } from './env.mjs'
import { callFunction } from './gas.mjs'
import { api } from './google.mjs'
import { expectedFromCore } from './mock.mjs'
import { batchUpdate, clearValues, readSheet, readStructure, readValues, resetSpreadsheet, sheetIdOf, timeZoneOf, writeValues } from './sheets.mjs'

const env = loadEnv()
const id = env.SFS_E2E_SPREADSHEET_ID
const script = env.SFS_E2E_SCRIPT_ID
const call = (name, parameters) => callFunction(script, name, parameters)

/** 名簿の画像の代わり。1 画素の PNG で、何も写っていない。 */
const rosterPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const sheetNames = sheetLayout.map((layout) => layout.name)
const answerColumns = sheetLayout[1].sections[0].columns.length + sheetLayout[1].sections[0].yearlyColumns

const expected = expectedFromCore()
const answerCount = expected.answers.length

/** API が返す時刻は 1 日に対する割合なので、HH:MM に戻す。それ以外は触らない。 */
function normalize(cell) {
  if (typeof cell === 'number' && cell > 0 && cell < 1) {
    const minutes = Math.round(cell * 24 * 60)
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  }
  return cell
}

/** 行の末尾の空を落として、正規化する（API は末尾の空を返さない）。 */
function trimmed(row) {
  const cells = row.map(normalize)
  while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop()
  return cells
}

/** 崩したシートで走らせたときの、スクリプトの例外の文（呼び出しの前置きを除く）を返す。 */
async function whyCheckStopped() {
  try {
    await call('e2eCheckStructure')
  } catch (error) {
    return String(error.message)
  }
  return null
}

/** 構造の検証が止まった文を、手元の名指しの行と突き合わせる。 */
function assertNamed(message, breakages) {
  assert.ok(message, '崩したのに止まらなかった')
  const lines = message.split('\n')
  assert.match(lines[0], new RegExp(`シートの見出しや列が ${breakages.length} か所変わっているため、処理できません`))
  assert.deepEqual(lines.slice(1), breakages.map(breakageToText))
}

describe('実機の 1 本の流れ', () => {
  let template
  let templateStructure
  let generated
  let built
  let formFileId

  before(async () => {
    await assertSandbox(env)
    assert.equal(await timeZoneOf(id), 'Asia/Tokyo', '検証用スプレッドシートのタイムゾーンが、スクリプトの Asia/Tokyo と違う（タイムスタンプの読みがずれる）')
    await resetSpreadsheet(id)
    await call('buildTemplate')
    template = Object.fromEntries(await Promise.all(sheetNames.map(async (name) => [name, await readSheet(id, name)])))
    templateStructure = await readStructure(id)
  })

  test('モックを回答シートに置いた（氏名・学籍番号は data/ の作りもの。外した 3 人は展開で止まる人）', async () => {
    assert.equal(expected.stopped.length, 3)
    // 文字列はそのまま（RAW）、タイムスタンプだけ人が打ったのと同じ読み（日時）にする。フォームの回答が入るのと同じ形である
    await writeValues(
      id,
      `'回答'!B2:J${answerCount + 1}`,
      expected.answers.map((row) => row.slice(1)),
      'RAW',
    )
    await writeValues(
      id,
      `'回答'!A2:A${answerCount + 1}`,
      expected.answers.map((row) => [row[0]]),
      'USER_ENTERED',
    )
    const written = await readValues(id, `'回答'!A1:J${answerCount + 1}`)
    assert.equal(written.length, answerCount + 1)
    assert.ok(
      written.slice(1).every((row) => typeof row[0] === 'number'),
      'タイムスタンプのセルが日時になっている',
    )
  })

  test('構造検証: 構成どおりなら崩れは 0 箇所（返り値は空の配列）', async () => {
    assert.deepEqual(await call('e2eCheckStructure'), [])
  })

  test('構造検証: 列を 1 つ挿すと、ずれた列名と押し出された見出しを名指しして止まる', async () => {
    const columns = sheetLayout.find((layout) => layout.name === '指標').sections[0].columns
    const sheetId = await sheetIdOf(id, '指標')
    const range = { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }
    await batchUpdate(id, [{ insertDimension: { range, inheritFromBefore: false } }])
    try {
      assertNamed(await whyCheckStopped(), [
        { sheet: '指標', kind: breakageKind.headingMismatch, row: 1, column: 1, actual: [columns[0], '', ...columns.slice(1, 4)], expected: columns },
        { sheet: '指標', kind: breakageKind.unknownColumn, row: 1, column: 6, actual: [columns[4]], expected: [] },
      ])
    } finally {
      await batchUpdate(id, [{ deleteDimension: { range } }])
    }
  })

  test('構造検証: 見出しを 1 つ書き換えると、場所と、いまの中身と構成を並べて名指しして止まる', async () => {
    const columns = sheetLayout.find((layout) => layout.name === '検証結果').sections[0].columns
    await writeValues(id, "'検証結果'!A1", [['区分']], 'RAW')
    try {
      assertNamed(await whyCheckStopped(), [{ sheet: '検証結果', kind: breakageKind.headingMismatch, row: 1, column: 1, actual: ['区分', ...columns.slice(1)], expected: columns }])
    } finally {
      await writeValues(id, "'検証結果'!A1", [[columns[0]]], 'RAW')
    }
  })

  test('構造検証: シートを 1 枚消すと、そのシートを名指しして止まる（消したシートは複製から元に戻す）', async () => {
    const before = (await readStructure(id)).find((s) => s.title === '回答')
    const valuesBefore = await readSheet(id, '回答')
    const sourceId = await sheetIdOf(id, '回答')
    const index = before.index
    const [{ duplicateSheet }] = await batchUpdate(id, [{ duplicateSheet: { sourceSheetId: sourceId, insertSheetIndex: index, newSheetName: '回答-退避' } }])
    await batchUpdate(id, [{ deleteSheet: { sheetId: sourceId } }])
    try {
      assertNamed(await whyCheckStopped(), [{ sheet: '回答', kind: breakageKind.missingSheet, row: null, column: null, actual: [], expected: [] }])
    } finally {
      await batchUpdate(id, [{ updateSheetProperties: { properties: { sheetId: duplicateSheet.properties.sheetId, title: '回答', index }, fields: 'title,index' } }])
    }
    // 複製は保護を持ち越さない（実機で見た）。buildTemplate と同じ「警告のみ」の保護を付け直す
    const layout = sheetLayout.find((one) => one.name === '回答')
    await batchUpdate(id, [{ addProtectedRange: { protectedRange: { range: { sheetId: duplicateSheet.properties.sheetId }, description: layout.protect.note, warningOnly: true } } }])
    const after = (await readStructure(id)).find((s) => s.title === '回答')
    assert.deepEqual(after, before, '戻した回答シートの形（位置・保護・幅・固定）が、消す前と同じ')
    assert.deepEqual(await readSheet(id, '回答'), valuesBefore)
  })

  test('構造検証: 戻すと、また 0 箇所に戻る', async () => {
    assert.deepEqual(await call('e2eCheckStructure'), [])
  })

  test('生成: モックと条件入力の初期値から、手元のコアと同じ出力が出る（違反 0・未充足の名指しが一致）', async (t) => {
    const startedAt = Date.now()
    generated = await call('e2eGenerate')
    const wallSeconds = (Date.now() - startedAt) / 1000
    assert.deepEqual(generated.output.notBuilt, [])
    assert.deepEqual(generated.output, expected.output)
    const kinds = {}
    for (const row of generated.output['検証結果']) kinds[row[0]] = (kinds[row[0]] ?? 0) + 1
    assert.equal(kinds['違反'] ?? 0, 0, '違反が 0 件')
    assert.ok((kinds['未充足'] ?? 0) > 0, '未充足が名指しで出ている（モックでは人が足りない枠がある）')
    // 実機の生成の所要時間。項目 14（人が測った 2026-09-22）を最後に、以後はこの出力が持つ（→ src/real-device-log.md）
    const seconds = generated.ms / 1000
    t.diagnostic(`生成の所要時間（実機）: スクリプトの中で ${seconds.toFixed(3)} 秒 ／ 呼び出し全体で ${wallSeconds.toFixed(1)} 秒（割り当て ${generated.output['割り当て'].length} 行 ／ 検証結果 ${generated.output['検証結果'].length} 行 ／ 指標 ${generated.output['指標'].length} 行）。合格の線は 360 秒`)
    console.log(`生成の所要時間（実機）: スクリプトの中で ${seconds.toFixed(3)} 秒 ／ 呼び出し全体で ${wallSeconds.toFixed(1)} 秒`)
    assert.ok(seconds < 360, `生成が 360 秒の線を越えた（${seconds} 秒）`)
  })

  test('生成: マス目の 4 枚・検証結果・指標が、手元のコアの出力と同じ中身で書かれた', async () => {
    for (const { layout, grid } of expected.grids) {
      const read = await readSheet(id, layout.name)
      const width = Math.max(...grid.header.map((_, i) => i + 1))
      assert.deepEqual(trimmed(read[0] ?? []), trimmed(grid.header), `${layout.name} の見出し`)
      const rows = read.slice(1).map((row) => trimmed(row.slice(0, width)))
      assert.deepEqual(rows, grid.rows.map(trimmed), `${layout.name} の行`)
    }
    // 日付・時刻の列は API が数で返すので、文字列と数だけの列で比べる（種別・役割・学籍番号・氏名・内容・あと何人・候補）
    const pick = (row) => [0, 4, 5, 6, 7, 8, 9].map((i) => row[i] ?? '')
    const checks = (await readSheet(id, '検証結果')).slice(1)
    assert.deepEqual(
      checks.map((row) => pick([...row, ...Array(10)].slice(0, 10))),
      expected.checkRows.map(pick),
    )
    const metrics = (await readSheet(id, '指標')).slice(1)
    assert.deepEqual(metrics, expected.metricRows)
  })

  test('画像: 日ごとの描く中身が、手元のコアと同じ値で返る', async () => {
    const images = await call('exportImagesFromDialog')
    assert.equal(images.length, gridLayouts(assignmentName).length)
    assert.deepEqual(images, JSON.parse(JSON.stringify(distributionImages(expected.grids, expected.days))))
  })

  test('フォームを作る: 設問の題と記録が手元の定義と同じで、回答シートが「回答」になり、URL が条件入力に残る', async () => {
    // 回答の行があるとフォームは作れない（回答を消さない）。作る前の形、つまり回答が空のファイルにする
    await clearValues(id, `'回答'!A2:J${answerCount + 1}`)
    const items = formItemsFor(expected.days)
    built = await call('createFormFromPicker', [{ base64: rosterPng, mimeType: 'image/png', fileName: 'roster.png' }])
    // 捨てるまでの印。途中で落ちても、次の回の頭が拾う（run.mjs）
    rememberForm(built.editUrl)
    formFileId = formFileIdOf(built.editUrl)
    assert.ok(formFileId, '編集用の URL からフォームのファイル ID が取れる')

    const questions = items.filter((item) => item.kind !== formItemKind.image)
    assert.deepEqual(built.log.slice(0, 1), [
      `設問の題と営業時間を「日ごとの営業時刻」${expected.days.length} 行から組んだ（${items
        .filter((item) => item.label)
        .map((item) => `${item.title} ${item.businessHours}`)
        .join(' / ')}）`,
    ])
    assert.ok(built.log.includes(`設問を ${questions.length} つ、画像アイテムを ${items.length - questions.length} つ置いた`))
    assert.ok(built.url.startsWith('https://docs.google.com/forms/'))

    const structure = await readStructure(id)
    assert.deepEqual(
      structure.map((s) => s.title),
      sheetNames,
      '8 枚が構成の並びのまま（フォームが作ったシートは「回答」になった）',
    )
    const answer = structure.find((s) => s.title === '回答')
    assert.deepEqual([answer.frozenRows, answer.protections.length, answer.protections[0]?.wholeSheet, answer.protections[0]?.warningOnly], [1, 1, true, true])
    const header = (await readValues(id, "'回答'!A1:J1"))[0]
    assert.deepEqual(header, [sheetLayout[1].sections[0].columns[0], ...questions.map((item) => item.title)])
    assert.equal(header.length, answerColumns)
    const urls = (await readValues(id, `'${formUrlBlock.sheet}'!C${formUrlBlock.row}:C${formUrlBlock.row + 1}`)).flat()
    assert.deepEqual(urls, [built.url, built.editUrl])
  })

  test('来年用に空にする: 紐付けを外し、回答・マス目・検証結果・指標・URL 欄が buildTemplate 直後の形に戻る（条件入力の値は残る）', async (t) => {
    // 回答を入れ直す（フォームに回答が付いた後の形。消えるものがあるようにする）
    await writeValues(
      id,
      `'回答'!B2:J${answerCount + 1}`,
      expected.answers.map((row) => row.slice(1)),
      'RAW',
    )
    await writeValues(
      id,
      `'回答'!A2:A${answerCount + 1}`,
      expected.answers.map((row) => [row[0]]),
      'USER_ENTERED',
    )
    const linked = await api('GET', `https://forms.googleapis.com/v1/forms/${formFileId}`)
    const linkedBefore = linked.ok ? linked.json.linkedSheetId === id : null
    if (linkedBefore === null) t.diagnostic(`Forms API が読めなかった（HTTP ${linked.status}）。紐付けの有無はスクリプトの記録だけで見た`)
    else assert.ok(linkedBefore, '作った直後は、フォームの回答先がこのスプレッドシートである')

    const cleared = await call('e2eClearForNextYear')
    assert.ok(cleared.formUrl?.startsWith('https://docs.google.com/forms/'), '外したフォームの URL が返る')
    assert.ok(cleared.log.some((line) => line.startsWith('「回答」とフォームの紐付けを外した')))
    assert.ok(cleared.log.includes(`「回答」の回答を ${answerCount} 行消した（表になっているので、シートを作り直した）`))
    if (linkedBefore !== null) {
      const unlinked = await api('GET', `https://forms.googleapis.com/v1/forms/${formFileId}`)
      assert.equal(unlinked.json.linkedSheetId, undefined, 'フォームの回答先が外れた')
    }
    for (const name of sheetNames.filter((one) => one !== '回答')) assert.deepEqual(await readSheet(id, name), template[name], `${name} が buildTemplate 直後の値に戻った`)
    // 「回答」も、buildTemplate 直後と同じ（後ろ 4 列の見出しも空）。許す例外は無い。
    // フォームが作ったシートは表（テーブル）で、SpreadsheetApp は表を外せず、見出しを空けても既定の名前（列 7〜列 10）が入り直す。だから作り直している（#347）
    assert.deepEqual(await readSheet(id, '回答'), template['回答'], '回答が buildTemplate 直後の値に戻った（後ろ 4 列の見出しは空）')
    assert.deepEqual(await readStructure(id), templateStructure, '8 枚の並び・保護・幅・固定が buildTemplate 直後と同じ（作り直した「回答」も）')
    // このフォームはここで捨てる（次の test で、空にしたファイルにもう 1 つ作る）
    assert.equal(await trashForm(formFileId), 'trashed')
    forgetForm()
  })

  test('空にしたファイルで「フォームを作る」がもう一度通る（来年の担当者がやること）。作り直した「回答」がフォームの作るシートに置き換わる', async () => {
    const items = formItemsFor(expected.days)
    const again = await call('createFormFromPicker', [{ base64: rosterPng, mimeType: 'image/png', fileName: 'roster.png' }])
    rememberForm(again.editUrl)
    formFileId = formFileIdOf(again.editUrl)
    assert.ok(formFileId)
    assert.notEqual(again.editUrl, built.editUrl, '新しいフォームができた')
    const questions = items.filter((item) => item.kind !== formItemKind.image)
    assert.deepEqual((await readValues(id, "'回答'!A1:J1"))[0], [sheetLayout[1].sections[0].columns[0], ...questions.map((item) => item.title)])
    assert.deepEqual(
      (await readStructure(id)).map((s) => s.title),
      sheetNames,
      '8 枚が構成の並びのまま',
    )
    const urls = (await readValues(id, `'${formUrlBlock.sheet}'!C${formUrlBlock.row}:C${formUrlBlock.row + 1}`)).flat()
    assert.deepEqual(urls, [again.url, again.editUrl])
  })

  test('最後に「回答」の紐付けを外してから、フォームをゴミ箱へ移した（ゴミ箱へ移しても紐付けは外れない。紐付いたままだと次の回の頭で「回答」が消せない → #349）', async (t) => {
    const cleared = await call('e2eClearForNextYear')
    assert.ok(cleared.formUrl?.startsWith('https://docs.google.com/forms/'), '外したフォームの URL が返る（いま紐付いている 2 つ目のフォーム）')
    assert.ok(cleared.log.some((line) => line.startsWith('「回答」とフォームの紐付けを外した')))
    // 外した後は、もう一度外そうとしても何も無い（スクリプトが「回答」の紐付けを見ている）
    assert.equal(await call('e2eUnlinkAnswers'), null, '「回答」はもうフォームに紐付いていない')
    const unlinked = await api('GET', `https://forms.googleapis.com/v1/forms/${formFileId}`)
    if (unlinked.ok) assert.equal(unlinked.json.linkedSheetId, undefined, 'フォームの回答先が外れた')
    else t.diagnostic(`Forms API が読めなかった（HTTP ${unlinked.status}）。紐付けの有無はスクリプトの記録だけで見た`)
    // 外した後の「回答」は buildTemplate 直後の形（作り直されている）
    assert.deepEqual(await readSheet(id, '回答'), template['回答'])
    assert.equal(await trashForm(formFileId), 'trashed')
    forgetForm()
  })
})
