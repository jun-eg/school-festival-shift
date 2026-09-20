#!/usr/bin/env bash
# PreToolUse(Bash) のガード（jq + grep 版）。
#
# guard-bash.py と同じものを、jq でコマンドを取り出し grep で形を見分けて書いた版である。
# どちらを採ってもよいように、検査は同じ 1 本を共有する:
#
#     python3 .claude/hooks/guard-bash.test.py .claude/hooks/guard-bash.sh
#
# 判断の背景は ../README.md、経緯は issue #73。

set -uo pipefail

MSG_FORCE="force-push は禁止（issue #73）。レビュー済みコミットが消えるとレビューコメントが行を見失う。main を取り込むなら \`git merge origin/main\`。"
MSG_REBASE="push 済みかどうかを判定できないので rebase は一律で止めている（issue #73）。main の取り込みは \`git merge origin/main\`。"
MSG_AMEND="push 済みコミットの書き換えを避けるため \`git commit --amend\` は止めている（issue #73）。新しいコミットを積む。"
MSG_RESET="\`git reset --hard\` は作業を消すので止めている（issue #73）。\`git restore\` / \`git revert\` を使う。"
MSG_GH_RAW="\`gh\` の \`-f\` / \`--raw-field\` はファイルを読まず \`@...\` をそのまま文字列として送る（issue #73 で実際に事故った）。\`-F body=@file\` か \`gh issue/pr ... --body-file file\` を使う。"

deny() {
  jq -nc --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

# `&&` `||` `;` `|` 改行 で区切って、1 本ずつのコマンドに分ける
split_segments() {
  sed -e 's/&&/\n/g' -e 's/||/\n/g' -e 's/;/\n/g' -e 's/|/\n/g'
}

# 引用符を解釈してトークンに割る。xargs は eval と違いコマンド置換をしない。
# 引用符が閉じていなければ粗く割ってでも見る。
tokenize() {
  printf '%s' "$1" | xargs -n1 2>/dev/null || printf '%s\n' $1
}

command_json=$(cat)
cmd=$(printf '%s' "$command_json" | jq -r '.tool_input.command // ""' 2>/dev/null) || exit 0
[ -n "$cmd" ] || exit 0

segment=""
# `|| [ -n ... ]` が無いと、改行で終わらない最後の 1 本を読み落とす
while IFS= read -r segment || [ -n "$segment" ]; do
  [ -n "${segment// /}" ] || continue

  tokens=()
  token=""
  while IFS= read -r token || [ -n "$token" ]; do tokens+=("$token"); token=""; done < <(tokenize "$segment")
  [ "${#tokens[@]}" -gt 0 ] || continue

  program=$(basename -- "${tokens[0]}")

  if [ "$program" = "git" ]; then
    # `git -C dir push ...` のような前置きオプションを飛ばしてサブコマンドを見つける
    i=1
    subcommand=""
    while [ "$i" -lt "${#tokens[@]}" ]; do
      case "${tokens[$i]}" in
        -C|-c|--git-dir|--work-tree|--namespace|--exec-path) i=$((i + 2)) ;;
        -*) i=$((i + 1)) ;;
        *) subcommand="${tokens[$i]}"; break ;;
      esac
    done
    args=("${tokens[@]:$((i + 1))}")

    case "$subcommand" in
      push)
        for arg in ${args[@]+"${args[@]}"}; do
          # --force / --force-with-lease / --force-if-includes / --force=...
          printf '%s' "$arg" | grep -qE '^--force(-with-lease|-if-includes)?(=|$)' && deny "$MSG_FORCE"
          # -f 単体と -fu のような短縮フラグの束
          printf '%s' "$arg" | grep -qE '^-[a-zA-Z]*f[a-zA-Z]*$' && deny "$MSG_FORCE"
          # `git push origin +main` / `+main:main` も強制更新
          printf '%s' "$arg" | grep -qE '^\+.' && deny "$MSG_FORCE"
        done
        ;;
      rebase)
        # rebase を始めない形だけは通す（途中で詰まったときの逃げ道）
        for arg in ${args[@]+"${args[@]}"}; do
          case "$arg" in --abort|--quit) continue 2 ;; esac
        done
        deny "$MSG_REBASE"
        ;;
      commit)
        for arg in ${args[@]+"${args[@]}"}; do
          [ "$arg" = "--amend" ] && deny "$MSG_AMEND"
        done
        ;;
      reset)
        for arg in ${args[@]+"${args[@]}"}; do
          [ "$arg" = "--hard" ] && deny "$MSG_RESET"
        done
        ;;
    esac
  elif [ "$program" = "gh" ]; then
    i=0
    while [ "$i" -lt "${#tokens[@]}" ]; do
      token="${tokens[$i]}"
      if printf '%s' "$token" | grep -qE '^(-f|--raw-field)$'; then
        next="${tokens[$((i + 1))]:-}"
        printf '%s' "$next" | grep -qE '^[A-Za-z_][A-Za-z0-9_.]*(\[\])?=@' && deny "$MSG_GH_RAW"
      fi
      # `-fbody=@file` のように詰めた書き方
      printf '%s' "$token" | grep -qE '^-f[A-Za-z_][A-Za-z0-9_.]*=@' && deny "$MSG_GH_RAW"
      i=$((i + 1))
    done
  fi
done < <(printf '%s' "$cmd" | split_segments)

exit 0
