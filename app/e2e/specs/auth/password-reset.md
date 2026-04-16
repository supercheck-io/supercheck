# Password Reset Test Specification

## Overview

This spec covers the current password reset flow implemented in:

- `app/src/app/(auth)/forgot-password/page.tsx`
- `app/src/app/(auth)/reset-password/page.tsx`
- `app/src/lib/session-security.ts`
- `app/e2e/tests/auth/password-reset.spec.ts`

The flow has two pages:

- `/forgot-password`
- `/reset-password?token=<token>`

## Current Behavior

### Forgot password page

- Email field is required
- Submit button is disabled until the email field is non-empty
- Successful requests move the UI to a `Check your email` success state
- The success state tells the user the link expires in `1 hour`
- The back link returns to `/sign-in`

Password reset requests are rate-limited by `checkPasswordResetRateLimit()`:

- `3` attempts
- `15 minute` window
- keyed by email or IP

### Reset password page

- Missing token immediately shows `Invalid or missing reset token...`
- Invalid or expired tokens may still load the page shell, but reset fails when the token is actually used
- Password validation is client-side before submit:
  - minimum `8` characters
  - at least one lowercase letter
  - at least one uppercase letter
  - at least one number
- Confirmation password must match
- Successful reset shows a success state and redirects to `/sign-in` after roughly `3` seconds

## Automated Coverage

| ID | Status | What the current E2E suite verifies |
|----|--------|-------------------------------------|
| `AUTH-009` | Automated | `/forgot-password` loads with email field and submit button |
| `AUTH-009` | Skipped | Success-state request test exists but is skipped because demo-site rate limiting makes it flaky |
| `AUTH-010` | Automated | Invalid / expired / missing token states are handled without crashing |
| `AUTH-011` | Skipped | Full reset flow requires deterministic token provisioning and is not currently automated |
| `AUTH-046` | Automated (best effort) | Repeated requests eventually surface rate-limit messaging when the environment enforces it |
| `Validation helpers` | Partially skipped | Mismatch and weak-password tests exist but are skipped until valid reset tokens are available |

## Selector Contract

### Forgot password page

| Element | Current selector |
|---------|------------------|
| Email | `[data-testid="forgot-password-email-input"]` |
| Submit | `[data-testid="forgot-password-submit"]` |
| Error | `[data-testid="forgot-password-error"]` |
| Success state | `[data-testid="forgot-password-success"]` |
| Back to sign in | `[data-testid="back-to-signin-link"]` |

### Reset password page

The reset page does not currently expose dedicated `reset-password-*` test ids. Use the actual field ids and visible copy.

| Element | Current selector |
|---------|------------------|
| New password | `#password` |
| Confirm password | `#confirmPassword` |
| Submit | `button[type="submit"]` |
| Error | `[role="alert"]` or visible validation copy |
| Success state | text such as `Password reset successfully` |

## Notes

- Do not document `reset-password-input` or `reset-password-confirm-input` test ids. They do not exist in the current UI.
- The current E2E suite is intentionally conservative around full reset completion because it lacks a deterministic mail/token fixture.
- Keep this spec aligned with the one-hour token expiry described in the success UI and with the server-side reset rate limit.
