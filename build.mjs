#!/usr/bin/env node
// ビルド — src/ を Apps Script に貼る形にして dist/ に出す（→ src/README.md「コアと殻の境目」）。
//
//   使い方: npm run build
//
// 出すのは 4 つで、dist/ は git に入れない（貼る前に毎回これを走らせる）。
//   dist/main.gs            src/entry.js から辿れる全部を 1 本にしたもの（esbuild の iife）
//   dist/export-images.html ┐ src/ui/*.html の <script src="…"></script> を、src/ui/*.js の中身に差し替えたもの
//   dist/form-picker.html   ┘
//   dist/appsscript.json    src/appsscript.json の写し
//
// iife の中の関数は Apps Script から名前で引けないので、src/entry.js が並べた名前ぶんの function 宣言を
// main.gs の最上位に足す（本体は iife の中の同じ名前の関数を呼ぶだけである）。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build as esbuild } from 'esbuild'

const root = path.dirname(fileURLToPath(import.meta.url))
const bundleName = 'shiftBundle'
const htmlNames = ['export-images', 'form-picker']

/** src/entry.js が並べた、Apps Script が名前で呼ぶ関数の名前。 */
export async function entryNames() {
  const entry = await import(pathToFileURL(path.join(root, 'src/entry.js')).href)
  return Object.keys(entry.entryPoints)
}

/** dist/main.gs の中身。 */
export async function renderMain() {
  const names = await entryNames()
  const result = await esbuild({
    entryPoints: [path.join(root, 'src/entry.js')],
    bundle: true,
    format: 'iife',
    globalName: bundleName,
    target: 'es2020',
    charset: 'utf8',
    write: false,
    banner: { js: '// src/ から npm run build で作ったファイル。ここを直さず、src/ を直す。' },
    footer: {
      js: names
        .map((name) => `function ${name}() { return ${bundleName}.entryPoints.${name}.apply(this, arguments) }`)
        .join('\n'),
    },
  })
  return result.outputFiles[0].text
}

/** HTML 1 枚の中身。<script src="X.js"></script> を、src/ui/X.js の中身を入れた <script> に差し替える。 */
export function renderHtml(name) {
  const html = fs.readFileSync(path.join(root, 'src/ui', `${name}.html`), 'utf8')
  return html.replace(/^( *)<script src="([^"]+)"><\/script>$/gm, (all, indent, file) => {
    const script = fs.readFileSync(path.join(root, 'src/ui', file), 'utf8').replace(/\n$/, '')
    const body = script.split('\n').map((line) => (line === '' ? line : `${indent}  ${line}`)).join('\n')
    return `${indent}<script>\n${body}\n${indent}</script>`
  })
}

/** 4 つを outdir に出す。 */
export async function build(outdir = path.join(root, 'dist')) {
  fs.mkdirSync(outdir, { recursive: true })
  fs.writeFileSync(path.join(outdir, 'main.gs'), await renderMain())
  for (const name of htmlNames) fs.writeFileSync(path.join(outdir, `${name}.html`), renderHtml(name))
  fs.copyFileSync(path.join(root, 'src/appsscript.json'), path.join(outdir, 'appsscript.json'))
  return outdir
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outdir = await build()
  console.log(`${path.relative(root, outdir)}/ に 4 つ出した: main.gs ／ ${htmlNames.map((n) => `${n}.html`).join(' ／ ')} ／ appsscript.json`)
}
