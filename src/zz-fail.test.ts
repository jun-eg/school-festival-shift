// 使い捨て: 検査を 1 件わざと落とし、main 向け PR がマージボタンで止まることを確かめる（#305）。merge しない
import assert from 'node:assert'
import test from 'node:test'

test('わざと落とす（#305 のブランチ保護の確かめ）', () => {
  assert.equal(1, 2)
})
