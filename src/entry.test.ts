#!/usr/bin/env node
// 入口の検査 — Apps Script が名前で呼ぶ関数の一覧（src/entry.ts）が、呼ぶ側と食い違っていないかと、
// ビルドが出す dist/main.gs が、その一覧どおりに最上位へ function を出しているかを見る。
//
//   使い方: node src/entry.test.ts
//
// 見るものは 6 つある（→ src/README.md「コアと殻の境目」、build.mjs）。
//   ① 一覧が、トリガー・menuItems・HTML の呼び先・手で実行する buildTemplate の和集合と一致する
//   ② ビルドが出した main.gs の最上位の function が、一覧と一致する
//   ③ 出した main.gs を読み込むと、メニュー「シフト」の 5 項目がそれぞれ最上位の関数を指す
//   ④ ビルドが出した HTML は、外から読み込む script を持たず、src/ui/*.ts の中身がそのまま入っている
//   ⑤ ①の突き合わせそのものが、食い違いを名指しする（偽の一覧で確かめる）
//   ⑥ ビルドが版（タグ、無ければ短い SHA）を main.gs の定数に埋め、メニューの「バージョン」がそれを返す
//
// 実機のコピーから版が読めること（#331 に預ける）は実機が持つ。
// 実機のエディタで buildTemplate が走ること、メニューが押せることは実機が持つ（→ src/real-device-log.md）。

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build, renderHtml, renderMain, renderScript, resolveVersion } from '../build.mjs'
import { check } from '../test/check.ts'
import { gasGlobal } from '../test/fakes/spreadsheet.ts'
import { entryPoints } from './entry.ts'
import { menuItems } from './shell/menu.ts'
import { versionMessage } from './shell/version.ts'

const srcDir = path.dirname(fileURLToPath(import.meta.url))

/** google.script.run の鎖のうち、サーバー側の関数の名前（withSuccessHandler などは飛ばす）。ファイル内の google.script.run を全部見る。 */
function calledFromHtml(script) {
  const handlers = ['withSuccessHandler', 'withFailureHandler', 'withUserObject']
  const called: string[] = []
  for (const start of script.matchAll(/google\.script\.run\b/g)) {
    let at = start.index + start[0].length
    for (;;) {
      const next = /^\s*\.(\w+)\s*\(/.exec(script.slice(at))
      if (!next) break
      if (handlers.indexOf(next[1]) === -1) {
        called.push(next[1])
        break
      }
      // ハンドラの引数（関数の本体を含む）を丸ごと飛ばす
      let depth = 1
      at += next[0].length
      while (at < script.length && depth > 0) {
        if (script[at] === '(') depth++
        else if (script[at] === ')') depth--
        at++
      }
    }
  }
  return called
}

/** 一覧と、呼ぶ側から集めた名前の食い違い。 */
function mismatch(listed, expected) {
  return {
    notListed: expected.filter((name) => listed.indexOf(name) === -1).sort(),
    notCalled: listed.filter((name) => expected.indexOf(name) === -1).sort(),
  }
}

const htmlNames = fs
  .readdirSync(path.join(srcDir, 'ui'))
  .filter((name) => name.endsWith('.html'))
  .map((name) => name.replace('.html', ''))
const calledByHtml = htmlNames.flatMap((name) => calledFromHtml(fs.readFileSync(path.join(srcDir, 'ui', `${name}.ts`), 'utf8')))
const triggers = ['onOpen', 'onEdit']
const runByHand = ['buildTemplate']
const expectedNames = [...new Set([...triggers, ...menuItems.map((item) => item.functionName), ...calledByHtml, ...runByHand])]
const listedNames = Object.keys(entryPoints)

// ---- ① 一覧と呼ぶ側 ---------------------------------------------------------

check(
  '① HTML が google.script.run で呼ぶ関数は、2 枚で 2 つ（exportImagesFromDialog ／ createFormFromPicker）',
  [htmlNames.sort(), calledByHtml.sort()],
  [
    ['export-images', 'form-picker'],
    ['createFormFromPicker', 'exportImagesFromDialog'],
  ],
)
check('① 一覧に足りない名前も、呼ばれていない名前も無い（トリガー・menuItems・HTML の呼び先・buildTemplate と一致する）', mismatch(listedNames, expectedNames), { notListed: [], notCalled: [] })
check('① 一覧の名前はどれも関数で、メニューの 5 項目は一覧にある', [listedNames.filter((name) => typeof entryPoints[name] !== 'function'), menuItems.map((item) => item.functionName).filter((name) => listedNames.indexOf(name) === -1)], [[], []])

// ---- ② main.gs の最上位の function ------------------------------------------

const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-build-'))
await build(outdir)
const main = fs.readFileSync(path.join(outdir, 'main.gs'), 'utf8')
const topLevelFunctions = [...main.matchAll(/^function (\w+)\(/gm)].map((match) => match[1])

check('② npm run build は dist に 4 つ（main.gs ・ HTML 2 枚 ・ appsscript.json）を出す', fs.readdirSync(outdir).sort(), ['appsscript.json', 'export-images.html', 'form-picker.html', 'main.gs'])
check('② main.gs の最上位の function 宣言は、一覧の名前と過不足なく一致する', mismatch(topLevelFunctions, listedNames), { notListed: [], notCalled: [] })
check('② appsscript.json は src/ の写しである', fs.readFileSync(path.join(outdir, 'appsscript.json'), 'utf8') === fs.readFileSync(path.join(srcDir, 'appsscript.json'), 'utf8'), true)

// ---- ③ 出した main.gs が動く ------------------------------------------------
// main.gs の最上位の function を、そのまま Node で読み込めるようにして呼ぶ（Apps Script が名前で引くのと同じ引き方）。

const added: any[] = []
const menu = {
  addItem(label, functionName) {
    added.push({ label, functionName })
    return menu
  },
  addSeparator() {
    added.push('---')
    return menu
  },
  addToUi() {
    added.push('shown')
  },
}
gasGlobal.SpreadsheetApp = {
  getUi() {
    return {
      createMenu(name) {
        added.push(name)
        return menu
      },
    }
  },
}
const loadable = path.join(outdir, 'main-loadable.mjs')
fs.writeFileSync(loadable, `${main}\nexport { ${topLevelFunctions.join(', ')} }\n`)
const gas = await import(pathToFileURL(loadable).href)
gas.onOpen()

check('③ main.gs の onOpen は、メニュー「シフト」に 5 項目を出す（来年用に空にするは区切り線の下）', added, ['シフト', ...menuItems.flatMap((item) => ((item.separatorBefore ? ['---'] : []) as any[]).concat([{ label: item.label, functionName: item.functionName }])), 'shown'])
check(
  '③ メニューの 5 項目の functionName は、どれも main.gs の最上位の関数である',
  menuItems.map((item) => typeof gas[item.functionName]),
  ['function', 'function', 'function', 'function', 'function'],
)
check(
  '③ 先頭の 4 項目の表示名と呼び先は、これまでと同じである（担当者の操作を増やさない。5 つ目の「バージョン」は末尾に足しただけ）',
  menuItems.map((item) => [item.label, item.functionName]),
  [
    ['フォームを作る', 'createForm'],
    ['生成', 'runGeneration'],
    ['画像を書き出す', 'exportImages'],
    ['来年用に空にする', 'clearForNextYear'],
    ['バージョン', 'showVersion'],
  ],
)

// ---- ④ HTML -----------------------------------------------------------------

for (const name of htmlNames) {
  const html = fs.readFileSync(path.join(outdir, `${name}.html`), 'utf8')
  const script = renderScript(`${name}.ts`)
  check(
    `④ ${name}.html は外から読み込む script を持たず、src/ui/${name}.ts を変換した中身がそのまま入っている`,
    [
      /<script[^>]*\bsrc=/i.test(html),
      html.includes(
        script
          .split('\n')
          .map((line) => (line === '' ? line : `      ${line}`))
          .join('\n'),
      ),
      html === renderHtml(name),
    ],
    [false, true, true],
  )
}

// ---- ⑤ 突き合わせそのものが食い違いを止める ---------------------------------

check(
  '⑤ 一覧から 1 つ落とすと、足りない名前を名指しする。余計な名前を足すと、呼ばれていない名前を名指しする',
  [
    mismatch(
      listedNames.filter((name) => name !== 'exportImagesFromDialog'),
      expectedNames,
    ),
    mismatch([...listedNames, 'oldRemovedFunction'], expectedNames),
  ],
  [
    { notListed: ['exportImagesFromDialog'], notCalled: [] },
    { notListed: [], notCalled: ['oldRemovedFunction'] },
  ],
)
check(
  '⑤ HTML の呼び先を拾う: 成功・失敗のハンドラは数えず、鎖のサーバー側の関数を返す（ハンドラ無しでも、1 ファイルに 2 か所あっても）。google.script.run が無ければ空である',
  [
    calledFromHtml('google.script.run\n  .withSuccessHandler(show)\n  .withFailureHandler(function (e) { say(e.message) })\n  .someServerFunction({ a: 1 })'),
    calledFromHtml('google.script.run.withSuccessHandler(done).other()'),
    calledFromHtml('document.getElementById("x")'),
    calledFromHtml('google.script.run.f(x)'),
    calledFromHtml('google.script.run.withSuccessHandler(function (a) { b(a) }).first()\ngoogle.script.run.second({ k: 1 })'),
  ],
  [['someServerFunction'], ['other'], [], ['f'], ['first', 'second']],
)

// ---- ⑥ 版 -------------------------------------------------------------------
// 実機のコピーから読めること（メニューの「バージョン」を押す）は #331 に預ける。ここでは、Node の上で
// 「ビルドが版を定数に埋める」「タグがあればタグ・無ければ短い SHA」「メニューの関数が版を出す」を見る。

const embedded = await renderMain('v9-test')
check('⑥ ビルドは、渡された版を main.gs の定数 buildVersion に埋める（別の版を渡すと、その版になる）', [/buildVersion = [^\n]*"v9-test"/.test(embedded), /buildVersion = [^\n]*"v8-other"/.test(await renderMain('v8-other'))], [true, true])

const toasts: any[] = []
gasGlobal.SpreadsheetApp = {
  getActive() {
    return {
      toast(...args) {
        toasts.push(args)
      },
    }
  },
}
const versionLoadable = path.join(outdir, 'version-loadable.mjs')
fs.writeFileSync(versionLoadable, `${embedded}\nexport { showVersion }\n`)
const versioned = await import(pathToFileURL(versionLoadable).href)
versioned.showVersion()
check('⑥ 埋めた版は、メニューの「バージョン」（showVersion）が画面に出す', toasts, [['このスクリプトの版: v9-test', 'シフト', 10]])
check('⑥ ビルドを通さない手元の実行では版は dev になる（埋まっていないことが読める）', versionMessage(), 'このスクリプトの版: dev')

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-version-'))
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
git('init', '-q')
fs.writeFileSync(path.join(repo, 'f.txt'), 'a')
git('add', 'f.txt')
git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'first')
const shortSha = git('rev-parse', '--short', 'HEAD')
const noTag = resolveVersion(repo)
git('tag', 'v1')
const oneTag = resolveVersion(repo)
git('tag', 'v2')
const twoTags = resolveVersion(repo)
fs.writeFileSync(path.join(repo, 'f.txt'), 'b')
const dirty = resolveVersion(repo)
fs.writeFileSync(path.join(repo, 'f.txt'), 'a')
const clean = resolveVersion(repo)
fs.writeFileSync(path.join(repo, 'untracked.txt'), 'x')
const untracked = resolveVersion(repo)
git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'second')
const afterTag = resolveVersion(repo)
check('⑥ 版は、タグが無ければ短い SHA・あればそのタグ・複数ならバージョン順の最後・タグより進んだ commit では SHA に戻る', [noTag === shortSha, oneTag, twoTags, afterTag === git('rev-parse', '--short', 'HEAD'), afterTag === shortSha], [true, 'v1', 'v2', true, false])
check('⑥ 追跡ファイルを書き換えると版に -dirty が付き、戻すと外れる（追跡していないファイルは数えない）', [dirty, clean, untracked], ['v2-dirty', 'v2', 'v2'])
check('⑥ git の無い場所では止まらず unknown になる', resolveVersion(fs.mkdtempSync(path.join(os.tmpdir(), 'shift-nogit-'))), 'unknown')
check('⑥ このリポジトリで resolveVersion は空でない版（タグか SHA）を返す', resolveVersion().length > 0, true)

fs.rmSync(repo, { recursive: true, force: true })
fs.rmSync(outdir, { recursive: true, force: true })
