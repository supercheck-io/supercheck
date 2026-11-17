# Free tools API

The Cloudflare Worker behind the no-signup tools at `supercheck.io/tools`. It runs in its own Cloudflare account on the Workers Free plan, has no data bindings and holds no Supercheck secret. Nothing in `app/` or `worker/` calls it.

One endpoint: `POST /v1/check` with a `text/plain` JSON body `{ tool, input, method?, token }`, where `token` is a Turnstile token. Every request passes, in order: kill switch, body cap (4 KB), origin allow-list, per-IP rate limits, URL policy, Turnstile, per-site rate limit, then the check itself with manual redirects, a DNS-over-HTTPS pre-check on every host and a 40-subrequest budget.

```bash
npm ci
npm run typecheck
npm test          # Vitest in workerd (Miniflare); outbound fetches are mocked
npm run test:cov  # 80% lines and branches
npm run size      # wrangler deploy --dry-run
```

`wrangler.jsonc` has no `account_id`; deploys read `CLOUDFLARE_ACCOUNT_ID`. Secrets (`TURNSTILE_SECRET`, `IP_HASH_KEY`) are set with `wrangler secret put`. `CHECKS_ENABLED`, `TOOLS` and `BLOCKED_HOSTS` are set only in the dashboard and are not in `wrangler.jsonc`, so `keep_vars` keeps them across deploys. Until `CHECKS_ENABLED=true` is set, every check returns 503 `disabled`.

The docs site reads the Worker URL and the Turnstile site key from `NEXT_PUBLIC_CHECKS_API_URL` and `NEXT_PUBLIC_TOOLS_TURNSTILE_SITE_KEY` at build time. Without them the tool pages show the method and a link to Supercheck, with no form.
