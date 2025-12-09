# Sign In Test Specification

## Overview
Tests for the sign-in page at `/sign-in`. Covers email/password authentication, OAuth providers, error handling, and session management.

## Page Structure
- **Route**: `/sign-in`
- **Page Object**: `SignInPage` from `pages/auth/sign-in.page.ts`
- **Fixture**: `authTest` from `fixtures/auth.fixture.ts`

## Test Cases

### AUTH-004: Sign in with valid credentials
**Priority**: Critical | **Type**: Positive

**Prerequisites**:
- User account exists and is verified
- Valid test credentials in environment variables

**Steps**:
1. Navigate to `/sign-in`
2. Enter valid email in email field (`[data-testid="login-email-input"]`)
3. Enter valid password in password field (`[data-testid="login-password-input"]`)
4. Click the Login button (`[data-testid="login-submit-button"]`)
5. Wait for redirect to dashboard

**Expected Result**:
- User is redirected to dashboard (`/`)
- No error messages displayed
- Session is created (cookies set)

**Test Code Pattern**:
```typescript
test('AUTH-004: Sign in with valid credentials @critical @positive', async ({ page }) => {
  const signInPage = new SignInPage(page);
  await signInPage.navigate();
  await signInPage.signInAndWaitForDashboard(env.testUser.email, env.testUser.password);
  await expect(page).toHaveURL('/');
});
```

---

### AUTH-005: Sign in with invalid password
**Priority**: High | **Type**: Negative

**Prerequisites**:
- User account exists

**Steps**:
1. Navigate to `/sign-in`
2. Enter valid email
3. Enter incorrect password
4. Click Login button
5. Check for error message

**Expected Result**:
- Error message displayed: "Invalid credentials"
- User remains on sign-in page
- No session created

**Test Code Pattern**:
```typescript
test('AUTH-005: Sign in with invalid password @high @negative', async ({ page }) => {
  const signInPage = new SignInPage(page);
  await signInPage.navigate();
  await signInPage.signIn(env.testUser.email, 'wrong-password-123');
  await signInPage.expectError(/invalid|incorrect/i);
  await expect(page).toHaveURL(/sign-in/);
});
```

---

### AUTH-006: Sign in with non-existent email
**Priority**: High | **Type**: Negative

**Prerequisites**: None

**Steps**:
1. Navigate to `/sign-in`
2. Enter non-existent email
3. Enter any password
4. Click Login button
5. Check for error message

**Expected Result**:
- Generic error: "Invalid credentials" (security - doesn't reveal if email exists)
- User remains on sign-in page

**Test Code Pattern**:
```typescript
test('AUTH-006: Sign in with non-existent email @high @negative', async ({ page }) => {
  const signInPage = new SignInPage(page);
  await signInPage.navigate();
  await signInPage.signIn('nonexistent@example.com', 'any-password');
  await signInPage.expectError(/invalid|incorrect/i);
});
```

---

### AUTH-016b: Last used badge on sign-in page
**Priority**: High | **Type**: Positive

**Prerequisites**:
- User previously signed in with GitHub OAuth

**Steps**:
1. Sign in with GitHub OAuth
2. Sign out
3. Navigate back to `/sign-in`
4. Verify GitHub button shows "Last used" badge

**Expected Result**:
- GitHub OAuth button displays "Last used" badge (`[data-testid="last-used-badge"]`)
- Badge indicates previously used authentication method

**Test Code Pattern**:
```typescript
test('AUTH-016b: Last used badge on sign-in page @high @positive', async ({ page }) => {
  // This test requires OAuth setup and browser storage manipulation
  const signInPage = new SignInPage(page);
  await signInPage.navigate();
  // Check for last used badge on previously used OAuth provider
  await signInPage.expectLastUsedBadge('github');
});
```

---

### AUTH-018: Sign out
**Priority**: High | **Type**: Positive

**Prerequisites**:
- User is signed in

**Steps**:
1. Click user menu (`[data-testid="user-menu"]`)
2. Click "Sign out" button (`[data-testid="sign-out-button"]`)
3. Wait for redirect

**Expected Result**:
- Session destroyed
- User redirected to `/sign-in`
- Protected routes no longer accessible

**Test Code Pattern**:
```typescript
test('AUTH-018: Sign out @high @positive', async ({ authenticatedPage }) => {
  // Click user menu
  await authenticatedPage.click('[data-testid="user-menu"]');
  // Click sign out
  await authenticatedPage.click('[data-testid="sign-out-button"]');
  // Verify redirect
  await expect(authenticatedPage).toHaveURL(/sign-in/);
});
```

---

## Selectors Reference

| Element | Primary Selector | Fallback Selectors |
|---------|------------------|-------------------|
| Email Input | `[data-testid="login-email-input"]` | `#email`, `input[name="email"]` |
| Password Input | `[data-testid="login-password-input"]` | `#password`, `input[name="password"]` |
| Submit Button | `[data-testid="login-submit-button"]` | `button[type="submit"]`, `button:has-text("Login")` |
| Error Message | `[data-testid="login-error-message"]` | `[role="alert"]`, `.text-destructive` |
| GitHub Button | `[data-testid="login-github-button"]` | `button:has-text("GitHub")` |
| Google Button | `[data-testid="login-google-button"]` | `button:has-text("Google")` |
| Forgot Password Link | `[data-testid="login-forgot-password-link"]` | `a:has-text("Forgot")` |
| Last Used Badge | `[data-testid="last-used-badge"]` | `text=Last used` |

## Tags
- `@critical` - Critical priority tests
- `@high` - High priority tests
- `@positive` - Happy path tests
- `@negative` - Error case tests
- `@smoke` - Include in smoke test suite
