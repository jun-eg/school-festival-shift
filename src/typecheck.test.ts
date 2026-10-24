#!/usr/bin/env node
// 型検査の設定の検査 — tsconfig.json の設定が、止めるべき書き方を止めていることを、わざと悪い 1 本を tsc に食わせて見る。
//
//   使い方: node src/typecheck.test.ts
//
// 見るものは 4 つある（→ tsconfig.json、src/README.md「型を検査する」）。
//   ① 悪い書き方が無ければ通る（以降の ②〜④ が、設定の誤りで落ちているのではないことの対照）
//   ② es2019 に無い API（structuredClone ・ replaceAll）を使うと落ちる — Apps Script の V8 に無い API を手元で弾く
//   ③ 型剥がしで走らない書き方（enum）を書くと落ちる — erasableSyntaxOnly
//   ④ 型だけの import を import type にしないと落ちる — verbatimModuleSyntax（型剥がしが消さず、実行時の SyntaxError になる）
//
// 悪い 1 本は os.tmpdir() に書き、リポジトリには置かない。tsc は npm run typecheck と同じものを使う。

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { check } from '../test/check.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-typecheck-'))

// 型の import 先は、本物の src/core/types.ts を指す。
const types = path.join(root, 'src', 'core', 'types.ts')

const files: Record<string, string> = {
  'fine.ts': `import type { Slot } from '${types}'\nexport const slot: Slot = { start: '08:00', end: '08:30' }\n`,
  'new-api.ts': "export const copy = structuredClone({ a: 1 })\nexport const text = 'a-b'.replaceAll('-', '_')\n",
  'enum.ts': 'export enum Kind { A, B }\n',
  'type-import.ts': `import { Slot } from '${types}'\nexport const slot: Slot = { start: '08:00', end: '08:30' }\n`,
}
for (const [name, source] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), source)

fs.writeFileSync(
  path.join(dir, 'tsconfig.json'),
  JSON.stringify({
    extends: path.join(root, 'tsconfig.json'),
    compilerOptions: { typeRoots: [path.join(root, 'node_modules', '@types')] },
    include: [path.join(dir, '*.ts')],
    exclude: [],
  }),
)

const result = spawnSync(process.execPath, [tsc, '-p', path.join(dir, 'tsconfig.json'), '--pretty', 'false'], { encoding: 'utf8' })
const output = `${result.stdout}${result.stderr}`
fs.rmSync(dir, { recursive: true, force: true })

/** tsc の出力のうち、そのファイルについての行の、エラー番号。 */
function errorsIn(name: string): string[] {
  return output
    .split('\n')
    .filter((line) => line.includes(`${name}(`))
    .map((line) => (/error (TS\d+)/.exec(line) || [])[1])
    .filter(Boolean)
}

check('① 悪い書き方が無い 1 本は、tsc を通る（②〜④ が設定の誤りで落ちているのではない）', errorsIn('fine.ts'), [])
check('② es2019 に無い API（structuredClone ・ replaceAll）を使うと、tsc が落ちる', [errorsIn('new-api.ts').includes('TS2304'), errorsIn('new-api.ts').includes('TS2550')], [true, true])
check('③ enum を書くと、tsc が落ちる（erasableSyntaxOnly — 型剥がしで走らない）', errorsIn('enum.ts'), ['TS1294'])
check('④ 型だけの import を import type にしないと、tsc が落ちる（verbatimModuleSyntax）', errorsIn('type-import.ts'), ['TS1484'])
