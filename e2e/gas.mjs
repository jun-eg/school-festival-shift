// Apps Script Execution API（scripts.run）で、殻の関数を名前で呼ぶ。
// メニューの関数は呼ばない（getUi() と toast を掴むので失敗する → src/entry.ts の「手で実行する」の関数を呼ぶ）。

import fs from 'node:fs'
import path from 'node:path'
import { sharedDir } from './env.mjs'
import { api } from './google.mjs'

/** 1 日に打つ scripts.run の上限（再試行を含む）。Apps Script の日次クォータよりずっと下に置く。 */
export const dailyLimit = 100

/** 1 回の呼び出しを待つ上限。Apps Script 側の実行上限（6 分）より短く、buildTemplate（数十秒）には十分。 */
export const callTimeoutMs = 180_000

/** 控えの既定の置き場。worktree をまたいで 1 つ（~/.config/sfs-e2e/quota.json）。検査は別の置き場を渡す。 */
export const defaultQuotaFile = path.join(sharedDir, 'quota.json')

/** 日付の区切りは日本時間の 0 時（= UTC の 15 時）。日本時間は夏時間が無いので、9 時間足して UTC の日付を取る。 */
export function jstDate(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10)
}

const sleeper = new Int32Array(new SharedArrayBuffer(4))
const lockStaleMs = 10_000

/** 読んでから書くまでの間に別のプロセスが書かないよう、控えのそばの mkdir（原子的）を排他に使う。持ち主が落ちて残ったものは 10 秒で奪う。 */
function withLock(file, fn) {
  const lockDir = `${file}.lock`
  const deadline = Date.now() + 30_000
  for (;;) {
    try {
      fs.mkdirSync(lockDir)
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      try {
        if (Date.now() - fs.statSync(lockDir).mtimeMs > lockStaleMs) fs.rmSync(lockDir, { recursive: true, force: true })
      } catch {}
      if (Date.now() > deadline) throw new Error(`控えのロックが取れない（${lockDir}）`)
      Atomics.wait(sleeper, 0, 0, 20)
    }
  }
  try {
    return fn()
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true })
  }
}

/** 今日の分に 1 回足す。上限を超えるなら、打たずに止まる。控えは worktree をまたいで 1 つ（日本時間の 0 時に 0 へ戻る）。 */
export function countCall(file = defaultQuotaFile, now = new Date(), limit = dailyLimit) {
  const today = jstDate(now)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  return withLock(file, () => {
    let state = { date: today, count: 0 }
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (saved.date === today && Number.isInteger(saved.count)) state = saved
    } catch {}
    if (state.count >= limit) throw new Error(`今日の scripts.run が上限（${limit} 回）に達した。控えは worktree をまたいで 1 つで、日本時間の 0 時（明日の 0:00）に 0 へ戻るので、その後にやり直す（${file}）`)
    state.count += 1
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(state))
    fs.renameSync(tmp, file)
    return state.count
  })
}

/**
 * 関数を 1 つ呼び、返り値を返す。devMode で呼ぶので、clasp push した最新の保存版が動く（デプロイは要らない）。
 * タイムアウト・通信の失敗・Google 側の一時的な失敗は 1 回だけ再試行する。スクリプト自身の例外（USER_ERROR のうち下記の一時的なもの以外）は再試行しない。
 */
export async function callFunction(scriptId, functionName, parameters = []) {
  let lastError
  for (let attempt = 1; attempt <= 2; attempt++) {
    countCall()
    try {
      const res = await api('POST', `https://script.googleapis.com/v1/scripts/${scriptId}:run`, { function: functionName, parameters, devMode: true }, { timeoutMs: callTimeoutMs })
      if (res.ok && !res.json.error) return res.json.response?.result
      // スクリプト自身の例外は error.message が 'ScriptError' で、本文は details の errorMessage に入る
      const message = res.json.error?.details?.[0]?.errorMessage ?? res.json.error?.message ?? JSON.stringify(res.json)
      // 反映の遅れで「reading from storage … NOT_FOUND」が返ることがある。実機で初回の呼び出しに出た。再試行で通る
      const transient = res.status >= 500 || res.status === 429 || /reading from storage|timed out|Service invoked too many times/i.test(message)
      lastError = new Error(`${functionName} が失敗した（HTTP ${res.status}）: ${message}`)
      if (!transient) throw Object.assign(lastError, { final: true })
    } catch (error) {
      if (error.final) throw error
      lastError = error
    }
    if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, 5_000))
  }
  throw lastError
}
