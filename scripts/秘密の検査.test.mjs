// 秘密の検査の検査 — 通る形と止まる形。本物の秘密は 1 つも書かない（形に当たる文字列は、その場で組み立てる）。

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { knownValues, scan } from './秘密の検査.mjs'

const filler = 'abcdefghijklmnopqrstuvwxyz0123456789'
const accessToken = `${'ya'}29.${filler}`
const refreshToken = `1/${'/'}${filler}`
const clientSecret = `${'GOC'}SPX-${filler}`
const clientId = `123456789012-${filler}.apps.googleusercontent.com`

test('通る形 — 普通のファイルと、空の雛形 .env.example', () => {
  assert.deepEqual(
    scan([
      { path: 'src/a.ts', text: 'const x = 1' },
      { path: '.env.example', text: 'SFS_E2E_SCRIPT_ID=\n' },
      { path: 'docs/a.md', text: '`refresh_token` は書かない' },
    ]),
    [],
  )
})

test('止まる形 — 名前', () => {
  for (const name of ['.env', '.env.local', '.clasprc.json', 'creds.json', 'x/my-creds.json', 'client_secret_1.json']) {
    assert.equal(scan([{ path: name, text: '' }]).length, 1, name)
  }
})

test('止まる形 — 中身（値そのものは出力に入らない）', () => {
  for (const text of [accessToken, refreshToken, clientSecret, clientId, '-----BEGIN ' + 'PRIVATE KEY-----', '{"refresh' + '_token": "' + filler + '"}']) {
    const problems = scan([{ path: 'a.txt', text: `x ${text} y` }])
    assert.equal(problems.length >= 1, true, text)
    assert.equal(problems.join('\n').includes(filler), false)
  }
})

test('止まる形 — .env に書いた ID そのもの（短いものは見ない）', () => {
  const known = knownValues('SFS_E2E_SCRIPT_ID=AKfycbxXXXXXXXXXXXX\nSFS_E2E_SPREADSHEET_ID="1AbCdEfGhIjKlMn"\nSFS_E2E_GCP_PROJECT=short\nOTHER=zzzzzzzzzzzz\n')
  assert.deepEqual(
    known.map(([name]) => name),
    ['SFS_E2E_SCRIPT_ID', 'SFS_E2E_SPREADSHEET_ID'],
  )
  assert.equal(scan([{ path: 'a.md', text: 'id: 1AbCdEfGhIjKlMn' }], known).length, 1)
  assert.equal(scan([{ path: 'a.md', text: 'id: nothing' }], known).length, 0)
})
