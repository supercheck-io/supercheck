# RBAC Test Specification

## Overview

This spec documents the current RBAC model and the current state of E2E coverage.

Authoritative sources:

- `docs/content/docs/app/admin/roles-and-permissions.mdx`
- `app/e2e/tests/auth/rbac.spec.ts`
- `app/e2e/fixtures/roles.fixture.ts`

Use the canonical role ids below when writing new tests or fixtures.

## Canonical Roles

| Role ID | Display name | Scope |
|---------|--------------|-------|
| `super_admin` | Super Admin | System-wide access across organizations |
| `org_owner` | Org Owner | Full organization access, all projects |
| `org_admin` | Org Admin | Organization administration, all projects |
| `project_admin` | Project Admin | Full control of assigned projects |
| `project_editor` | Project Editor | Create/edit access in assigned projects |
| `project_viewer` | Project Viewer | Read-only access to all projects in the organization |

Key scope rules:

- Organization roles (`super_admin`, `org_owner`, `org_admin`) can access all projects in scope
- `project_admin` and `project_editor` are limited to assigned projects
- `project_viewer` is intentionally organization-wide and read-only

## Current Automated Coverage

The current suite is strongest on unauthenticated access and authorization boundaries. Most role-account-specific tests are scaffolded but still skipped pending dedicated seeded users and fixtures.

| ID / Scenario | Status | What is currently verified |
|---------------|--------|----------------------------|
| `AUTH-042` | Automated | Protected routes redirect unauthenticated users to `/sign-in` |
| `Super admin route requires auth` | Automated | `/super-admin` is not accessible anonymously |
| `API requires authentication` | Automated | API requests do not return `200` or test data without auth |
| `Cross-org access fails` | Automated | Invalid organization access attempts return non-`200` |
| `AUTH-020` through `AUTH-032` | Mostly skipped | Placeholder coverage for viewer/editor/admin/super-admin role accounts |
| `Authenticated nav smoke checks` | Automated, non-blocking | Nav/admin link visibility is logged for already-authenticated sessions |

## Expected Role Scenarios

These are the scenarios the suite is intended to cover once seeded role accounts are available:

| ID | Expected behavior |
|----|-------------------|
| `AUTH-020` | `project_viewer` cannot access super admin |
| `AUTH-021` | `project_viewer` cannot create tests |
| `AUTH-023` | `project_viewer` can view runs/results |
| `AUTH-024` | `project_editor` can create tests in assigned projects |
| `AUTH-025` | `project_editor` cannot access super admin |
| `AUTH-026` | `project_admin` can manage project members |
| `AUTH-028` | `org_admin` can manage projects |
| `AUTH-030` | `org_owner` can access org-level administration and billing |
| `AUTH-031` | `super_admin` can access super admin |
| `AUTH-032` | `super_admin` can view all organizations |

## Notes

- Older fixture comments and helper names may still say `Editor` or `Viewer`. Treat `project_editor` and `project_viewer` as the canonical role identifiers.
- Do not overstate the current E2E coverage. Today, most role-specific tests are placeholders until dedicated RBAC users and seeded data are provisioned.
- Keep this spec in sync with the public roles-and-permissions document when role scope changes.
