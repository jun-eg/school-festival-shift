#!/usr/bin/env node
// リンクの検査 — repo 内の Markdown の相対リンクが、実在するファイルに解決するかを見る。
//
// 見るもの: `[..](path)` と `<img src="path">` の相対パス（`.md`・画像・フォルダ・何でも）。
// 見ないもの: `http(s)://`・`mailto:`・ページ内の `#` だけのリンク。
// 何も書き換えない。読むだけである。全件解決なら終了コード 0、1 つでも外れたら 1 で落ちる。
//
// 起こした経緯は issue #313（docs/ を docs/agent/ へ動かし、約 400 箇所の相対リンクが一度に動いた）。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const 根 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const 見ないフォルダ = new Set(['.git', 'node_modules', 'worktrees', 'dist'])

/** 根から下の .md を全部集める（.claude/worktrees と .git は見ない）。 */
function mdを集める(フォルダ) {
  const 出力 = []
  for (const 名前 of fs.readdirSync(フォルダ, { withFileTypes: true })) {
    if (見ないフォルダ.has(名前.name)) continue
    const 道 = path.join(フォルダ, 名前.name)
    if (名前.isDirectory()) 出力.push(...mdを集める(道))
    else if (名前.name.endsWith('.md')) 出力.push(道)
  }
  return 出力
}

/** 1 行の中のリンク先を全部返す。 */
function リンク先(行) {
  const 出力 = []
  // `[text](target)` と `[text](target "title")`。target に `)` は入らない前提（この repo のリンクに無い）
  for (const 一致 of 行.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) 出力.push(一致[1])
  for (const 一致 of 行.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)) 出力.push(一致[1])
  return 出力
}

const 外を指す = /^(https?:|mailto:|#)/
// 雛形の穴（`<立場>.md` のような、埋めてから初めてファイルになるもの）は見ない
const 雛形の穴 = /<[^>]+>/

function 解決する(ファイル, 先) {
  const 道 = decodeURIComponent(先.replace(/[#?].*$/, ''))
  if (道 === '' || 雛形の穴.test(道)) return null // ページ内リンクと雛形の穴
  return path.resolve(path.dirname(ファイル), 道)
}

const 外れ = []
let 見た = 0
for (const ファイル of mdを集める(根)) {
  const 行たち = fs.readFileSync(ファイル, 'utf8').split('\n')
  let コードの中 = false // ``` で囲まれた中は例文なので見ない
  行たち.forEach((行, i) => {
    if (/^\s*```/.test(行)) {
      コードの中 = !コードの中
      return
    }
    if (コードの中) return
    for (const 先 of リンク先(行)) {
      if (外を指す.test(先)) continue
      const 道 = 解決する(ファイル, 先)
      if (道 === null) continue
      見た += 1
      if (!fs.existsSync(道)) 外れ.push(`${path.relative(根, ファイル)}:${i + 1}  ${先}`)
    }
  })
}

if (外れ.length === 0) {
  console.log(`OK   相対リンク ${見た} 件が全部、実在するファイルに解決した`)
  process.exit(0)
}
console.log(`NG   相対リンク ${見た} 件のうち ${外れ.length} 件が解決しない`)
for (const 一つ of 外れ) console.log(`  ${一つ}`)
process.exit(1)
