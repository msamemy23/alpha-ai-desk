#!/usr/bin/env bash
# Opens one issue when the site stops answering, and closes it when it answers again. Uses the `gh` command with the
# workflow's own token; it needs issue permission only. Inputs: OK (true|false), CODE (http status or 000), GITHUB_REPOSITORY.
set -eu
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
ok="${OK:-false}"
code="${CODE:-000}"
now="$(date -u +'%Y-%m-%d %H:%M UTC')"
open="$(gh issue list --repo "$repo" --label uptime --state open --json number --jq '.[0].number // empty' || true)"

if [ "$ok" = "true" ]; then
  if [ -n "$open" ]; then
    gh issue comment "$open" --repo "$repo" --body "Alpha Desk is answering again (checked $now). Closing this."
    gh issue close "$open" --repo "$repo"
  fi
  exit 0
fi

# Down. One issue is enough: do not open another or add comments while one is open.
if [ -z "$open" ]; then
  gh label create uptime --repo "$repo" --color D93F0B --description "Alpha Desk stopped answering" >/dev/null 2>&1 || true
  if [ "$code" = "000" ]; then what="no answer at all"; else what="the answer code $code"; fi
  gh issue create --repo "$repo" --label uptime --title "Alpha Desk is not answering" --body "$(cat <<BODY
At $now https://alpha-ai-desk.vercel.app/api/health gave $what three times in a row, 20 seconds apart.

- 503 means the site is up but cannot reach its database. No answer or 5xx from Vercel means the site itself is down.
- Check the latest deployment and runtime logs in Vercel (project alpha-ai-desk), and the database in Supabase (project alpha desk).
- This issue closes itself when the site answers again.
BODY
)"
fi
