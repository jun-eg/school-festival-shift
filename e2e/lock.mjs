// npm run e2e の同時実行を 1 本にするロック。検証用スプレッドシートは 1 つなので、worktree をまたいで 1 本（置き場は env.mjs の sharedDir）。

import fs from 'node:fs'
import path from 'node:path'
import { sharedDir } from './env.mjs'

export const defaultLockFile = path.join(sharedDir, 'lock')

export function acquireLock(lockFile = defaultLockFile) {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' })
      return
    } catch {
      const holder = Number(fs.readFileSync(lockFile, 'utf8'))
      // pid として読めない（空・壊れている）ロックは、書く前に落ちた跡とみなして奪う。process.kill(0) はプロセスグループへの送信で成功してしまう
      let alive = Number.isInteger(holder) && holder > 0
      if (alive) {
        try {
          process.kill(holder, 0)
        } catch (error) {
          alive = error.code === 'EPERM'
        }
      }
      if (alive) throw new Error(`別の npm run e2e が動いている（pid ${holder}。worktree をまたいで 1 本）。同時には回さない`)
      fs.rmSync(lockFile, { force: true })
    }
  }
  throw new Error(`ロックが取れない（${lockFile}）`)
}

export function releaseLock(lockFile = defaultLockFile) {
  fs.rmSync(lockFile, { force: true })
}
