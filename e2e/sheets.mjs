// 検証用スプレッドシートを Sheets API で空に戻し、組み立ての結果を読む。

import { api } from './google.mjs'

const base = (id) => `https://sheets.googleapis.com/v4/spreadsheets/${id}`

/** 新しいスプレッドシートと同じ「シート 1 枚の空」に戻す。保護はシートごと消える。 */
export async function resetSpreadsheet(id) {
  const before = await api('GET', `${base(id)}?fields=sheets.properties.sheetId`)
  if (!before.ok) throw new Error(`シートの一覧が読めない（HTTP ${before.status}）`)
  const oldIds = before.json.sheets.map((s) => s.properties.sheetId)
  const added = await api('POST', `${base(id)}:batchUpdate`, { requests: [{ addSheet: { properties: { title: 'e2e-reset-tmp' } } }] })
  if (!added.ok) throw new Error(`空のシートを足せない（HTTP ${added.status}）`)
  const newId = added.json.replies[0].addSheet.properties.sheetId
  const done = await api('POST', `${base(id)}:batchUpdate`, {
    requests: [...oldIds.map((sheetId) => ({ deleteSheet: { sheetId } })), { updateSheetProperties: { properties: { sheetId: newId, title: 'シート1' }, fields: 'title' } }],
  })
  if (!done.ok) throw new Error(`空に戻せない（HTTP ${done.status}）: ${JSON.stringify(done.json).slice(0, 300)}`)
}

/** シートごとの名前・順・固定・保護・列の幅。保護の ID は消して付け直すたびに変わるので落とす。 */
export async function readStructure(id) {
  const fields = 'sheets(properties(title,index,gridProperties),protectedRanges(range,description,warningOnly,unprotectedRanges,editors),data(columnMetadata(pixelSize)))'
  const res = await api('GET', `${base(id)}?includeGridData=true&fields=${encodeURIComponent(fields)}`)
  if (!res.ok) throw new Error(`構造が読めない（HTTP ${res.status}）: ${JSON.stringify(res.json).slice(0, 300)}`)
  return res.json.sheets.map((s) => ({
    title: s.properties.title,
    index: s.properties.index,
    rowCount: s.properties.gridProperties.rowCount,
    columnCount: s.properties.gridProperties.columnCount,
    frozenRows: s.properties.gridProperties.frozenRowCount ?? 0,
    frozenColumns: s.properties.gridProperties.frozenColumnCount ?? 0,
    protections: (s.protectedRanges ?? []).map((p) => ({
      description: p.description ?? '',
      warningOnly: p.warningOnly ?? false,
      domainUsersCanEdit: p.editors?.domainUsersCanEdit ?? false,
      editors: p.editors?.users ?? [],
      wholeSheet: Object.keys(p.range).every((k) => k === 'sheetId'),
      unprotected: (p.unprotectedRanges ?? []).map((r) => [r.startRowIndex ?? 0, r.endRowIndex, r.startColumnIndex ?? 0, r.endColumnIndex]).sort((a, b) => a[2] - b[2] || a[0] - b[0]), // API は順を保たない
    })),
    columnWidths: (s.data?.[0]?.columnMetadata ?? []).map((c) => c.pixelSize),
  }))
}

/** 範囲（A1 記法、シート名つき）の値を、空のセルを '' にして返す。 */
export async function readValues(id, range) {
  const res = await api('GET', `${base(id)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`)
  if (!res.ok) throw new Error(`値が読めない（HTTP ${res.status}）: ${range}`)
  return res.json.values ?? []
}

/** シートの題名から sheetId を引く。無ければ null。 */
export async function sheetIdOf(id, title) {
  const res = await api('GET', `${base(id)}?fields=sheets.properties(sheetId,title)`)
  if (!res.ok) throw new Error(`シートの一覧が読めない（HTTP ${res.status}）`)
  return res.json.sheets.find((s) => s.properties.title === title)?.properties.sheetId ?? null
}

/** スプレッドシートのタイムゾーン。モックのタイムスタンプを、スクリプトの時刻（Asia/Tokyo）と同じ読みで置くために見る。 */
export async function timeZoneOf(id) {
  const res = await api('GET', `${base(id)}?fields=properties.timeZone`)
  if (!res.ok) throw new Error(`タイムゾーンが読めない（HTTP ${res.status}）`)
  return res.json.properties.timeZone
}

/** 値を置く。RAW は文字列のまま、USER_ENTERED は人が打ったのと同じ読み（日時になる）。 */
export async function writeValues(id, range, values, valueInputOption) {
  const res = await api('PUT', `${base(id)}/values/${encodeURIComponent(range)}?valueInputOption=${valueInputOption}`, { values })
  if (!res.ok) throw new Error(`値が置けない（HTTP ${res.status}）: ${range} ${JSON.stringify(res.json).slice(0, 300)}`)
}

/** 範囲の値を消す（書式・保護は残る）。 */
export async function clearValues(id, range) {
  const res = await api('POST', `${base(id)}/values/${encodeURIComponent(range)}:clear`, {})
  if (!res.ok) throw new Error(`値が消せない（HTTP ${res.status}）: ${range}`)
}

/** batchUpdate を 1 回打つ。返り値は replies。 */
export async function batchUpdate(id, requests) {
  const res = await api('POST', `${base(id)}:batchUpdate`, { requests })
  if (!res.ok) throw new Error(`batchUpdate が失敗した（HTTP ${res.status}）: ${JSON.stringify(res.json).slice(0, 300)}`)
  return res.json.replies
}

/** シートの値を全部（空のセルは ''、行の末尾の空は API が落とすので揃えない）。比べるときは同じ道具で 2 回読む。 */
export async function readSheet(id, title) {
  return readValues(id, `'${title}'`)
}
