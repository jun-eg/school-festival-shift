#!/usr/bin/env node
// コアと殻の境目の検査 — src/core/ が殻にも Apps Script のグローバルにも寄りかかっていないことを、コードの上で見る。
//
//   使い方: node src/boundary.test.ts
//
// 見るものは 3 つある（→ docs/agent/tech-requirements.md 6 の #8、src/README.md「コアと殻の境目」）。
//   ① src/core/ の import が src/core/ の中だけを指す（src/shell/ ・ src/ui/ ・ src/entry.ts ・ パッケージを指さない）
//   ② src/core/ が Apps Script のグローバル（SpreadsheetApp など）を参照しない
//   ③ ①②の検出そのものが、止めるべき書き方を止める（偽の例で確かめる）
//
// SpreadsheetApp を掴むファイルの数え上げは src/core/core.test.ts の ① が持つ。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { check } from '../test/check.ts'
import { identifiersIn, importSpecifiersIn } from '../test/source.ts'

const srcDir = path.dirname(fileURLToPath(import.meta.url))
const coreDir = path.join(srcDir, 'core')

/** Apps Script が置くグローバル。console はブラウザにも Node にもあるので数えない。 */
const gasGlobals = [
  'SpreadsheetApp',
  'FormApp',
  'HtmlService',
  'DriveApp',
  'Utilities',
  'PropertiesService',
  'CacheService',
  'ScriptApp',
  'Session',
  'LockService',
  'UrlFetchApp',
  'DocumentApp',
  'SlidesApp',
  'CardService',
  'MailApp',
  'GmailApp',
  'CalendarApp',
  'ContentService',
  'Logger',
  'Browser',
  'Charts',
  'Maps',
  'XmlService',
  'Jdbc',
  // globalThis.SpreadsheetApp の形で掴むのも止める（. の後ろの名前は見えないので、globalThis そのものを止める）。
  'globalThis',
]

/** file（src/ からの相対パス）の import のうち、src/core/ の外を指すもの。 */
function importsOutsideCore(file, source) {
  const from = path.dirname(path.join(srcDir, file))
  return importSpecifiersIn(source).filter((specifier) => {
    if (!specifier.startsWith('.')) return true
    const target = path.resolve(from, specifier)
    return target !== coreDir && !target.startsWith(coreDir + path.sep)
  })
}

/** コードが参照している Apps Script のグローバル（コメントと文字列の中は数えない）。 */
function gasGlobalsUsedIn(source) {
  const used = identifiersIn(source)
  return gasGlobals.filter((name) => used.has(name))
}

const coreFiles = fs
  .readdirSync(coreDir)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .sort()
const sources = Object.fromEntries(coreFiles.map((name) => [name, fs.readFileSync(path.join(coreDir, name), 'utf8')]))

// ---- ① import が core/ の中だけを指す ---------------------------------------

check(
  '① src/core/ の import は、すべて src/core/ の中を指す（shell/ ・ ui/ ・ entry.ts ・ パッケージを指さない）',
  coreFiles.flatMap((name) => importsOutsideCore(path.join('core', name), sources[name]).map((specifier) => `${name} → ${specifier}`)),
  [],
)

check('① src/core/ のファイルは 13 本（型の types.ts を足した）あり、import を読み取れている（検査が空振りしていない）', [coreFiles.length, coreFiles.filter((name) => importSpecifiersIn(sources[name]).length > 0).length >= 8], [13, true])

// ---- ② Apps Script のグローバルを参照しない ---------------------------------

check(
  '② src/core/ は Apps Script のグローバル（SpreadsheetApp など）を 1 つも参照しない',
  coreFiles.flatMap((name) => gasGlobalsUsedIn(sources[name]).map((global) => `${name} → ${global}`)),
  [],
)

// ---- ③ 止めるべき書き方を止める ---------------------------------------------

check(
  '③ core/ から shell/ への import は止まる（相対パスの書き方が違っても）',
  [
    importsOutsideCore('core/a.ts', "import { run } from '../shell/shell.ts'\n"),
    importsOutsideCore('core/a.ts', "import {\n  run,\n  recount,\n} from '../shell/shell.ts'\n"),
    importsOutsideCore('core/a.ts', "export { run } from '../shell/shell.ts'\n"),
    importsOutsideCore('core/a.ts', "const later = await import('../shell/shell.ts')\n"),
    importsOutsideCore('core/a.ts', "import '../entry.ts'\n"),
  ],
  [['../shell/shell.ts'], ['../shell/shell.ts'], ['../shell/shell.ts'], ['../shell/shell.ts'], ['../entry.ts']],
)

check(
  '③ core/ の中どうしの import と、コメント・文字列に書いた import は止まらない',
  [importsOutsideCore('core/a.ts', "import { build } from './core.ts'\n"), importsOutsideCore('core/a.ts', "import { build } from '../core/core.ts'\n"), importsOutsideCore('core/a.ts', "// import { run } from '../shell/shell.ts'\nconst text = \"import x from '../shell/shell.ts'\"\n")],
  [[], [], []],
)

check('③ パッケージの import は止まる', importsOutsideCore('core/a.ts', "import fs from 'node:fs'\nimport x from 'left-pad'\n"), ['node:fs', 'left-pad'])

check(
  '③ Apps Script のグローバルの参照は止まり、コメントと文字列の中の名前は止まらない',
  [
    gasGlobalsUsedIn('function f() { return SpreadsheetApp.getActive() }'),
    gasGlobalsUsedIn('const form = FormApp.create(`${Utilities.formatDate(d)}`)'),
    gasGlobalsUsedIn("// SpreadsheetApp を掴まない\nconst text = 'SpreadsheetApp'\n/* FormApp */\nconst ok = typeof console\n"),
    gasGlobalsUsedIn('const x = sheet.SpreadsheetApp'),
    gasGlobalsUsedIn('const ss = globalThis.SpreadsheetApp.getActive()'),
  ],
  [['SpreadsheetApp'], ['FormApp', 'Utilities'], [], [], ['globalThis']],
)
