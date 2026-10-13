# Self-hosted installer and 2.0 deploy reset

Status: server role implemented in PR #378 (installer, RustFS cutover, migration script). Not built yet:
the worker role / `PRIVATE_BIND_IP` flow, the deploy-folder cleanup and the docs restructure.
Supersedes the earlier "new installs only" RustFS scope: existing installs migrate with
`deploy/docker/migrate-minio-to-rustfs.sh`. Test hand-off: `selfhost-installer-test-handoff.md`.

## Goal

A first-time user goes from a fresh Linux server to a working, verified Supercheck
with one command and at most three answers. Everything that is breaking ships in
**one release** so self-hosters migrate once.

## Problems this fixes (observed on clean Ubuntu 24.04 arm64 hosts)

- MinIO image is no longer pullable (401 on quay.io and Docker Hub), so a stock
  `docker compose up` fails. RustFS is the replacement.
- Missing prerequisites, `bzip2`, gVisor sidecar, docker group (PR #374).
- S3 health check wrong for non-MinIO backends (PR #375).
- First test run times out: the 3.2 GB worker image is pulled into k3s containerd
  on first execution and exceeds the 300 s execution timeout.
- Users are asked to read compose files and hand-edit `.env`.

## Decisions

1. **One entry point:** `deploy/install.sh`, plain bash, no Node or other runtime.
   Run as `curl -fsSL https://supercheck.io/install.sh | sudo bash`, published
   with a checksum and a "read it first" link. Pinned to a release tag.
2. **No npm package, no TUI library.** Prompts are plain `read`; styling is ANSI
   with `NO_COLOR` and non-TTY fallback. Zero new dependencies on a fresh host.
3. **Roles via flag:** `--role server` (default) and `--role worker`.
   `--role agent` is not a multi-location option: Private Agents only run
   read-only AI SRE connector queries, not monitors, Playwright or k6
   (`docs/content/docs/app/deployment/private-agent.mdx`). Keep it documented
   separately.
4. **Every prompt has a flag** (`--domain`, `--email`, `--local`, `--yes`,
   `--version`) so agents and CI run the same path with no questions.
5. **Thin wrapper.** The installer calls the existing scripts and compose files,
   so manual runbooks cannot drift from it. `init-secrets.sh` and `setup-k3s.sh`
   remain the source of truth.
6. **RustFS replaces MinIO in `docker-compose.yml`** (single service, no override
   file, no profile). Pin `ghcr.io/rustfs/rustfs:1.0.1`, never `latest`.
   Because the install base is small and this is a breaking release, existing
   installs are not kept on MinIO. They are protected by a preflight, not by
   compose structure (see Upgrade safety).
7. **Fewer compose files.** Role files stay (`worker`, `private-agent`, `external`
   serve different hosts). Remove `docker-compose-secure.yml` (already a shim).
   Decide on `-local` and `-aisre-lab` during implementation, with their usage
   counts in docs and CI as the evidence.

## Install flow (server role)

Seven steps, one screen each, a persistent `[3/7]` progress line, plain language.

1. **Check host** - Linux, root, CPU/RAM/disk, architecture, ports 80/443/3000
   free. Fail here, before changing anything, with the exact fix.
2. **Choose setup** - the only real question:
   `1) Try it locally (HTTP, this server only)   2) Public server (HTTPS, domain)`.
   Public asks for domain and Let's Encrypt email, then checks DNS resolves to
   this host before continuing.
3. **Install prerequisites** - Docker, Compose, git, bzip2; skip what exists.
4. **Generate configuration** - `.env` with secrets; never overwrite an existing
   `.env`; never print secrets.
5. **Prepare isolated execution** - k3s and gVisor via `setup-k3s.sh`.
6. **Pull and warm images** - app, worker, RustFS, and import the worker image into
   k3s containerd so the first test run passes. Show a real progress indicator,
   this is the slowest step.
7. **Start and verify** - `compose up -d --wait`, `/api/health`, then print the URL,
   how to create the first account, where logs and backups live, and the
   command to add a location.

UX rules: show what will happen before it happens; one question at a time with a
default in brackets; every failure prints cause, fix and the line to re-run;
re-running is always safe and resumes; `--dry-run` prints the plan only.
Completion screen shows only what the user needs next.

## Multi-server (worker role)

Remote workers need PostgreSQL, Redis and S3 on the main server, which today bind
to `127.0.0.1`. The installer must not expose them silently.

- Server install asks "Will you add more locations later?" If yes it asks for a
  private bind address (`PRIVATE_BIND_IP`) and rejects a public address unless
  `--allow-public-datastores` is passed. RFC1918 and Tailscale 100.64.0.0/10 are
  accepted.
- It writes `worker.env` (mode 0600) with exactly the variables the worker needs
  and prints the one command to run on the other host:
  `sudo bash install.sh --role worker --join-file worker.env --location eu-west`.
  Copy it with `scp`; the installer never prints credentials.
- Worker role installs prerequisites, k3s + gVisor, checks it can reach the three
  services before starting, then starts `docker-compose-worker.yml`.
- Remove hardcoded `minioadmin` defaults in `docker-compose-worker.yml` examples.

## Upgrade safety (breaking release)

- Installer and `docker compose up` preflight: if a `minio-data` volume exists and
  no `rustfs-data` volume, stop with a link to a manual migration note. No silent
  empty storage.
- Migration note: start the old MinIO image if cached, `rclone` or `aws s3 sync`
  every bucket to RustFS, compare counts, switch, keep `minio-data` until verified.
- Changelog and release notes lead with the breaking changes. Include
  `docker compose up -d --remove-orphans` guidance.

## Deploy folder and docs

- `deploy/` becomes: `install.sh`, `docker-compose*.yml`, `scripts/` (existing
  setup scripts), `README.md` (3 lines pointing to docs). Users stop reading
  compose files.
- Docs: Quickstart (one command) first; "What the installer does", "Add a
  location", "Advanced / manual" (the current runbook, kept accurate by CI).
- `INSTALL.md` stays as the agent runbook and documents the non-interactive flags.

## Pull requests (in order)

1. #374 install blockers, #375 health probe. Merge first.
2. RustFS cutover: compose, credentials in `init-secrets.sh`, chown helper,
   healthcheck, volume preflight, docs.
3. `install.sh` server role with step UI, flags, dry-run, image warm-up.
4. Worker role and `PRIVATE_BIND_IP` flow.
5. Deploy folder cleanup and docs rewrite.
6. Release notes and migration note. Cut as one release.

## Test matrix (a skipped test is not a pass)

- Clean Ubuntu 22.04 and 24.04 and Debian 12, on amd64 and arm64 (only arm64 on 24.04
  has been exercised so far).
- Local HTTP and public HTTPS (needs a real domain).
- Re-run on a finished install: no secret change, no restart loop.
- Interrupted install (Ctrl-C at each step) then re-run.
- Non-TTY and `NO_COLOR` output; agent run with flags only.
- Existing MinIO install with data: preflight blocks, migration note works.
- Two-host install: worker joins over a private network, a monitor runs in the
  second location; refuses a public bind address.
- RustFS: sign-up, test run, artifacts, status-page upload, document download,
  retention cleanup, all eight buckets created.
- Compose floor v2.24.4 for every file.

## Open questions

- Does RustFS send `x-amz-request-id` on a missing-bucket 404 (agent verified yes
  on 1.0.1); keep #375's logic pinned to that.
- RustFS single-node disk-topology check: confirm the default volume layout passes
  without `RUSTFS_UNSAFE_BYPASS_DISK_CHECK`.
- Hosting for `install.sh` and its checksum (GitHub release asset vs supercheck.io).
- Are `-local` and `-aisre-lab` used by anyone; delete or keep.
- Is image warm-up better in `setup-k3s.sh` (benefits manual installs) or the
  installer. Leaning `setup-k3s.sh`.
