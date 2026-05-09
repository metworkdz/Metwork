#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# auto-commit.sh  —  Claude Code Stop hook
#
# Runs automatically at the end of every Claude Code session.
# Commits any uncommitted changes so nothing is ever "stuck" in
# an invisible worktree or unstaged state.
#
# The user still controls WHEN to push to GitHub / deploy to Vercel.
# ─────────────────────────────────────────────────────────────────

set -e

MAIN_DIR="/Users/macbookpro/Downloads/metwork"

# ── 1. Commit changes in any active Claude worktrees ──────────────
WORKTREES_DIR="$MAIN_DIR/.claude/worktrees"

if [ -d "$WORKTREES_DIR" ]; then
  for worktree in "$WORKTREES_DIR"/*/; do
    [ -d "$worktree" ] || continue
    cd "$worktree" 2>/dev/null || continue

    # Only act on real git working trees
    git rev-parse --git-dir > /dev/null 2>&1 || continue

    branch=$(git branch --show-current 2>/dev/null)
    [ -z "$branch" ] && continue

    # Skip if nothing to commit
    [ -z "$(git status --porcelain 2>/dev/null)" ] && continue

    git add -A
    # Amend the last commit if it was also an auto-commit (keeps history clean)
    last_msg=$(git log -1 --format="%s" 2>/dev/null || echo "")
    if [[ "$last_msg" == "chore: claude auto-commit"* ]]; then
      git commit --amend --no-edit --no-verify 2>/dev/null || true
    else
      git commit -m "chore: claude auto-commit [$(date '+%Y-%m-%d %H:%M')]" \
        --no-verify 2>/dev/null || true
    fi

    echo "✅ Auto-committed worktree changes → branch: $branch"
  done
fi

# ── 2. Commit any changes directly in main (non-worktree sessions) ─
cd "$MAIN_DIR" 2>/dev/null || exit 0
git rev-parse --git-dir > /dev/null 2>&1 || exit 0

branch=$(git branch --show-current 2>/dev/null)
[ "$branch" != "main" ] && exit 0   # safety: only auto-commit on main

[ -z "$(git status --porcelain 2>/dev/null)" ] && exit 0  # nothing to do

git add -A
last_msg=$(git log -1 --format="%s" 2>/dev/null || echo "")
if [[ "$last_msg" == "chore: claude auto-commit"* ]]; then
  git commit --amend --no-edit --no-verify 2>/dev/null || true
else
  git commit -m "chore: claude auto-commit [$(date '+%Y-%m-%d %H:%M')]" \
    --no-verify 2>/dev/null || true
fi

echo "✅ Auto-committed main branch changes"
echo ""
echo "  ➜  To deploy, run:  bash /Users/macbookpro/Downloads/metwork/deploy.sh"
