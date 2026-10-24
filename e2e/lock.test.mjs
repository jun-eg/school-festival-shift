// 同時実行のロックの検査。一時ディレクトリに置き、本物の ~/.config/sfs-e2e/ は触らない。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { sharedDir } from './env.mjs'
import { acquireLock, defaultLockFile, releaseLock } from './lock.mjs'

const lockIn = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sfs-lock-')), 'lock')

test('ロックの既定の置き場は worktree の外（~/.config/sfs-e2e/lock）', () => {
  assert.equal(defaultLockFile, path.join(sharedDir, 'lock'))
})

test('生きているプロセスが持っていれば止まり、放せば取れる', () => {
  const file = lockIn()
  fs.writeFileSync(file, String(process.ppid))
  assert.throws(() => acquireLock(file), /同時には回さない/)
  releaseLock(file)
  acquireLock(file)
  assert.equal(fs.readFileSync(file, 'utf8'), String(process.pid))
  releaseLock(file)
})

test('死んだ・壊れたロックは奪う', () => {
  const file = lockIn()
  fs.writeFileSync(file, '')
  acquireLock(file)
  releaseLock(file)
  fs.writeFileSync(file, '2147483646')
  acquireLock(file)
  releaseLock(file)
})
