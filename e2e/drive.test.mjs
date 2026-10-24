// e2e/drive.mjs の、ネットワークを使わない部分の検査。npm test が回す（E2E そのものは回さない）。
//   使い方: node e2e/drive.test.mjs

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formFileIdOf } from './drive.mjs'

test('編集用の URL からフォームのファイル ID を取る', () => {
  assert.equal(formFileIdOf('https://docs.google.com/forms/d/1AbC_-xyz/edit'), '1AbC_-xyz')
})

test('配る用の URL（…/forms/d/e/…）は別の ID なので、ファイルの ID として読まない', () => {
  assert.equal(formFileIdOf('https://docs.google.com/forms/d/e/1FAIpQLSabc/viewform'), null)
})

test('フォームの URL でないもの・空は null で、何も捨てない', () => {
  assert.equal(formFileIdOf(''), null)
  assert.equal(formFileIdOf(undefined), null)
  assert.equal(formFileIdOf('https://docs.google.com/spreadsheets/d/1AbC/edit'), null)
})
