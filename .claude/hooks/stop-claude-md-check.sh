#!/usr/bin/env bash
# Stop hook — enforces the CLAUDE.md "keep this file alive" rule.
#
# Fires when Claude tries to end a turn. If files changed this turn but
# CLAUDE.md wasn't touched, blocks the stop and sends Claude back a reminder.
#
# Bypass: set CLAUDE_MD_SKIP=1 in the environment for a turn (e.g. when
# making a tiny mechanical change like fixing a typo).

set -uo pipefail

# 1. Read Claude's JSON payload from stdin.
input="$(cat || true)"

# 2. Avoid infinite loops — if we already blocked once this turn, let it stop.
if printf '%s' "$input" | grep -q '"stop_hook_active": *true'; then
  exit 0
fi

# 3. Honor explicit bypass.
if [ "${CLAUDE_MD_SKIP:-0}" = "1" ]; then
  exit 0
fi

# 4. Locate the repo root from the hook's own directory.
hook_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "${hook_dir}/../.." && pwd)"
cd "${repo_root}" || exit 0

# Not a git repo? Bail silently.
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# 5. Collect every changed path: working-tree changes + unpushed commits.
#    Working tree (`git status --porcelain`) catches the "edited but not yet
#    committed" case. Diff vs. upstream catches the "committed but didn't
#    update CLAUDE.md" case — important because Claude may commit several
#    files together and forget the doc update.

working_changes=$(git status --porcelain 2>/dev/null | awk '{print $NF}' || true)

# Resolve upstream: prefer the tracked remote, fall back to origin/main.
upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)
if [ -z "${upstream}" ]; then
  if git rev-parse --verify origin/main >/dev/null 2>&1; then
    upstream="origin/main"
  fi
fi

if [ -n "${upstream}" ]; then
  commit_changes=$(git diff --name-only "${upstream}"...HEAD 2>/dev/null || true)
else
  commit_changes=""
fi

all_changes=$(printf '%s\n%s\n' "${working_changes}" "${commit_changes}" | sed '/^$/d' | sort -u)

# Nothing changed → nothing to document → let the turn end.
if [ -z "${all_changes}" ]; then
  exit 0
fi

# 6. Was CLAUDE.md touched (in the working tree OR a recent commit)?
if printf '%s\n' "${all_changes}" | grep -qx 'CLAUDE.md'; then
  exit 0
fi

# 7. Filter out ignorable noise: claude session artifacts, lockfiles.
#    If everything left over is noise, let the turn end.
non_trivial_changes=$(printf '%s\n' "${all_changes}" | grep -Ev '^(\.claude/(projects|todos)/|skills-lock\.json$)' || true)
if [ -z "${non_trivial_changes}" ]; then
  exit 0
fi

# 8. Real changes happened and CLAUDE.md wasn't touched → block and remind.
#    Output JSON with decision=block; Claude continues with the reason as input.
files_changed_list=$(printf '%s' "${non_trivial_changes}" | head -20 | sed 's/"/\\"/g' | tr '\n' ',' | sed 's/,$//')

cat <<EOF
{
  "decision": "block",
  "reason": "Per the meta rule in CLAUDE.md, you changed files this turn but didn't update CLAUDE.md. Decide whether the changes introduce a new pattern, vendor, table, env var, feature, endpoint, admin tab, or architectural decision — if so, edit the relevant section. If we discussed any unimplemented idea this turn, append it to the 'Ideas / backlog' section. If the change is genuinely too trivial to document, add a one-line note under 'Recent decisions' explaining why and then stop. Files changed this turn (first 20): ${files_changed_list}. To bypass this check for one turn, set CLAUDE_MD_SKIP=1 in the environment."
}
EOF
