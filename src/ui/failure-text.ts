// 失敗の文を担当者に出せる形にする。export-images と form-picker の 2 枚が同じものを使う（ビルドが 1 本にまとめる → build.mjs の renderScript）。

/**
 * google.script.run の失敗の受け手に届く error.message は、サーバーで投げた例外が `Error: <本文>` の形になっている。
 * 担当者が読む文に英語の前置きが混ざらないよう、頭の `Error: ` だけを外す（本文の途中の語は触らない）。
 */
export function failureText(error: { message?: string } | string): string {
  var message = typeof error === 'string' ? error : String(error.message)
  return message.replace(/^Error: /, '')
}
