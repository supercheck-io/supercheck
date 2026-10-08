# Automatic PR review

`Code review agent` reviews open, non-draft PRs from human authors in this repository on creation, new commits, reopening, and marking ready for review. It posts a GitHub comment review with up to eight inline findings and optional single-line suggestions. It never approves, changes code, or applies suggestions. Human review and normal CI remain required.

## Setup

Add `OPENCODE_API_KEY` to **Settings → Secrets and variables → Actions** in each repository. The key must have an active OpenCode Go subscription with access to `deepseek-v4.1-flash`. The reviewer uses the [documented Go chat completions API](https://opencode.ai/docs/go/#endpoints), identifies itself with a user agent and stable session header, requests JSON without tools, and disables thinking so the answer is returned as final content.

Workflow-scoped Actions event policies must allow `pull_request` and `workflow_dispatch`. When migrating an existing policy, keep its legacy `pull_request_target` allowance until the default branch uses the new workflow, then remove that unused allowance. Preserve active enforcement and the workflow path scope.

Allow Actions to create PR reviews under repository/organization policy. Do not make this advisory workflow a required merge check. Provider outages, exhausted quota, or missing credentials produce a warning, an explicit failure result in the job summary, and one failure notice per commit; they never claim a successful review. Runner, artifact, or GitHub permission errors still fail the workflow.

## Retry and coverage

In **Actions → Code review agent → Run workflow**, select `main` and enter the PR number. Use a new manual run to retry after fixing credentials or quota. Failed reviews do not suppress a later successful review. A completed review is posted once per commit; automatic duplicate events avoid another model call. Manual runs can review drafts, but still honor opt-outs and refuse forks, bots, and closed PRs.

GitHub does not trigger another workflow when a PR is created or updated using `GITHUB_TOKEN`. Automation using that token must explicitly dispatch this workflow with the PR number, or use an authorized GitHub App/PAT that generates PR events.

- Opt out with `[skip-ai-review]` in the PR title, body, or latest commit message, or the `skip-ai-review` label.
- Forks and bot PRs are skipped before any provider call.
- PRs above 100 files or 8,000 changed lines receive a size notice instead of a model call.
- Reviews see at most 100,000 patch characters plus bounded PR metadata. Missing text patches and truncated diffs are marked partial. Binary-only or deletion-only diffs without commentable new-file lines receive a notice.
- The model sees the supplied diff, not the whole repository, CI results, or runtime behavior. It can miss bugs and suggest incorrect fixes. Validate each finding before applying it.
- Each request has a five-minute timeout, an 8,192-token output limit, and at most one retry. Authentication and other permanent HTTP errors are not retried.
- A PR that closes or receives a new commit while the model is running gets no obsolete review.

## Security and maintenance

`pull_request` runs for internal PRs; fork PRs are skipped and GitHub withholds their secrets. GitHub runs the PR workflow definition, so internal collaborators must be trusted to modify workflows (as they already have write access). The reviewer scripts are checked out from the default branch, and its resolved commit is reused by all jobs; PR source code is never built or executed by the reviewer. Downloaded artifacts contain data only. Input collection, provider access, and publishing use separate jobs. Only the provider job receives `OPENCODE_API_KEY`; only the publisher has PR write permission. PR text and model responses are data, never shell commands. Only completed JSON reviews are accepted; inline paths and lines must exist in the included diff. Recognized credential formats and the provider key are redacted before output limits are applied. Raw provider replies and errors are not logged or uploaded.

The title, body, and bounded diff are sent to OpenCode Go; input artifacts expire after one day. This applies to private ops changes too. Do not put credentials in PR content.

This uses GitHub’s ordinary PR event without overriding event policies or checkout protections. Runs perform only repository development work: no hosted service, unrelated compute, persistent process, or quota evasion. Timeouts, concurrency cancellation, size limits, bounded retries, and one-day artifact retention limit resource use. GitHub can still enforce account policies; no workflow can guarantee account status.

References: [secure use](https://docs.github.com/en/actions/reference/security/secure-use), [PR event security](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target), and [Actions usage terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#actions).

The workflow, script, tests, and this guide are kept identical in `supercheck` and `supercheck-ops`. Change both copies together. Actions are pinned by commit SHA and Node 24 is explicit. Run:

```sh
node --test .github/scripts/pr-review.test.mjs
```

`PR review script` runs these regression checks on PRs changing the reviewer. New reviewer behavior becomes automatic only after it is merged into the PR base branch.
