# Sign In Test Specification

## Overview

This spec tracks the current sign-in flow implemented in:

- `app/src/components/auth/login-form.tsx`
- `app/src/app/api/auth/sign-in/check/route.ts`
- `app/e2e/tests/auth/sign-in.spec.ts`

The sign-in page always supports email/password authentication. OAuth buttons are shown when the corresponding provider is enabled and the flow is not invite-restricted.

## Current Behavior

### AUTH-004: Valid email/password sign-in

- Route: `/sign-in`
- Successful sign-in redirects away from `/sign-in`
- Session cookies are established by the auth layer

### AUTH-005 / AUTH-006: Invalid credentials

- Wrong password and unknown email should both produce generic failure behavior
- Because progressive lockout is active, the visible message may be either invalid-credentials text or a temporary lockout/rate-limit message

### AUTH-018: Sign out

- The test exists but is currently `test.skip(...)` because it is flaky on the demo environment
- Expected behavior remains: open user menu, choose sign out, redirect to `/sign-in`, protected routes require login again

## Lockout and Safety Rules

`/api/auth/sign-in/check` is called around sign-in attempts and implements progressive lockout for both email and client IP.

Current thresholds from `app/src/lib/security/login-lockout.ts`:

| Failed attempts | Lockout |
|-----------------|---------|
| `5` | `30s` |
| `10` | `5m` |
| `15` | `15m` |
| `20` | `1h` |

The check endpoint supports:

- `pre-check`
- `failed`
- `success`

## Automated Coverage

| ID | Status | What the current E2E suite verifies |
|----|--------|-------------------------------------|
| `AUTH-004` | Automated | Valid credentials redirect away from `/sign-in` |
| `AUTH-005` | Automated | Invalid password shows generic error or lockout message |
| `AUTH-006` | Automated | Unknown email shows generic error or lockout message |
| `AUTH-018` | Skipped | Sign-out flow exists but is skipped in the current suite |
| `OAuth button visibility` | Automated | GitHub and Google buttons render when enabled |
| `Form validation` | Automated | Empty fields / invalid email stay on `/sign-in` |
| `Forgot password navigation` | Automated | Link routes to `/forgot-password` |

## Selector Contract

| Element | Current selector |
|---------|------------------|
| Email | `[data-testid="login-email-input"]` |
| Password | `[data-testid="login-password-input"]` |
| Submit | `[data-testid="login-submit-button"]` |
| Error message | `[data-testid="login-error-message"]` |
| Forgot password link | `[data-testid="login-forgot-password-link"]` |
| GitHub OAuth | `[data-testid="login-github-button"]` |
| Google OAuth | `[data-testid="login-google-button"]` |
| Last used badge | `[data-testid="last-used-badge"]` |
| Email verified alert | `[data-testid="email-verified-alert"]` |

## Notes

- The current submit button label is `Login`, not `Sign in`.
- Invite-aware sign-in can prefill and lock the email field, and offers a `Create one` link back to `/sign-up?invite=<token>`.
- Keep this spec aligned with the progressive lockout implementation instead of asserting a single fixed error string for every failed login.
