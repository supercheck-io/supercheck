# Sign Up Test Specification

## Overview

This spec documents the current sign-up behavior implemented in:

- `app/src/app/(auth)/sign-up/page.tsx`
- `app/src/components/auth/signup-form.tsx`
- `app/e2e/tests/auth/sign-up.spec.ts`

Sign-up is hosting-mode dependent.

- Cloud-hosted: `/sign-up` is invitation-only. Without `?invite=<token>`, the page redirects to `/sign-in`.
- Self-hosted: `/sign-up` supports open email/password registration unless `SIGNUP_ENABLED=false`.
- Invite flow: `/sign-up?invite=<token>` fetches invite metadata and renders the join form.
- Invalid invite token: cloud redirects to `/sign-in`; self-hosted falls back to open `/sign-up`.

## Current Behavior

### AUTH-001: `/sign-up` without invite follows hosting mode

- Cloud-hosted: redirect to `/sign-in`
- Self-hosted with signup enabled: stay on `/sign-up`
- Self-hosted with `SIGNUP_ENABLED=false`: redirect to `/sign-in`

### AUTH-002 / AUTH-014: OAuth entry point for new cloud users

For non-invite cloud sign-up, the OAuth buttons live on `/sign-in`, not on `/sign-up`.

- GitHub button: `data-testid="login-github-button"`
- Google button: `data-testid="login-google-button"`

### AUTH-003: Invitation sign-up

With a valid invite token:

- The page loads invite metadata from `/api/invite/<token>`
- The heading changes to `Join <organization>`
- The invited email is prefilled and read-only
- The submit button text is `Create account & join`

## Automated Coverage

| ID | Status | What the current E2E suite verifies |
|----|--------|-------------------------------------|
| `AUTH-001` | Automated | `/sign-up` redirects in cloud mode and remains available in self-hosted mode |
| `AUTH-002` | Automated | GitHub OAuth button is visible on `/sign-in` when enabled |
| `AUTH-003` | Skipped | Placeholder only; requires deterministic invite creation in test setup |
| `AUTH-014` | Automated | Google OAuth button is visible on `/sign-in` when enabled |
| `Invalid invite token` | Automated | Invalid invite falls back to `/sign-in` in cloud or `/sign-up` in self-hosted |
| `OAuth error redirect` | Automated | `/sign-in?error=...` remains on the sign-in page |

## Selector Contract

### Open registration or invite form

The current form component does not expose dedicated `signup-*` test ids for the fields. The stable selectors are:

| Element | Current selector |
|---------|------------------|
| Name | `#name` or `input[name="name"]` |
| Email | `#email` or `input[name="email"]` |
| Password | `#password` or `input[name="password"]` |
| Submit | `button[type="submit"]` |

### OAuth entry point for non-invite sign-up

| Element | Current selector |
|---------|------------------|
| GitHub | `[data-testid="login-github-button"]` |
| Google | `[data-testid="login-google-button"]` |
| Last used badge | `[data-testid="last-used-badge"]` |

### Invite state

The invite flow is asserted primarily by visible copy, not a dedicated `data-testid`.

- Invite banner contains `Invitation for`
- Invited email appears in the banner
- Heading contains `Join <organization>`

## Notes

- Cloud mode uses a social-first new-user flow. `/sign-up` should not be documented as the normal OAuth entry point.
- CAPTCHA headers are requested before email sign-up calls. This is relevant to the hosted auth endpoints, but there is no dedicated E2E assertion for CAPTCHA state yet.
- Keep this spec aligned with the hosting-mode checks in `app/e2e/tests/auth/sign-up.spec.ts` and the runtime config from `/api/config/app`.
