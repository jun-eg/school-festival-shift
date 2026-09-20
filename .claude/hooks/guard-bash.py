#!/usr/bin/env python3
"""PreToolUse(Bash) のガード。事故の形に当たるコマンドを実行前に落とす。

permissions.deny は前置一致なので `git push origin foo --force` のように
フラグが後ろへ回った形と、`gh api ... -f body=@file` のように
フラグがサブコマンド引数の後ろに来る形を拾えない。そこをここで止める。

判断の背景は .claude/README.md、経緯は issue #73。
"""

import json
import os
import re
import shlex
import sys

# git push で履歴を上書きする指定。`--force-with-lease=origin/main` のように値を付けた形も拾う
FORCE_LONG = re.compile(r"^--force(-with-lease|-if-includes)?(=|$)")
# `-f` 単体と `-fu` のような短縮フラグの束
FORCE_SHORT = re.compile(r"^-[a-zA-Z]*f[a-zA-Z]*$")
# rebase を始めない形だけは通す（途中で詰まったときの逃げ道）
REBASE_ESCAPES = ("--abort", "--quit")
# gh の `-f` / `--raw-field` はファイルを読まない
GH_RAW_FIELD = re.compile(r"^(-f|--raw-field)$")
GH_RAW_FIELD_INLINE = re.compile(r"^-f[A-Za-z_][A-Za-z0-9_.\[\]]*=@")

MSG_FORCE = (
    "force-push は禁止（issue #73）。レビュー済みコミットが消えるとレビューコメントが行を見失う。"
    "main を取り込むなら `git merge origin/main`。"
)
MSG_REBASE = (
    "push 済みかどうかを判定できないので rebase は一律で止めている（issue #73）。"
    "main の取り込みは `git merge origin/main`。"
)
MSG_AMEND = "push 済みコミットの書き換えを避けるため `git commit --amend` は止めている（issue #73）。新しいコミットを積む。"
MSG_RESET = "`git reset --hard` は作業を消すので止めている（issue #73）。`git restore` / `git revert` を使う。"
MSG_GH_RAW = (
    "`gh` の `-f` / `--raw-field` はファイルを読まず `@...` をそのまま文字列として送る（issue #73 で実際に事故った）。"
    "`-F body=@file` か `gh issue/pr ... --body-file file` を使う。"
)


def split_segments(command):
    """`&&` `||` `;` `|` 改行 で区切って、1 本ずつのコマンドに分ける。"""
    return re.split(r"&&|\|\||[;|\n]", command)


def tokenize(segment):
    try:
        return shlex.split(segment)
    except ValueError:
        # 引用符が閉じていないなど。粗く割ってでも見る。
        return segment.split()


def program(tokens):
    return os.path.basename(tokens[0]) if tokens else ""


def git_subcommand(tokens):
    """`git -C dir push ...` のような前置きオプションを飛ばして (サブコマンド, 残り) を返す。"""
    takes_value = ("-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path")
    i = 1
    while i < len(tokens):
        token = tokens[i]
        if token in takes_value:
            i += 2
            continue
        if token.startswith("-"):
            i += 1
            continue
        return token, tokens[i + 1:]
    return None, []


def check_git(tokens):
    sub, args = git_subcommand(tokens)
    if sub == "push":
        for arg in args:
            if FORCE_LONG.match(arg):
                return MSG_FORCE
            if FORCE_SHORT.match(arg):
                return MSG_FORCE
            # `git push origin +main` / `+main:main` も強制更新
            if arg.startswith("+") and len(arg) > 1:
                return MSG_FORCE
    elif sub == "rebase":
        if not any(arg in REBASE_ESCAPES for arg in args):
            return MSG_REBASE
    elif sub == "commit":
        if "--amend" in args:
            return MSG_AMEND
    elif sub == "reset":
        if "--hard" in args:
            return MSG_RESET
    return None


def check_gh(tokens):
    for i, token in enumerate(tokens):
        if GH_RAW_FIELD.match(token):
            nxt = tokens[i + 1] if i + 1 < len(tokens) else ""
            if re.match(r"^[A-Za-z_][A-Za-z0-9_.\[\]]*=@", nxt):
                return MSG_GH_RAW
        if GH_RAW_FIELD_INLINE.match(token):
            return MSG_GH_RAW
    return None


def reason_to_deny(command):
    for segment in split_segments(command):
        tokens = tokenize(segment)
        if not tokens:
            continue
        name = program(tokens)
        reason = check_git(tokens) if name == "git" else check_gh(tokens) if name == "gh" else None
        if reason:
            return reason
    return None


def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0
    command = (payload.get("tool_input") or {}).get("command") or ""
    reason = reason_to_deny(command)
    if not reason:
        return 0
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
