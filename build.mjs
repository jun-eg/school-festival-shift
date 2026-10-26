#!/usr/bin/env node
// ビルド — src/ を Apps Script に貼る形にして dist/ に出す（→ src/README.md「コアと殻の境目」）。
//
//   使い方: npm run build
//
// 出すのは 4 つで、dist/ は git に入れない（貼る前に毎回これを走らせる）。
//   dist/main.gs            src/entry.ts から辿れる全部を 1 本にしたもの（esbuild の iife。型は esbuild が剥がすだけで、検査は npm run typecheck）
//   dist/export-images.html ┐ src/ui/*.html の <script src="…"></script> を、src/ui/*.ts を変換した中身に差し替えたもの
//   dist/form-picker.html   ┘
//   dist/appsscript.json    src/appsscript.json の写し
//
// iife の中の関数は Apps Script から名前で引けないので、src/entry.js が並べた名前ぶんの function 宣言を
// main.gs の最上位に足す（本体は iife の中の同じ名前の関数を呼ぶだけである）。
//
// 版（HEAD のタグ、無ければ短い SHA）は src/shell/version.ts の定数として main.gs に埋まる（define）。
//
// target は es2019 である。Apps Script の V8 に合わせて落としてあり、tsconfig.json の lib（es2019）と揃えている。

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build as esbuild, buildSync } from 'esbuild'
import { envWithoutGit } from './scripts/git-env.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const bundleName = 'shiftBundle'
const htmlNames = ['export-images', 'form-picker']

/** Apps Script の V8 に合わせて落とす構文の水準。tsconfig.json の lib と揃える。 */
export const target = 'es2019'

/** src/entry.ts が並べた、Apps Script が名前で呼ぶ関数の名前。 */
export async function entryNames() {
  const entry = await import(pathToFileURL(path.join(root, 'src/entry.ts')).href)
  return Object.keys(entry.entryPoints)
}

/**
 * 貼る物に載せる版。HEAD に付いた git のタグ（複数ならバージョン順の最後）、無ければ短い SHA（追跡ファイルに未 commit の変更があれば末尾に -dirty）、git が使えなければ 'unknown'。
 * タグの無い dist/ を貼らない決まりは src/README.md が持つ。ここはタグが無くても止まらず、SHA で版を名指しする。
 */
export function resolveVersion(cwd = root) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: envWithoutGit() }).trim()
  try {
    const tags = git('tag', '--points-at', 'HEAD', '--sort=version:refname').split('\n').filter(Boolean)
    const base = tags.length > 0 ? tags[tags.length - 1] : git('rev-parse', '--short', 'HEAD') || 'unknown'
    // 追跡ファイルに commit していない変更があれば、タグの指す commit と貼る物が食い違う。印を付けて、貼らない決まりで止める。
    const dirty = git('status', '--porcelain', '--untracked-files=no') !== ''
    return dirty ? `${base}-dirty` : base
  } catch {
    return 'unknown'
  }
}

/** dist/main.gs の中身。version は src/shell/version.ts の buildVersion として埋まる。 */
export async function renderMain(version = resolveVersion()) {
  const names = await entryNames()
  const result = await esbuild({
    entryPoints: [path.join(root, 'src/entry.ts')],
    bundle: true,
    format: 'iife',
    globalName: bundleName,
    target,
    charset: 'utf8',
    write: false,
    define: { __BUILD_VERSION__: JSON.stringify(version) },
    banner: { js: '// src/ から npm run build で作ったファイル。ここを直さず、src/ を直す。' },
    footer: {
      js: names
        .map((name) => `function ${name}() { return ${bundleName}.entryPoints.${name}.apply(this, arguments) }`)
        .join('\n'),
    },
  })
  return result.outputFiles[0].text
}

/**
 * ダイアログの script 1 本。src/ui/X.ts の型を剥がし、import した src/ui/ の中の値（failure-text.ts）を 1 本にまとめて JS にする。
 * 関数 1 つにくるむ（format: iife）のは、tsc が ES モジュールとして見る .ts（import type を持つ）を、
 * ページに置く普通の script に戻すためである。最上位の var がページのグローバルに漏れることもなくなる。
 */
export function renderScript(file) {
  const result = buildSync({ entryPoints: [path.join(root, 'src/ui', file)], bundle: true, write: false, format: 'iife', target, charset: 'utf8' })
  return result.outputFiles[0].text.replace(/\n$/, '')
}

/** HTML 1 枚の中身。<script src="X.ts"></script> を、src/ui/X.ts を変換した中身を入れた <script> に差し替える。 */
export function renderHtml(name) {
  const html = fs.readFileSync(path.join(root, 'src/ui', `${name}.html`), 'utf8')
  return html.replace(/^( *)<script src="([^"]+)"><\/script>$/gm, (all, indent, file) => {
    const script = renderScript(file)
    const body = script.split('\n').map((line) => (line === '' ? line : `${indent}  ${line}`)).join('\n')
    return `${indent}<script>\n${body}\n${indent}</script>`
  })
}

/** 4 つを outdir に出す。 */
export async function build(outdir = path.join(root, 'dist'), version = resolveVersion()) {
  fs.mkdirSync(outdir, { recursive: true })
  fs.writeFileSync(path.join(outdir, 'main.gs'), await renderMain(version))
  for (const name of htmlNames) fs.writeFileSync(path.join(outdir, `${name}.html`), renderHtml(name))
  fs.copyFileSync(path.join(root, 'src/appsscript.json'), path.join(outdir, 'appsscript.json'))
  return outdir
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outdir = await build()
  console.log(`版: ${resolveVersion()}`)
  console.log(`${path.relative(root, outdir)}/ に 4 つ出した: main.gs ／ ${htmlNames.map((n) => `${n}.html`).join(' ／ ')} ／ appsscript.json`)
}
