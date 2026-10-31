#!/usr/bin/env bash
# issue 番号か URL を 1 つ受け取り、/flow implement が続きから回すための状態を JSON で出す。
# 読むだけ。何も書き換えない。
#   bash .claude/skills/flow/state.sh 320
#   bash .claude/skills/flow/state.sh https://github.com/OWNER/REPO/issues/320
#
# 出るもの:
#   issue          fetch.sh の結果そのまま（number, title, state, parent, subIssues, owner, repo）
#   role           親 ／ 単独 ／ sub-issue
#   cushion        親のとき: origin にある worktree-<親番号>-* の branch 名（無ければ null）
#   mainPr         head がその branch で base が main の PR（無ければ null）
#   subIssues[].pr head が worktree-<sub番号>-* の PR のうち最新 1 本（number, state, baseRefName, headRefName, mergedAt。無ければ null）
#   subIssues[].branch origin にある worktree-<sub番号>-* の branch 名（無ければ null）
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
arg="${1:-}"
if [ -z "$arg" ]; then
  echo "usage: state.sh <issue 番号 | issue URL>" >&2
  exit 2
fi

issue_json="$(bash "$here/../issue-check/fetch.sh" "$arg")"
owner="$(jq -r .owner <<<"$issue_json")"
repo="$(jq -r .repo <<<"$issue_json")"
number="$(jq -r .number <<<"$issue_json")"
nwo="$owner/$repo"

# origin の branch 一覧（1 回だけ取る）
branches="$(gh api --paginate "repos/$nwo/branches?per_page=100" --jq '.[].name')"
branch_for() { grep -m1 -E "^worktree-$1-" <<<"$branches" || true; }

# PR 一覧（open と merged と closed。1 回だけ取る）
prs="$(gh api --paginate "repos/$nwo/pulls?state=all&per_page=100" --jq '.[] | {number, state: (if .merged_at then "MERGED" else (.state | ascii_upcase) end), baseRefName: .base.ref, headRefName: .head.ref, mergedAt: .merged_at, url: .html_url}' | jq -sc '.')"
pr_for_head_prefix() {
  jq -c --arg p "worktree-$1-" '[.[] | select(.headRefName | startswith($p))] | sort_by(.number) | last // null' <<<"$prs"
}
pr_for_head_base() {
  jq -c --arg h "$1" --arg b "$2" '[.[] | select(.headRefName == $h and .baseRefName == $b)] | sort_by(.number) | last // null' <<<"$prs"
}

role="単独"
if [ "$(jq '.subIssues | length' <<<"$issue_json")" -gt 0 ]; then
  role="親"
elif [ "$(jq '.parent' <<<"$issue_json")" != "null" ]; then
  role="sub-issue"
fi

if [ "$role" = "sub-issue" ]; then
  cushion="$(branch_for "$(jq -r .parent.number <<<"$issue_json")")"
else
  cushion="$(branch_for "$number")"
fi
main_pr="null"
if [ -n "$cushion" ]; then
  main_pr="$(pr_for_head_base "$cushion" main)"
fi

subs="[]"
if [ "$role" = "親" ]; then
  subs="$(jq -c '.subIssues' <<<"$issue_json")"
  out="[]"
  for n in $(jq -r '.[].number' <<<"$subs"); do
    b="$(branch_for "$n")"
    p="$(pr_for_head_prefix "$n")"
    item="$(jq -c --argjson n "$n" --arg b "$b" --argjson p "$p" '.[] | select(.number == $n) | . + {branch: (if $b == "" then null else $b end), pr: $p}' <<<"$subs")"
    out="$(jq -c --argjson i "$item" '. + [$i]' <<<"$out")"
  done
  subs="$out"
fi

jq -n \
  --argjson issue "$issue_json" \
  --arg role "$role" \
  --arg cushion "$cushion" \
  --argjson mainPr "$main_pr" \
  --argjson subIssues "$subs" \
  '{issue: ($issue | del(.subIssues)), role: $role, cushion: (if $cushion == "" then null else $cushion end), mainPr: $mainPr, subIssues: $subIssues}'
