/**
 * Apps Script が名前で呼ぶ関数の一覧（→ src/README.md「コアと殻の境目」）。
 *
 * ビルドは、ここに並べた名前ぶんの function 宣言を dist/main.gs の最上位に出す（→ build.mjs）。
 * エディタの関数一覧と、メニュー・トリガー・google.script.run は、最上位の function を名前で引くからである。
 * 並べ忘れた関数は、ビルドが出さないので呼べない。逆に、並べたのに無い名前は import が解決せず、ビルドが止まる。
 *
 * 並べる名前は 4 つの出どころから来る。それぞれ src/entry.test.ts が突き合わせる。
 *   - トリガー: onOpen ／ onEdit
 *   - メニュー: menuItems の functionName（→ shell/menu.ts）
 *   - HTML: google.script.run が呼ぶ名前（→ ui/*.ts）
 *   - 手で実行する: buildTemplate（テンプレートを組むときにエディタから走らせる）
 *   - E2E 用: e2eGenerate ／ e2eCheckStructure ／ e2eClearForNextYear ／ e2eUnlinkAnswers（npm run e2e が Execution API で呼ぶ。メニューにも画面にも出さない → shell/e2e.ts）
 */

import { createFormFromPicker } from './shell/build-form.ts'
import { buildTemplate } from './shell/build-template.ts'
import { clearForNextYear } from './shell/clear-for-next-year.ts'
import { e2eCheckStructure, e2eClearForNextYear, e2eGenerate, e2eUnlinkAnswers } from './shell/e2e.ts'
import { createForm, exportImages, exportImagesFromDialog, onEdit, onOpen, runGeneration, showVersion } from './shell/menu.ts'

export const entryPoints = {
  // トリガー
  onOpen,
  onEdit,
  // メニュー「シフト」の 5 項目
  createForm,
  runGeneration,
  exportImages,
  clearForNextYear,
  showVersion,
  // HTML から google.script.run で呼ばれる
  exportImagesFromDialog,
  createFormFromPicker,
  // 手で実行する
  buildTemplate,
  // E2E 用（メニューにも画面にも出さない）
  e2eGenerate,
  e2eCheckStructure,
  e2eClearForNextYear,
  e2eUnlinkAnswers,
}
