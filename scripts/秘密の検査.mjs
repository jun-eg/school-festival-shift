#!/usr/bin/env node
// 秘密の検査 — commit しようとしている物に、トークン・OAuth の鍵・E2E の ID が混ざっていないかを見る（→ e2e/README.md）。
//
//   使い方: node scripts/秘密の検査.mjs        （ステージされた物を見る。.githooks/pre-commit が回す）
//
// 見るものは 2 つある。
//   ① 名前 — .env ・ .clasprc.json ・ creds.json ・ *-creds.json ・ client_secret*.json（.env.example は空の雛形なので通す）。
//      .gitignore が名指しして git add を拒むが、git add -f で入るので、ここでも止める
//   ② 中身 — Google のアクセストークン・リフレッシュトークン・OAuth クライアントの秘密・秘密鍵・OAuth クライアント ID の形、
//      JSON の "refresh_token" "access_token" "client_secret" "private_key" に値が付いた形、
//      そして手元の .env に書いてある E2E の ID（スプレッドシート・スクリプト・GCP プロジェクト）そのもの
//
// 止まったら、どのファイルの何に当たったかだけを出す。一致した値そのものは出さない。

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const forbiddenNames = [/^\.env$/, /^\.env\.(?!example$).+$/, /^\.clasprc\.json$/, /^creds\.json$/, /-creds\.json$/, /^client_secret.*\.json$/]

const contentPatterns = [
  ['Google のアクセストークンの形', /ya29\.[0-9A-Za-z_-]{20,}/],
  ['Google のリフレッシュトークンの形', /\b1\/\/[0-9A-Za-z_-]{20,}/],
  ['OAuth クライアントの秘密の形', /GOCSPX-[0-9A-Za-z_-]{10,}/],
  ['OAuth クライアント ID の形', /\b\d{10,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com/],
  ['秘密鍵', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['トークン・秘密の JSON（値が付いている）', /"(refresh_token|access_token|client_secret|private_key)"\s*:\s*"[^"]{8,}"/],
]

/** 手元の .env に書いてある値（8 文字以上）を、そのものとして探す。 */
export function knownValues(envText) {
  const values = []
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*(SFS_E2E_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) {
      const value = m[2].replace(/^(['"])(.*)\1$/, '$2')
      if (value.length >= 8) values.push([m[1], value])
    }
  }
  return values
}

/**
 * files: [{ path, text }]。見つけた問題の一覧を返す（空なら通る）。一致した値そのものは含めない。
 * known: [[名前, 値]]（knownValues の返り値）。
 */
export function scan(files, known = []) {
  const problems = []
  for (const file of files) {
    if (forbiddenNames.some((re) => re.test(path.basename(file.path)))) {
      problems.push(`${file.path}: 秘密を置くファイルの名前である（commit しない）`)
      continue
    }
    for (const [label, re] of contentPatterns) {
      if (re.test(file.text)) problems.push(`${file.path}: ${label}が入っている`)
    }
    for (const [name, value] of known) {
      if (file.text.includes(value)) problems.push(`${file.path}: .env の ${name} の値が入っている`)
    }
  }
  return problems
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = git('rev-parse', '--show-toplevel').trim()
  const names = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').split('\0').filter(Boolean)
  const files = names.map((name) => {
    const buffer = execFileSync('git', ['show', `:${name}`], { maxBuffer: 256 * 1024 * 1024 })
    return { path: name, text: buffer.includes(0) ? '' : buffer.toString('utf8') }
  })
  // e2e/env.mjs と同じ置き場: worktree の直下の .env、無ければ ~/.config/sfs-e2e/.env
  const envFile = [path.join(root, '.env'), path.join(os.homedir(), '.config/sfs-e2e/.env')].find((file) => fs.existsSync(file))
  const known = envFile ? knownValues(fs.readFileSync(envFile, 'utf8')) : []
  if (!envFile) console.log('秘密の検査: .env がどちらにも無いので、E2E の ID は見ていない（トークン・鍵の形だけ見る）')
  const problems = scan(files, known)
  if (problems.length > 0) {
    console.error('秘密の検査: commit を止めた。トークン・鍵・E2E の ID は commit しない（→ e2e/README.md）')
    for (const p of problems) console.error(`  ${p}`)
    process.exit(1)
  }
  console.log(`秘密の検査: ${files.length} 件を見て、混ざりは無かった`)
}
