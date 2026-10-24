// e2e/sheets.mjs の resetSpreadsheet の、ネットワークを使わない部分の検査。npm test が回す（E2E そのものは回さない）。
//   使い方: node e2e/sheets.test.mjs
// 偽の Sheets API の上で、前の回の残り（一時シート）の拾い方と、途中で落ちたときの後始末を見る。

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planReset, resetSpreadsheet, resetTmpTitle } from './sheets.mjs'

/** 偽の Sheets API。sheets は { sheetId, title } の配列。linked に入れた sheetId は、消す batchUpdate が 400 になる（紐付いたシートは消せない）。 */
function fakeApi(sheets, { linked = [], failRename = false } = {}) {
  let next = 100
  const calls = []
  const request = async (method, url, body) => {
    calls.push({ method, url, body })
    if (method === 'GET') return { ok: true, status: 200, json: { sheets: sheets.map((s) => ({ properties: { ...s } })) } }
    const reqs = body.requests
    const deletes = reqs.filter((r) => r.deleteSheet).map((r) => r.deleteSheet.sheetId)
    if (deletes.some((sheetId) => linked.includes(sheetId))) return { ok: false, status: 400, json: { error: 'linked' } }
    if (failRename && reqs.some((r) => r.updateSheetProperties)) return { ok: false, status: 400, json: { error: 'rename' } }
    const replies = []
    for (const r of reqs) {
      if (r.addSheet) {
        const sheet = { sheetId: next++, title: r.addSheet.properties.title }
        assert.ok(!sheets.some((s) => s.title === sheet.title), '同じ名前のシートは足せない（HTTP 400）')
        sheets.push(sheet)
        replies.push({ addSheet: { properties: sheet } })
      } else replies.push({})
    }
    for (const sheetId of deletes)
      sheets.splice(
        sheets.findIndex((s) => s.sheetId === sheetId),
        1,
      )
    for (const r of reqs.filter((x) => x.updateSheetProperties)) sheets.find((s) => s.sheetId === r.updateSheetProperties.properties.sheetId).title = r.updateSheetProperties.properties.title
    return { ok: true, status: 200, json: { replies } }
  }
  return { request, calls }
}

test('下ごしらえ: 一時シートが残っていれば先に消す対象にし、消すシートには含めない', () => {
  assert.deepEqual(
    planReset([
      { sheetId: 1, title: '回答' },
      { sheetId: 2, title: resetTmpTitle },
    ]),
    { leftover: [2], olds: [1], reuse: null },
  )
  assert.deepEqual(planReset([{ sheetId: 1, title: '回答' }]), { leftover: [], olds: [1], reuse: null })
})

test('下ごしらえ: 一時シートしか無ければ消せないので、それを使い回す', () => {
  assert.deepEqual(planReset([{ sheetId: 2, title: resetTmpTitle }]), { leftover: [], olds: [], reuse: 2 })
})

test('普通の回: 全部消して、足した 1 枚が「シート1」になる', async () => {
  const sheets = [
    { sheetId: 1, title: '条件入力' },
    { sheetId: 2, title: '回答' },
  ]
  await resetSpreadsheet('id', fakeApi(sheets).request)
  assert.deepEqual(
    sheets.map((s) => s.title),
    ['シート1'],
  )
})

test('前の回の一時シートが残っていても通る（3 回目から落ちていた形）', async () => {
  const sheets = [
    { sheetId: 1, title: '条件入力' },
    { sheetId: 2, title: resetTmpTitle },
  ]
  await resetSpreadsheet('id', fakeApi(sheets).request)
  assert.deepEqual(
    sheets.map((s) => s.title),
    ['シート1'],
  )
})

test('一時シートしか残っていない（空に戻した直後で落ちた形）でも通る', async () => {
  const sheets = [{ sheetId: 2, title: resetTmpTitle }]
  await resetSpreadsheet('id', fakeApi(sheets).request)
  assert.deepEqual(
    sheets.map((s) => s.title),
    ['シート1'],
  )
})

test('紐付いたシートは消せない（400）。止まるが、足した一時シートは消してから止まる', async () => {
  const sheets = [
    { sheetId: 1, title: '条件入力' },
    { sheetId: 2, title: '回答' },
  ]
  const fake = fakeApi(sheets, { linked: [2] })
  await assert.rejects(resetSpreadsheet('id', fake.request), /空に戻せない（HTTP 400）.*足した一時シートは消した/s)
  assert.deepEqual(
    sheets.map((s) => s.title),
    ['条件入力', '回答'],
    '一時シートが残らない',
  )
})

test('名前を戻す段で落ちても、足した一時シートは消してから止まる', async () => {
  const sheets = [{ sheetId: 1, title: '条件入力' }]
  await assert.rejects(resetSpreadsheet('id', fakeApi(sheets, { failRename: true }).request), /足した一時シートは消した/)
  assert.deepEqual(
    sheets.map((s) => s.title),
    ['条件入力'],
  )
})
