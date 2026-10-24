/**
 * E2E（npm run e2e → e2e/README.md）が Execution API で呼ぶ口。メニューにも画面にも出さない。
 *
 * メニューの入口（menu.ts）は getUi() と toast を掴むので、Execution API からは呼べない。
 * ここは、その中身を呼ぶ無引数の口である — getActive() で包むだけで、規則も文言も足さない。
 * 手元の検査と同じ関数を、実機の SpreadsheetApp の上で走らせて、同じ結果になるかを見るためにある。
 */

import { clearForNextYearOn, unlinkAnswersOn } from './clear-for-next-year.ts'
import { runOnActiveSpreadsheet } from './shell.ts'
import { checkStructure } from './verify-structure.ts'

/** 生成を 1 回走らせる。返すのはコアの出力と、スクリプトの中で測った所要時間（ミリ秒）である。 */
export function e2eGenerate() {
  const startedAt = Date.now()
  const output = runOnActiveSpreadsheet()
  return { ms: Date.now() - startedAt, output: output }
}

/** 構造を確かめる。崩れていれば、メニューの生成と同じ例外で止まる。崩れていなければ空の配列を返す。 */
export function e2eCheckStructure() {
  return checkStructure(SpreadsheetApp.getActive())
}

/** 来年用に空にする本体を、確認なしで呼ぶ。返すのは外したフォームの URL とやったことの記録である。 */
export function e2eClearForNextYear() {
  return clearForNextYearOn(SpreadsheetApp.getActive())
}

/** 「回答」とフォームの紐付けだけを外す。「回答」が無い・紐付いていなければ何もせず null を返す（npm run e2e の頭の後始末）。 */
export function e2eUnlinkAnswers() {
  return unlinkAnswersOn(SpreadsheetApp.getActive())
}
