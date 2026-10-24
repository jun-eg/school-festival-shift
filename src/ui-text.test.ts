#!/usr/bin/env node
// ダイアログの失敗の文の検査 — 頭の `Error: ` が外れること、2 枚が同じ処理を通ることを見る（→ #351）。
//
//   使い方: node src/ui-text.test.ts
//
//   ① 頭の `Error: ` だけが外れる（本文の途中の語・頭が違う文は触らない）
//   ② ビルドした 2 枚の HTML は、失敗の受け手で error.message をそのまま足さず、外す処理を通している
//   ③ 実際に動かすと、2 枚とも失敗の文に `Error: ` が出ない（偽の google.script.run と document で動かす）

import vm from 'node:vm'
import { renderHtml, renderScript } from '../build.mjs'
import { check } from '../test/check.ts'
import { failureText } from './ui/failure-text.ts'

check('① 頭の Error: だけを外す', [failureText({ message: 'Error: このファイルにはもうフォームがあります' }), failureText({ message: '画像が大きすぎます' }), failureText({ message: 'x Error: y' }), failureText('Error: z')], ['このファイルにはもうフォームがあります', '画像が大きすぎます', 'x Error: y', 'z'])

for (const name of ['export-images', 'form-picker']) {
  const html = renderHtml(name)
  check(`② ${name}.html は失敗の受け手で error.message を直に足さない`, [/\+\s*error\.message/.test(html), html.includes('Error: ')], [false, true])
}

/** script を偽の画面で動かし、失敗の受け手に Error: 付きの例外を渡して、画面に出た文を返す。 */
function shownOnFailure(name: string, press: boolean): string {
  const elements: Record<string, any> = {}
  const element = (id: string) => {
    if (!elements[id]) {
      elements[id] = {
        id,
        textContent: '',
        className: '',
        hidden: false,
        files: [{ type: 'image/png', name: 'a.png' }],
        addEventListener(_type: string, fn: () => void) {
          this.click = fn
        },
        appendChild() {},
      }
    }
    return elements[id]
  }
  let failure: ((error: { message: string }) => void) | undefined
  const run: any = {
    withSuccessHandler: () => run,
    withFailureHandler: (fn: typeof failure) => {
      failure = fn
      return run
    },
    createFormFromPicker: () => {},
    exportImagesFromDialog: () => {},
  }
  class FakeReader {
    result = 'data:image/png;base64,AAAA'
    onload: () => void = () => {}
    onerror: () => void = () => {}
    readAsDataURL() {
      this.onload()
    }
  }
  vm.runInNewContext(renderScript(`${name}.ts`), { document: { getElementById: element, createElement: () => element('x') }, google: { script: { run } }, FileReader: FakeReader, setTimeout })
  if (press) element('run').click()
  failure?.({ message: 'Error: 本文' })
  return element('state').textContent
}

for (const [name, press] of [
  ['export-images', false],
  ['form-picker', true],
] as const) {
  const shown = shownOnFailure(name, press)
  check(`③ ${name} の失敗の文に Error: が出ない`, [shown.includes('Error:'), shown.endsWith('：本文')], [false, true])
}
