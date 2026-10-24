// 日次の控え（countCall）の検査。ネットワークも Apps Script も触らない。控えは一時ディレクトリに置き、本物の ~/.config/sfs-e2e/ は触らない。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { countCall, defaultQuotaFile, jstDate } from './gas.mjs'
import { sharedDir } from './env.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sfs-quota-'))

test('控えの既定の置き場は ~/.config/sfs-e2e/ の下で、worktree の直下ではない', () => {
  assert.equal(defaultQuotaFile, path.join(os.homedir(), '.config/sfs-e2e/quota.json'))
  assert.equal(sharedDir, path.dirname(defaultQuotaFile))
})

test('日付は日本時間で区切る（UTC 14:59 は同じ日、15:00 で翌日）', () => {
  assert.equal(jstDate(new Date('2026-10-24T14:59:59Z')), '2026-10-24')
  assert.equal(jstDate(new Date('2026-10-24T15:00:00Z')), '2026-10-25')
})

test('別の作業ディレクトリから数えても、同じ 1 つの控えに積まれる', () => {
  const dir = tmp()
  const file = path.join(dir, 'quota.json')
  const cwd = process.cwd()
  const other = tmp()
  try {
    assert.equal(countCall(file), 1)
    process.chdir(other)
    assert.equal(countCall(file), 2)
  } finally {
    process.chdir(cwd)
  }
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).count, 2)
  assert.deepEqual(fs.readdirSync(other), [])
})

test('上限で止まり、控えの場所と日本時間の 0 時を言う。日が変われば 0 に戻る', () => {
  const file = path.join(tmp(), 'quota.json')
  const now = new Date('2026-10-24T10:00:00Z')
  for (let i = 1; i <= 3; i++) assert.equal(countCall(file, now, 3), i)
  assert.throws(
    () => countCall(file, now, 3),
    (error) => error.message.includes(file) && error.message.includes('日本時間の 0 時') && error.message.includes('上限（3 回）'),
  )
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).count, 3)
  assert.equal(countCall(file, new Date('2026-10-24T15:00:00Z'), 3), 1)
})

test('壊れた控えは 0 から数え直す', () => {
  const file = path.join(tmp(), 'quota.json')
  fs.writeFileSync(file, '{壊れ')
  assert.equal(countCall(file), 1)
})

test('同時に数えても数え落とさない（別プロセス 6 本 × 25 回 = 150、上限は 150）', () => {
  const file = path.join(tmp(), 'quota.json')
  const gas = fileURLToPath(new URL('./gas.mjs', import.meta.url))
  const script = `import { countCall } from ${JSON.stringify(gas)}; for (let i = 0; i < 25; i++) countCall(${JSON.stringify(file)}, new Date(), 150)`
  const procs = Array.from(
    { length: 6 },
    () =>
      new Promise((resolve) => {
        import('node:child_process').then(({ spawn }) => {
          const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: 'inherit' })
          child.on('exit', resolve)
        })
      }),
  )
  return Promise.all(procs).then((codes) => {
    assert.deepEqual(codes, [0, 0, 0, 0, 0, 0])
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).count, 150)
    assert.throws(() => countCall(file, new Date(), 150), /上限/)
  })
})
