# Execution Queue Follow-up

This guide describes the source behavior; verify the exact deployed release before relying on it operationally.

## Promotion behavior

The candidate validates policy and workload eligibility before the Redis atomic
queued-to-running claim. A temporary or unknown dependency outage leaves the queued
member, original FIFO score, payload, and capacity untouched. A known permanent
workload denial removes the queued member before marking the database row terminal;
if that write fails, the original FIFO position is restored. Repeated promotion
clears the previous release marker so each owned slot releases once.

The existing shared capacity-deferral helper already covers Playwright, K6, legacy
monitors. It persists a deferral counter and uses
jittered exponential delays from a nominal 1 to 30 seconds, jittered by 0.75–1.25
(up to 37.5 seconds actual). The 720-deferral limit permits about six hours of total waiting. Deferrals do not consume BullMQ attempts; this candidate does not introduce
a new backoff implementation.

For a regional monitor control-plane check, `ExecutionCapacityError` skips the
scheduled cycle immediately instead of waiting for backoff and later creating
missing-region downtime at the five-minute deadline. This intentional data gap
does not start compute or create usage for the skipped check. Legacy monitors,
Playwright, and K6 retain capacity deferral.

## Verification boundary

App coverage CI exercises four namespace-isolated promotion regressions against real Redis through `TEST_REDIS_URL`. The existing worker PostgreSQL suite checks neutral cycle aborts and preservation of completed cycles and diagnostic observations. Focused checks cover policy/target outages, rejected-workload ownership, backoff and closure-only retries.

These source checks do not certify a deployed release. Confirm the exact App and global/regional worker revision and exercise paused/skipped and capacity-saturated checks in an isolated environment before rollout acceptance.
