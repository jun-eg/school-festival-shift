#!/usr/bin/env python3
"""ガードが止める形・通す形を 1 本ずつ確かめる。

    python3 .claude/hooks/guard-bash.test.py              # 既定（guard-bash.py）
    python3 .claude/hooks/guard-bash.test.py 別の実装のパス   # 実装を入れ替えるとき

**この一覧が契約であって、実装ではない。** 実装を書き直しても、通るべきはここである。
依存はゼロである（Python の標準だけを使う）。何も書き換えない。
`gh pr merge` の base は PATH の先頭に置いた偽の `gh` が答える（12 → main、34 → クッション branch、99 → 引けない）。
ネットワークには出ない。
全件一致なら終了コード 0、1 つでも外れたら 1 で落ちる。
"""

import json
import os
import stat
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "guard-bash.py")
# .py は sys.executable 経由、それ以外は実行権限で直に呼ぶ
HOOK = [sys.executable, TARGET] if TARGET.endswith(".py") else [TARGET]

# 止まってほしい形
DENY = [
    "git push --force origin foo",
    "git push origin foo --force",
    "git push -f origin foo",
    "git push origin foo -f",
    "git push --force-with-lease origin foo",
    "git push origin +main",
    "git push origin +main:main",
    "git -C /tmp/x push origin main --force",
    "git rebase origin/main",
    "git rebase -i HEAD~3",
    "git commit --amend --no-edit",
    "git commit -m 'x' --amend",
    "git reset --hard origin/main",
    "gh api repos/o/r/issues/73 -X PATCH -f body=@body.md",
    "gh api repos/o/r/issues/73 -f body=@body.md -X PATCH",
    "gh api repos/o/r/issues/73 --raw-field body=@body.md",
    "gh api repos/o/r/issues/73 -fbody=@body.md",
    "git push --force-with-lease=origin/main origin main",
    "cd /tmp && git push origin main --force",
    "echo hi; gh api x -f body=@f.md",
    # pre-push を飛ばす道
    "git push --no-verify",
    "git push origin foo --no-verify",
    "git push --no-verify -u origin foo",
    "git push --no-ver origin foo",
    "git -C /tmp/x push --no-verify origin foo",
    "git -c core.hooksPath=/dev/null push origin foo",
    "git -C /tmp/x -c core.hooksPath=/dev/null push origin foo",
    "git --config-env=core.hooksPath=V push origin foo",
    "git --config-env core.hooksPath=V push origin foo",
    "cd /tmp && git push origin foo --no-verify",
    # main への push
    "git push origin main",
    "git push -u origin main",
    "git push origin HEAD:main",
    "git push origin foo:main",
    "git push origin worktree-320-x:refs/heads/main",
    # main 向けの PR の merge。base は偽の gh が答える
    "gh pr merge 12 --merge",
    "gh pr merge --merge",
    "gh pr merge",
    "gh pr merge 34 --rebase",
    "gh pr merge 99 --merge",
    "gh api -X PUT repos/o/r/pulls/12/merge",
    "gh api repos/o/r/pulls/34/merge -X PUT",
    "git push origin :main",
    "gh -R o/r pr merge 12 --merge",
    "gh --repo o/r pr merge 12 --merge",
    "gh --repo=o/r pr merge 12 --merge",
    "gh pr merge 34 -rd",
    "gh pr merge 34 -Ro/r --rebase",
    "gh pr merge 34 -Rx/y --merge",
    "gh -R x/y pr merge 34 --merge",
    "gh pr merge 34 --merge --repo=x/y",
    "gh pr -R o/r merge 12 --merge",
    "gh pr --repo=o/r merge 12 --merge",
    "gh pr -R x/y merge 34 --merge",
    "gh pr merge 34 --rebase=true",
    # remote の branch を消す形（削除はリポジトリ設定が担う）
    "git push origin --delete x",
    "git push --delete origin x",
    "git push origin x --delete",
    "git push --del origin x",
    "git push --prune origin 'refs/heads/*:refs/heads/*'",
    "git push --mirror origin",
    "git push --mir origin",
    "gh api graphql -f query='mutation { updateRefs(input: {}) { clientMutationId } }'",
    "git push -d origin x",
    "git push origin :x",
    "git push origin :refs/heads/x",
    "git -C /tmp/x push origin :x",
    "cd /tmp && git push origin --delete x",
    "gh pr merge 34 -md",
    "gh pr close 34 -d",
    "gh pr close 34 --delete-branch",
    "gh pr close 34 --comment x --delete-branch",
    "gh pr merge 34 --merge --delete-branch",
    "gh pr merge 34 --merge -d",
    "gh pr merge --delete-branch 34 --merge",
    "gh pr merge 34 --delete-branch=true --merge",
    "gh api -X DELETE repos/o/r/git/refs/heads/x",
    "gh api repos/o/r/git/refs/heads/x -X DELETE",
    "gh api --method DELETE repos/o/r/git/refs/heads/x",
    "gh api --method=DELETE repos/o/r/git/refs/heads/x",
    "gh api -XDELETE repos/o/r/git/refs/heads/x",
    "gh api graphql -f query='mutation { deleteRef(input: {refId: \"x\"}) { clientMutationId } }'",
]

# 通ってほしい形（止めすぎていないか）
ALLOW = [
    "git push origin foo",
    "git push -u origin foo",
    "git push --follow-tags origin foo",
    "git push -u origin worktree-320-x",
    "git push origin HEAD",
    "git commit -m 'no-verify の話'",
    "git push origin no-verify-branch",
    "git -c core.hooksPath=.githooks commit -m x",
    "gh pr merge 34 --merge",
    "gh pr merge 34 --merge --repo o/r",
    "gh -R o/r pr merge 34 --merge",
    "gh pr merge -m 34",
    "gh pr merge -Ro/r 34 --merge",
    "git push -u origin worktree-377-x",
    "git push origin worktree-377-x",
    "git push --dry-run origin foo",
    "gh pr close 34",
    "gh pr close 34 -c '-d'",
    "gh pr close 34 --delete-branch=false",
    "gh pr merge 34 --merge --delete-branch=false",
    "gh api repos/o/r/git/refs/heads/x",
    "gh api -X DELETE repos/o/r/issues/comments/5",
    "gh pr -R o/r merge 34 --merge",
    "gh pr view 12 --json baseRefName",
    "gh api repos/o/r/pulls/12",
    "gh pr checks 34 --watch",
    "git merge origin/main",
    "git rebase --abort",
    "git rebase --quit",
    "git commit -m 'force push の話'",
    'git commit -m "fix the --amend bug"',
    "git push --repo=origin",
    "git reset HEAD~1",
    "git restore --staged x",
    "gh api repos/o/r/issues/73 -X PATCH -F body=@body.md",
    "gh issue edit 73 --body-file body.md",
    "gh pr comment 72 --body-file c.md",
    "gh api repos/o/r/issues/73 -f title=hello",
    "ls -f",
    "grep -f patterns.txt file",
]

FAKE_GH = """#!/bin/sh
# 偽の gh。`gh pr view <N> --json baseRefName --jq .baseRefName [--repo o/r]` にだけ答える。
# repo が x/y なら番号に関わらず main（hook が repo を落とさず渡していることの確かめ）
case "$*" in
  *--repo\ x/y*) echo main; exit 0 ;;
esac
case "$3" in
  12) echo main ;;
  34) echo worktree-320-implement-skill ;;
  *) echo "no pull requests found" >&2; exit 1 ;;
esac
"""
fake_dir = tempfile.mkdtemp(prefix="guard-fake-gh-")
fake_gh = os.path.join(fake_dir, "gh")
with open(fake_gh, "w") as f:
    f.write(FAKE_GH)
os.chmod(fake_gh, os.stat(fake_gh).st_mode | stat.S_IXUSR)
ENV = dict(os.environ, PATH=fake_dir + os.pathsep + os.environ.get("PATH", ""))


def run(cmd):
    out = subprocess.run(HOOK, input=json.dumps({"tool_name": "Bash", "tool_input": {"command": cmd}}),
                         capture_output=True, text=True, env=ENV)
    assert out.returncode == 0, f"exit {out.returncode}: {out.stderr}"
    if not out.stdout.strip():
        return None
    return json.loads(out.stdout)["hookSpecificOutput"]["permissionDecision"]

fails = []
for cmd in DENY:
    d = run(cmd)
    mark = "OK  " if d == "deny" else "FAIL"
    if d != "deny": fails.append(("should deny", cmd))
    print(f"{mark} deny  | {cmd}")
for cmd in ALLOW:
    d = run(cmd)
    mark = "OK  " if d is None else "FAIL"
    if d is not None: fails.append(("should allow", cmd))
    print(f"{mark} allow | {cmd}")

# settings.json の deny が残っている（前置一致で止める層が消えていない）
SETTINGS = os.path.join(HERE, "..", "settings.json")
with open(SETTINGS, encoding="utf-8") as f:
    perms = json.load(f)["permissions"]
for rule in ["Bash(git push --force:*)", "Bash(git push --no-verify:*)", "Bash(git commit --amend:*)", "Bash(git reset --hard:*)"]:
    ok = rule in perms.get("deny", [])
    if not ok: fails.append(("settings.json deny から消えている", rule))
    print(f"{'OK  ' if ok else 'FAIL'} deny-rule  | {rule}")

print()
print(f"{TARGET}: {len(DENY)+len(ALLOW)} cases, {len(fails)} failures")
for kind, cmd in fails:
    print(f"  {kind}: {cmd}")
sys.exit(1 if fails else 0)
