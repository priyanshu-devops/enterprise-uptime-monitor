#!/usr/bin/env bash
# Squash the entire git history of the current repository into a single commit.
#
# Used by maintenance.yml against the storage repo: screenshots are overwritten
# in place every run, so history is pure bloat — a weekly squash keeps the
# repo small and GitHub Pages fast. Run from inside the repo to squash.
#
# Safe by construction: the working tree is untouched; only history is replaced.
set -euo pipefail

BRANCH="${1:-main}"

echo "Squashing history of branch '$BRANCH'..."
BEFORE=$(du -sh .git | cut -f1)

git checkout --orphan _squash
git add -A
git -c user.name='uptime-monitor[bot]' \
    -c user.email='uptime-monitor@users.noreply.github.com' \
    commit -m "storage snapshot $(date -u +%Y-%m-%dT%H:%MZ) (history squashed)"
git branch -D "$BRANCH"
git branch -m "$BRANCH"

# Drop old objects locally so the push is small.
git reflog expire --expire=now --all
git gc --prune=now --aggressive --quiet

AFTER=$(du -sh .git | cut -f1)
echo "History squashed: .git $BEFORE -> $AFTER"
echo "NOTE: caller must push with --force origin $BRANCH"
