// git を「この cwd の repo」に対して呼ぶための環境変数。外から渡された GIT_*（GIT_DIR・GIT_INDEX_FILE など）を落とす（issue #354）。
//
// hook や worktree のセッションは GIT_DIR を worktree の git ディレクトリに向けたまま子を起こす。
// それを引き継いだ git は、cwd が別の場所でも本物の repo を読み書きする。一時 repo の `git init` は
// 本物の .git/config に `bare = true` を書き、メインの checkout が「must be run in a work tree」で止まる。
//
// 使い分け: 一時 repo を作る所・cwd の repo を読むだけの所（build.mjs の resolveVersion、src/entry.test.ts）はこれを env に渡す。
// 本物の repo を読むのが目的の所（scripts/要約の検査.mjs・scripts/秘密の検査.mjs・.githooks/pre-push）は渡さない
// （hook が渡す GIT_INDEX_FILE などを、意図して使う）。

/** env から GIT_ で始まるものを落とした写し。足したいものは呼び出し側が後から足す。 */
export function envWithoutGit(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('GIT_')))
}
