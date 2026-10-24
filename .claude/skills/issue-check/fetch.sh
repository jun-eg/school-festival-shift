#!/usr/bin/env bash
# issue 番号か URL を 1 つ受け取り、番号・タイトル・state・親・sub-issue（親に並んだ順）を JSON で出す。
# 読むだけ。何も書き換えない。
#   bash .claude/skills/issue-check/fetch.sh 312
#   bash .claude/skills/issue-check/fetch.sh https://github.com/OWNER/REPO/issues/312
set -euo pipefail

arg="${1:-}"
if [ -z "$arg" ]; then
  echo "usage: fetch.sh <issue 番号 | issue URL>" >&2
  exit 2
fi

if [[ "$arg" =~ ^https?://github\.com/([^/]+)/([^/]+)/issues/([0-9]+) ]]; then
  owner="${BASH_REMATCH[1]}"
  repo="${BASH_REMATCH[2]}"
  number="${BASH_REMATCH[3]}"
elif [[ "$arg" =~ ^#?([0-9]+)$ ]]; then
  number="${BASH_REMATCH[1]}"
  nwo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
  owner="${nwo%%/*}"
  repo="${nwo##*/}"
else
  echo "issue 番号か URL ではない: $arg" >&2
  exit 2
fi

gh api graphql \
  -F owner="$owner" -F repo="$repo" -F number="$number" \
  -f query='
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      number title state url
      parent { number title state }
      subIssues(first: 50) { nodes { number title state } }
    }
  }
}' --jq '.data.repository.issue + {owner: "'"$owner"'", repo: "'"$repo"'", subIssues: .data.repository.issue.subIssues.nodes}'
