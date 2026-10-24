#!/usr/bin/env node
// npm run e2e — dist/ をビルドして検証用スクリプトへ clasp push し、実機の殻の関数を Execution API で呼んで node:test で突き合わせる。
//
// E2E は任意である（CI にも npm test にも入れない → CONTRIBUTING.md・e2e/README.md）。
// 硬さ:
//   - 同時実行は 1 本（.e2e/lock。生きているプロセスが持っていれば、待たずに止まる）
//   - scripts.run は 1 日 100 回まで（e2e/gas.mjs）。関数 1 回は 180 秒で切り、1 回だけ再試行する
//   - push 先は .env の SFS_E2E_SCRIPT_ID だけ。.clasp.json は読まず、毎回 .e2e/clasp.json を書く。スプレッドシートの題名が sfs-e2e で始まらないか、スクリプトの親が検証用スプレッドシートでなければ、何も書かずに止まる（e2e/env.mjs）
//   - 前の回の残りは頭で拾う: 「回答」の紐付け（スクリプトが外す）→ 残ったフォーム（ゴミ箱へ）→ 一時シート（e2e-reset-tmp。resetSpreadsheet が消す）。拾えなければ名指しして止まる
//   - 秘密（トークン・creds・.env）は .gitignore が名指しし、中身は .githooks/pre-commit が止める

import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { build, resolveVersion } from '../build.mjs'
import { trashLeftoverForms } from './drive.mjs'
import { callFunction } from './gas.mjs'
import { assertSandbox, assertScriptBelongsToSandbox, loadEnv, root, workDir } from './env.mjs'

const lockFile = path.join(workDir, 'lock')
const pushTimeoutMs = 120_000

function acquireLock() {
  fs.mkdirSync(workDir, { recursive: true })
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
      if (alive) throw new Error(`別の npm run e2e が動いている（pid ${holder}）。同時には回さない`)
      fs.rmSync(lockFile, { force: true })
    }
  }
  throw new Error(`ロックが取れない（${lockFile}）`)
}

function releaseLock() {
  fs.rmSync(lockFile, { force: true })
}

function pushToSandbox(env) {
  const clasp = path.join(root, 'node_modules/.bin/clasp')
  const project = path.join(workDir, 'clasp.json')
  // rootDir は clasp.json のあるディレクトリからの相対で、その外には出せない。だから貼る物は dist/ ではなく .e2e/dist/ に出す
  fs.writeFileSync(project, JSON.stringify({ scriptId: env.SFS_E2E_SCRIPT_ID, rootDir: 'dist' }))
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const out = execFileSync(clasp, ['-P', project, 'push', '-f'], { cwd: root, encoding: 'utf8', timeout: pushTimeoutMs, stdio: ['ignore', 'pipe', 'pipe'] })
      console.log(out.split('\n')[0])
      return
    } catch (error) {
      if (attempt === 2) throw new Error(`clasp push が失敗した: ${String(error.stderr || error.message).split('\n')[0]}`)
      console.log('clasp push が失敗した。1 回だけやり直す')
    }
  }
}

let exitCode = 1
try {
  const env = loadEnv()
  acquireLock()
  try {
    console.log(`検証用スプレッドシート: ${await assertSandbox(env)}`)
    await assertScriptBelongsToSandbox(env)
    await build(path.join(workDir, 'dist'))
    console.log(`版: ${resolveVersion()}`)
    pushToSandbox(env)
    // 前の回が途中で落ちて残した「回答」の紐付けを外す。Sheets API は紐付いたシートを消せない（400）ので、空に戻す（= 「回答」を消す）より前に外す。
    // 紐付けの有無は Node 側から分からない（Forms API は 403）ので、スクリプトに見てもらう。ゴミ箱にあるフォームでも開けて外せる（実機で見た: 2026-10-25）。
    // push の後に呼ぶ — 呼ぶ口は今のビルドにある。「回答」が無い・紐付いていなければ何もしない。
    const unlinked = await callFunction(env.SFS_E2E_SCRIPT_ID, 'e2eUnlinkAnswers')
    if (unlinked) console.log(`前の回に残った「回答」とフォームの紐付けを外した（${unlinked}）`)
    // 前の回が途中で落ちて残したフォームを、空に戻す（= 条件入力の URL 欄が消える）より前に捨てる
    const leftover = await trashLeftoverForms(env.SFS_E2E_SPREADSHEET_ID)
    if (leftover > 0) console.log(`前の回に残ったフォームを ${leftover} 件ゴミ箱へ移した`)
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', '--test-concurrency=1', `--test-timeout=${10 * 60_000}`, path.join(root, 'e2e/build-template.e2e.mjs'), path.join(root, 'e2e/pipeline.e2e.mjs')], { cwd: root, stdio: 'inherit' })
    exitCode = result.status ?? 1
  } finally {
    releaseLock()
  }
} catch (error) {
  console.error(`E2E を回せなかった: ${error.message}`)
}
process.exit(exitCode)
