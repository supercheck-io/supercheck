# Self-host installer: test hand-off

Branch: `feat/rustfs-s3-backend` (PR #378, draft). Last commit: `c8e79e33`.
Do not push to `main`. Do not touch `.env` on a host that has data. Report what you skipped; a skipped test is not a pass.

## Under test
- `deploy/docker/install.sh` (single-server installer)
- RustFS replacing MinIO (`docker-compose.yml`, `docker-compose-local.yml`, `-secure`)
- `deploy/docker/migrate-minio-to-rustfs.sh`

## Setup
Use a fresh VM per case (OrbStack: `orb create ubuntu:24.04 <name>`), copy `deploy/docker` to `/opt/supercheck/deploy/docker`, run as root. Delete VMs afterwards; host disk is tight (about 20 GB free). Do not use `/tmp`-dependent assumptions: the installer logs to `/var/log/supercheck/install.log`.

## Cases
1. **Fresh install, local:** `sudo bash install.sh --local --yes` on Ubuntu 24.04 arm64. Expect exit 0 (or 3 if the app image predates #375: `s3` check "degraded"), 5 healthy services. Record total time.
2. **Same on:** Ubuntu 22.04, Debian 12, and an amd64 host (any available).
3. **Re-run** on a finished install: `.env` hash unchanged, no restart loop, sandbox step re-verifies and passes.
4. **Interrupt:** Ctrl-C during each of steps 3, 5, 6, then re-run. Expect no orphaned `apt`, `git`, `k3s` or `docker pull` processes after the interrupt, and a clean resume.
5. **Failure paths:** port 3000 and 9000 occupied; non-root; no TTY and no flags (expect exit 1 with the flag hint); `--domain` without `--email`; `--version 9.9.9`.
6. **Public mode:** `--domain <real domain> --email <addr> --yes` on a host with DNS pointed at it. Expect HTTPS to come up and the sign-up-open warning to print. Skip if no domain is available and say so.
7. **Guards:** (a) create volume `supercheck_minio-data` with no `supercheck_rustfs-data`: preflight must stop, `--ignore-minio` must bypass. (b) delete `.env` while `supercheck_postgres-data` exists: preflight must stop.
8. **First test run:** sign up, create a Playwright test, run it. Expect it to pass on the first run without a timeout (worker image pre-imported into k3s). Check `k3s ctr -n k8s.io images ls -q | grep worker`.
9. **RustFS data paths:** a run that produces a report, a screenshot and a trace (artifacts readable in the UI); status-page asset upload; document download; a retention or cleanup cycle; all eight buckets exist; `docker compose ps` shows rustfs healthy and port 9001 is not published.
10. **Migration script:** on a real old install (needs a MinIO image; `cgr.dev/chainguard/minio:latest` is the pullable stand-in) with real data: run `migrate-minio-to-rustfs.sh`, `git pull`, `docker compose up -d --wait --remove-orphans`; check the data is present and `/api/health` is ok. Also run it with wrong credentials in `.env` and confirm it leaves `.env` untouched.
11. **Health probe:** `/api/health` must report `s3: ok` on RustFS once the image includes #375. If the image is older, `degraded` is expected and not an installer bug.

## Known and expected
- `SUPERCHECK_VERSION_DEFAULT` is 1.3.6, which predates #375, and the installer fetches tag `v1.3.6`.
- The resume run after commit `c8e79e33` was started but its result was never read; treat the hardened script as untested end to end.
- Not covered by anyone yet: Debian, 22.04, amd64, public HTTPS, the demo host migration (`.github/scripts/deploy-demo.sh` has no `--remove-orphans`).

## Release checklist (order matters)
1. Merge #378 only after the hands-on cases above pass; the tester's earlier pass covered fresh install, re-run, SIGINT, guards, failure paths, migration (including wrong credentials and rollback), first test run and artifacts.
2. The `v1.3.6` tag still contains the MinIO compose files and an unpullable MinIO image, so the installer's default version must move to the new release together with the compose defaults (`validate.sh` enforces they match). Cut the release from `main` after #375 and #378.
3. Demo host: run `migrate-minio-to-rustfs.sh` on it before its next deploy (`.github/scripts/deploy-demo.sh` has no `--remove-orphans`; adding it without migrating would silently give the demo empty storage).
4. Release notes lead with the breaking storage change and link the "Upgrading from MinIO" section.
5. Open the PR for `docs/selfhost-installer-plan` (still unmerged) or fold it into this one.

## Testing from `main` before a release tag exists
`install.sh` fetches its source by tag, and no released tag has the RustFS compose files yet (the standalone default `v1.3.6` is refused with a clear message). Until a tag exists, test from a checkout of `main`:

```bash
git clone --depth 1 https://github.com/supercheck-io/supercheck.git /opt/supercheck
export SUPERCHECK_VERSION=1.3.7-canary.15     # newest canary images; they predate #375, so /api/health shows s3 "degraded" (expected, exit code 3)
sudo -E bash /opt/supercheck/deploy/docker/install.sh --local --yes
```

After the next canary tag is cut from `main`, use `sudo bash install.sh --version <that tag> --local --yes` instead and expect exit 0. **Cutting any `v*` tag also deploys the demo host** (`build-multiarch.yml`, `deploy-demo.sh`): migrate the demo host with `migrate-minio-to-rustfs.sh` first.
