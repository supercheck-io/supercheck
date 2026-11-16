#!/usr/bin/env bash
# Appends a check list to the job summary.
# Usage: checks-summary.sh "Title" "Check name=<steps.id.outcome>" ...
set -uo pipefail

title="$1"
shift
icon="✅"
rows=""
for entry in "$@"; do
  case "${entry##*=}" in
    success) result="✅ passed" ;;
    failure) result="❌ failed"; icon="❌" ;;
    *) result="⏭️ not run"; [ "$icon" = "❌" ] || icon="⚠️" ;;
  esac
  rows+="| ${entry%=*} | ${result} |"$'\n'
done

{
  echo "## ${icon} ${title}"
  echo ""
  echo "| Check | Result |"
  echo "| --- | --- |"
  printf '%s' "$rows"
} >>"${GITHUB_STEP_SUMMARY:-/dev/stdout}"
