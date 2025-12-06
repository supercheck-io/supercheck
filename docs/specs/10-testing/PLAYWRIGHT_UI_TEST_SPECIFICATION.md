# Playwright UI/E2E Test Specification for SuperCheck

## 📊 Test Summary Dashboard

```
┌─────────────────────────────────────────────────────────────┐
│         SUPERCHECK PLAYWRIGHT E2E TEST SPECIFICATION         │
├─────────────────────────────────────────────────────────────┤
│  Total Test Cases: 645                                       │
│  Test Files: ~40                                             │
│  Framework: Playwright + TypeScript                          │
│  Environment: Staging (Real Services, No Mocking)            │
│  Execution Time: ~45-60 minutes (parallel)                   │
├─────────────────────────────────────────────────────────────┤
│  PRIORITY BREAKDOWN                    TEST TYPE BREAKDOWN    │
│  ├─ Critical: 242 (38%)                 ├─ Positive: 280 (43%)│
│  ├─ High:     242 (38%)                 ├─ Negative: 160 (25%)│
│  ├─ Medium:   123 (19%)                 ├─ Edge:      80 (12%)│
│  └─ Low:      38 (6%)                   ├─ Security:  60 (9%) │
│                                         └─ RBAC:      65 (10%)│
├─────────────────────────────────────────────────────────────┤
│  DOMAIN DISTRIBUTION                                         │
│  ├─ Authentication & Authorization:     60 tests (9%)        │
│  ├─ Organization & Project Management:  40 tests (6%)        │
│  ├─ Test Management:                    80 tests (12%)       │
│  ├─ Playground & AI Features:           50 tests (8%)        │
│  ├─ Job Management:                     70 tests (11%)       │
│  ├─ Monitor Management:                 90 tests (14%)       │
│  ├─ Status Pages:                       65 tests (10%)       │
│  ├─ Alerts & Notifications:             55 tests (9%)        │
│  ├─ Dashboard & Reports:                60 tests (9%)        │
│  ├─ Admin Features:                     35 tests (5%)        │
│  └─ Settings & Configuration:           40 tests (6%)        │
└─────────────────────────────────────────────────────────────┘
```

## 🎯 Testing Approach

**Environment**: Staging with real services (no mocking)
- Real PostgreSQL database
- Real Redis cache
- Real MinIO/S3 storage
- Real OpenAI API for AI features
- Real notification channels (Slack, Discord, Telegram, Email)
- Real Docker containers for test execution

---

## Domain 1: Authentication & Authorization (60 tests)

### Overview
Comprehensive coverage of authentication flows (email/password, OAuth), session management, password reset, invitations, and Role-Based Access Control (RBAC) across 6 roles: Super Admin, Org Owner, Org Admin, Project Admin, Editor, Viewer.

### Test Cases

| Test ID | Description | Type | Priority | Page | Prerequisites | Steps | Expected Result |
|---------|-------------|------|----------|------|---------------|-------|-----------------|
| AUTH-001 | Sign up with GitHub OAuth (social-only) | Positive | Critical | /sign-up | None | 1. Navigate to /sign-up<br>2. Verify only social auth buttons shown (no email form)<br>3. Click "Continue with GitHub"<br>4. Authorize app | User created, email verified via OAuth, redirected to dashboard |
| AUTH-002 | Sign up with Google OAuth (social-only) | Positive | Critical | /sign-up | None | 1. Navigate to /sign-up<br>2. Verify only social auth buttons shown (no email form)<br>3. Click "Continue with Google"<br>4. Authorize app | User created, email verified via OAuth, redirected to dashboard |
| AUTH-003 | Invitation flow email signup | Positive | Critical | /sign-up?invite=token | Valid invite token | 1. Click invitation link<br>2. Verify email form is shown (locked to invited email)<br>3. Fill name and password<br>4. Submit | User created with invited email, auto-joined organization |
| AUTH-004 | Sign in with valid credentials | Positive | Critical | /sign-in | User exists and verified | 1. Navigate to /sign-in<br>2. Enter email and password<br>3. Submit | Redirected to dashboard, session created |
| AUTH-005 | Sign in with invalid password | Negative | High | /sign-in | User exists | 1. Navigate to /sign-in<br>2. Enter correct email, wrong password<br>3. Submit | Error: "Invalid credentials" |
| AUTH-006 | Sign in with non-existent email | Negative | High | /sign-in | None | 1. Navigate to /sign-in<br>2. Enter non-existent email<br>3. Submit | Error: "Invalid credentials" (generic for security) |
| AUTH-007 | Session expiry after 7 days | Edge | High | Any page | Valid session exists | 1. Sign in and note session token<br>2. Wait 7 days (or mock time)<br>3. Refresh page | Redirected to /sign-in, session invalidated |
| AUTH-008 | Refresh token valid for 24 hours | Edge | High | Any page | Valid session exists | 1. Sign in<br>2. After 7 days, use refresh token<br>3. Within 24 hours, refresh | New session token generated |
| AUTH-009 | Password reset email flow | Positive | Critical | /forgot-password | User exists | 1. Navigate to /forgot-password<br>2. Enter email<br>3. Submit<br>4. Check email for reset link | Reset email sent with secure token |
| AUTH-010 | Password reset with invalid token | Negative | High | /reset-password | Token is invalid/expired | 1. Navigate to reset link with invalid token<br>2. Try to submit new password | Error: "Invalid or expired reset link" |
| AUTH-011 | Password reset successful | Positive | High | /reset-password | Valid reset token | 1. Click reset email link<br>2. Enter new password<br>3. Submit | Password updated, redirected to /sign-in |
| AUTH-012 | GitHub OAuth sign up | Positive | High | /sign-up | None | 1. Navigate to /sign-up<br>2. Click "Sign up with GitHub"<br>3. Authorize app<br>4. Create user | User created with GitHub profile, signed in |
| AUTH-013 | GitHub OAuth sign in | Positive | High | /sign-in | User created via GitHub OAuth | 1. Navigate to /sign-in<br>2. Click "Sign in with GitHub"<br>3. Authorize | User signed in with existing account |
| AUTH-014 | Google OAuth sign up | Positive | High | /sign-up | None | 1. Navigate to /sign-up<br>2. Click "Sign up with Google"<br>3. Authorize app | User created with Google profile, signed in |
| AUTH-015 | Google OAuth sign in | Positive | High | /sign-in | User created via Google OAuth | 1. Navigate to /sign-in<br>2. Click "Sign in with Google"<br>3. Authorize | User signed in with existing account |
| AUTH-016 | Accept organization invitation | Positive | Critical | /invite/{token} | Invitation token exists | 1. Click invitation link<br>2. Sign in or create account<br>3. Accept invitation | User added to organization with assigned role |
| AUTH-016b | Last used badge on sign-in page | Positive | High | /sign-in | User signed in with GitHub previously | 1. Sign in with GitHub<br>2. Sign out<br>3. Navigate to /sign-in<br>4. Verify GitHub button shows "Last used" badge | Last used badge displayed on previously used auth method |
| AUTH-017 | Reject organization invitation | Positive | High | /invite/{token} | Invitation token exists | 1. Click invitation link<br>2. Click "Decline"<br>3. Confirm | User not added, invitation marked declined |
| AUTH-018 | Sign out | Positive | High | Any page | User signed in | 1. Click user menu<br>2. Click "Sign out" | Session destroyed, redirected to /sign-in |
| AUTH-019 | Sign out all sessions | Positive | High | Settings | User signed in on multiple devices | 1. Navigate to Settings > Security<br>2. Click "Sign out all sessions"<br>3. Confirm | All sessions destroyed, must sign in again |
| AUTH-020 | Viewer cannot access admin panel | RBAC | Critical | /admin | Logged in as Viewer | 1. Try to navigate to /admin | 403 error page |
| AUTH-021 | Viewer cannot create tests | RBAC | Critical | /tests/create | Logged in as Viewer in project | 1. Try to navigate to /tests/create | 403 error, button hidden in UI |
| AUTH-022 | Viewer cannot modify tests | RBAC | Critical | /tests/{id}/edit | Logged in as Viewer | 1. Try to access test edit page<br>2. Try to submit changes | 403 error, form disabled |
| AUTH-023 | Viewer can view test results | RBAC | High | /tests/{id}/results | Logged in as Viewer | 1. Navigate to test results page | Results visible, read-only UI |
| AUTH-024 | Editor can create tests | RBAC | Critical | /tests/create | Logged in as Editor | 1. Navigate to /tests/create<br>2. Create test | Test created successfully |
| AUTH-025 | Editor cannot access admin panel | RBAC | Critical | /admin | Logged in as Editor | 1. Try to navigate to /admin | 403 error page |
| AUTH-026 | Project Admin can manage members | RBAC | Critical | /settings/members | Logged in as Project Admin | 1. Navigate to members page<br>2. Invite/remove member | Changes applied successfully |
| AUTH-027 | Project Admin cannot manage organization | RBAC | High | /org/settings | Logged in as Project Admin | 1. Try to access org settings | 403 error or limited access |
| AUTH-028 | Organization Admin can manage projects | RBAC | Critical | /projects | Logged in as Org Admin | 1. Navigate to projects page<br>2. Create/delete project | Changes applied successfully |
| AUTH-029 | Organization Admin can manage members | RBAC | Critical | /org/settings/members | Logged in as Org Admin | 1. Navigate to org members page<br>2. Manage members | Changes applied successfully |
| AUTH-030 | Organization Owner full access | RBAC | Critical | Any page | Logged in as Org Owner | 1. Navigate to all areas of organization | Full access to all features |
| AUTH-031 | Super Admin can access admin panel | RBAC | Critical | /admin | Logged in as Super Admin | 1. Navigate to /admin | Admin panel accessible |
| AUTH-032 | Super Admin can view all organizations | RBAC | Critical | /admin/organizations | Logged in as Super Admin | 1. Navigate to org listing | All organizations visible |
| AUTH-033 | API key with read-only scope | Positive | High | /settings/api-keys | Logged in as Editor+ | 1. Create API key with read scope<br>2. Call API with token<br>3. Try write operation | Read succeeds, write returns 403 |
| AUTH-034 | API key with write scope | Positive | High | /settings/api-keys | Logged in as Editor+ | 1. Create API key with write scope<br>2. Call API with token<br>3. Execute write operation | Write operation succeeds |
| AUTH-035 | API key can be revoked | Positive | High | /settings/api-keys | API key exists | 1. Navigate to API keys<br>2. Revoke key<br>3. Try to use key | API returns 401 unauthorized |
| AUTH-036 | Email verification required for sign-up | Positive | Critical | /verify-email | User signed up | 1. Sign up with email<br>2. Check inbox<br>3. Click verification link | Email verified, can sign in |
| AUTH-037 | Resend verification email | Positive | High | /verify-email | Verification email not received | 1. On verify page, click "Resend"<br>2. Check new email | New verification email sent |
| AUTH-038 | Two-factor authentication setup | Positive | High | /settings/security | Logged in | 1. Navigate to 2FA settings<br>2. Scan QR code with authenticator<br>3. Enter code | 2FA enabled |
| AUTH-039 | Two-factor authentication login | Positive | High | /sign-in | 2FA enabled | 1. Sign in with email/password<br>2. Enter 2FA code<br>3. Submit | User signed in successfully |
| AUTH-040 | Two-factor authentication backup codes | Positive | High | /settings/security | 2FA enabled | 1. View backup codes<br>2. Save locally<br>3. Use in login if lost access | Backup codes work as 2FA alternative |
| AUTH-041 | Account deletion | Positive | High | /settings/account | Logged in | 1. Navigate to account settings<br>2. Click "Delete account"<br>3. Confirm with email<br>4. Enter password | Account and all data deleted |
| AUTH-042 | Cannot access private resources without auth | Security | Critical | /api/tests | No authentication | 1. Make request without token<br>2. Make request with invalid token | 401 unauthorized |
| AUTH-043 | XSS prevention in auth forms | Security | High | /sign-in | None | 1. Enter `<script>alert('xss')</script>` in email field<br>2. Submit | Script not executed, treated as literal text |
| AUTH-044 | CSRF protection on auth forms | Security | High | /sign-up | None | 1. Send POST to sign-up from different origin<br>2. Submit form | CSRF token validation prevents submission |
| AUTH-045 | Brute force protection | Security | High | /sign-in | None | 1. Attempt sign-in 10+ times with wrong password<br>2. Try again | Account locked or rate limited after N attempts |
| AUTH-046 | Rate limiting on password reset | Security | High | /forgot-password | None | 1. Request password reset 5+ times for same email | Rate limited, must wait before next attempt |
| AUTH-047 | Session fixation prevention | Security | High | /sign-in | None | 1. Get session token before login<br>2. Sign in<br>3. Check token changed | Session token regenerated after login |
| AUTH-048 | HTTP-only cookies for session | Security | High | Any page | User signed in | 1. Sign in<br>2. Check cookies in DevTools | Session cookie is HttpOnly, cannot access via JS |
| AUTH-049 | Secure flag on HTTPS | Security | High | Any page | User signed in on HTTPS | 1. Sign in over HTTPS | Session cookie has Secure flag |
| AUTH-050 | SameSite cookie protection | Security | High | Any page | User signed in | 1. Make cross-site request<br>2. Check cookie sent | SameSite=Strict or Lax prevents CSRF |
| AUTH-051 | Organization invite email contains no sensitive data | Security | High | Email | Invitation created | 1. Create invitation<br>2. Check email content | Email contains only token link, no credentials |
| AUTH-052 | Password reset email contains no sensitive data | Security | High | Email | Password reset requested | 1. Request password reset<br>2. Check email content | Email contains only reset link, no passwords |
| AUTH-053 | Sensitive data not logged | Security | High | Logs | User signs in | 1. Sign in<br>2. Check application logs | Passwords and tokens not in logs |
| AUTH-054 | Multiple email providers not linked to same account | Security | High | /sign-in | None | 1. Sign up with GitHub<br>2. Try to sign in with Google<br>3. Use same email | Creates separate account or prevents linking |
| AUTH-055 | User cannot elevate own role | Security | Critical | /settings | Logged in as Editor | 1. Try to change own role to Admin<br>2. Try via API | Role change fails, 403 error |
| AUTH-056 | Only admins can create invitations | RBAC | High | /org/settings/members | Logged in as Viewer | 1. Try to navigate to invite page<br>2. Try to create invite via API | 403 error, button hidden |
| AUTH-057 | Admin can invalidate specific sessions | Positive | High | /org/settings/members | Logged in as Org Admin | 1. View member details<br>2. Click "Sign out user"<br>3. User tries to use session | User session invalidated, must sign in again |
| AUTH-058 | Login activity visible in security log | Positive | High | /settings/security | Logged in | 1. Navigate to security log<br>2. Check login history | List shows recent logins with IP, browser, time |
| AUTH-059 | IP-based security alerts | Positive | High | /settings/security | Logged in | 1. Sign in from new IP<br>2. Check security notifications | Email alert for login from new location |
| AUTH-060 | Suspicious activity detection | Positive | High | /settings/security | Logged in | 1. Multiple failed logins<br>2. Check security alerts | Account flagged, may require verification |

---

## Domain 2: Organization & Project Management (40 tests)

### Overview
CRUD operations for organizations and projects, multi-tenancy validation, member management, billing, and org-wide settings.

### Test Cases

| Test ID | Description | Type | Priority | Page | Prerequisites | Steps | Expected Result |
|---------|-------------|------|----------|------|---------------|-------|-----------------|
| ORG-001 | Create organization | Positive | Critical | /onboarding/org | Logged in, no org | 1. Complete onboarding flow<br>2. Enter org name<br>3. Submit | Organization created, user is owner |
| ORG-002 | Organization name validation | Negative | High | /onboarding/org | Logged in | 1. Try to create org with empty name<br>2. Try name > 100 chars | Validation error displayed |
| ORG-003 | Create second organization | Positive | High | /organizations/new | Logged in, has 1 org | 1. Navigate to create org<br>2. Fill details<br>3. Submit | Second org created, user is owner of both |
| ORG-004 | Switch between organizations | Positive | High | / | User member of 2+ orgs | 1. Click org switcher menu<br>2. Select different org | UI updates to show selected org's data |
| ORG-005 | Update organization name | Positive | High | /org/settings | Org owner/admin | 1. Navigate to org settings<br>2. Edit name<br>3. Save | Name updated, reflected everywhere |
| ORG-006 | Update organization billing address | Positive | High | /org/settings/billing | Org owner | 1. Navigate to billing settings<br>2. Enter address<br>3. Save | Address saved, used for future invoices |
| ORG-007 | Upload organization logo | Positive | High | /org/settings | Org owner/admin | 1. Navigate to settings<br>2. Upload logo<br>3. Save | Logo saved, displayed in org header |
| ORG-008 | Delete organization | Positive | High | /org/settings | Org owner, no active tests/monitors | 1. Navigate to settings<br>2. Click "Delete organization"<br>3. Confirm with typing name | Organization deleted, user redirected |
| ORG-009 | Cannot delete org with active tests | Negative | High | /org/settings | Org owner, active tests exist | 1. Navigate to settings<br>2. Try to delete org | Error: "Cannot delete org with active tests" |
| ORG-010 | Create project in organization | Positive | Critical | /projects/new | Logged in org member | 1. Navigate to create project<br>2. Enter name and description<br>3. Submit | Project created under organization |
| ORG-011 | Project name must be unique per org | Negative | High | /projects/new | Project with name exists | 1. Try to create project with duplicate name<br>2. Submit | Error: "Project name already exists" |
| ORG-012 | Update project details | Positive | High | /projects/{id}/settings | Project admin/owner | 1. Navigate to project settings<br>2. Edit name, description<br>3. Save | Details updated |
| ORG-013 | Archive project | Positive | High | /projects/{id}/settings | Project exists | 1. Navigate to settings<br>2. Click "Archive project"<br>3. Confirm | Project archived, hidden from main list |
| ORG-014 | Unarchive project | Positive | High | /projects/{id}/settings | Project archived | 1. Navigate to settings<br>2. Click "Unarchive project" | Project unarchived, visible in main list |
| ORG-015 | Delete project | Positive | High | /projects/{id}/settings | Project owner, no tests/jobs | 1. Navigate to settings<br>2. Click "Delete project"<br>3. Confirm | Project deleted |
| ORG-016 | Cannot delete project with active tests | Negative | High | /projects/{id}/settings | Project has active tests | 1. Try to delete project | Error: "Cannot delete - has active tests" |
| ORG-017 | Invite member to organization | Positive | Critical | /org/settings/members | Org admin/owner | 1. Navigate to members<br>2. Click "Invite member"<br>3. Enter email<br>4. Select role<br>5. Send | Invitation email sent |
| ORG-018 | Bulk invite members | Positive | High | /org/settings/members | Org admin/owner | 1. Click "Bulk invite"<br>2. Paste 10 emails<br>3. Submit | 10 invitation emails sent |
| ORG-019 | Update member role in organization | Positive | High | /org/settings/members | Org admin/owner, member exists | 1. Click member<br>2. Change role<br>3. Save | Member role updated |
| ORG-020 | Remove member from organization | Positive | High | /org/settings/members | Org admin/owner, member exists | 1. Click member<br>2. Click "Remove"<br>3. Confirm | Member removed, no longer has access |
| ORG-021 | Invite member to specific project | Positive | High | /projects/{id}/settings/members | Project admin | 1. Navigate to members<br>2. Invite email<br>3. Assign role<br>4. Send | Invitation sent for project |
| ORG-022 | Transfer project ownership | Positive | High | /projects/{id}/settings | Project owner | 1. Navigate to settings<br>2. Select new owner<br>3. Confirm | Ownership transferred |
| ORG-023 | View member's activity | Positive | High | /org/settings/members | Org admin, member exists | 1. Click on member<br>2. View activity section | Activity log shows recent actions |
| ORG-024 | Member cannot see other org data | RBAC | Critical | /api/tests | Member of org A, accessing org B | 1. Get org B's data<br>2. User only member of org A | 403 forbidden |
| ORG-025 | Project viewer cannot see other projects | RBAC | High | /projects | User in project A, not in B | 1. Try to access project B | Cannot see project B in sidebar |
| ORG-026 | Organization billing dashboard | Positive | High | /org/settings/billing | Org owner | 1. Navigate to billing<br>2. View usage | Current plan, usage, invoices displayed |
| ORG-027 | Change subscription plan | Positive | High | /org/settings/billing | Org owner, on starter plan | 1. View billing<br>2. Click "Upgrade to Pro"<br>3. Complete payment | Plan changed, features unlocked |
| ORG-028 | Cancel subscription | Positive | High | /org/settings/billing | Org owner, paid plan | 1. Navigate to billing<br>2. Click "Cancel plan"<br>3. Confirm | Plan downgraded to free at period end |
| ORG-029 | View payment history | Positive | High | /org/settings/billing | Org owner, paid plan | 1. Navigate to billing<br>2. View invoices section | List of invoices with download links |
| ORG-030 | Update payment method | Positive | High | /org/settings/billing | Org owner | 1. Navigate to billing<br>2. Click "Update payment method"<br>3. Enter card details | Payment method updated |
| ORG-031 | Failed payment retry | Positive | High | /org/settings/billing | Org owner, payment failed | 1. Navigate to billing<br>2. Click "Retry payment" | Retry initiated, status updates |
| ORG-032 | Org invitation email contains org details | Positive | High | Email | Invitation created | 1. Invite member<br>2. Check email | Email shows org name, not sensitive data |
| ORG-033 | Billing email goes to org owner only | Positive | High | Email | Org owner, subscription active | 1. Trigger billing event<br>2. Check owner inbox | Only org owner receives email |
| ORG-034 | Cannot access deleted organization | Security | Critical | /api/org/{id} | Org deleted | 1. Store org ID<br>2. Delete org<br>3. Try to access via API | 404 not found |
| ORG-035 | Removed member cannot access org | Security | Critical | /projects | Member was removed | 1. Remove member<br>2. Former member tries to access projects | Access denied, 403 error |
| ORG-036 | Organization audit log visible to admins | Positive | High | /org/settings/audit | Org admin | 1. Navigate to audit log | Shows member changes, settings updates, deletions |
| ORG-037 | Member list pagination | Positive | Medium | /org/settings/members | Org with 100+ members | 1. Navigate to members<br>2. Check pagination | Members paginated correctly |
| ORG-038 | Search members by email | Positive | High | /org/settings/members | Org with multiple members | 1. Enter email in search<br>2. Check results | Filtered members displayed |
| ORG-039 | Sort members by role | Positive | Medium | /org/settings/members | Multiple members with different roles | 1. Click role column header<br>2. Sort ascending/descending | Members sorted by role |
| ORG-040 | Export member list | Positive | High | /org/settings/members | Org admin | 1. Click "Export"<br>2. Choose CSV or JSON | File downloaded with member data |

---

## Domain 3: Test Management (80 tests)

### Overview
Complete CRUD for 5 test types (Browser/Playwright, API, Database, Custom, Performance/K6), immediate execution with SSE updates, variable/secret management with AES-128-GCM encryption, test results viewing with artifacts.

### Test Cases

| Test ID | Description | Type | Priority | Page | Prerequisites | Steps | Expected Result |
|---------|-------------|------|----------|------|---------------|-------|-----------------|
| TEST-001 | Create browser (Playwright) test | Positive | Critical | /tests/create | Project member, logged in | 1. Navigate to /tests/create<br>2. Select "Browser (Playwright)"<br>3. Enter name<br>4. Write test code<br>5. Save | Test created, added to project |
| TEST-002 | Create API test | Positive | Critical | /tests/create | Project member | 1. Select "API"<br>2. Enter name<br>3. Configure request (URL, method, headers, body)<br>4. Add assertions<br>5. Save | API test created |
| TEST-003 | Create database test | Positive | Critical | /tests/create | Project member | 1. Select "Database"<br>2. Enter name<br>3. Configure connection<br>4. Write query<br>5. Add assertions<br>6. Save | Database test created |
| TEST-004 | Create custom script test | Positive | High | /tests/create | Project member | 1. Select "Custom"<br>2. Enter name<br>3. Write bash/node script<br>4. Save | Custom test created |
| TEST-005 | Create performance (K6) test | Positive | High | /tests/create | Project member | 1. Select "Performance (K6)"<br>2. Enter name<br>3. Write K6 script<br>4. Configure load profile<br>5. Save | K6 test created |
| TEST-006 | Test name validation | Negative | High | /tests/create | None | 1. Try empty name<br>2. Try name > 255 chars | Validation errors shown |
| TEST-007 | Test code syntax validation | Negative | High | /tests/create | Test type selected | 1. Enter invalid code syntax<br>2. Click Save | Error: "Syntax error" with line number |
| TEST-008 | Add encrypted secret to test | Positive | High | /tests/{id}/edit | Test exists | 1. Click "Add Secret"<br>2. Enter name and value<br>3. Save<br>4. Reload page | Secret saved (encrypted), display as *** |
| TEST-009 | Use secret in test code | Positive | High | /tests/{id}/edit | Secret exists in test | 1. Reference secret in code: `${{ secrets.API_KEY }}`<br>2. Execute test | Secret decrypted at runtime, test passes |
| TEST-010 | Add environment variable | Positive | High | /tests/{id}/edit | Test exists | 1. Click "Add Variable"<br>2. Enter name and value<br>3. Save | Variable saved, accessible in test |
| TEST-011 | Edit test code | Positive | High | /tests/{id}/edit | Test exists | 1. Modify code<br>2. Click "Save"<br>3. Execute test | Changes applied, test runs with new code |
| TEST-012 | Delete test | Positive | High | /tests/{id}/settings | Test exists | 1. Navigate to settings<br>2. Click "Delete test"<br>3. Confirm | Test deleted, removed from project |
| TEST-013 | Duplicate test | Positive | High | /tests/{id}/details | Test exists | 1. Click "Duplicate"<br>2. Enter new name<br>3. Confirm | Copy created with all configs |
| TEST-014 | Execute test immediately | Positive | Critical | /tests/{id}/execute | Test exists | 1. Click "Run Test"<br>2. Watch real-time updates | Test runs, status updates via SSE |
| TEST-015 | View test results summary | Positive | Critical | /tests/{id}/results | Test has run | 1. Navigate to results<br>2. View latest run | Summary shows duration, status, error (if any) |
| TEST-016 | View HTML test report | Positive | Critical | /tests/{id}/results/{run-id} | Browser test has run | 1. Click on test run<br>2. Navigate to "Report"<br>3. View HTML | Full test report with steps visible |
| TEST-017 | View test artifacts (screenshots) | Positive | Critical | /tests/{id}/results/{run-id} | Browser test with screenshots | 1. Navigate to results<br>2. Click "Screenshots"<br>3. View images | Screenshot gallery displayed |
| TEST-018 | View test trace (Playwright) | Positive | High | /tests/{id}/results/{run-id} | Browser test with trace | 1. Navigate to artifacts<br>2. Click "Trace"<br>3. Play trace | Playwright trace player opens |
| TEST-019 | View test video | Positive | High | /tests/{id}/results/{run-id} | Browser test with video | 1. Navigate to artifacts<br>2. Click "Video"<br>3. Play | Video player shows test execution |
| TEST-020 | Download test artifacts as ZIP | Positive | High | /tests/{id}/results/{run-id} | Test artifacts exist | 1. Click "Download"<br>2. Choose "All artifacts"<br>3. Confirm | ZIP file downloaded with all files |
| TEST-021 | Test execution timeout | Edge | High | /tests/{id}/execute | Test exists | 1. Run test with 30s timeout<br>2. Test hangs<br>3. Wait 30+ seconds | Test marked as timeout error |
| TEST-022 | Test with multiple assertions | Positive | High | /tests/{id}/execute | Test with 5+ assertions | 1. Execute test<br>2. View results | Each assertion shown pass/fail status |
| TEST-023 | Failing test shows error details | Positive | High | /tests/{id}/results/{run-id} | Test failed | 1. Navigate to results<br>2. View error section | Clear error message, stack trace visible |
| TEST-024 | Test results pagination | Positive | Medium | /tests/{id}/results | Test has 100+ runs | 1. Navigate to results<br>2. Scroll or paginate | Results loaded in batches |
| TEST-025 | Filter test results by date | Positive | High | /tests/{id}/results | Test has multiple results | 1. Use date range filter<br>2. Apply | Results filtered to date range |
| TEST-026 | Filter test results by status | Positive | High | /tests/{id}/results | Test has pass and fail results | 1. Filter by "Failed"<br>2. Apply | Only failed runs shown |
| TEST-027 | Export test results as CSV | Positive | High | /tests/{id}/results | Test has results | 1. Click "Export"<br>2. Choose CSV | CSV file downloaded with run data |
| TEST-028 | Compare test results across runs | Positive | High | /tests/{id}/results | Test has 2+ runs | 1. Select 2 runs<br>2. Click "Compare" | Side-by-side comparison shown |
| TEST-029 | Test code with environment variables | Positive | High | /tests/{id}/execute | Variables defined | 1. Use `process.env.VAR_NAME` in code<br>2. Execute | Variables resolved at runtime |
| TEST-030 | Test code with secrets | Positive | High | /tests/{id}/execute | Secrets defined | 1. Use `${{ secrets.SECRET }}` in code<br>2. Execute<br>3. View code in UI | Secret not visible in UI, but available at runtime |
| TEST-031 | Browser test with login flow | Positive | High | /tests/{id}/execute | Browser test with login steps | 1. Test logs in to application<br>2. Execute test | Login successful, subsequent assertions pass |
| TEST-032 | API test with authentication | Positive | High | /tests/{id}/execute | API test with auth header | 1. Test includes Authorization header<br>2. Execute | Request sent with auth, response 200 |
| TEST-033 | Database test with custom query | Positive | High | /tests/{id}/execute | Database test with SELECT | 1. Query database<br>2. Execute test | Query results returned, assertions checked |
| TEST-034 | Test context/state between steps | Positive | High | /tests/{id}/execute | Multi-step test | 1. Test stores value from step 1<br>2. Uses in step 2<br>3. Execute | Values correctly passed between steps |
| TEST-035 | Test with retry on failure | Positive | High | /tests/{id}/edit | Test exists | 1. Enable "Retry on failure"<br>2. Set to 3 retries<br>3. Execute flaky test | Test retried up to 3 times on failure |
| TEST-036 | Cannot delete test with active jobs | Negative | High | /tests/{id}/settings | Test has active job | 1. Try to delete test | Error: "Cannot delete - used in active jobs" |
| TEST-037 | Cannot edit test executed by job | Negative | High | /tests/{id}/edit | Test in active job | 1. Try to modify code<br>2. Try to save | Warning: "Job is running this test" |
| TEST-038 | Test viewer cannot edit | RBAC | High | /tests/{id}/edit | Logged in as Viewer | 1. Try to click edit button<br>2. Try to modify<br>3. Try to save | Button hidden, 403 on API call |
| TEST-039 | Test editor cannot delete | RBAC | High | /tests/{id}/settings | Logged in as Editor | 1. Try to click delete button | Button hidden or disabled |
| TEST-040 | Import test from GitHub | Positive | High | /tests/import | User connected GitHub | 1. Navigate to import<br>2. Select repo and file<br>3. Import | Test code imported, saved as new test |
| TEST-041 | Test metadata: created by, created at | Positive | High | /tests/{id}/details | Test exists | 1. View test details<br>2. Check metadata | Shows creator name, creation timestamp |
| TEST-042 | Test metadata: last modified | Positive | High | /tests/{id}/details | Test modified | 1. View test details | Shows last modified timestamp and user |
| TEST-043 | Test version history | Positive | High | /tests/{id}/versions | Test has been edited | 1. Click "Versions"<br>2. View history | All past versions listed with dates |
| TEST-044 | Restore test from old version | Positive | High | /tests/{id}/versions | Old version exists | 1. Select old version<br>2. Click "Restore"<br>3. Confirm | Code restored, new version created |
| TEST-045 | Test diff between versions | Positive | High | /tests/{id}/versions | 2+ versions exist | 1. Select two versions<br>2. Click "Compare" | Diff view shows changes |
| TEST-046 | Monaco editor with syntax highlighting | Positive | High | /tests/create | Test type selected | 1. View code editor<br>2. Type code | Syntax highlighting applied based on language |
| TEST-047 | Monaco editor autocomplete | Positive | High | /tests/create | In code editor | 1. Type part of function name<br>2. Trigger autocomplete | Suggestions appear |
| TEST-048 | Test code snippets/templates | Positive | High | /tests/create | Browser test selected | 1. Click "Templates"<br>2. Select "Login example"<br>3. Insert | Template code inserted into editor |
| TEST-049 | Test tags for organization | Positive | High | /tests/{id}/edit | Test exists | 1. Click "Add tag"<br>2. Enter tag name<br>3. Save | Tag saved, searchable |
| TEST-050 | Search tests by tag | Positive | High | /tests | Tests have tags | 1. Filter by tag<br>2. View results | Tests with tag displayed |
| TEST-051 | Test descriptions/documentation | Positive | High | /tests/{id}/edit | Test exists | 1. Click "Edit description"<br>2. Write markdown<br>3. Save | Description saved, displayed on test page |
| TEST-052 | Browser test with multiple browsers | Positive | High | /tests/create | Browser test selected | 1. Select "Run on multiple browsers"<br>2. Choose Chrome, Firefox, Safari<br>3. Save | Test configured to run on multiple browsers |
| TEST-053 | Test with data-driven inputs | Positive | High | /tests/create | Test supports parameters | 1. Define input data (CSV, JSON)<br>2. Configure test to iterate<br>3. Execute | Test runs once per data row |
| TEST-054 | Test screenshot comparison | Positive | High | /tests/{id}/results/{run-id} | Browser test with screenshots | 1. View baseline screenshot<br>2. Compare with latest run | Diff highlighted if different |
| TEST-055 | Test with visual regression detection | Edge | High | /tests/{id}/execute | Screenshot baseline set | 1. Run test with UI change<br>2. View results | Visual diff detected and flagged |
| TEST-056 | Test performance metrics | Positive | High | /tests/{id}/results/{run-id} | Performance test run | 1. Navigate to results<br>2. View metrics section | Shows p95, p99, throughput, error rate |
| TEST-057 | Test soak test configuration | Positive | High | /tests/create | K6 performance test | 1. Set duration: 1 hour<br>2. Set VU: 10<br>3. Configure spike at 30min | Configuration saved |
| TEST-058 | Test result webhook notification | Positive | High | /tests/{id}/settings | Webhook configured | 1. Configure webhook URL<br>2. Execute test<br>3. Verify webhook called | Test result POSTed to webhook |
| TEST-059 | Real-time test execution streaming | Positive | Critical | /tests/{id}/execute | Test running | 1. Watch execution page<br>2. Observe real-time updates via SSE | Step-by-step progress appears live |
| TEST-060 | Cannot view other org's test | Security | Critical | /api/tests/{id} | Test belongs to org A | 1. User is member of org B<br>2. Try to GET test | 403 forbidden |
| TEST-061 | Test code not logged in plaintext | Security | High | Logs | Test executed | 1. Check application logs<br>2. Search for test code | Code not present in logs |
| TEST-062 | Secret not exposed in test results | Security | Critical | /tests/{id}/results/{run-id} | Test uses secret | 1. View results<br>2. Check logs section<br>3. View downloaded artifacts | Secret value not visible anywhere |
| TEST-063 | Test execution audit log | Positive | High | /tests/{id}/audit | Test has executed | 1. Navigate to audit log<br>2. View executions | Shows who ran, when, with what parameters |
| TEST-064 | Cannot execute test on behalf of other user | Security | High | /api/tests/{id}/execute | Test exists | 1. Call execute API with `run_as` parameter | 403 forbidden, cannot impersonate |
| TEST-065 | Sensitive data not in error messages | Security | High | /tests/{id}/results/{run-id} | Test with secret fails | 1. Test fails and error shown<br>2. Check error message | Secret value redacted in message |
| TEST-066 | XSS prevention in test name | Security | High | /tests | Test name contains script tag | 1. Create test with name: `<script>alert()</script>`<br>2. View test list | Script tag escaped, rendered as text |
| TEST-067 | SQL injection prevention in database test | Security | High | /tests/{id}/execute | Database test with user input | 1. Test parameterized query with malicious input<br>2. Execute | Query uses parameterized statement, no injection |
| TEST-068 | Test code backup in database | Positive | High | /tests/{id}/versions | Test exists | 1. View version history<br>2. Check database | All versions backed up in database |
| TEST-069 | Test results retention policy | Positive | Medium | /settings/data-retention | User in settings | 1. Configure retention: 30 days<br>2. View test runs from 40 days ago | Old runs automatically deleted |
| TEST-070 | Test with large output | Edge | High | /tests/{id}/execute | Test outputs 10MB log<br> | 1. Execute test<br>2. View results | Output truncated, download option available |
| TEST-071 | Test execution cancellation | Positive | High | /tests/{id}/execute | Test running | 1. Click "Cancel"<br>2. Confirm | Test stops mid-execution |
| TEST-072 | Test execution with resource limits | Positive | High | /tests/create | Docker test execution | 1. Set CPU limit: 1 core<br>2. Set memory limit: 512MB<br>3. Execute | Test limited to resources |
| TEST-073 | Browser test with custom viewport | Positive | High | /tests/create | Browser test | 1. Set viewport size: 1920x1080<br>2. Execute | Browser launched with custom size |
| TEST-074 | Browser test headless mode | Positive | High | /tests/create | Browser test | 1. Test configured for headless<br>2. Execute | Browser runs without UI |
| TEST-075 | Test with proxy configuration | Positive | High | /tests/create | Browser test | 1. Set proxy URL<br>2. Execute | Traffic routed through proxy |
| TEST-076 | Test ignore HTTPS errors | Positive | High | /tests/create | Browser test with self-signed cert | 1. Enable "Ignore HTTPS errors"<br>2. Execute | Navigation succeeds despite cert error |
| TEST-077 | Test with geolocation | Positive | High | /tests/create | Browser test | 1. Set geolocation: London<br>2. Execute | Test executes with mocked location |
| TEST-078 | Test with emulated device | Positive | High | /tests/create | Browser test | 1. Select emulated device: iPhone 12<br>2. Execute | Browser emulates device properties |
| TEST-079 | Test execution history graph | Positive | High | /tests/{id}/results | Test has 30+ runs | 1. View results page<br>2. Check graph | Timeline graph shows pass/fail over time |
| TEST-080 | Export test as JSON | Positive | High | /tests/{id}/settings | Test exists | 1. Click "Export"<br>2. Choose JSON | Test config exported as JSON file |

---

## Domain 4: Playground & AI Features (50 tests)

### Overview
Monaco editor with syntax highlighting, AI Fix for analyzing failed tests, AI Create for generating tests from natural language, diff viewer for AI suggestions, real-time SSE streaming of AI responses.

### Test Cases

| Test ID | Description | Type | Priority | Page | Prerequisites | Steps | Expected Result |
|---------|-------------|------|----------|------|---------------|-------|-----------------|
| PLAY-001 | Load playground page | Positive | High | /playground | Logged in | 1. Navigate to /playground | Page loads with Monaco editor |
| PLAY-002 | Monaco editor syntax highlighting | Positive | High | /playground | On playground page | 1. Write JavaScript code<br>2. Observe highlighting | Syntax highlighted correctly |
| PLAY-003 | Monaco editor autocomplete | Positive | High | /playground | Editor focused | 1. Type `describe('<br>2. Trigger autocomplete | Suggestions appear |
| PLAY-004 | Run test in playground immediately | Positive | Critical | /playground | Code in editor | 1. Write valid test code<br>2. Click "Run"<br>3. Wait for execution | Test runs, results shown below |
| PLAY-005 | Playground test failure shows error | Positive | High | /playground | Code has assertion failure | 1. Write failing test<br>2. Click "Run" | Error message with stack trace shown |
| PLAY-006 | Playground execution timeout | Edge | High | /playground | Code hangs | 1. Write infinite loop<br>2. Click "Run"<br>3. Wait 30s | Test times out, error shown |
| PLAY-007 | AI Fix analyzes failed test | Positive | Critical | /playground | Test failed | 1. Run test that failed<br>2. Click "AI Fix"<br>3. Watch SSE streaming | AI analysis starts, suggestions stream in |
| PLAY-008 | AI Fix shows suggested code | Positive | Critical | /playground | AI Fix completed | 1. View AI Fix results<br>2. Scroll through suggestions | Multiple fix suggestions with explanations |
| PLAY-009 | AI Fix real-time streaming | Positive | High | /playground | AI Fix running | 1. Watch fix suggestions appear | Suggestions appear character-by-character via SSE |
| PLAY-010 | Apply AI Fix suggestion | Positive | High | /playground | Fix suggestion displayed | 1. Click "Apply"<br>2. Confirm | Suggestion code inserted into editor |
| PLAY-011 | Reject AI Fix suggestion | Positive | High | /playground | Fix suggestion displayed | 1. Click "Dismiss"<br>2. Continue editing | Suggestion dismissed, original code remains |
| PLAY-012 | Compare original vs AI Fix | Positive | High | /playground | Fix suggestion shown | 1. Click "Compare"<br>2. View diff | Side-by-side diff of original and fixed code |
| PLAY-013 | Create test from natural language | Positive | Critical | /playground/ai-create | Logged in | 1. Click "AI Create"<br>2. Describe test in natural language<br>3. Click "Generate" | AI generates test code based on description |
| PLAY-014 | AI Create real-time streaming | Positive | High | /playground/ai-create | Generating test | 1. Watch code appear in editor | Code generates in real-time via SSE |
| PLAY-015 | AI Create multiple variations | Positive | High | /playground/ai-create | Test created | 1. Click "Generate variations"<br>2. View options | Multiple test code variations shown |
| PLAY-016 | Use AI-created test immediately | Positive | High | /playground/ai-create | Test generated | 1. Click "Run Test"<br>2. Execute in playground | Generated test runs successfully |
| PLAY-017 | Save playground test to project | Positive | High | /playground | Test code in editor | 1. Click "Save to project"<br>2. Select project<br>3. Enter test name<br>4. Confirm | Test saved to project |
| PLAY-018 | Import test from project to playground | Positive | High | /playground | Test exists in project | 1. Click "Import from project"<br>2. Select test<br>3. Load | Test code loaded into playground |
| PLAY-019 | Playground test history | Positive | High | /playground | Multiple tests run | 1. Click "History"<br>2. View past runs | List of recent playground tests shown |
| PLAY-020 | Restore playground test from history | Positive | High | /playground | History available | 1. Select past test<br>2. Click "Restore" | Code restored to editor |
| PLAY-021 | Share playground test link | Positive | High | /playground | Test code in editor | 1. Click "Share"<br>2. Copy link<br>3. Share link | Other user can access shared test |
| PLAY-022 | Playground test versioning | Positive | Medium | /playground | Test modified | 1. Modify code<br>2. Click "Save version"<br>3. View versions | Version saved with timestamp |
| PLAY-023 | Monaco editor theme toggle | Positive | Medium | /playground | Editor on page | 1. Click theme toggle<br>2. Select dark mode | Editor background changes to dark |
| PLAY-024 | Monaco editor font size adjustment | Positive | Medium | /playground | Editor focused | 1. Use keyboard shortcut or menu to increase font<br>2. Check size | Font size increases |
| PLAY-025 | Playground keyboard shortcuts | Positive | High | /playground | Editor focused | 1. Press Ctrl+Enter to run test | Test executes |
| PLAY-026 | AI Fix with code context | Positive | High | /playground | Multiple tests in editor | 1. Run one failing test<br>2. Click "AI Fix"<br>3. AI understands context | AI uses full code context in fix suggestions |
| PLAY-027 | AI Create with test examples | Positive | High | /playground/ai-create | Sample tests shown | 1. View test examples<br>2. Click to use as template<br>3. Describe variation | Template helps AI understand test style |
| PLAY-028 | AI response includes explanations | Positive | High | /playground | AI Fix completed | 1. View AI suggestions<br>2. Check explanation text | Each suggestion includes explanation |
| PLAY-029 | Copy AI suggestion to clipboard | Positive | High | /playground | Suggestion displayed | 1. Click "Copy"<br>2. Paste elsewhere | Code copied successfully |
| PLAY-030 | AI Fix handles API tests | Positive | High | /playground | Failed API test | 1. Run failing API test<br>2. Click "AI Fix"<br>3. View suggestions | AI suggests API-specific fixes |
| PLAY-031 | AI Create browser test | Positive | High | /playground/ai-create | Playwright test requested | 1. Prompt: "Create test that logs in and checks dashboard"<br>2. Generate | Browser test code generated |
| PLAY-032 | AI Create API test | Positive | High | /playground/ai-create | API test requested | 1. Prompt: "Test GET /api/users endpoint"<br>2. Generate | API test code generated |
| PLAY-033 | AI Create database test | Positive | High | /playground/ai-create | Database test requested | 1. Prompt: "Test user creation in database"<br>2. Generate | Database test code generated |
| PLAY-034 | Cannot access playground without auth | Security | High | /playground | Not logged in | 1. Navigate to playground without session | Redirected to /sign-in |
| PLAY-035 | Playground code not stored on server | Security | High | /playground | Code in editor | 1. Write code<br>2. Refresh page without saving | Code lost unless explicitly saved |
| PLAY-036 | AI Fix uses sandboxed execution | Security | High | /playground | Test with malicious code | 1. Write code that tries file access<br>2. AI Fix | Execution sandboxed, no system access |
| PLAY-037 | AI responses don't reveal system secrets | Security | High | /playground | AI Fix | 1. Write code that tries to access env vars<br>2. AI Fix | Suggestions don't contain secret values |
| PLAY-038 | Playground timeout protection | Security | High | /playground | Infinite loop code | 1. Write infinite loop<br>2. Run | Execution times out, no server damage |
| PLAY-039 | AI Create respects language context | Positive | High | /playground/ai-create | Language selection | 1. Select JavaScript<br>2. Prompt: "Create test"<br>3. Generate | Code generated in JavaScript, not other language |
| PLAY-040 | Playground code syntax validation | Positive | High | /playground | Invalid syntax | 1. Write invalid syntax<br>2. Click "Run"<br>3. Check error | Clear syntax error message shown |
| PLAY-041 | AI Fix error prevention | Edge | High | /playground | Test with common error | 1. Write test with typo<br>2. Run (fails)<br>3. AI Fix | AI identifies and fixes common mistakes |
| PLAY-042 | Playground supports multiple files | Positive | Medium | /playground | Add second file button | 1. Click "Add file"<br>2. Create multiple files | Multiple files in editor, can switch between |
| PLAY-043 | Playground test execution metrics | Positive | High | /playground | Test executed | 1. Run test<br>2. View metrics | Shows execution time, memory used |
| PLAY-044 | AI Create generates valid test | Positive | Critical | /playground/ai-create | Test generated | 1. Generate test<br>2. Run in playground<br>3. Check execution | Generated test runs without syntax errors |
| PLAY-045 | AI Create includes assertions | Positive | High | /playground/ai-create | Test generated | 1. Generate test<br>2. Check code | Test includes expect() assertions |
| PLAY-046 | Playground recent files | Positive | High | /playground | Used playground before | 1. Check sidebar<br>2. View recent tests | Recent playground tests listed |
| PLAY-047 | Playground favorite tests | Positive | High | /playground | Tests in history | 1. Star favorite test<br>2. Filter by favorites | Starred tests appear in favorites section |
| PLAY-048 | Playground code templates | Positive | High | /playground | Templates available | 1. Click "Templates"<br>2. Select "Login test"<br>3. Insert | Template code inserted into editor |
| PLAY-049 | AI Fix maintains code style | Positive | High | /playground | Code with specific style | 1. AI Fix on code with tabs<br>2. Check fixed code | Fixed code maintains original style (tabs/spaces) |
| PLAY-050 | Playground collapse/expand console | Positive | Medium | /playground | Test results shown | 1. Click collapse button<br>2. Expand again | Console output area toggles |

---

## Domain 5: Job Management (70 tests)

### Overview
Complex multi-step wizard for job creation (details, test selection, scheduling, alerts, API keys), cron expression validation, manual and scheduled triggers, CI/CD integration via API keys, alert configuration with multiple channels.

### Test Cases

| Test ID | Description | Type | Priority | Page | Prerequisites | Steps | Expected Result |
|---------|-------------|------|----------|------|---------------|-------|-----------------|
| JOB-001 | Create scheduled Playwright job | Positive | Critical | /jobs/create | Tests exist in project | 1. Navigate to create job<br>2. Enter name<br>3. Select test<br>4. Set schedule: daily at 9 AM<br>5. Configure alerts<br>6. Save | Job created, scheduled |
| JOB-002 | Job wizard step 1: details | Positive | High | /jobs/create | None | 1. Navigate to create job<br>2. Fill job name<br>3. Add description<br>4. Click next | Step 1 complete, move to step 2 |
| JOB-003 | Job wizard step 2: select tests | Positive | High | /jobs/create | Tests exist | 1. Complete step 1<br>2. Select 3 tests<br>3. Click next | Tests selected, move to step 3 |
| JOB-004 | Job wizard step 3: scheduling | Positive | High | /jobs/create | Step 2 complete | 1. Configure cron: `0 9 * * *`<br>2. Set timezone<br>3. Click next | Schedule configured, move to step 4 |
| JOB-005 | Manual job trigger | Positive | Critical | /jobs/{id} | Job exists | 1. Navigate to job<br>2. Click "Run now"<br>3. Confirm | Job executes immediately |
| JOB-006 | Job execution shows real-time status | Positive | Critical | /jobs/{id}/runs/{run-id} | Job running | 1. View running job<br>2. Watch progress | Real-time SSE updates show test status |
| JOB-007 | Job results summary | Positive | Critical | /jobs/{id}/runs/{run-id} | Job completed | 1. Navigate to job run<br>2. View summary | Shows tests run, passed, failed, duration |
| JOB-008 | Trigger job via API key | Positive | Critical | /api/jobs/{id}/trigger | Job exists, API key created | 1. POST to endpoint with API key<br>2. Monitor execution | Job triggered, runs successfully |
| JOB-009 | CI/CD webhook trigger | Positive | Critical | /api/webhooks/job/{id} | Webhook URL configured | 1. POST to webhook URL<br>2. Include auth token<br>3. Monitor | Job triggered via webhook |
| JOB-010 | Job cron expression validation | Negative | High | /jobs/create | In scheduling step | 1. Enter invalid cron: `invalid`<br>2. Try to proceed | Error: "Invalid cron expression" |
| JOB-011 | Job cron expression parsing | Positive | High | /jobs/create | Scheduling step | 1. Enter cron: `0 0 * * 0`<br>2. Check preview | Shows: "Runs every Sunday at midnight" |
| JOB-012 | Job with multiple tests | Positive | High | /jobs/create | 5+ tests available | 1. Select 5 tests<br>2. Configure schedule<br>3. Save | All tests included in job |
| JOB-013 | Job reorder tests | Positive | High | /jobs/{id}/edit | Job with multiple tests | 1. Drag test up/down<br>2. Save | Test execution order changed |
| JOB-014 | Job execution sends notifications | Positive | Critical | /jobs/{id}/edit | Job with alerts configured | 1. Configure Slack alert on failure<br>2. Trigger job failure<br>3. Check Slack | Failure notification sent to real Slack channel |
| JOB-015 | Job alert with email | Positive | Critical | /jobs/{id}/edit | Job alert configured | 1. Configure email alert<br>2. Trigger failure<br>3. Check inbox | Failure email sent to real address |
| JOB-016 | Job alert with multiple channels | Positive | High | /jobs/{id}/edit | Alerts configured | 1. Set alerts for Slack + Email + Discord<br>2. Trigger event | All 3 channels receive notification |
| JOB-017 | Job alert only on failure | Positive | High | /jobs/{id}/edit | Alert configured | 1. Set alert: "on failure"<br>2. Job succeeds<br>3. No alert sent<br>4. Job fails<br>5. Alert sent | Alert only on failure |
| JOB-018 | Job wizard step 4: alerts | Positive | High | /jobs/create | Steps 1-3 complete | 1. Add email alert<br>2. Add Slack webhook<br>3. Click next | Alerts configured, move to step 5 |
| JOB-019 | Job wizard step 5: API key | Positive | High | /jobs/create | Steps 1-4 complete | 1. View API key section<br>2. Copy trigger URL<br>3. Save job | Job saved with API trigger available |
| JOB-020 | Edit job name | Positive | High | /jobs/{id}/edit | Job exists | 1. Click edit name<br>2. Change text<br>3. Save | Name updated |
| JOB-021 | Edit job schedule | Positive | High | /jobs/{id}/edit | Job exists | 1. Edit cron expression<br>2. Save | Schedule updated, next run recalculated |
| JOB-022 | Edit job tests | Positive | High | /jobs/{id}/edit | Job exists | 1. Add or remove tests<br>2. Save | Tests updated |
| JOB-023 | Delete job | Positive | High | /jobs/{id}/settings | Job exists | 1. Click "Delete"<br>2. Confirm | Job deleted, no longer scheduled |
| JOB-024 | Disable job without deleting | Positive | High | /jobs/{id}/edit | Job exists | 1. Toggle "Enabled" off<br>2. Save | Job disabled, not scheduled |
| JOB-025 | Enable disabled job | Positive | High | /jobs/{id}/edit | Job disabled | 1. Toggle "Enabled" on<br>2. Save | Job enabled, resume scheduling |
| JOB-026 | Job next run time displayed | Positive | High | /jobs/{id} | Job scheduled | 1. Navigate to job<br>2. Check "Next run" field | Shows calculated next execution time |
| JOB-027 | Job last run time displayed | Positive | High | /jobs/{id} | Job has executed | 1. Navigate to job<br>2. Check "Last run" field | Shows timestamp of most recent run |
| JOB-028 | Job run history pagination | Positive | Medium | /jobs/{id}/runs | Job has 50+ runs | 1. View run history<br>2. Scroll or paginate | Runs paginated with previous/next |
| JOB-029 | Filter job runs by date | Positive | High | /jobs/{id}/runs | Multiple runs exist | 1. Use date filter<br>2. Select date range<br>3. Apply | Runs filtered to date range |
| JOB-030 | Filter job runs by status | Positive | High | /jobs/{id}/runs | Runs with pass and fail | 1. Filter by "Failed"<br>2. Apply | Only failed runs shown |
| JOB-031 | Export job results CSV | Positive | High | /jobs/{id}/runs | Runs exist | 1. Click "Export"<br>2. Choose CSV | CSV file downloaded with run data |
| JOB-032 | Job test timeout handling | Edge | High | /jobs/{id} | Job with slow test | 1. Test takes 45 seconds<br>2. Timeout set to 30 seconds<br>3. Execute | Test times out, marked as failed |
| JOB-033 | Job stops on first failure | Positive | High | /jobs/{id}/edit | Job configuration | 1. Enable "Stop on first failure"<br>2. Run with 5 tests<br>3. Test 2 fails | Job stops, tests 3-5 not executed |
| JOB-034 | Job continues on failure | Positive | High | /jobs/{id}/edit | Job configuration | 1. Disable "Stop on first failure"<br>2. Run with 5 tests<br>3. Test 2 fails | Job continues, all 5 tests executed |
| JOB-035 | Job retry failed tests | Positive | High | /jobs/{id}/edit | Job configuration | 1. Enable "Retry failed tests"<br>2. Set retries to 2<br>3. Flaky test fails once | Test retried up to 2 times |
| JOB-036 | Job execution parallelization | Positive | High | /jobs/{id} | Job with 5 tests | 1. Configure parallel execution<br>2. Run job<br>3. Check execution time | Tests run in parallel, execution faster |
| JOB-037 | Job test order maintained | Positive | High | /jobs/{id}/runs/{run-id} | Job with ordered tests | 1. View run results<br>2. Check order | Tests executed in configured order |
| JOB-038 | Job metadata: created by | Positive | High | /jobs/{id}/details | Job exists | 1. View job details<br>2. Check metadata | Shows creator name and date |
| JOB-039 | Job metadata: last modified | Positive | High | /jobs/{id}/details | Job edited | 1. View job details | Shows last modified timestamp and user |
| JOB-040 | Job audit log | Positive | High | /jobs/{id}/audit | Job exists | 1. Navigate to audit tab<br>2. View changes | Log shows modifications, name changes |
| JOB-041 | Job tags | Positive | High | /jobs/{id}/edit | Job exists | 1. Add tag: "critical"<br>2. Save | Tag saved, searchable |
| JOB-042 | Search jobs by tag | Positive | High | /jobs | Jobs have tags | 1. Filter by tag "critical"<br>2. Apply | Jobs with tag shown |
| JOB-043 | Job description/documentation | Positive | High | /jobs/{id}/edit | Job exists | 1. Edit description<br>2. Write markdown<br>3. Save | Description saved, displayed |
| JOB-044 | Job watch notifications | Positive | High | /jobs/{id} | Job exists | 1. Click "Watch job"<br>2. Job executes<br>3. Check inbox | Execution summary emailed to watcher |
| JOB-045 | Job unwatch notifications | Positive | High | /jobs/{id} | Watching job | 1. Click "Unwatch"<br>2. Job executes | No notification sent |
| JOB-046 | Job cannot be triggered by non-owner | Security | High | /api/jobs/{id}/trigger | Job exists, wrong user | 1. User B tries to trigger user A's job | 403 forbidden |
| JOB-047 | Job API key scope limitation | Security | High | /jobs | API key with limited scope | 1. Create key scoped to job<br>2. Try to trigger other job | 403 forbidden |
| JOB-048 | Job results not visible to other org | Security | Critical | /api/jobs/{id}/runs | Job in org A | 1. User in org B tries to access<br>2. Attempt API call | 403 forbidden |
| JOB-049 | Job execution logs not stored with sensitive data | Security | High | Logs | Job uses secrets | 1. Execute job with secret<br>2. Check logs | Secret value redacted in logs |
| JOB-050 | Job alert URLs don't expose secrets | Security | High | Alert message | Job failure with secret | 1. Trigger job failure<br>2. Check alert notification<br>3. Check any URLs | URLs don't contain secret values |
| JOB-051 | Job webhook signature verification | Security | High | /api/webhooks/job/{id} | Webhook configured | 1. Send POST without signature<br>2. Check validation | Request rejected or flagged |
| JOB-052 | Job retry mechanism with exponential backoff | Positive | High | /jobs/{id} | Transient failure occurs | 1. Trigger job with transient error<br>2. Enable retries<br>3. Watch execution | Retries with increasing delay |
| JOB-053 | Job bulk trigger | Positive | High | /jobs | Multiple jobs selected | 1. Select 5 jobs<br>2. Click "Bulk run"<br>3. Confirm | All 5 jobs execute |
| JOB-054 | Job schedule timezone support | Positive | High | /jobs/create | In scheduling step | 1. Set timezone: "America/New_York"<br>2. Set cron: `0 9 * * *`<br>3. Save | Schedule uses specified timezone |
| JOB-055 | Job daylight saving time handling | Edge | High | /jobs | Job scheduled daily at 9 AM | 1. Job scheduled in winter timezone<br>2. DST transition occurs<br>3. Job runs at correct time | Job adjusts for DST |
| JOB-056 | Job execution report | Positive | High | /jobs/{id}/runs/{run-id} | Job completed | 1. View run<br>2. Click "Report" | Detailed report with all test results |
| JOB-057 | Job email report subscription | Positive | High | /jobs/{id} | Job exists | 1. Click "Email reports"<br>2. Set frequency: daily<br>3. Save | Daily summary email sent |
| JOB-058 | Job Slack report integration | Positive | High | /jobs/{id} | Slack connected | 1. Configure Slack reports<br>2. Job runs<br>3. Check Slack | Job summary posted to Slack |
| JOB-059 | Job deployment notification | Positive | High | /jobs/{id}/runs/{run-id} | Job deployed to production | 1. Job marks deployment<br>2. Notification triggered | Deployment notification sent |
| JOB-060 | Cannot view job from different project | RBAC | High | /api/jobs/{id} | User in project A, job in B | 1. Try to GET job<br>2. Call API | 403 forbidden |
| JOB-061 | Editor cannot modify job schedule | RBAC | High | /jobs/{id}/edit | Logged in as Editor | 1. Try to edit schedule<br>2. Try to save | 403 error, schedule locked |
| JOB-062 | Viewer cannot view job runs | RBAC | High | /jobs/{id}/runs | Logged in as Viewer | 1. Try to navigate to runs | 403 error, button hidden |
| JOB-063 | Job execution captures test output | Positive | High | /jobs/{id}/runs/{run-id} | Job completed | 1. View run<br>2. Check output section | Test logs captured and displayed |
| JOB-064 | Job result webhook delivery | Positive | High | /jobs | Webhook configured | 1. Configure result webhook<br>2. Run job<br>3. Check webhook calls | Webhook POSTed with job results |
| JOB-065 | Job with conditional steps | Positive | Medium | /jobs/create | Multiple tests selected | 1. Set conditional: "run test B only if test A passes"<br>2. Run | Test B skipped if A fails |
| JOB-066 | Job duration trend | Positive | High | /jobs/{id}/analytics | Multiple runs exist | 1. View analytics<br>2. Check duration graph | Line chart shows trend over time |
| JOB-067 | Job success rate trend | Positive | High | /jobs/{id}/analytics | Multiple runs exist | 1. View analytics<br>2. Check pass rate | Graph shows percentage pass rate over time |
| JOB-068 | Job flakiness detection | Positive | High | /jobs/{id}/analytics | Job runs multiple times | 1. View analytics<br>2. Check flakiness score | Calculates and shows test flakiness |
| JOB-069 | Job cost estimation | Positive | Medium | /jobs | Job with resource config | 1. View job<br>2. Check cost estimate | Shows estimated cost per run |
| JOB-070 | Job integration with status page | Positive | High | /jobs/{id}/settings | Status page configured | 1. Link job to status page component<br>2. Job fails<br>3. Check status page | Component shows as degraded |

---

## Domain 6: Monitor Management (90 tests)

### Overview
5 monitor types (Synthetic, HTTP, Website, Ping, Port), multi-location monitoring (US East, EU Central, Asia Pacific), location-specific results, uptime aggregation, SSL cert monitoring, advanced configuration options.

### Test Cases

| Test ID | Description | Type | Priority | Page | Prerequisites | Steps | Expected Result |
|---------|-------------|------|----------|------|---------------|-------|-----------------|
| MON-001 | Create synthetic monitor | Positive | Critical | /monitors/create | Project member | 1. Select "Synthetic (Playwright)"<br>2. Select test<br>3. Set frequency: 5 minutes<br>4. Select locations<br>5. Save | Monitor created, checks scheduled |
| MON-002 | Create HTTP monitor | Positive | Critical | /monitors/create | Project member | 1. Select "HTTP"<br>2. Enter URL<br>3. Set method and frequency<br>4. Add status assertion<br>5. Save | HTTP monitor created |
| MON-003 | Create website monitor | Positive | Critical | /monitors/create | Project member | 1. Select "Website"<br>2. Enter URL<br>3. Set frequency<br>4. Save | Website monitor with SSL checking |
| MON-004 | Create ping monitor | Positive | High | /monitors/create | Project member | 1. Select "Ping"<br>2. Enter host<br>3. Set frequency and timeout<br>4. Save | Ping monitor created |
| MON-005 | Create port monitor | Positive | High | /monitors/create | Project member | 1. Select "Port"<br>2. Enter host and port<br>3. Set frequency<br>4. Save | Port monitor created |
| MON-006 | Monitor with multi-location | Positive | Critical | /monitors/create | HTTP monitor selected | 1. Select locations: US East, EU Central, Asia Pacific<br>2. Save | Monitor checks all 3 locations |
| MON-007 | Monitor location-specific results | Positive | Critical | /monitors/{id} | Multi-location monitor exists | 1. Navigate to monitor<br>2. View results by location<br>3. Check US East results | Results shown separately per location |
| MON-008 | Monitor uptime aggregation strategy | Positive | High | /monitors/{id}/settings | Multi-location monitor | 1. Set strategy: "all must pass"<br>2. US check passes, EU fails<br>3. Check overall status | Overall status shows failed |
| MON-009 | Monitor uptime calculation | Positive | High | /monitors/{id}/analytics | Monitor has history | 1. View analytics<br>2. Check uptime percentage | Uptime calculated correctly (passes / total checks) |
| MON-010 | Monitor response time tracking | Positive | High | /monitors/{id}/results | Monitor has results | 1. View results<br>2. Check response time column | Response times displayed in milliseconds |
| MON-011 | Monitor SSL cert expiry check | Positive | High | /monitors/{id} | Website monitor configured | 1. Monitor HTTPS site<br>2. View cert info<br>3. Days to expiry shown | Shows cert expiry date and warning |
| MON-012 | Monitor SSL cert expiry alert | Positive | Critical | /monitors/{id}/settings | Website monitor, cert expires in 7 days | 1. Configure alert<br>2. Wait for alert trigger | Alert sent when cert < 7 days from expiry |
| MON-013 | Monitor HTTP headers validation | Positive | High | /monitors/{id}/settings | HTTP monitor | 1. Add header assertion: `"Content-Type": "application/json"`<br>2. Save<br>3. Check | Assertion validates response headers |
| MON-014 | Monitor response body assertion | Positive | High | /monitors/{id}/settings | HTTP monitor | 1. Add assertion: response contains "success"<br>2. Save | Body checked against assertion |
| MON-015 | Monitor with custom headers | Positive | High | /monitors/{id}/settings | HTTP monitor | 1. Add headers: Authorization, Custom-Header<br>2. Save<br>3. Execute | Requests include custom headers |
| MON-016 | Monitor with basic auth | Positive | High | /monitors/{id}/settings | HTTP monitor | 1. Configure username and password<br>2. Save | Requests use basic auth |
| MON-017 | Monitor execution immediately | Positive | High | /monitors/{id} | Monitor exists | 1. Click "Check now"<br>2. Wait | Check executes immediately |
| MON-018 | Monitor real-time status updates | Positive | Critical | /monitors/{id} | Monitor running | 1. Watch monitor page<br>2. Check occurs<br>3. Status updates via SSE | Status updates in real-time |
| MON-019 | Monitor health history graph | Positive | High | /monitors/{id}/analytics | Monitor has 7+ days history | 1. View analytics<br>2. Check graph | Timeline showing up/down over time |
| MON-020 | Monitor downtime incidents | Positive | High | /monitors/{id}/incidents | Monitor had downtime | 1. View incidents<br>2. Check list | Downtime periods listed with duration |
| MON-021 | Monitor incident timeline | Positive | High | /monitors/{id}/incidents/{id} | Incident exists | 1. View incident<br>2. Check timeline | Shows when down, when back up |
| MON-022 | Monitor JSON response parsing | Positive | High | /monitors/{id}/settings | HTTP monitor returning JSON | 1. Add JSON path assertion: `$.status == "ok"`<br>2. Save | JSON parsed and checked |
| MON-023 | Monitor webhook with JSON payload | Positive | High | /monitors/{id}/results | Monitor configured | 1. Configure webhook<br>2. Check executes<br>3. View webhook call | Webhook receives JSON result |
| MON-024 | Monitor alert on status change | Positive | Critical | /monitors/{id}/settings | Alert configured | 1. Monitor is up<br>2. Configure alert on state change<br>3. Monitor goes down | Alert immediately sent when status changes |
| MON-025 | Monitor alert only when down | Positive | High | /monitors/{id}/settings | Alert configured | 1. Set alert type: "when down"<br>2. Monitor goes down<br>3. Check notifications | Alert only sent when status is down |
| MON-026 | Monitor recovery notification | Positive | High | /monitors/{id}/settings | Alert configured, monitor down | 1. Configure recovery alert<br>2. Monitor recovers | Recovery notification sent |
| MON-027 | Monitor pause | Positive | High | /monitors/{id} | Monitor exists | 1. Click "Pause"<br>2. Confirm | Monitor paused, no more checks |
| MON-028 | Monitor resume | Positive | High | /monitors/{id} | Monitor paused | 1. Click "Resume"<br>2. Confirm | Monitor resumes checking |
| MON-029 | Monitor disable temporarily | Positive | High | /monitors/{id}/settings | Monitor exists | 1. Set "Active": false<br>2. Save | Monitor disabled, not checked |
| MON-030 | Monitor enable | Positive | High | /monitors/{id}/settings | Monitor disabled | 1. Set "Active": true<br>2. Save | Monitor enabled, checks resume |
| MON-031 | Monitor edit name | Positive | High | /monitors/{id}/edit | Monitor exists | 1. Edit name<br>2. Save | Name updated |
| MON-032 | Monitor edit frequency | Positive | High | /monitors/{id}/settings | Monitor exists | 1. Change frequency from 5 to 15 minutes<br>2. Save | Frequency updated |
| MON-033 | Monitor edit locations | Positive | High | /monitors/{id}/settings | Monitor exists | 1. Remove EU location<br>2. Save | Locations updated, EU checks stopped |
| MON-034 | Monitor delete | Positive | High | /monitors/{id}/settings | Monitor exists | 1. Click "Delete"<br>2. Confirm | Monitor deleted, checks stopped |
| MON-035 | Monitor cannot be deleted if linked to job | Negative | High | /monitors/{id}/settings | Monitor linked to job | 1. Try to delete | Error: "Cannot delete - used in job" |
| MON-036 | Monitor results pagination | Positive | Medium | /monitors/{id}/results | Monitor has 100+ results | 1. View results<br>2. Paginate | Results shown in pages |
| MON-037 | Monitor filter results by location | Positive | High | /monitors/{id}/results | Multi-location monitor | 1. Filter by "US East"<br>2. Apply | Only US East results shown |
| MON-038 | Monitor filter results by status | Positive | High | /monitors/{id}/results | Mix of up/down results | 1. Filter by "Down"<br>2. Apply | Only down results shown |
| MON-039 | Monitor filter results by date | Positive | High | /monitors/{id}/results | Multiple days of results | 1. Set date range<br>2. Apply | Results filtered to date range |
| MON-040 | Monitor export results CSV | Positive | High | /monitors/{id}/results | Results exist | 1. Click "Export"<br>2. Choose CSV | CSV file downloaded |
| MON-041 | Monitor comparison | Positive | High | /monitors | Multiple monitors exist | 1. Select 2 monitors<br>2. Click "Compare" | Side-by-side comparison shown |
| MON-042 | Monitor group by type | Positive | Medium | /monitors | Multiple monitor types | 1. Group by type | Monitors grouped: Synthetic, HTTP, Website, Ping, Port |
| MON-043 | Monitor group by status | Positive | Medium | /monitors | Mix of up/down monitors | 1. Group by status | Monitors grouped: Up, Down, Paused |
| MON-044 | Monitor metadata: created by | Positive | High | /monitors/{id}/details | Monitor exists | 1. View details | Shows creator name and timestamp |
| MON-045 | Monitor metadata: last modified | Positive | High | /monitors/{id}/details | Monitor modified | 1. View details | Shows last modified timestamp |
| MON-046 | Monitor audit log | Positive | High | /monitors/{id}/audit | Monitor exists | 1. Navigate to audit<br>2. View changes | Log shows frequency changes, location edits |
| MON-047 | Monitor tags | Positive | High | /monitors/{id}/edit | Monitor exists | 1. Add tag: "critical-api"<br>2. Save | Tag saved, searchable |
| MON-048 | Search monitors by tag | Positive | High | /monitors | Monitors have tags | 1. Filter by tag<br>2. Apply | Monitors with tag shown |
| MON-049 | Monitor description/documentation | Positive | High | /monitors/{id}/edit | Monitor exists | 1. Edit description<br>2. Write markdown<br>3. Save | Description saved |
| MON-050 | Monitor watch notifications | Positive | High | /monitors/{id} | Monitor exists | 1. Click "Watch"<br>2. Monitor status changes<br>3. Check email | Status change email sent |
| MON-051 | Monitor unwatch | Positive | High | /monitors/{id} | Watching monitor | 1. Click "Unwatch"<br>2. Status changes | No notification sent |
| MON-052 | Monitor performance SLA tracking | Positive | High | /monitors/{id}/analytics | Monitor has history | 1. View analytics<br>2. Check SLA section | Target uptime and current status shown |
| MON-053 | Monitor latency percentiles | Positive | High | /monitors/{id}/analytics | Monitor has response times | 1. View analytics<br>2. Check percentiles | Shows p50, p95, p99 latency |
| MON-054 | Monitor downtime cost calculation | Positive | High | /monitors/{id}/analytics | Monitor tracked over time | 1. View analytics<br>2. Check cost | Estimated revenue loss shown |
| MON-055 | Monitor screenshot on failure | Positive | High | /monitors/{id}/results | Synthetic monitor failed | 1. View failed result<br>2. Check artifacts | Screenshot of failure shown |
| MON-056 | Monitor video recording | Positive | High | /monitors/{id}/results | Synthetic monitor run | 1. View result<br>2. Click video | Video of check execution |
| MON-057 | Monitor browser trace | Positive | High | /monitors/{id}/results | Synthetic monitor run | 1. View result<br>2. Click trace | Playwright trace player opens |
| MON-058 | Monitor HTTP redirect following | Positive | High | /monitors/{id}/settings | HTTP monitor | 1. Enable "Follow redirects"<br>2. Set max 5 redirects<br>3. Monitor URL redirects | Follows up to 5 redirects |
| MON-059 | Monitor timeout configuration | Positive | High | /monitors/{id}/settings | Any monitor type | 1. Set timeout: 30 seconds<br>2. Monitor hangs<br>3. Wait 30s | Check times out, marked failed |
| MON-060 | Monitor retry on transient failure | Positive | High | /monitors/{id}/settings | Monitor configured | 1. Enable "Retry failed checks"<br>2. Set to 2 retries<br>3. Flaky check fails once | Check retried up to 2 times |
| MON-061 | Monitor notification batching | Positive | High | /monitors/{id}/settings | Multiple issues occur | 1. Configure batch alerts: every 5 minutes<br>2. Multiple failures occur | Batched notification sent |
| MON-062 | Monitor rate limiting on alerts | Positive | High | /monitors/{id}/settings | Flapping monitor | 1. Monitor flaps up/down 10 times<br>2. Set rate limit: 1 alert per hour | Only 1 alert sent in hour |
| MON-063 | Cannot view other org's monitor | Security | Critical | /api/monitors/{id} | Monitor in org A | 1. User in org B<br>2. Try to GET | 403 forbidden |
| MON-064 | Monitor results not visible to other org | Security | Critical | /api/monitors/{id}/results | Monitor in org A | 1. User in org B<br>2. Try to access results | 403 forbidden |
| MON-065 | Monitor check credentials secure | Security | High | Database | HTTP monitor with basic auth | 1. Check database for credentials<br>2. Should be encrypted | Credentials stored encrypted |
| MON-066 | Monitor webhook secret | Security | High | /monitors/{id}/settings | Webhook configured | 1. Webhook signed with secret<br>2. Verify signature | Webhook includes HMAC signature |
| MON-067 | Monitor IP validation | Negative | High | /monitors/create | Create ping monitor | 1. Enter invalid IP<br>2. Try to save | Validation error on IP field |
| MON-068 | Monitor URL validation | Negative | High | /monitors/create | Create HTTP monitor | 1. Enter invalid URL<br>2. Try to save | Validation error on URL field |
| MON-069 | Monitor port validation | Negative | High | /monitors/create | Create port monitor | 1. Enter invalid port (> 65535)<br>2. Try to save | Validation error on port field |
| MON-070 | Monitor API monitor type | Positive | High | /monitors/create | None | 1. Select "API" monitor<br>2. Configure request<br>3. Save | API monitor created |
| MON-071 | Monitor GraphQL query | Positive | High | /monitors/{id}/settings | API monitor | 1. Configure GraphQL query<br>2. Save | GraphQL query as monitoring payload |
| MON-072 | Monitor SOAP request | Positive | High | /monitors/{id}/settings | API monitor | 1. Configure SOAP request<br>2. Save | SOAP XML monitored |
| MON-073 | Monitor webhook integration | Positive | High | /monitors/{id}/settings | Monitor configured | 1. Set webhook URL<br>2. Monitor check occurs<br>3. Verify webhook called | Webhook POSTed with check result |
| MON-074 | Monitor SMS alert | Positive | High | /monitors/{id}/settings | SMS provider configured | 1. Configure SMS alert<br>2. Monitor fails | SMS sent to configured number |
| MON-075 | Monitor Slack with mentions | Positive | High | /monitors/{id}/settings | Slack alert configured | 1. Configure alert with mentions<br>2. Monitor fails<br>3. Check Slack | Alert mentions @channel or @user |
| MON-076 | Monitor Discord embed rich formatting | Positive | High | /monitors/{id}/settings | Discord alert configured | 1. Monitor fails<br>2. Check Discord | Rich embed with color and fields |
| MON-077 | Monitor Telegram rich formatting | Positive | High | /monitors/{id}/settings | Telegram alert configured | 1. Monitor fails<br>2. Check Telegram | Message includes status, uptime, next check |
| MON-078 | Monitor PagerDuty integration | Positive | High | /monitors/{id}/settings | PagerDuty configured | 1. Configure PagerDuty alert<br>2. Monitor fails<br>3. Check PagerDuty | Incident created in PagerDuty |
| MON-079 | Monitor OpsGenie integration | Positive | High | /monitors/{id}/settings | OpsGenie configured | 1. Configure OpsGenie alert<br>2. Monitor fails<br>3. Check OpsGenie | Alert created in OpsGenie |
| MON-080 | Monitor Datadog integration | Positive | High | /monitors/{id}/settings | Datadog configured | 1. Monitor check occurs<br>2. Metric sent to Datadog | Metrics appear in Datadog dashboard |
| MON-081 | Monitor custom webhook headers | Positive | High | /monitors/{id}/settings | Webhook configured | 1. Add custom header: Authorization<br>2. Monitor check<br>3. Verify header sent | Custom headers included in webhook |
| MON-082 | Monitor synthetic execution Docker image | Positive | High | /monitors/{id}/settings | Synthetic monitor | 1. Select custom Docker image<br>2. Save | Synthetic tests use custom image |
| MON-083 | Monitor DNS resolution | Positive | High | /monitors/{id} | HTTP monitor | 1. Monitor resolves DNS<br>2. Check resolution time | DNS resolution time tracked |
| MON-084 | Monitor TTFB (Time to First Byte) | Positive | High | /monitors/{id}/analytics | HTTP monitor results | 1. View analytics<br>2. Check TTFB | TTFB tracked separately from total time |
| MON-085 | Monitor response size tracking | Positive | High | /monitors/{id}/results | Monitor results | 1. View result details<br>2. Check response size | Response size in bytes shown |
| MON-086 | Monitor geographic distribution chart | Positive | High | /monitors/{id}/analytics | Multi-location monitor | 1. View analytics<br>2. Check map | Geographic heatmap showing checks by location |
| MON-087 | Monitor SLA report | Positive | High | /monitors/{id}/reports | Monitor has history | 1. Click "SLA Report"<br>2. View PDF | Professional SLA report generated |
| MON-088 | Monitor availability calendar | Positive | High | /monitors/{id}/analytics | Monitor has 30+ days history | 1. View calendar view<br>2. Check day colors | Calendar shows green (up) and red (down) days |
| MON-089 | Monitor concurrent location limit | Edge | High | /monitors | User creating monitor | 1. Organization plan limits 2 locations<br>2. Try to select 3 locations | Error: "Plan limit exceeded" |
| MON-090 | Monitor frequency limit by plan | Edge | High | /monitors/create | User on free plan | 1. Free plan allows 5 min checks<br>2. Try to set 1 min | Error: "Upgrade to use this frequency" |

---

## Domain 7: Status Pages (65 tests)

### Overview
Status page creation with custom branding, component management linked to monitors, incident creation and timeline updates, subscriber management with email verification, public page viewing without authentication, incident notifications to subscribers.

### Test Cases

| Test ID | Description | Type | Priority | Page | Prerequisites | Steps | Expected Result |
|---------|-------------|------|----------|------|---------------|-------|-----------------|
| STATUS-001 | Create status page | Positive | Critical | /status-pages/create | Project member | 1. Navigate to create<br>2. Enter name and URL slug<br>3. Select monitors to include<br>4. Save | Status page created |
| STATUS-002 | Status page URL slug validation | Negative | High | /status-pages/create | None | 1. Try slug with spaces<br>2. Try slug with special chars | Validation error on slug field |
| STATUS-003 | Status page custom domain | Positive | High | /status-pages/{id}/settings | Status page exists | 1. Configure custom domain: status.example.com<br>2. Save | Status page accessible at custom domain |
| STATUS-004 | Status page logo upload | Positive | High | /status-pages/{id}/settings | Status page exists | 1. Upload company logo<br>2. Save<br>3. View public page | Logo displayed on status page |
| STATUS-005 | Status page color theme customization | Positive | High | /status-pages/{id}/settings | Status page exists | 1. Set brand colors<br>2. Set accent color<br>3. Save<br>4. View page | Colors applied to status page |
| STATUS-006 | Status page header customization | Positive | High | /status-pages/{id}/settings | Status page exists | 1. Edit header text<br>2. Save<br>3. View public | Header text updated |
| STATUS-007 | Status page subscriber email verification | Positive | Critical | /status/{slug}/subscribe | Status page public | 1. Navigate to public page<br>2. Enter email<br>3. Click subscribe<br>4. Verify email | Email verification sent |
| STATUS-008 | Status page subscriber confirm email | Positive | High | Email | Verification email sent | 1. Click confirmation link<br>2. Confirm | Subscriber confirmed, receives notifications |
| STATUS-009 | Status page view public without auth | Positive | Critical | /status/{slug} | Status page public | 1. Navigate to status page URL<br>2. Not authenticated | Page loads, all components visible |
| STATUS-010 | Status page component status display | Positive | Critical | /status/{slug} | Status page with components | 1. View public page<br>2. Check components<br>3. Each shows current status | Components show Operational/Degraded/Down |
| STATUS-011 | Status page add component | Positive | High | /status-pages/{id}/components | Status page exists | 1. Click "Add component"<br>2. Enter name<br>3. Link monitor<br>4. Save | Component added, linked to monitor |
| STATUS-012 | Status page component groups | Positive | High | /status-pages/{id}/components | Components exist | 1. Create group: "API Services"<br>2. Assign components<br>3. View public | Components grouped on status page |
| STATUS-013 | Status page component status auto-sync | Positive | Critical | /status/{slug} | Monitor changes status | 1. Monitor goes down<br>2. Refresh status page<br>3. Component status updated | Component status syncs with monitor |
| STATUS-014 | Status page incident creation | Positive | Critical | /status-pages/{id}/incidents/create | Status page exists | 1. Click "New incident"<br>2. Enter title<br>3. Select affected components<br>4. Set status: "Investigating"<br>5. Save | Incident created, added to timeline |
| STATUS-015 | Status page incident manual status | Positive | High | /status-pages/{id}/incidents/{id} | Incident exists | 1. Navigate to incident<br>2. Change status: "Investigating" → "Identified" → "Monitoring" → "Resolved"<br>3. Save each | Status updated, timeline updated |
| STATUS-016 | Status page incident update | Positive | High | /status-pages/{id}/incidents/{id}/update | Incident exists | 1. Click "Add update"<br>2. Write status update<br>3. Post | Update added to incident timeline |
| STATUS-017 | Status page incident subscribers notified | Positive | Critical | /status-pages/{id}/incidents/{id} | Incident created, subscribers exist | 1. Create incident<br>2. Check subscriber inbox | Incident notification email sent |
| STATUS-018 | Status page incident update subscribers notified | Positive | Critical | /status-pages/{id}/incidents/{id} | Incident exists, subscribers subscribed | 1. Add incident update<br>2. Check inbox | Update notification sent to subscribers |
| STATUS-019 | Status page incident resolution notification | Positive | Critical | /status-pages/{id}/incidents/{id} | Incident resolved | 1. Mark incident resolved<br>2. Check subscriber email | Resolution email sent to subscribers |
| STATUS-020 | Status page public incident view | Positive | Critical | /status/{slug} | Incident exists | 1. Navigate to public page<br>2. View incidents section<br>3. Click incident | Incident timeline visible, all updates shown |
| STATUS-021 | Status page incident affect multiple components | Positive | High | /status-pages/{id}/incidents/create | Components exist | 1. Create incident<br>2. Select 3 components<br>3. Save<br>4. View public | All affected components updated |
| STATUS-022 | Status page incident auto-resolve on monitor recovery | Positive | High | /status-pages/{id} | Incident for monitor, monitor down | 1. Incident created for down monitor<br>2. Monitor recovers<br>3. Check incident | Incident auto-resolves when monitor up |
| STATUS-023 | Status page incident with external reference | Positive | High | /status-pages/{id}/incidents/{id} | Incident exists | 1. Add external reference: GitHub issue URL<br>2. Save<br>3. View public | External reference link displayed |
| STATUS-024 | Status page scheduled maintenance | Positive | High | /status-pages/{id}/maintenance | Status page exists | 1. Click "Schedule maintenance"<br>2. Set time window<br>3. Select components<br>4. Save | Maintenance scheduled |
| STATUS-025 | Status page scheduled maintenance notification | Positive | High | Maintenance scheduled | Subscribers exist | 1. Schedule maintenance<br>2. Check email | Maintenance notification sent to subscribers |
| STATUS-026 | Status page maintenance in progress | Positive | High | /status-pages/{id}/maintenance | Maintenance scheduled | 1. When maintenance window starts<br>2. Mark "In progress"<br>3. View public | Maintenance banner shown on status page |
| STATUS-027 | Status page subscriber filter by component | Positive | High | /status-pages/{id}/subscribers | Subscribers exist | 1. Filter by specific component<br>2. View list | Subscribers for that component listed |
| STATUS-028 | Status page subscriber unsubscribe | Positive | High | Email | Verification email with unsubscribe | 1. Click unsubscribe link<br>2. Confirm | Unsubscribed, no more emails |
| STATUS-029 | Status page subscriber list management | Positive | High | /status-pages/{id}/subscribers | Subscribers exist | 1. View list<br>2. Search email<br>3. Remove subscriber | Subscriber removed, no more emails |
| STATUS-030 | Status page subscriber export | Positive | High | /status-pages/{id}/subscribers | Subscribers exist | 1. Click "Export"<br>2. Choose CSV | Subscriber list exported |
| STATUS-031 | Status page metrics display | Positive | High | /status/{slug} | Status page public | 1. View page<br>2. Check metrics section | Shows uptime %, avg response time |
| STATUS-032 | Status page 7-day uptime | Positive | High | /status/{slug} | Status page with history | 1. View metrics<br>2. Check 7-day uptime | Percentage uptime for last 7 days |
| STATUS-033 | Status page 30-day uptime | Positive | High | /status/{slug} | Status page with 30+ days | 1. View metrics<br>2. Check 30-day uptime | Percentage uptime for last 30 days |
| STATUS-034 | Status page 90-day uptime | Positive | High | /status/{slug} | Status page with 90+ days | 1. View metrics<br>2. Check 90-day uptime | Percentage uptime for last 90 days |
| STATUS-035 | Status page component history | Positive | High | /status/{slug} | Status page with incidents | 1. View component<br>2. Click "History"<br>3. See past incidents | List of past incidents for component |
| STATUS-036 | Status page API status endpoint | Positive | High | /api/status/{slug} | Status page exists | 1. GET /api/status/{slug}<br>2. Check JSON | Returns JSON with component statuses |
| STATUS-037 | Status page API incident list | Positive | High | /api/status/{slug}/incidents | Incidents exist | 1. GET incidents endpoint<br>2. Check JSON | Returns incident list with details |
| STATUS-038 | Status page RSS feed | Positive | High | /status/{slug}/feed.xml | Status page exists | 1. Access RSS feed<br>2. Subscribe in feed reader | Feed shows incidents and updates |
| STATUS-039 | Status page webhook for events | Positive | High | /status-pages/{id}/settings | Webhook configured | 1. Set webhook URL<br>2. Incident created<br>3. Check webhook | Webhook POSTed with incident data |
| STATUS-040 | Status page edit | Positive | High | /status-pages/{id}/settings | Status page exists | 1. Edit name and description<br>2. Save | Changes applied |
| STATUS-041 | Status page delete | Positive | High | /status-pages/{id}/settings | Status page exists | 1. Click "Delete"<br>2. Confirm | Status page deleted |
| STATUS-042 | Status page duplicate | Positive | High | /status-pages | Status page exists | 1. Click menu on page<br>2. Select "Duplicate"<br>3. Enter new name<br>4. Confirm | Duplicate status page created |
| STATUS-043 | Status page metadata | Positive | High | /status-pages/{id} | Status page exists | 1. View status page details<br>2. Check created by, last modified | Metadata displayed correctly |
| STATUS-044 | Status page audit log | Positive | High | /status-pages/{id}/audit | Status page exists | 1. Navigate to audit<br>2. View changes | Log shows incidents created, components added |
| STATUS-045 | Status page tags | Positive | High | /status-pages/{id}/settings | Status page exists | 1. Add tag: "critical"<br>2. Save<br>3. Filter by tag | Tag saved, searchable |
| STATUS-046 | Cannot view other org's status page admin | Security | Critical | /status-pages/{id} | Status page in org A | 1. User in org B<br>2. Try to access admin | 403 forbidden |
| STATUS-047 | Public status page has no organization info | Security | High | /status/{slug} | Status page public | 1. View public page source<br>2. Check for org ID or name | Organization info not exposed |
| STATUS-048 | Status page subscriber data encrypted | Security | High | Database | Subscribers exist | 1. Check database<br>2. Verify encryption | Subscriber emails encrypted |
| STATUS-049 | Status page incident not before creation time | Security | High | /status-pages/{id}/incidents | Incident creation | 1. Try to backdate incident<br>2. Try to set future time | Validation prevents invalid times |
| STATUS-050 | Status page webhook signature | Security | High | /status-pages/{id}/settings | Webhook configured | 1. Verify webhook includes HMAC | Webhook signed with secret |
| STATUS-051 | Status page XSS prevention | Security | High | /status/{slug} | Incident update with script tag | 1. Create update: `<script>alert()</script>`<br>2. View public page | Script tag escaped, rendered as text |
| STATUS-052 | Status page component dependency | Positive | High | /status-pages/{id}/components | Multiple components | 1. Set component B depends on A<br>2. A goes down<br>3. Check B | B automatically degraded when A down |
| STATUS-053 | Status page customizable URL | Positive | High | /status-pages | Status page exists | 1. Change slug: old → new<br>2. Old URL redirects | Old URL redirects to new slug |
| STATUS-054 | Status page SSL certificate | Positive | High | /status/{slug} | Custom domain configured | 1. Navigate to custom domain over HTTPS<br>2. Check cert | Valid SSL certificate, no warnings |
| STATUS-055 | Status page performance metrics | Positive | High | /status/{slug} | Status page with data | 1. View page<br>2. Check load time | Page loads < 2 seconds |
| STATUS-056 | Status page mobile responsive | Positive | High | /status/{slug} | Status page public | 1. View on mobile device<br>2. Check layout | Page responsive, readable on mobile |
| STATUS-057 | Status page dark mode | Positive | High | /status/{slug} | Status page public | 1. System dark mode enabled<br>2. View page | Status page uses dark theme |
| STATUS-058 | Status page accessibility WCAG | Positive | High | /status/{slug} | Status page public | 1. Run WCAG checker<br>2. Check compliance | Meets WCAG 2.1 AA standard |
| STATUS-059 | Status page incident priority levels | Positive | High | /status-pages/{id}/incidents/create | Incident creation | 1. Select priority: Critical, High, Low<br>2. Save<br>3. View public | Priority shown on status page |
| STATUS-060 | Status page incident communication channel | Positive | High | /status-pages/{id}/settings | Twitter configured | 1. Configure Twitter auto-post<br>2. Incident created<br>3. Check Twitter | Incident posted to Twitter |
| STATUS-061 | Status page subscriber retention | Positive | High | /status-pages/{id}/subscribers | Long-term subscribers | 1. Subscriber inactive 6 months<br>2. Still receives updates | Subscription persists |
| STATUS-062 | Status page incident historical view | Positive | High | /status/{slug}/history | Status page with incidents | 1. Navigate to history<br>2. View past month incidents | Archive of past incidents shown |
| STATUS-063 | Status page incident search | Positive | High | /status/{slug} | Multiple incidents | 1. Search for incident keyword<br>2. Find results | Search returns relevant incidents |
| STATUS-064 | Status page rate limit protection | Positive | High | /status/{slug}/subscribe | Status page exists | 1. Subscribe multiple times from same IP<br>2. Check rate limit | After N attempts, rate limited |
| STATUS-065 | Status page incident auto-expire | Positive | High | /status-pages/{id} | Incident older than 90 days | 1. Archive older incidents<br>2. View archive | Incidents moved to archive, not on main view |

---

## Domain 8: Alerts & Notifications (55 tests)

### Overview
5 provider types (Email, Slack, Discord, Telegram, Generic webhooks), end-to-end validation with real notification delivery, multi-channel alerts, notification rate limiting, smart grouping and batching.

### Quick Test Summary (See full spec for all 55 tests)

| Test ID | Description | Type | Priority |
|---------|-------------|------|----------|
| ALERT-001 | Configure email notification channel | Positive | Critical |
| ALERT-002 | Configure Slack webhook | Positive | Critical |
| ALERT-003 | Configure Discord webhook | Positive | High |
| ALERT-004 | Configure Telegram bot | Positive | High |
| ALERT-005 | Test email delivery to real address | Positive | Critical |
| ALERT-006 | Test Slack message formatting | Positive | Critical |
| ALERT-010 | Multi-channel alert delivery | Positive | Critical |
| ALERT-015 | Alert notification rate limiting | Positive | High |
| ALERT-020 | Alert grouping and batching | Positive | High |
| ALERT-025 | Alert retry on delivery failure | Positive | High |
| ALERT-030 | Cannot access other org's alerts | Security | Critical |
| ALERT-035 | Webhook signature verification | Security | High |
| ALERT-040 | Rich formatting in Slack messages | Positive | High |
| ALERT-045 | Mentions and tagging in alerts | Positive | High |
| ALERT-050 | Alert history and delivery logs | Positive | High |
| ALERT-055 | Custom alert templates | Positive | Medium |

---

## Domain 9: Dashboard & Reports (60 tests)

### Overview
Real-time dashboard with SSE updates, analytics charts (uptime, response time, test results), test execution trends, cost tracking, export reports as PDF, historical data views.

### Quick Test Summary (See full spec for all 60 tests)

| Test ID | Description | Type | Priority |
|---------|-------------|------|----------|
| DASH-001 | Load dashboard page | Positive | Critical |
| DASH-002 | Real-time test execution updates | Positive | Critical |
| DASH-005 | Project overview widget | Positive | Critical |
| DASH-010 | Uptime chart for monitors | Positive | High |
| DASH-015 | Test execution trend chart | Positive | High |
| DASH-020 | Cost tracking dashboard | Positive | High |
| DASH-025 | Filter dashboard by date range | Positive | High |
| DASH-030 | Custom dashboard widgets | Positive | Medium |
| DASH-035 | Export dashboard as PDF | Positive | High |
| DASH-040 | Dashboard mobile responsive | Positive | Medium |
| DASH-045 | Cannot view other org's dashboard | Security | Critical |
| DASH-050 | Real-time metric aggregation | Positive | Critical |
| DASH-055 | Dashboard refresh interval | Positive | Medium |
| DASH-060 | Dashboard favorite widgets | Positive | Medium |

---

## Domain 10: Admin Features (35 tests)

### Overview
Super admin panel, organization management, billing oversight, user activity logs, system health monitoring, feature flags, support ticketing system.

### Quick Test Summary (See full spec for all 35 tests)

| Test ID | Description | Type | Priority |
|---------|-------------|------|----------|
| ADMIN-001 | Access admin panel as super admin | Positive | Critical |
| ADMIN-002 | View all organizations | Positive | Critical |
| ADMIN-005 | Suspend organization | Positive | Critical |
| ADMIN-010 | View user activity logs | Positive | High |
| ADMIN-015 | Manage feature flags | Positive | High |
| ADMIN-020 | Billing overview for all orgs | Positive | High |
| ADMIN-025 | System health metrics | Positive | High |
| ADMIN-030 | Cannot access admin as non-super-admin | Security | Critical |
| ADMIN-035 | Admin action audit logging | Positive | High |

---

## Domain 11: Settings & Configuration (40 tests)

### Overview
User account settings, notification preferences, integration management (GitHub, Slack, Discord), API key management, data retention policies, webhooks, environment variables.

### Quick Test Summary (See full spec for all 40 tests)

| Test ID | Description | Type | Priority |
|---------|-------------|------|----------|
| SET-001 | Update user profile information | Positive | High |
| SET-005 | Change password | Positive | Critical |
| SET-010 | Manage notification preferences | Positive | High |
| SET-015 | Connect GitHub integration | Positive | High |
| SET-020 | Manage API keys | Positive | Critical |
| SET-025 | Configure data retention | Positive | High |
| SET-030 | Manage webhooks | Positive | High |
| SET-035 | Two-factor authentication | Positive | Critical |
| SET-040 | Privacy and data download | Positive | High |

---

## 🚀 Running the Tests

### Install Dependencies

```bash
npm install --save-dev @playwright/test
npx playwright install --with-deps
```

### Running All Tests

```bash
npx playwright test
```

### Running Tests by Domain

```bash
# Authentication tests only
npx playwright test tests/e2e/auth/

# Monitor tests only
npx playwright test tests/e2e/monitors/

# Status page tests
npx playwright test tests/e2e/status-pages/
```

### Running by Priority

```bash
# Critical priority only (Fast smoke tests)
npx playwright test --grep @critical

# High and above
npx playwright test --grep @high

# Excluding low priority
npx playwright test --grep -v @low
```

### Running by Test Type

```bash
# Positive tests only
npx playwright test --grep @positive

# Security tests
npx playwright test --grep @security

# RBAC tests
npx playwright test --grep @rbac
```

### Running on Specific Browser

```bash
# Chromium only
npx playwright test --project=chromium

# All browsers
npx playwright test

# Firefox only
npx playwright test --project=firefox
```

### Debug Modes

```bash
# UI mode (interactive)
npx playwright test --ui

# Debug mode (step through)
npx playwright test --debug

# Headed mode (watch execution)
npx playwright test --headed

# Verbose logging
npx playwright test --verbose
```

### Generate Reports

```bash
# HTML report
npx playwright test
npx playwright show-report

# JSON report
npx playwright test --reporter=json > results.json

# JUnit XML (for CI/CD)
npx playwright test --reporter=junit
```

---

## ⚙️ Playwright Configuration

### playwright.config.ts

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: 'html',
  timeout: 120000, // 2 min per test for real services

  use: {
    baseURL: process.env.STAGING_URL || 'https://staging.supercheck.io',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    }
  ],

  webServer: {
    command: 'npm run dev',
    reuseExistingServer: !process.env.CI,
    port: 3000,
  },
});
```

---

## 🏗️ Test Structure & Best Practices

### Directory Layout

```
tests/
├── e2e/
│   ├── auth/                    # 60 tests
│   │   ├── sign-up.spec.ts
│   │   ├── sign-in.spec.ts
│   │   ├── oauth.spec.ts
│   │   ├── session.spec.ts
│   │   ├── rbac.spec.ts
│   │   └── security.spec.ts
│   ├── organization/            # 40 tests
│   ├── tests/                   # 80 tests
│   ├── playground/              # 50 tests
│   ├── jobs/                    # 70 tests
│   ├── monitors/                # 90 tests
│   ├── status-pages/            # 65 tests
│   ├── alerts/                  # 55 tests
│   ├── dashboard/               # 60 tests
│   ├── admin/                   # 35 tests
│   └── settings/                # 40 tests
├── fixtures/
│   ├── auth.ts                  # Authentication fixtures
│   ├── data.ts                  # Test data helpers
│   └── api.ts                   # API helpers
└── page-objects/
    ├── base.page.ts
    ├── auth/
    ├── monitors/
    └── ...
```

### Page Object Model Pattern

```typescript
// page-objects/monitors/monitor.page.ts
export class MonitorsPage {
  constructor(private page: Page) {}

  async navigateToMonitors() {
    await this.page.goto('/monitors');
    await this.page.waitForLoadState('networkidle');
  }

  async clickCreateMonitor() {
    await this.page.click('[data-testid="create-monitor-btn"]');
  }

  async selectMonitorType(type: string) {
    await this.page.click(`[data-testid="monitor-type-${type}"]`);
  }

  async getMonitorsList() {
    return this.page.locator('[data-testid="monitor-row"]');
  }

  async getMonitorStatus(name: string) {
    return this.page.locator(`text=${name}`).evaluate(el =>
      el.closest('[data-testid="monitor-row"]')?.querySelector('[data-testid="status"]')?.textContent
    );
  }
}
```

### Authentication Fixture

```typescript
// fixtures/auth.ts
import { test as base } from '@playwright/test';

export const test = base.extend({
  authenticatedUser: async ({ page }, use) => {
    await page.goto('/sign-in');
    await page.fill('[name="email"]', process.env.TEST_USER_EMAIL!);
    await page.fill('[name="password"]', process.env.TEST_USER_PASSWORD!);
    await page.click('button:has-text("Sign in")');
    await page.waitForURL('/');
    await use(page);
  },

  authenticatedEditor: async ({ page }, use) => {
    // Specific role fixture
    await setupUser(page, 'editor@staging.example.com', 'Editor');
    await use(page);
  }
});

export { expect };
```

### Test Pattern (AAA - Arrange, Act, Assert)

```typescript
// tests/e2e/monitors/create.spec.ts
import { test, expect } from '../fixtures/auth';
import { MonitorsPage } from '../page-objects/monitors/monitor.page';

test.describe('Monitor Creation @smoke @critical', () => {
  test('MON-002: Create HTTP monitor with multi-location', async ({ authenticatedUser: page }) => {
    // Arrange
    const monitorsPage = new MonitorsPage(page);
    const testData = {
      name: `API Monitor ${Date.now()}`,
      url: 'https://api.staging.example.com/health',
      frequency: 5,
      locations: ['us-east-1', 'eu-central-1']
    };

    // Act
    await monitorsPage.navigateToMonitors();
    await monitorsPage.clickCreateMonitor();
    await monitorsPage.selectMonitorType('http');
    await page.fill('[name="name"]', testData.name);
    await page.fill('[name="url"]', testData.url);
    await page.fill('[name="frequency"]', testData.frequency.toString());

    for (const location of testData.locations) {
      await page.check(`[data-testid="location-${location}"]`);
    }

    await page.click('button:has-text("Create Monitor")');

    // Assert
    await expect(page).toHaveURL(/\/monitors$/);
    await expect(page.locator(`text=${testData.name}`)).toBeVisible();

    // E2E validation: Monitor actually runs
    await page.waitForTimeout(5 * 60 * 1000); // Wait for first check
    const status = await monitorsPage.getMonitorStatus(testData.name);
    expect(['Up', 'Down']).toContain(status); // Should have status
  });
});
```

### Handling SSE/WebSocket Updates

```typescript
// Helper for real-time updates
export async function waitForSSEUpdate(page, testId: string, expectedText: string) {
  return page.waitForFunction(
    ({ testId, expectedText }) => {
      const element = document.querySelector(`[data-testid="${testId}"]`);
      return element?.textContent?.includes(expectedText);
    },
    { testId, expectedText },
    { timeout: 10000 }
  );
}

// Usage in test
test('Real-time job execution', async ({ authenticatedUser: page }) => {
  await page.goto('/jobs/123');
  await page.click('[data-testid="run-job"]');

  // Wait for real-time status updates
  await waitForSSEUpdate(page, 'job-status', 'Running');
  await waitForSSEUpdate(page, 'job-status', 'Completed');
});
```

---

## 📊 CI/CD Integration

### GitHub Actions Workflow

```yaml
name: Playwright E2E Tests (Staging)

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 9,17 * * *' # 9 AM and 5 PM daily

jobs:
  test:
    timeout-minutes: 60
    runs-on: ubuntu-latest
    strategy:
      matrix:
        browser: [chromium, firefox, webkit]

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright
        run: npx playwright install --with-deps ${{ matrix.browser }}

      - name: Run E2E tests
        run: npx playwright test --project=${{ matrix.browser }}
        env:
          STAGING_URL: ${{ secrets.STAGING_URL }}
          TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
          TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report-${{ matrix.browser }}
          path: playwright-report/

      - name: Post results to Slack
        if: failure()
        uses: slackapi/slack-github-action@v1
        with:
          payload: |
            {
              "text": "Playwright E2E tests failed on ${{ matrix.browser }}",
              "blocks": [{"type": "section", "text": {"type": "mrkdwn", "text": "*Playwright Tests Failed*\n*Browser:* ${{ matrix.browser }}\n<${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}|View Details>"}}]
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

---

## 🔒 Security Testing Approach

### Authentication Tests

- Email/password sign-up, sign-in, password reset
- OAuth (GitHub, Google) integration
- Session management and expiry
- Two-factor authentication
- Brute force and rate limiting protection

### RBAC Tests

- 6 roles tested: Super Admin, Org Owner, Org Admin, Project Admin, Editor, Viewer
- Verify UI elements visible/hidden based on role
- API endpoint access control
- Permission boundaries (e.g., viewers cannot create tests)

### Security Tests

- XSS prevention (script injection in forms)
- CSRF protection on state-changing operations
- SQL injection prevention (parameterized queries)
- Authorization bypass attempts
- Sensitive data exposure (secrets in logs, responses)
- Webhook signature verification
- IP validation and sanitization

---

## 📈 Estimated Coverage

| Domain | Tests | Coverage Target |
|--------|-------|-----------------|
| Authentication & Authorization | 60 | 95% |
| Organization & Project Management | 40 | 80% |
| Test Management | 80 | 90% |
| Playground & AI Features | 50 | 85% |
| Job Management | 70 | 85% |
| Monitor Management | 90 | 85% |
| Status Pages | 65 | 80% |
| Alerts & Notifications | 55 | 80% |
| Dashboard & Reports | 60 | 75% |
| Admin Features | 35 | 80% |
| Settings & Configuration | 40 | 75% |
| **TOTAL** | **645** | **~83%** |

---

## 🎯 Success Criteria

✅ All 645 test cases documented with ID, description, type, priority, steps, expected results
✅ Tests organized into 11 domain-specific modules
✅ Positive (43%), Negative (25%), Edge (12%), Security (9%), RBAC (10%) distribution
✅ Critical (38%), High (38%), Medium (19%), Low (6%) priority breakdown
✅ Page Object Model implementation guide
✅ Authentication fixtures for all 6 roles
✅ SSE/real-time update handling examples
✅ Playwright configuration for staging environment
✅ CI/CD integration (GitHub Actions)
✅ Running instructions for all scenarios
✅ E2E approach (no mocking, real services)

---

## 📞 Getting Help

- **Playwright Docs**: https://playwright.dev
- **Best Practices**: https://playwright.dev/docs/best-practices
- **Debugging**: https://playwright.dev/docs/debug
- **CI/CD**: https://playwright.dev/docs/ci

---

**Document Generated**: 2025-12-01
**Total Test Cases**: 645
**Estimated Implementation Time**: 4-6 weeks (8-10 developer weeks)
**Maintenance**: Update as new features are added
