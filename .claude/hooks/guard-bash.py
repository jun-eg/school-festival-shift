#!/usr/bin/env python3
"""PreToolUse(Bash) のガード。事故の形に当たるコマンドを実行前に落とす。

permissions.deny は前置一致なので `git push origin foo --force` のように
フラグが後ろへ回った形と、`gh api ... -f body=@file` のように
フラグがサブコマンド引数の後ろに来る形を拾えない。そこをここで止める。

main に向く merge・push は issue #320 で足した。`gh pr merge <N>` は base を gh に引いて判断する。

判断の背景は .claude/README.md、経緯は issue #73 と #320。
"""

import json
import os
import re
import shlex
import subprocess
import sys
import time

# git push で履歴を上書きする指定。`--force-with-lease=origin/main` のように値を付けた形も拾う
FORCE_LONG = re.compile(r"^--force(-with-lease|-if-includes)?(=|$)")
# `-f` 単体と `-fu` のような短縮フラグの束
FORCE_SHORT = re.compile(r"^-[a-zA-Z]*f[a-zA-Z]*$")
# rebase を始めない形だけは通す（途中で詰まったときの逃げ道）
REBASE_ESCAPES = ("--abort", "--quit")
# gh の `-f` / `--raw-field` はファイルを読まない
GH_RAW_FIELD = re.compile(r"^(-f|--raw-field)$")
GH_RAW_FIELD_INLINE = re.compile(r"^-f[A-Za-z_][A-Za-z0-9_.\[\]]*=@")
# Claude が merge・push してはいけない branch
PROTECTED = "main"
# `gh pr merge` で値を取るオプション（番号を探すときに飛ばす）。`-m` は `--merge` の短縮で値を取らない
GH_MERGE_TAKES_VALUE = ("-R", "--repo", "-b", "--body", "-F", "--body-file", "-t", "--subject",
                        "--match-head-commit", "-A", "--author-email")
# `-rd` のように束ねた短縮フラグ。`r` が混ざっていれば rebase
GH_SHORT_BUNDLE = re.compile(r"^-[a-zA-Z]+$")
# hook 全体の締切（settings.json の timeout 10 秒より短く）。gh を何回呼んでもこの中で終える
DEADLINE = time.monotonic() + 8.0
# REST で merge する形 `repos/o/r/pulls/12/merge`
GH_API_MERGE = re.compile(r"(^|/)pulls/[0-9]+/merge$")

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
MSG_PUSH_MAIN = (
    f"`{PROTECTED}` への push は止めている（issue #320）。{PROTECTED} に入れるのは人が PR を merge するときだけ。"
    "branch を push して PR を作る。"
)
MSG_MERGE_MAIN = (
    f"`{PROTECTED}` 向けの PR は Claude が merge しない（issue #320）。人がレビューして merge する。"
    f"Claude が merge してよいのは {PROTECTED} 以外の branch（クッション branch）向けの PR だけ。"
)
MSG_MERGE_NO_NUMBER = (
    "`gh pr merge` は PR 番号を付けて打つ（issue #320）。番号が無いと今の branch の PR が対象になり、"
    f"クッション branch の上で打つと {PROTECTED} 向けの PR が merge される。"
)
MSG_MERGE_UNRESOLVED = (
    "`gh pr merge` の base を `gh pr view` で引けなかったので止めた（issue #320）。"
    "番号・repo・ネットワークを確かめてから打ち直す。"
)
MSG_MERGE_REBASE = "`gh pr merge --rebase` は履歴を書き換えるので止めている（issue #73 / #320）。`--merge` を使う。"
MSG_GH_API_MERGE = (
    "REST で PR を merge する形は止めている（issue #320）。base の判定を通すため `gh pr merge <N> --merge` を使う。"
)
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
        if any(pushes_protected(arg) for arg in args):
            return MSG_PUSH_MAIN
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


def pushes_protected(refspec):
    """`main` / `HEAD:main` / `refs/heads/main` / `:main` のように、送り先が守る branch に向く refspec か。"""
    if refspec.startswith("-"):
        return False
    dst = refspec.split(":", 1)[1] if ":" in refspec else refspec
    return dst in (PROTECTED, f"refs/heads/{PROTECTED}")


def pr_base(number, repo):
    """PR の base branch 名。引けなければ None（止める側に倒す）。"""
    cmd = ["gh", "pr", "view", number, "--json", "baseRefName", "--jq", ".baseRefName"]
    if repo:
        cmd += ["--repo", repo]
    remaining = DEADLINE - time.monotonic()
    if remaining <= 0:
        return None
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=remaining)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if out.returncode != 0:
        return None
    return out.stdout.strip() or None


def strip_gh_repo(tokens):
    """`-R x` / `--repo x` / `--repo=x` / `-Rx` をどの位置からでも抜き、(残りの tokens, repo) を返す。

    gh は repo 指定を `gh -R x pr merge`・`gh pr -R x merge`・`gh pr merge -R x` のどこにでも置ける。
    """
    rest = []
    repo = None
    i = 0
    while i < len(tokens):
        token = tokens[i]
        if token in ("-R", "--repo"):
            repo = tokens[i + 1] if i + 1 < len(tokens) else None
            i += 2
            continue
        if token.startswith("--repo="):
            repo = token.split("=", 1)[1]
            i += 1
            continue
        if token.startswith("-R") and len(token) > 2:
            repo = token[2:]
            i += 1
            continue
        rest.append(token)
        i += 1
    return rest, repo


def gh_subcommand(tokens):
    """repo 指定を抜いたうえで、フラグでない語の 1 つ目と 2 つ目（`pr` `merge`）と、その後ろの引数と、repo を返す。"""
    rest, repo = strip_gh_repo(tokens[1:])
    words = []
    for i, token in enumerate(rest):
        if token.startswith("-"):
            continue
        words.append(token)
        if len(words) == 2:
            return words, rest[i + 1:], repo
    return words, [], repo


def check_gh_pr_merge(args, repo):
    """`gh pr merge` の残り引数を見る。番号必須・rebase 禁止・base が守る branch なら止める。repo 指定は抜いた後で渡される。"""
    number = None
    i = 0
    while i < len(args):
        arg = args[i]
        if arg == "--rebase" or arg.startswith("--rebase=") or (GH_SHORT_BUNDLE.match(arg) and "r" in arg[1:]):
            return MSG_MERGE_REBASE
        if arg in GH_MERGE_TAKES_VALUE:
            i += 2
            continue
        if not arg.startswith("-") and number is None:
            number = arg
        i += 1
    if number is None:
        return MSG_MERGE_NO_NUMBER
    base = pr_base(number, repo)
    if base is None:
        return MSG_MERGE_UNRESOLVED
    if base == PROTECTED:
        return MSG_MERGE_MAIN
    return None


def check_gh(tokens):
    words, args, repo = gh_subcommand(tokens)
    if words[:2] == ["pr", "merge"]:
        reason = check_gh_pr_merge(args, repo)
        if reason:
            return reason
    if words[:1] == ["api"]:
        if any(GH_API_MERGE.search(t) for t in tokens[1:] if not t.startswith("-")):
            return MSG_GH_API_MERGE
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
