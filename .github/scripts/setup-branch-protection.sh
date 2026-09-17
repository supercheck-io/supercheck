#!/usr/bin/env bash
#
# Set the required status checks for the protected main branch.
#
# Idempotent: safe to run repeatedly. Only the required status checks are
# modified; all other branch protection settings are left untouched.
#
# IMPORTANT: run this only after the PR that introduces every listed check has
# merged to the branch. A required check that never reports blocks all merges.
#
# Requires: the gh CLI authenticated with admin access to the repository.
#
# Usage:
#   ./.github/scripts/setup-branch-protection.sh
#
# Override the target with environment variables:
#   REPO=owner/name BRANCH=main ./.github/scripts/setup-branch-protection.sh

set -euo pipefail

REPO="${REPO:-supercheck-io/supercheck}"
BRANCH="${BRANCH:-main}"

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: the GitHub CLI (gh) is required" >&2
  exit 1
fi

# Keep every entry in sync with the job `name:` values in .github/workflows/*.
# A name that does not match a real check leaves merges permanently blocked.
read -r -d '' payload <<'JSON' || true
{
  "strict": true,
  "contexts": [
    "App Quality Checks",
    "Worker Quality Checks",
    "Quality Checks Summary",
    "Deploy Validation",
    "Dependency Review",
    "CodeQL"
  ]
}
JSON

echo "==> Setting required status checks on ${REPO}@${BRANCH}"
printf '%s' "$payload" | gh api --method PATCH \
  "repos/${REPO}/branches/${BRANCH}/protection/required_status_checks" \
  --input - >/dev/null

echo "Done. Current required checks:"
gh api "repos/${REPO}/branches/${BRANCH}/protection/required_status_checks" \
  --jq '.contexts[]' | sed 's/^/  - /'

# Read-only safety check: a PR author cannot approve their own PR, so while the
# project is maintained by one person, requiring code-owner review blocks
# merges. This script never changes that setting; it only warns if it is on.
require_code_owner_reviews="$(gh api \
  "repos/${REPO}/branches/${BRANCH}/protection" \
  --jq '.required_pull_request_reviews.require_code_owner_reviews // false')"
if [ "$require_code_owner_reviews" = "true" ]; then
  echo "WARNING: 'Require review from Code Owners' is enabled." >&2
  echo "         A pull request author cannot approve their own PR, which" >&2
  echo "         blocks merges for a single maintainer. Disable it in" >&2
  echo "         Settings > Branches > main unless a second reviewer exists." >&2
fi
