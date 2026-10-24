// 検査の 1 件 — node:test の it と node:assert の deepStrictEqual に渡す薄い口。
//
//   check(見出し, 実測, 期待)
//
// 検査のファイルは上から順に盤面を作り替えていくので、実測は呼んだその場で決まっていなければならない。
// it の中に式を置くと、盤面が先へ進んだ後に評価されてしまう。だから実測と期待は呼んだ時点で値にし、
// it の中では比べるだけにする（見出しは it の名前になる）。
//
// 比べる前に JSON に通すのは、これまでの検査（JSON.stringify の一致）と同じ緩さを保つためである。
// vm の文脈が作った配列とこちらの配列は prototype が別なので、そのままだと deepStrictEqual が落ちる。

import { it } from 'node:test'
import assert from 'node:assert/strict'

/** JSON に通した値。undefined は JSON にならないので、そのまま返す。 */
function plain(value) {
  const text = JSON.stringify(value)
  return text === undefined ? undefined : JSON.parse(text)
}

export function check(title, actual, expected) {
  const now = plain(actual)
  const want = plain(expected)
  it(title, () => {
    assert.deepStrictEqual(now, want)
  })
}
