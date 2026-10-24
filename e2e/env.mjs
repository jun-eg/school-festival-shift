// .env（リポジトリの直下、gitignore 済み）を読み、検証用のものだけを触る柵を張る。
// 値は表示しない。ID も秘密として扱う（.githooks/pre-commit が、commit に混ざったら止める）。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { api } from './google.mjs'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const workDir = path.join(root, '.e2e')

/** スプレッドシートの題名がこれで始まらなければ、検証用ではないとみなして触らない。 */
export const titlePrefix = 'sfs-e2e'

const required = ['SFS_E2E_SPREADSHEET_ID', 'SFS_E2E_SCRIPT_ID', 'SFS_E2E_GCP_PROJECT']

/** .env を読む。無い・欠けているときは、何を用意するかを書いて止まる。process.env の値が先に効く。 */
export function loadEnv() {
  const file = path.join(root, '.env')
  const values = {}
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) values[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
    }
  }
  const env = {}
  for (const key of required) env[key] = process.env[key] || values[key] || ''
  const missing = required.filter((key) => !env[key])
  if (missing.length > 0) {
    throw new Error(`E2E に要る設定が無い: ${missing.join(' ／ ')}。E2E は任意である。使うなら .env.example を .env にコピーして埋め、clasp login --creds を通す（→ e2e/README.md）`)
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
