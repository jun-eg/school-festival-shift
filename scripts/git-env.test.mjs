// git-env の検査 — 外から GIT_DIR が渡されても、検査・ビルドの git が本物の repo を書き換えない（issue #354）。
// 使い捨ての repo と worktree を作り、その中だけで確かめる。この repo の .git は触らない。

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { envWithoutGit } from './git-env.mjs'

test('GIT_ で始まるものだけを落とす', () => {
  const env = envWithoutGit({ GIT_DIR: 'a', GIT_INDEX_FILE: 'b', GIT_EXEC_PATH: 'c', PATH: '/bin', HOME: '/h', MY_GIT_X: '1' })
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h', MY_GIT_X: '1' })
})

/** 掃除済みの env（GIT_* 無し）で git を呼ぶ。使い捨ての repo を組むのに使う。 */
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: envWithoutGit(), stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function 使い捨て() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'git-env-test-'))
  const main = path.join(base, 'main')
  fs.mkdirSync(main)
  git(main, 'init', '-q')
  fs.writeFileSync(path.join(main, 'f.txt'), 'a')
  git(main, 'add', 'f.txt')
  git(main, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'first')
  git(main, 'worktree', 'add', '-q', path.join(base, 'wt'), '-b', 'wt')
  const gitDir = path.join(main, '.git', 'worktrees', 'wt')
  assert.ok(fs.existsSync(gitDir))
  return { base, main, gitDir, other: fs.mkdtempSync(path.join(base, 'other-')) }
}

/** GIT_DIR を worktree の git ディレクトリに向けた子で、script を走らせる。 */
const 子で走らせる = (gitDir, cwd, script) => execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd, encoding: 'utf8', env: { ...process.env, GIT_DIR: gitDir } }).trim()

const bareOf = (main) => git(main, 'config', '--get', 'core.bare')

test('止まる形 — 掃除しない git init は、渡された GIT_DIR の repo に bare = true を書く（この検査の前提）', () => {
  const { base, main, gitDir, other } = 使い捨て()
  try {
    execFileSync('git', ['init', '-q'], { cwd: other, env: { ...process.env, GIT_DIR: gitDir } })
    assert.equal(bareOf(main), 'true')
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('通る形 — GIT_DIR を渡されても、掃除した git init は本物の repo の config・refs・タグを変えない', () => {
  const { base, main, gitDir, other } = 使い捨て()
  try {
    const before = [fs.readFileSync(path.join(main, '.git', 'config'), 'utf8'), git(main, 'for-each-ref'), git(main, 'tag', '-l')]
    const helper = pathToFileURL(path.join(import.meta.dirname, 'git-env.mjs')).href
    子で走らせる(
      gitDir,
      other,
      `import { execFileSync } from 'node:child_process'
import { envWithoutGit } from ${JSON.stringify(helper)}
const run = (...a) => execFileSync('git', a, { env: envWithoutGit() })
run('init', '-q')
run('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'x')
run('tag', 'v1')`,
    )
    const after = [fs.readFileSync(path.join(main, '.git', 'config'), 'utf8'), git(main, 'for-each-ref'), git(main, 'tag', '-l')]
    assert.deepEqual(after, before)
    assert.equal(bareOf(main), 'false')
    assert.equal(git(other, 'tag', '-l'), 'v1')
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('通る形 — GIT_DIR を渡されても、resolveVersion は cwd の repo を見る（git の無い場所は unknown）', () => {
  const { base, main, gitDir, other } = 使い捨て()
  try {
    const build = pathToFileURL(path.join(import.meta.dirname, '..', 'build.mjs')).href
    const script = (cwd) => `import { resolveVersion } from ${JSON.stringify(build)}\nconsole.log(resolveVersion(${JSON.stringify(cwd)}))`
    assert.equal(子で走らせる(gitDir, other, script(other)), 'unknown')
    assert.equal(子で走らせる(gitDir, other, script(main)), git(main, 'rev-parse', '--short', 'HEAD'))
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})
