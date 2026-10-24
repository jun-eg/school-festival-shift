// Google の API を Node から叩く最小の道具（依存なし）。
// トークンは clasp が保存した ~/.clasprc.json（リポジトリの外）の refresh_token から取る。中身は表示しない・ログに出さない。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const rcPath = process.env.clasp_config_auth ?? path.join(os.homedir(), '.clasprc.json')

let cached = null

/** access token を 1 本取る（有効なうちは使い回す）。 */
export async function accessToken() {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
  let saved
  try {
    saved = JSON.parse(fs.readFileSync(rcPath, 'utf8')).tokens.default
  } catch {
    throw new Error(`clasp の認証が読めない（${rcPath}）。人が 1 回 clasp login --creds を通す（→ e2e/README.md）`)
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: saved.client_id, client_secret: saved.client_secret, refresh_token: saved.refresh_token, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(30_000),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`access token が取れない: ${body.error}（${body.error_description ?? ''}）。clasp login をやり直す`)
  cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 }
  return cached.token
}

/** JSON の API を 1 回叩く。タイムアウトを超えたら止まる。 */
export async function api(method, url, body, { timeoutMs = 60_000 } = {}) {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  let json
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = { raw: text }
  }
  return { status: res.status, ok: res.ok, json }
}
