// Apps Script Execution API（scripts.run）で、殻の関数を名前で呼ぶ。
// メニューの関数は呼ばない（getUi() と toast を掴むので失敗する → src/entry.ts の「手で実行する」の関数を呼ぶ）。

import fs from 'node:fs'
import path from 'node:path'
import { workDir } from './env.mjs'
import { api } from './google.mjs'

/** 1 日に打つ scripts.run の上限（再試行を含む）。Apps Script の日次クォータよりずっと下に置く。 */
export const dailyLimit = 100

/** 1 回の呼び出しを待つ上限。Apps Script 側の実行上限（6 分）より短く、buildTemplate（数十秒）には十分。 */
export const callTimeoutMs = 180_000

const quotaFile = path.join(workDir, 'quota.json')

/** 今日の分に 1 回足す。上限を超えるなら、打たずに止まる。 */
export function countCall() {
  const today = new Date().toISOString().slice(0, 10)
  fs.mkdirSync(workDir, { recursive: true })
  let state = { date: today, count: 0 }
  try {
    const saved = JSON.parse(fs.readFileSync(quotaFile, 'utf8'))
    if (saved.date === today) state = saved
  } catch {}
  if (state.count >= dailyLimit) throw new Error(`今日の scripts.run が上限（${dailyLimit} 回）に達した。明日やり直す（${quotaFile}）`)
  state.count += 1
  fs.writeFileSync(quotaFile, JSON.stringify(state))
  return state.count
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
