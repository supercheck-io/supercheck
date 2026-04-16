# Security Test Specification

## Overview

This spec describes the current auth-related security coverage implemented in:

- `app/e2e/tests/auth/security.spec.ts`
- `app/src/app/api/auth/sign-in/check/route.ts`
- `app/src/lib/security/login-lockout.ts`
- `app/src/lib/session-security.ts`

This is a record of current automated coverage, not a blanket security certification.

## Current Protections Under Test

### Unauthenticated access control

- Protected UI routes redirect to `/sign-in`
- API requests without authentication do not return application data

### Input safety

- XSS payloads submitted through sign-in and forgot-password forms do not execute
- SQL-injection-style strings and oversized inputs are handled without crashing the page

### Login abuse protection

Sign-in lockout is progressive and tracks both email and client IP.

| Failed attempts | Lockout |
|-----------------|---------|
| `5` | `30s` |
| `10` | `5m` |
| `15` | `15m` |
| `20` | `1h` |

The E2E test is best-effort: it checks that repeated failures eventually surface a lockout or rate-limit message, not that every threshold is hit at an exact attempt count in every environment.

### Password reset abuse protection

- Password reset requests are expected to avoid user enumeration
- Server-side rate limiting is `3` attempts per `15` minutes per email or IP

### Session and cookie hardening

When valid test credentials are available, the suite checks for:

- session regeneration after login
- `HttpOnly` session cookies
- `Secure` cookies on HTTPS environments
- `SameSite` protection (`Strict` or `Lax`)

## Current Automated Coverage

| ID / Scenario | Status | What the current E2E suite verifies |
|---------------|--------|-------------------------------------|
| `AUTH-042` | Automated in `rbac.spec.ts` | Protected routes require authentication |
| `AUTH-043` | Automated | XSS payloads in sign-in and forgot-password forms do not execute |
| `AUTH-044` | Automated, broad assertion | Direct auth POSTs and cross-origin API calls are handled safely without exposing data or crashing |
| `AUTH-045` | Automated, best effort | Repeated failed logins eventually surface lockout/rate-limit messaging |
| `AUTH-047` | Automated when credentials exist | Session token changes after login if a pre-login session existed |
| `AUTH-048` | Automated when credentials exist | Session cookie is `HttpOnly` |
| `AUTH-049` | Automated on HTTPS when credentials exist | Session cookie is `Secure` |
| `AUTH-050` | Automated when credentials exist | Session cookie uses `SameSite` protection |
| `Generic login errors` | Automated | Unknown-user and wrong-password flows stay generic |
| `Password reset enumeration safety` | Automated | Forgot-password flow uses success-state behavior instead of exposing account existence |
| `Logout clears session` | Skipped | Test exists but is skipped in the current suite |

## Important Accuracy Notes

- Do not claim the suite enforces a single CSRF rejection status code. The current `AUTH-044` test only asserts that the request is handled safely and that data is not exposed.
- Do not document `AUTH-055` or similar privilege-escalation scenarios as automated coverage. They are not present in the current suite.
- Sensitive email content review and log redaction checks are still manual review items, not automated E2E coverage.

## Manual Review Items

These remain worthwhile checks, but they are not currently automated here:

- invite email content does not leak sensitive data
- password reset email content does not leak sensitive data
- server logs do not record passwords, raw reset tokens, or API keys
- non-admin users cannot elevate their own roles through UI or API mutations
