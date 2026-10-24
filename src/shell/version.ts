/**
 * このスクリプトの版（→ build.mjs、docs/agent/ADR/dev-env/0001）。
 *
 * npm run build が、HEAD の git タグ（無ければ短い SHA）を __BUILD_VERSION__ に埋めて dist/main.gs の定数にする。
 * 手元の検査（ビルドを通さない）では埋まらないので、'dev' になる。
 * 担当者は、メニュー「シフト」の末尾「バージョン」で読める。引き継ぎで「これはどの版か」と聞かれたときの答えである。
 */

declare const __BUILD_VERSION__: string | undefined

export const buildVersion: string = typeof __BUILD_VERSION__ === 'string' ? __BUILD_VERSION__ : 'dev'

/** 「バージョン」を押したときに出す文。 */
export function versionMessage(version: string = buildVersion): string {
  return `このスクリプトの版: ${version}`
}
