# Sign Up Test Specification

## Overview
Tests for the sign-up page at `/sign-up`. SuperCheck uses social-only signup (GitHub, Google) by default. Email/password signup is only available when a user has an invitation token.

## Page Structure
- **Route**: `/sign-up` (OAuth only) or `/sign-up?invite=<token>` (email form)
- **Page Object**: `SignUpPage` from `pages/auth/sign-up.page.ts`
- **Fixture**: `authTest` from `fixtures/auth.fixture.ts`

## Test Cases

### AUTH-001: Sign up with GitHub OAuth (social-only)
**Priority**: Critical | **Type**: Positive

**Prerequisites**: None

**Steps**:
1. Navigate to `/sign-up`
2. Verify only social auth buttons shown (no email form)
3. Click "Continue with GitHub" button (`[data-testid="signup-github-button"]`)
4. Authorize app on GitHub
5. Wait for callback and redirect

**Expected Result**:
- User account created with GitHub profile
- Email verified via OAuth
- User redirected to dashboard

**Test Code Pattern**:
```typescript
test('AUTH-001: Sign up with GitHub OAuth @critical @positive', async ({ page }) => {
  const signUpPage = new SignUpPage(page);
  await signUpPage.navigate();

  // Verify OAuth-only mode (no email form)
  await signUpPage.expectOAuthOnlyMode();

  // Click GitHub button
  await signUpPage.clickGitHubSignUp();

  // Handle GitHub OAuth (external page)
  await page.waitForURL(/github\.com/);
  // ... OAuth flow handled by GitHub
});
```

---

### AUTH-002: Sign up with Google OAuth (social-only)
**Priority**: Critical | **Type**: Positive

**Prerequisites**: None

**Steps**:
1. Navigate to `/sign-up`
2. Verify only social auth buttons shown
3. Click "Continue with Google" button (`[data-testid="signup-google-button"]`)
4. Authorize app on Google
5. Wait for callback and redirect

**Expected Result**:
- User account created with Google profile
- Email verified via OAuth
- User redirected to dashboard

**Test Code Pattern**:
```typescript
test('AUTH-002: Sign up with Google OAuth @critical @positive', async ({ page }) => {
  const signUpPage = new SignUpPage(page);
  await signUpPage.navigate();

  await signUpPage.expectOAuthOnlyMode();
  await signUpPage.clickGoogleSignUp();

  await page.waitForURL(/accounts\.google\.com/);
  // ... OAuth flow handled by Google
});
```

---

### AUTH-003: Invitation flow email signup
**Priority**: Critical | **Type**: Positive

**Prerequisites**:
- Valid invitation token exists
- Invitation email is known

**Steps**:
1. Click invitation link with token (e.g., `/sign-up?invite=abc123`)
2. Verify email form is shown (locked to invited email)
3. Fill name field (`[data-testid="signup-name-input"]`)
4. Fill password field (`[data-testid="signup-password-input"]`)
5. Submit form (`[data-testid="signup-submit-button"]`)

**Expected Result**:
- User account created with invited email
- User auto-joined to organization with assigned role
- Redirected to dashboard

**Test Code Pattern**:
```typescript
test('AUTH-003: Invitation flow email signup @critical @positive', async ({ page }) => {
  const signUpPage = new SignUpPage(page);
  const inviteToken = 'test-invite-token'; // Use valid test token

  await signUpPage.navigate(inviteToken);

  // Verify email form mode (not OAuth-only)
  await signUpPage.expectEmailFormMode();
  await signUpPage.expectInvitationBadge();

  // Email should be pre-filled and read-only
  await signUpPage.expectInvitedEmail('invited@example.com');

  // Fill remaining fields
  await signUpPage.signUpWithInvite('Test User', 'SecurePassword123!');

  // Wait for redirect to dashboard
  await expect(page).toHaveURL('/');
});
```

---

### AUTH-012: GitHub OAuth sign up (detailed)
**Priority**: High | **Type**: Positive

**Prerequisites**:
- GitHub test account configured
- OAuth app authorized

**Steps**:
1. Navigate to `/sign-up`
2. Click "Sign up with GitHub"
3. If prompted, enter GitHub credentials
4. Authorize the app
5. Wait for callback to `/auth-callback`
6. User is redirected to dashboard

**Expected Result**:
- User account created with GitHub profile data
- Email from GitHub profile is used
- User is signed in automatically

---

### AUTH-013: GitHub OAuth sign in (existing user)
**Priority**: High | **Type**: Positive

**Prerequisites**:
- User already created via GitHub OAuth

**Steps**:
1. Navigate to `/sign-in`
2. Click "Sign in with GitHub"
3. Authorize (if needed)
4. Wait for redirect

**Expected Result**:
- User signed in with existing account
- Redirected to dashboard

---

### AUTH-014: Google OAuth sign up
**Priority**: High | **Type**: Positive

**Prerequisites**:
- Google test account configured

**Steps**:
1. Navigate to `/sign-up`
2. Click "Sign up with Google"
3. Select Google account or enter credentials
4. Authorize the app
5. Wait for callback

**Expected Result**:
- User account created with Google profile
- Email verified automatically
- Redirected to dashboard

---

### AUTH-015: Google OAuth sign in (existing user)
**Priority**: High | **Type**: Positive

**Prerequisites**:
- User already created via Google OAuth

**Steps**:
1. Navigate to `/sign-in`
2. Click "Sign in with Google"
3. Authorize
4. Wait for redirect

**Expected Result**:
- User signed in with existing account
- Redirected to dashboard

---

## OAuth Testing Notes

**Important**: OAuth tests require:
1. Dedicated test OAuth apps for GitHub and Google
2. Test accounts with known credentials
3. Environment variables set:
   - `E2E_GITHUB_TEST_USER`
   - `E2E_GITHUB_TEST_PASSWORD`
   - `E2E_GOOGLE_TEST_USER`
   - `E2E_GOOGLE_TEST_PASSWORD`

**OAuth Page Handling**:
```typescript
// Handle GitHub OAuth
await page.waitForURL(/github\.com/);
await page.fill('#login_field', env.oauth.github.username);
await page.fill('#password', env.oauth.github.password);
await page.click('[type="submit"]');

// Wait for callback
await page.waitForURL(/auth-callback/);
await page.waitForURL('/'); // Final redirect
```

---

## Selectors Reference

| Element | Primary Selector | Fallback Selectors |
|---------|------------------|-------------------|
| Name Input | `[data-testid="signup-name-input"]` | `#name`, `input[name="name"]` |
| Email Input | `[data-testid="signup-email-input"]` | `#email`, `input[name="email"]` |
| Password Input | `[data-testid="signup-password-input"]` | `#password`, `input[name="password"]` |
| Submit Button | `[data-testid="signup-submit-button"]` | `button[type="submit"]` |
| GitHub Button | `[data-testid="signup-github-button"]` | `button:has-text("GitHub")` |
| Google Button | `[data-testid="signup-google-button"]` | `button:has-text("Google")` |
| Invitation Badge | `[data-testid="invitation-badge"]` | `text=Invited` |
| Error Message | `[data-testid="signup-error-message"]` | `[role="alert"]` |

## Tags
- `@critical` - Critical priority tests
- `@high` - High priority tests
- `@positive` - Happy path tests
- `@oauth` - OAuth-specific tests
