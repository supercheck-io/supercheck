# Run callback fencing rollout

This release adds migration `0038_run_callback_fencing.sql`. Apply migrations before starting the new App or workers. The migration is additive and creates `run_callbacks` plus a `BEFORE DELETE` trigger on `runs`; it does not backfill existing callbacks.

## Upgrade order

1. Pause new execution admission and retention/deletion work during the upgrade.
2. Drain or stop **all** old Playwright and K6 callbacks, including uploads, retries, final metadata persistence, and regional workers. Missing BullMQ jobs or Kubernetes pods do not establish drain. If remote storage outcomes remain uncertain, reconcile those pre-protocol artifact directories before enabling deletion.
3. Apply migrations through the normal deployment migration runner, then deploy the new App and all workers.
4. Resume admission and cleanup only after confirming all callback entry points run the new code. Validate the paused-upload, lease-loss, deletion, and late-PUT cases in an isolated environment before production acceptance.

Migration 0037 is owned by the separate execution-entitlements change. The filename-based migration runner supports the independent 0038 slot; reconcile the journal and migration ordering when integrating both changes. Do not renumber a migration after it has been applied.

## Protocol

- Playwright and K6 callbacks acquire exclusive durable ownership for a run and refresh it every ten seconds. Recovery protects fresh ownership even if the queue and execution pod disappear. After a heartbeat is stale for two minutes, recovery checks for a live execution pod before revoking ownership. Revocation fences future artifact operations; it never proves that remote writes have stopped.
- Run-backed artifacts use an immutable `<runId>/` directory in one configured bucket. Saved tests no longer overwrite a shared test directory. A legacy test-ID metadata alias points to the same run-owned report for existing clients.
- The worker records the bucket before its first PUT, checks every key belongs to that run, and preserves both SDK and outer retries. Final report metadata is guarded by the existing run and callback owner in a short transaction.
- Run deletion, retention, and parent cascades revoke ownership and activate cleanup atomically. The ledger has no run FK, so deleting a run cannot erase its cleanup pointer. Storage requests run outside database transactions.
- `run_artifacts` checks up to 1,000 due pointers every fifteen minutes. Failed storage calls retry after fifteen minutes; successful or empty-prefix checks return after one day. Due timestamps order the bounded work, so a large backlog can extend these intervals.

A local rejection, callback completion, or final storage acknowledgement cannot exclude a delayed external commit from an earlier retry. Therefore cleanup tombstones are retained indefinitely and revisited after successful cleanup. Do not purge them based on age, `finished_at`, or an empty listing. This trades one small database row and periodic prefix listings per deleted run for retry-safe cleanup; monitor due-row backlog with the lifecycle service statistics.

## Rollback and acceptance

Keep the migration, trigger, and tombstones if application code is rolled back. Pause execution admission and deletion/retention before restoring workers that do not implement the protocol, and repeat the drain procedure before re-enabling it. Removing the ledger would discard cleanup evidence.

Unit and PostgreSQL regressions verify protocol behavior, not deployed storage semantics or worker rollout. Live acceptance must include a paused upload after queue/pod loss, an uncertain PUT that commits after cleanup, worker death, parent cascades, and two executions of one saved test. No production migration, worker drain, or deployment is performed by the PR.
