// .env（リポジトリの直下、gitignore 済み）を読み、検証用のものだけを触る柵を張る。
// 値は表示しない。ID も秘密として扱う（.githooks/pre-commit が、commit に混ざったら止める）。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { api } from './google.mjs'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const workDir = path.join(root, '.e2e')

/** worktree をまたいで 1 つだけ持つ物（日次の控え・同時実行のロック）の置き場。.env の置き場（~/.config/sfs-e2e/）に揃える。worktree の直下の .e2e/ は読まない。 */
export const sharedDir = path.join(os.homedir(), '.config/sfs-e2e')

/** スプレッドシートの題名がこれで始まらなければ、検証用ではないとみなして触らない。 */
export const titlePrefix = 'sfs-e2e'

const required = ['SFS_E2E_SPREADSHEET_ID', 'SFS_E2E_SCRIPT_ID', 'SFS_E2E_GCP_PROJECT']

/** .env の置き場。worktree の直下にあればそれ、無ければ ~/.config/sfs-e2e/.env（worktree をまたいで使う）。どちらにも無ければ null。 */
export function envFile() {
  return [path.join(root, '.env'), path.join(sharedDir, '.env')].find((file) => fs.existsSync(file)) ?? null
}

/** .env を読む。無い・欠けているときは、何を用意するかを書いて止まる。環境変数では上書きできない（行き先が .env 以外で変わらないようにする）。 */
export function loadEnv() {
  const file = envFile()
  const values = {}
  if (file) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) values[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
    }
  }
  const env = {}
  for (const key of required) env[key] = values[key] || ''
  const missing = required.filter((key) => !env[key])
  if (missing.length > 0) {
    throw new Error(`E2E に要る設定が無い: ${missing.join(' ／ ')}。E2E は任意である。使うなら .env.example を .env（worktree の直下か ~/.config/sfs-e2e/.env）にコピーして埋め、clasp login --creds を通す（→ e2e/README.md）`)
  }
  return env
}

/** 検証用のスプレッドシートであることを、題名で確かめる。違えば、何も書く前に止まる。 */
export async function assertSandbox(env) {
  const res = await api('GET', `https://sheets.googleapis.com/v4/spreadsheets/${env.SFS_E2E_SPREADSHEET_ID}?fields=properties.title`)
  if (!res.ok) throw new Error(`検証用スプレッドシートを開けない（HTTP ${res.status}）。ID と、clasp login のアカウントを確かめる`)
  const title = res.json.properties.title
  if (!title.startsWith(titlePrefix)) {
    throw new Error(`検証用ではないスプレッドシートを指している（題名が「${titlePrefix}」で始まらない）。何も書かずに止めた`)
  }
  return title
}

/** push 先のスクリプトが、検証用スプレッドシートにバインドされたものであることを確かめる。違えば、何も push する前に止まる。 */
export async function assertScriptBelongsToSandbox(env) {
  const res = await api('GET', `https://script.googleapis.com/v1/projects/${encodeURIComponent(env.SFS_E2E_SCRIPT_ID)}`)
  if (!res.ok) throw new Error(`スクリプトの情報を読めない（HTTP ${res.status}）。何も push せずに止めた`)
  if (res.json.parentId !== env.SFS_E2E_SPREADSHEET_ID) {
    throw new Error('スクリプトが検証用スプレッドシートに付いていない。何も push せずに止めた')
  }
}
