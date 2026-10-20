# Sign-in lockout and client IP trust

Status: current. Applies to `app/src/lib/security/login-lockout.ts`,
`app/src/lib/security/login-lockout-hooks.ts`,
`app/src/app/api/auth/sign-in/check/route.ts`, and `getClientIP()` in
`app/src/lib/session-security.ts`.

## Policy

Progressive lockout, identical ladder on every blocking dimension:

| Failed attempts | Lockout |
|-----------------|---------|
| 5 | 30 seconds |
| 10 | 5 minutes |
| 15 | 15 minutes |
| 20 | 1 hour |

Attempt counters expire after 24 hours without a new attempt. Successful
sign-in clears the counters and any lock for the identities involved.

## Blocking dimensions

A sign-in is hard-blocked only by:

1. the client IP, and
2. the email + client IP pair.

There is deliberately **no email-only lock**. A per-email counter is still
incremented on a confirmed wrong password for telemetry and future step-up
verification, but it never blocks a sign-in.

**Why:** an email-only block lets anyone who knows a victim's address keep that
account locked by burning the threshold just under the lock window (for the
1-hour step, roughly one bad attempt per hour). The lockout becomes a targeted
denial-of-service tool against a known account.

**Trade-off:** a distributed attack that spreads attempts against one email
across many IPs is not stopped by an account-wide lock. It is bounded by the
per-IP ladder, the email+IP ladder, and the rate limits in front of sign-in:

- `/api/auth/sign-in/check` — 20 pre-checks per minute per client IP, fail-closed
  when Redis is unavailable.
- `/api/auth/sign-in/email` — the same per-IP lockout applies to every credential
  attempt, so each source address is capped by the ladder above.

If per-account step-up verification is added later, the existing per-email
counter is the input for it.

## Atomic attempt reservation

`before()` reserves the attempt before the password is checked. One Lua script
per attempt performs, atomically:

1. read the lock TTLs — if any blocking key is locked, return "locked" without
   incrementing anything or renewing any lock;
2. increment every blocking counter and refresh its 24-hour TTL;
3. evaluate the ladder and create the lock(s) the new count warrants.

Without this, a parallel burst could all read an unlocked state before any
failure was counted and get more password guesses than the ladder allows.

Settlement in `after()`:

| Outcome | Action |
|---|---|
| `INVALID_EMAIL_OR_PASSWORD` | Keep the reservation; increment the per-email telemetry counter |
| New session created | Clear the email and email+IP counters/locks; give the shared IP attempt back |
| Captcha failure, unverified email, transport/other API error | Release the reservation (decrement; remove a lock the reservation created) |
| Already locked (rejected in `before()`) | No counters touched |

A release only removes a lock whose remaining TTL is no longer than the one the
released reservation created, so a later, longer lock is never shortened.
Success resets the account-scoped pair counter but only gives back the attempt
charged to the shared IP, so a successful sign-in cannot reset the IP ladder for
other users behind the same NAT.

Redis unavailable: reservation and checks fail open (sign-in proceeds). The
pre-check endpoint's own rate limiter still fails closed.

All lockout responses share one message, `Too many sign-in attempts. Please try
again later.`, and the pre-check returns HTTP 429. A single message means the
response cannot be used to distinguish "this address is locked" from "this
account is locked".

## Client IP derivation

`getClientIP()` reads `X-Forwarded-For` from **right to left**. The leftmost
entry is whatever the client sent and is never trusted. It skips
`TRUSTED_PROXY_HOPS` right-hand entries (those appended by our own edge) and
returns the first syntactically valid address (`net.isIP`). It never falls back
to `X-Real-IP` or `X-Remote-Addr`, which are client-spoofable unless an edge
overwrites them. If nothing valid remains, it returns `unknown`; the IP and
email+IP lockout dimensions are then skipped rather than sharing one bucket.

| Variable | Default | Meaning |
|---|---|---|
| `TRUSTED_PROXY_HOPS` | `0` | Number of right-hand `X-Forwarded-For` entries appended by trusted infrastructure beyond the nearest proxy |
| `TRUST_CF_CONNECTING_IP` | `false` | Trust `CF-Connecting-IP`; only when the origin is reachable exclusively through Cloudflare |

### Deployment values

| Deployment | `TRUSTED_PROXY_HOPS` | `TRUST_CF_CONNECTING_IP` |
|---|---|---|
| Local dev (no proxy) | `0` (unused; header absent) | `false` |
| Self-hosted Compose with one Traefik/nginx proxy appending the client address | `0` | `false` |
| Cloudflare → ingress-nginx → app (cloud edge pattern; verify the hop count) | `1` | `true` |
| Cloudflare → app directly, no other proxy | `0` | `true` |
| Cloudflare → cloud load balancer → ingress → app | `2` | `true` |
| Direct ingress / load balancer, no Cloudflare | `0` | `false` |

Values are a property of the ingress topology, not of the app. Changing the
number of proxies without changing `TRUSTED_PROXY_HOPS` either makes every
client look like the proxy (one shared lockout bucket) or trusts a
client-supplied address.

### Required edge behaviour

These settings are only safe when all of the following hold:

1. The app origin is not reachable directly (security group / firewall /
   Cloudflare Tunnel / IP allowlist limited to the edge).
2. The edge overwrites or appends `X-Forwarded-For`; it must not forward a
   client-supplied value untouched. If the edge overwrites with exactly one
   client address, `TRUSTED_PROXY_HOPS=0` is the correct value.
3. When `TRUST_CF_CONNECTING_IP=true`, Cloudflare is the only path to the origin
   and the edge does not forward a client-supplied `CF-Connecting-IP`.

An edge that only sets `X-Real-IP` is no longer trusted: it must set
`X-Forwarded-For`. Without a trustworthy header, the IP and email+IP lockout
dimensions are skipped and the per-IP rate limits collapse into a single
`unknown` bucket, so this is a correctness requirement, not just a hardening
one.

Deployment follow-up (ingress, tracked outside this repository): confirm the
staging and production ingress strips incoming `X-Forwarded-For` /
`CF-Connecting-IP` from untrusted peers, appends exactly one entry per trusted
hop, and blocks direct access to the app service. The values above assume the
Cloudflare → ingress-nginx pattern; the cloud topology has not been verified
from this repository, so `TRUSTED_PROXY_HOPS` must be confirmed against the
actual hop count before relying on lockout keys.

## Residual risk

- An attacker rotating across many source addresses can still make repeated
  guesses against one account. Protection is the per-IP/IP-pair ladder plus
  edge rate limits, as described above.
- If the edge is misconfigured (client-supplied `X-Forwarded-For` survives), an
  attacker can rotate lockout keys per request. That does not grant extra
  guesses against a single address, but it weakens IP-based throttling.
- A request that reserves an attempt and never reaches `after()` (aborted
  connection, process crash, or a handler throwing a non-API error) leaves one
  counted failure; it expires after 24 hours or on the next successful sign-in.
