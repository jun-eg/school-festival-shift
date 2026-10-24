// E2E の 1 本目 — 実機の buildTemplate が、手元の組み立ての検査（src/shell/build-template.test.ts）と同じ結果になる。
//
//   使い方: npm run e2e（clasp push まで run.mjs がやる。ここだけ回すなら .e2e/ の準備が要るので run.mjs 経由で回す）
//
// 見るものは 4 つある。手元の検査の番号に合わせてある。
//   ① 8 枚が構成の並びででき、最初からある空のシートが消える
//   ② 8 枚に保護が 1 つずつかかる。割り当ての 4 枚は「持ち主だけ」、ほかの 4 枚は「警告のみ」で、条件入力だけは区画の入力欄が保護の外にある
//   ③ 2 回走らせても形が変わらず、2 回目は何も作らない
//   ⑥ 友達欄・候補の列の幅と、固定する行・列
//
// 実行の頭で、検証用スプレッドシートをシート 1 枚の空に戻す。前の実行の残骸は効かない。
// 入れるデータは無い（buildTemplate が置く見出しと初期値だけで、data/ のモックも使わない。氏名・学籍番号は 1 行も入らない）。

import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { dayLabels, inputProtectionNote, protectionKind, protectionNote, sectionLastRow, sectionWidth, sheetLayout, gridProtectionNote } from '../src/core/sheet-layout.ts'
import { assertSandbox, loadEnv } from './env.mjs'
import { callFunction } from './gas.mjs'
import { readStructure, readValues, resetSpreadsheet } from './sheets.mjs'

const env = loadEnv()
const id = env.SFS_E2E_SPREADSHEET_ID

const sorted = (ranges) => [...ranges].sort((a, b) => a.join(',').localeCompare(b.join(','), 'en', { numeric: true }))
const pad = (row, n) => [...row, ...Array(Math.max(0, n - row.length)).fill('')]

describe('実機の buildTemplate', () => {
  let log
  let first
  let secondLog
  let second

  before(async () => {
    await assertSandbox(env)
    await resetSpreadsheet(id)
    const empty = await readStructure(id)
    assert.deepEqual(
      empty.map((s) => [s.title, s.protections.length]),
      [['シート1', 0]],
      '実行の頭で、シート 1 枚の空に戻っている',
    )
    log = await callFunction(env.SFS_E2E_SCRIPT_ID, 'buildTemplate')
    first = await readStructure(id)
    secondLog = await callFunction(env.SFS_E2E_SCRIPT_ID, 'buildTemplate')
    second = await readStructure(id)
  })

  test('① 8 枚が構成の並びででき、空の「シート1」が消えた', () => {
    assert.equal(sheetLayout.length, 8)
    assert.deepEqual(
      first.map((s) => s.title),
      sheetLayout.map((c) => c.name),
    )
    assert.deepEqual(
      first.map((s) => s.index),
      sheetLayout.map((_, i) => i),
    )
    assert.match(log, /空のシート「シート1」を消した/)
  })

  test('① 返り値の最後の行が、保護の枚数を言っている', () => {
    const last = log.trim().split('\n').pop()
    assert.match(last, new RegExp(`^${sheetLayout.length} 枚のうち保護したのは ${sheetLayout.filter((c) => c.protect).length} 枚である`))
  })

  test('① 条件入力の 1 行目は区画の見出し、2 行目が列名で、回答の 1 行目は構成の列名である', async () => {
    const input = await readValues(id, '条件入力!A1:AA2')
    assert.deepEqual(
      input[0].filter((v) => v !== ''),
      sheetLayout[0].sections.map((k) => k.heading),
    )
    assert.deepEqual(pad(input[1] ?? [], 5).slice(0, 5), ['日付', '準備開始', '調理開始', '調理終了', '片付け開始'])
    const answers = await readValues(id, '回答!A1:J1')
    assert.deepEqual(pad(answers[0], 10), [...sheetLayout[1].sections[0].columns, '', '', '', ''])
  })

  test('② 8 枚とも、シート全体に保護が 1 つずつかかった', () => {
    assert.deepEqual(
      first.map((s) => [s.title, s.protections.length, s.protections[0]?.wholeSheet]),
      sheetLayout.map((c) => [c.name, 1, true]),
    )
  })

  test('② 条件入力・回答・検証結果・指標は「警告のみ」で、説明が付いている', () => {
    const notes = { 条件入力: inputProtectionNote, 回答: protectionNote, 検証結果: protectionNote, 指標: protectionNote }
    for (const [name, note] of Object.entries(notes)) {
      const p = first.find((s) => s.title === name).protections[0]
      assert.deepEqual([p.warningOnly, p.description], [true, note], name)
    }
  })

  test('② 割り当ての 4 枚は「持ち主だけ」— 警告ではなく、編集者は持ち主 1 人で、ドメインにも閉じている', () => {
    for (const name of dayLabels) {
      const p = first.find((s) => s.title === name).protections[0]
      assert.deepEqual([p.warningOnly, p.editors.length, p.domainUsersCanEdit, p.description], [false, 1, false, gridProtectionNote], name)
    }
    assert.equal(sheetLayout.filter((c) => c.protect.kind === protectionKind.ownerOnly).length, dayLabels.length)
  })

  test('② 条件入力だけ、区画ごとの入力欄が保護の外にある', () => {
    for (const s of first) {
      const layout = sheetLayout.find((c) => c.name === s.title)
      const expected = layout.protect.openInputs ? layout.sections.map((section) => [2, sectionLastRow(section, s.rowCount), section.startColumn - 1, section.startColumn - 1 + sectionWidth(section)]) : []
      assert.deepEqual(sorted(s.protections[0].unprotected), sorted(expected), s.title)
    }
  })

  test('⑥ 友達欄（3 列目）は時刻の列 3 つ分、検証結果の候補（10 列目）は 5 列分の幅で、ほかの列は既定の幅のまま', () => {
    for (const s of first) {
      const special = dayLabels.includes(s.title) ? { 3: 300 } : s.title === '検証結果' ? { 10: 500 } : {}
      const widths = Object.fromEntries(s.columnWidths.map((w, i) => [i + 1, w]))
      for (const [column, width] of Object.entries(widths)) {
        assert.equal(width, special[column] ?? 100, `${s.title} の ${column} 列目`)
      }
      for (const [column, width] of Object.entries(special)) assert.equal(widths[column], width, s.title)
    }
  })

  test('固定する行と列が構成どおりである', () => {
    assert.deepEqual(
      first.map((s) => [s.title, s.frozenRows, s.frozenColumns]),
      sheetLayout.map((c) => [c.name, c.frozenRows, c.frozenColumns || 0]),
    )
  })

  test('割り当ての 4 枚は 51 列に広がった', () => {
    assert.deepEqual(
      first.filter((s) => dayLabels.includes(s.title)).map((s) => s.columnCount),
      dayLabels.map(() => 51),
    )
  })

  test('③ 2 回走らせても形が変わらず、2 回目は何も作らない', () => {
    assert.deepEqual(second, first)
    assert.deepEqual(
      secondLog.split('\n').filter((line) => line.includes('作った') || line.includes('置いた') || line.includes('広げた')),
      [],
    )
  })
})
