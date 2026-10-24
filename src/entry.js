/**
 * Apps Script が名前で呼ぶ関数の一覧（→ src/README.md「コアと殻の境目」）。
 *
 * ビルドは、ここに並べた名前ぶんの function 宣言を dist/main.gs の最上位に出す（→ build.mjs）。
 * エディタの関数一覧と、メニュー・トリガー・google.script.run は、最上位の function を名前で引くからである。
 * 並べ忘れた関数は、ビルドが出さないので呼べない。逆に、並べたのに無い名前は import が解決せず、ビルドが止まる。
 *
 * 並べる名前は 4 つの出どころから来る。それぞれ src/entry.test.mjs が突き合わせる。
 *   - トリガー: onOpen ／ onEdit
 *   - メニュー: menuItems の functionName（→ shell/menu.js）
 *   - HTML: google.script.run が呼ぶ名前（→ ui/*.js）
 *   - 手で実行する: buildTemplate（テンプレートを組むときにエディタから走らせる）
 */

import { createFormFromPicker } from './shell/build-form.js'
import { buildTemplate } from './shell/build-template.js'
import { clearForNextYear } from './shell/clear-for-next-year.js'
import { createForm, exportImages, exportImagesFromDialog, onEdit, onOpen, runGeneration } from './shell/menu.js'

export const entryPoints = {
  // トリガー
  onOpen,
  onEdit,
  // メニュー「シフト」の 4 項目
  createForm,
  runGeneration,
  exportImages,
  clearForNextYear,
  // HTML から google.script.run で呼ばれる
  exportImagesFromDialog,
  createFormFromPicker,
  // 手で実行する
  buildTemplate,
}
