// 作ったフォームを Drive API でゴミ箱へ移す（スクリプトは Drive を掴まない → src/appsscript.json、#260）。
//
// フォームを作るのはスクリプトである。スクリプトが作ったフォームは、clasp のトークンの drive.file でゴミ箱へ移せた（2026-10-25）。
// 移せなければ（403）、何を確かめるかを書いて止まる。黙って残さない。

import fs from 'node:fs'
import path from 'node:path'
import { workDir } from './env.mjs'
import { api } from './google.mjs'
import { readValues } from './sheets.mjs'

/** 途中で落ちた回の、まだ捨てていないフォーム。作った直後に書き、捨てたら消す（.e2e/ は gitignore 済み）。 */
export const leftoverFile = path.join(workDir, 'leftover-form.json')

const driveScopeHint = 'フォームをゴミ箱へ移せなかった（403）。フォームの持ち主と、clasp login のアカウントが検証用と同じかを確かめる（→ e2e/README.md）'

/** ゴミ箱へ移す PATCH の返りの読み。404 は、読めた直後にもう無い（人が消した）ので、捨てた扱いにする。403 は移せないので止める。 */
export function trashOutcome(status) {
  if (status === 404) return 'gone'
  if (status === 403) return 'denied'
  return status >= 200 && status < 300 ? 'ok' : 'error'
}

/** 編集用の URL（…/forms/d/<ファイルの ID>/edit）からファイルの ID を取る。配る用の URL（…/forms/d/e/…）は別の ID なので、読まない。 */
export function formFileIdOf(editUrl) {
  return /\/forms\/d\/(?!e\/)([\w-]+)/.exec(String(editUrl))?.[1] ?? null
}

/** フォームのファイルをゴミ箱へ移す。もう無い・もうゴミ箱にあるときは何もしない。移せなければ止まる。 */
export async function trashForm(fileId) {
  const got = await api('GET', `https://www.googleapis.com/drive/v3/files/${fileId}?fields=trashed,mimeType`)
  if (got.status === 404) return 'gone'
  if (!got.ok) throw new Error(`フォームの状態が読めない（HTTP ${got.status}）`)
  if (got.json.mimeType !== 'application/vnd.google-apps.form') throw new Error('ゴミ箱へ移そうとしたものがフォームではない。何もせずに止めた')
  if (got.json.trashed) return 'already'
  const moved = await api('PATCH', `https://www.googleapis.com/drive/v3/files/${fileId}?fields=trashed`, { trashed: true })
  if (trashOutcome(moved.status) === 'gone') return 'gone'
  if (trashOutcome(moved.status) === 'denied') throw new Error(driveScopeHint)
  if (!moved.ok) throw new Error(`フォームをゴミ箱へ移せない（HTTP ${moved.status}）`)
  const check = await api('GET', `https://www.googleapis.com/drive/v3/files/${fileId}?fields=trashed`)
  if (!check.json.trashed) throw new Error('ゴミ箱へ移したはずのフォームが、まだゴミ箱に無い')
  return 'trashed'
}

/** 作ったフォームを控える（捨てるまでの印）。 */
export function rememberForm(editUrl) {
  fs.mkdirSync(workDir, { recursive: true })
  fs.writeFileSync(leftoverFile, JSON.stringify({ editUrl }))
}

/** 捨てたので控えを消す。 */
export function forgetForm() {
  fs.rmSync(leftoverFile, { force: true })
}

/**
 * 前の回に残ったフォームを捨てる（実行の頭、空に戻すより前に呼ぶ）。
 * 控え（.e2e/leftover-form.json）と、検証用スプレッドシートの条件入力 C10（編集用の URL。空に戻すと消えるので、その前に読む）の両方を見る。
 * 捨てた数を返す。
 */
export async function trashLeftoverForms(spreadsheetId) {
  const urls = []
  try {
    urls.push(JSON.parse(fs.readFileSync(leftoverFile, 'utf8')).editUrl)
  } catch {}
  try {
    const cell = (await readValues(spreadsheetId, "'条件入力'!C9:C10")).flat()
    urls.push(...cell.filter((value) => typeof value === 'string' && value.startsWith('https://docs.google.com/forms/')))
  } catch {}
  let trashed = 0
  for (const fileId of new Set(urls.map(formFileIdOf).filter(Boolean))) {
    if ((await trashForm(fileId)) === 'trashed') trashed += 1
  }
  forgetForm()
  return trashed
}
