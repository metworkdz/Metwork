#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# deploy.sh  —  One-command deploy for Metwork
#
# Usage:
#   bash deploy.sh              → commit + push to GitHub (Vercel auto-deploys)
#   bash deploy.sh --direct     → commit + push + also run `vercel --prod`
#   bash deploy.sh --message "your message"  → custom commit message
#
# What it does:
#  1. If Claude used a worktree this session → merges it into main
#  2. Commits any remaining uncommitted changes on main
#  3. Pushes main to GitHub  → Vercel auto-deploys via GitHub integration
#  4. (optional) Also runs `vercel --prod` for immediate direct deploy
# ─────────────────────────────────────────────────────────────────

set -e
cd /Users/macbookpro/Downloads/metwork

# ── Parse args ────────────────────────────────────────────────────
DIRECT=false
COMMIT_MSG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --direct)   DIRECT=true;  shift ;;
    --message)  COMMIT_MSG="$2"; shift 2 ;;
    *)          shift ;;
  esac
done

echo ""
echo "🚀  Metwork deploy"
echo "────────────────────────────────────────"

# ── Step 1: Merge any Claude worktree branches into main ──────────
WORKTREES_DIR=".claude/worktrees"
if [ -d "$WORKTREES_DIR" ]; then
  for worktree in "$WORKTREES_DIR"/*/; do
    [ -d "$worktree" ] || continue
    cd "$worktree" 2>/dev/null || continue
    git rev-parse --git-dir > /dev/null 2>&1 || { cd /Users/macbookpro/Downloads/metwork; continue; }

    branch=$(git branch --show-current 2>/dev/null)
    [ -z "$branch" ] && { cd /Users/macbookpro/Downloads/metwork; continue; }

    # Commit any uncommitted worktree changes first
    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
      git add -A
      git commit -m "chore: sync before deploy [$(date '+%Y-%m-%d %H:%M')]" --no-verify
      echo "  ✓ Committed worktree changes on: $branch"
    fi

    cd /Users/macbookpro/Downloads/metwork

    # Check if worktree branch is ahead of main
    ahead=$(git rev-list "main..$branch" --count 2>/dev/null || echo "0")
    if [ "$ahead" -gt 0 ]; then
      echo "  🔀 Merging $branch → main ($ahead commit(s))..."
      git merge "$branch" -X theirs --no-edit
      echo "  ✓ Merged"
    fi
  done
  cd /Users/macbookpro/Downloads/metwork
fi

# ── Step 2: Commit any remaining changes on main ──────────────────
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  git add -A
  if [ -n "$COMMIT_MSG" ]; then
    git commit -m "$COMMIT_MSG"
  else
    echo ""
    echo "  Uncommitted changes found."
    read -rp "  Enter commit message (or press Enter for auto-message): " msg
    if [ -z "$msg" ]; then
      msg="feat: deploy [$(date '+%Y-%m-%d %H:%M')]"
    fi
    git commit -m "$msg"
  fi
  echo "  ✓ Committed"
fi

# ── Step 3: Push to GitHub ────────────────────────────────────────
echo ""
echo "  📤 Pushing to GitHub (origin/main)..."
git push origin main
echo "  ✓ Pushed → Vercel will auto-deploy from GitHub"

# ── Step 4 (optional): Also deploy directly via Vercel CLI ───────
if [ "$DIRECT" = true ]; then
  echo ""
  echo "  🔧 Running vercel --prod..."
  vercel --prod
  echo "  ✓ Direct Vercel deploy complete"
fi

echo ""
echo "────────────────────────────────────────"
echo "✅  Deploy complete!"
if [ "$DIRECT" = false ]; then
  echo "   Vercel will pick up the GitHub push and deploy automatically."
  echo "   Check status at: https://vercel.com/dashboard"
fi
echo ""
