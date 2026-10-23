#!/usr/bin/env node
// 要約の検査 — docs/ 直下の要約が、原本（docs/agent/）より古くなっていないかを見る。
//
// 要約の先頭には、原本の在処とハッシュが刻んである。
//   ---
//   source: agent/design-doc.md          ← docs/ からの相対パス（ファイルかフォルダ）
//   source-hash: <git hash-object の値>   ← フォルダならツリーハッシュ
//   ---
// 原本の今のハッシュと比べ、違えば要約の名前を挙げて落ちる。
// 拾うのは「原本を直して要約を見直していない」だけで、中身が追いついているかは人が読む側で見る。
//
// 使い方
//   node scripts/要約の検査.mjs              作業ツリーの原本と比べる（pre-commit 向け）
//   node scripts/要約の検査.mjs --head       HEAD の原本と比べる（CI 向け）
//   node scripts/要約の検査.mjs --stamp      要約を見直したあと、ハッシュを刻み直す（全部）
//   node scripts/要約の検査.mjs --stamp docs/design-doc.md   名指しで刻み直す
//
// 長さの上限（docs/README.md の「要約の書き方」）も同時に見る。
// 規約の原本は docs/README.md。起こした経緯は issue #316。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const 根 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const 要約の置き場 = path.join(根, 'docs')
const 原本の置き場 = path.join(根, 'docs', 'agent')
const 見ないもの = new Set(['README.md'])
const 上限 = { 成果物: 40, ADRの段落: 10 }

const 引数 = process.argv.slice(2)
const HEADで見る = 引数.includes('--head')
const 刻み直す = 引数.includes('--stamp')
const 名指し = 引数.filter((一つ) => !一つ.startsWith('--')).map((一つ) => path.resolve(根, 一つ))

const git = (...args) => execFileSync('git', args, { cwd: 根, encoding: 'utf8' }).trim()

/** docs/ 直下（agent/ を除く）の .md を全部集める。 */
function 要約を集める(フォルダ) {
  const 出力 = []
  for (const 名前 of fs.readdirSync(フォルダ, { withFileTypes: true })) {
    const 道 = path.join(フォルダ, 名前.name)
    if (道 === 原本の置き場) continue
    if (名前.isDirectory()) 出力.push(...要約を集める(道))
    else if (名前.name.endsWith('.md') && !(フォルダ === 要約の置き場 && 見ないもの.has(名前.name))) 出力.push(道)
  }
  return 出力
}

/** 先頭の --- で囲んだ部分を読む。無ければ null。 */
function 先頭を読む(本文) {
  const 行 = 本文.split('\n')
  if (行[0] !== '---') return null
  const 終わり = 行.indexOf('---', 1)
  if (終わり < 0) return null
  const 値 = {}
  for (const 一行 of 行.slice(1, 終わり)) {
    const 一致 = /^([a-z-]+):\s*(.*)$/.exec(一行)
    if (一致) 値[一致[1]] = 一致[2].trim()
  }
  return { 値, 本体: 行.slice(終わり + 1) }
}

/** 原本の今のハッシュ。ファイルはブロブ、フォルダはツリー。 */
function 原本のハッシュ(相対) {
  const 道 = path.join(要約の置き場, 相対)
  if (HEADで見る) return git('rev-parse', `HEAD:docs/${相対}`)
  if (!fs.existsSync(道)) throw new Error(`原本が無い: docs/${相対}`)
  if (fs.statSync(道).isFile()) return git('hash-object', '--', 道)
  // 作業ツリーのフォルダのツリーハッシュ。仮の index に入れて write-tree で出す
  const 仮のindex = path.join(fs.mkdtempSync(path.join(os.tmpdir(), '要約の検査-')), 'index')
  const env = { ...process.env, GIT_INDEX_FILE: 仮のindex }
  const run = (...args) => execFileSync('git', args, { cwd: 根, encoding: 'utf8', env }).trim()
  run('read-tree', '--empty')
  run('add', '--', path.relative(根, 道))
  const ハッシュ = run('write-tree', `--prefix=${path.relative(根, 道).replace(/\\/g, '/')}/`)
  fs.rmSync(path.dirname(仮のindex), { recursive: true, force: true })
  return ハッシュ
}

/** 長さの上限を見る。外れた理由を返す（無ければ空）。 */
function 長さを見る(要約, 本体) {
  const 外れ = []
  const 名前 = path.basename(要約)
  if (名前 === 'ADR.md') {
    // 1 本の ADR は空行で区切った 1 段落。`で始まる段落だけを数える
    let 段落 = []
    const 閉じる = () => {
      if (段落.length > 上限.ADRの段落 && /^`/.test(段落[0])) 外れ.push(`${段落[0].slice(0, 30)}… が ${段落.length} 行（上限 ${上限.ADRの段落}）`)
      段落 = []
    }
    for (const 行 of 本体) (行.trim() === '' ? 閉じる() : 段落.push(行))
    閉じる()
  } else {
    const 行数 = 本体.filter((行, i, 全部) => !(i === 0 && 行 === '') && !(i === 全部.length - 1 && 行 === '')).length
    if (行数 > 上限.成果物) 外れ.push(`${行数} 行（上限 ${上限.成果物}）`)
  }
  return 外れ
}

const 外れ = []
let 見た = 0
const 対象 = 名指し.length > 0 ? 名指し : 要約を集める(要約の置き場)
for (const 要約 of 対象) {
  const 名前 = path.relative(根, 要約)
  const 本文 = fs.readFileSync(要約, 'utf8')
  const 先頭 = 先頭を読む(本文)
  if (!先頭 || !先頭.値.source || !先頭.値['source-hash']) {
    外れ.push(`${名前}: 先頭に source と source-hash が無い`)
    continue
  }
  let 今
  try {
    今 = 原本のハッシュ(先頭.値.source)
  } catch (e) {
    外れ.push(`${名前}: ${e.message}`)
    continue
  }
  見た += 1
  if (刻み直す) {
    if (今 !== 先頭.値['source-hash']) {
      fs.writeFileSync(要約, 本文.replace(/^source-hash:.*$/m, `source-hash: ${今}`))
      console.log(`刻み直した  ${名前}  ${先頭.値['source-hash'].slice(0, 12)} → ${今.slice(0, 12)}`)
    }
  } else if (今 !== 先頭.値['source-hash']) {
    外れ.push(`${名前}: 原本 docs/${先頭.値.source} が動いている（要約 ${先頭.値['source-hash'].slice(0, 12)} ／ 原本 ${今.slice(0, 12)}）`)
  }
  for (const 一つ of 長さを見る(要約, 先頭.本体)) 外れ.push(`${名前}: ${一つ}`)
}

if (外れ.length === 0) {
  console.log(`OK   要約 ${見た} 本が原本と同じハッシュを持ち、長さも上限の中にある`)
  process.exit(0)
}
console.log(`NG   要約 ${外れ.length} 件が外れた`)
for (const 一つ of 外れ) console.log(`  ${一つ}`)
console.log('直し方: 原本の差分と古い要約を読んで要約を書き直し、`node scripts/要約の検査.mjs --stamp <要約>` で刻み直す（→ docs/README.md）')
process.exit(1)
