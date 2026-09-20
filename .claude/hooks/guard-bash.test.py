#!/usr/bin/env python3
"""ガードが止める形・通す形を 1 本ずつ確かめる。

    python3 .claude/hooks/guard-bash.test.py                          # 既定（python3 版）
    python3 .claude/hooks/guard-bash.test.py .claude/hooks/guard-bash.sh   # jq + grep 版

**この 34 件が契約である。** 実装が python3 でも jq + grep でも、同じここを通る。
依存はゼロである（Python の標準だけを使う）。何も書き換えない。
全件一致なら終了コード 0、1 つでも外れたら 1 で落ちる。
"""

import json
import os
import subprocess
import sys

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
]

# 通ってほしい形（止めすぎていないか）
ALLOW = [
    "git push origin foo",
    "git push -u origin foo",
    "git push --follow-tags origin main",
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

def run(cmd):
    out = subprocess.run(HOOK, input=json.dumps({"tool_name": "Bash", "tool_input": {"command": cmd}}),
                         capture_output=True, text=True)
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

print()
print(f"{TARGET}: {len(DENY)+len(ALLOW)} cases, {len(fails)} failures")
for kind, cmd in fails:
    print(f"  {kind}: {cmd}")
sys.exit(1 if fails else 0)
