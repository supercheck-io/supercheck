# Security Test Specification

## Overview
Security tests for the authentication system including XSS prevention, CSRF protection, brute force protection, session security, and sensitive data handling.

## Test Cases

### AUTH-042: Cannot access private resources without auth
**Priority**: Critical | **Type**: Security

**Prerequisites**: Not authenticated

**Steps**:
1. Make request to private API without token
2. Make request with invalid token
3. Check response

**Expected Result**:
- 401 Unauthorized response
- No data leaked in error message

**Test Code Pattern**:
```typescript
test('AUTH-042: Cannot access private resources without auth @critical @security', async ({ unauthenticatedPage }) => {
  // Try to access private routes
  await unauthenticatedPage.goto('/tests');
  await expect(unauthenticatedPage).toHaveURL(/sign-in/);

  await unauthenticatedPage.goto('/monitors');
  await expect(unauthenticatedPage).toHaveURL(/sign-in/);

  await unauthenticatedPage.goto('/jobs');
  await expect(unauthenticatedPage).toHaveURL(/sign-in/);
});
```

---

### AUTH-043: XSS prevention in auth forms
**Priority**: High | **Type**: Security

**Prerequisites**: None

**Steps**:
1. Enter `<script>alert('xss')</script>` in email field
2. Submit form
3. Check response

**Expected Result**:
- Script not executed
- Input treated as literal text
- Proper escaping applied

**Test Code Pattern**:
```typescript
test('AUTH-043: XSS prevention in auth forms @high @security', async ({ page }) => {
  await page.goto('/sign-in');

  const xssPayload = '<script>alert("xss")</script>';

  // Fill email with XSS payload
  await page.fill('input[name="email"]', xssPayload);
  await page.fill('input[name="password"]', 'anypassword');
  await page.click('button[type="submit"]');

  // Should not execute script - page should show error or sanitized input
  // Check that no alert dialog appeared
  const dialogPromise = page.waitForEvent('dialog', { timeout: 2000 }).catch(() => null);
  expect(await dialogPromise).toBeNull();

  // Error message should not contain unescaped script
  const errorMessage = page.locator('[role="alert"]');
  if (await errorMessage.isVisible()) {
    const text = await errorMessage.textContent();
    expect(text).not.toContain('<script>');
  }
});
```

---

### AUTH-044: CSRF protection on auth forms
**Priority**: High | **Type**: Security

**Prerequisites**: None

**Steps**:
1. Send POST request to sign-up from different origin
2. Submit form without CSRF token
3. Check rejection

**Expected Result**:
- Request rejected
- CSRF token validation prevents submission

**Test Code Pattern**:
```typescript
test('AUTH-044: CSRF protection on auth forms @high @security', async ({ page, context }) => {
  // Attempt cross-origin request
  const response = await page.request.post('/api/auth/sign-in', {
    data: {
      email: 'test@example.com',
      password: 'password',
    },
    headers: {
      'Origin': 'https://malicious-site.com',
    },
  });

  // Should be blocked (403 or require CSRF token)
  expect([400, 403, 401]).toContain(response.status());
});
```

---

### AUTH-045: Brute force protection
**Priority**: High | **Type**: Security

**Prerequisites**: None

**Steps**:
1. Attempt sign-in 10+ times with wrong password
2. Check for rate limiting or account lockout

**Expected Result**:
- Account locked or rate limited after N failed attempts
- Clear message about lockout
- Cannot retry immediately

**Test Code Pattern**:
```typescript
test('AUTH-045: Brute force protection @high @security', async ({ page }) => {
  const signInPage = new SignInPage(page);
  await signInPage.navigate();

  // Attempt multiple failed logins
  for (let i = 0; i < 11; i++) {
    await signInPage.signIn('test@example.com', `wrong-password-${i}`);
    await page.waitForTimeout(500);
    await signInPage.clearForm();
  }

  // Should see rate limit or lockout message
  const rateLimitMessage = page.locator('text=/rate limit|too many|locked|try again/i');
  await expect(rateLimitMessage).toBeVisible({ timeout: 5000 });
});
```

---

### AUTH-047: Session fixation prevention
**Priority**: High | **Type**: Security

**Prerequisites**: None

**Steps**:
1. Get session token before login
2. Sign in
3. Check that session token changed

**Expected Result**:
- Session ID regenerated after successful login
- Old session token invalid

**Test Code Pattern**:
```typescript
test('AUTH-047: Session fixation prevention @high @security', async ({ page }) => {
  await page.goto('/sign-in');

  // Get cookies before login
  const cookiesBefore = await page.context().cookies();
  const sessionBefore = cookiesBefore.find(c => c.name.includes('session'));

  // Sign in
  await page.fill('input[name="email"]', env.testUser.email);
  await page.fill('input[name="password"]', env.testUser.password);
  await page.click('button[type="submit"]');
  await page.waitForURL('/');

  // Get cookies after login
  const cookiesAfter = await page.context().cookies();
  const sessionAfter = cookiesAfter.find(c => c.name.includes('session'));

  // Session should be different (or new if didn't exist)
  if (sessionBefore && sessionAfter) {
    expect(sessionAfter.value).not.toBe(sessionBefore.value);
  }
});
```

---

### AUTH-048: HTTP-only cookies for session
**Priority**: High | **Type**: Security

**Prerequisites**: User signed in

**Steps**:
1. Sign in
2. Check cookies in DevTools/API
3. Verify HttpOnly flag

**Expected Result**:
- Session cookie has HttpOnly flag
- Cannot access via JavaScript

**Test Code Pattern**:
```typescript
test('AUTH-048: HTTP-only cookies for session @high @security', async ({ page }) => {
  await page.goto('/sign-in');
  await page.fill('input[name="email"]', env.testUser.email);
  await page.fill('input[name="password"]', env.testUser.password);
  await page.click('button[type="submit"]');
  await page.waitForURL('/');

  // Check cookies
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find(c =>
    c.name.includes('session') ||
    c.name.includes('auth') ||
    c.name.includes('token')
  );

  expect(sessionCookie).toBeDefined();
  expect(sessionCookie?.httpOnly).toBe(true);
});
```

---

### AUTH-049: Secure flag on HTTPS
**Priority**: High | **Type**: Security

**Prerequisites**: User signed in on HTTPS

**Steps**:
1. Sign in over HTTPS
2. Check session cookie

**Expected Result**:
- Session cookie has Secure flag

**Test Code Pattern**:
```typescript
test('AUTH-049: Secure flag on HTTPS @high @security', async ({ page }) => {
  // Only run if baseURL is HTTPS
  if (!env.baseUrl.startsWith('https')) {
    test.skip();
  }

  await page.goto('/sign-in');
  await page.fill('input[name="email"]', env.testUser.email);
  await page.fill('input[name="password"]', env.testUser.password);
  await page.click('button[type="submit"]');
  await page.waitForURL('/');

  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find(c => c.name.includes('session'));

  expect(sessionCookie?.secure).toBe(true);
});
```

---

### AUTH-050: SameSite cookie protection
**Priority**: High | **Type**: Security

**Prerequisites**: User signed in

**Steps**:
1. Sign in
2. Check SameSite attribute

**Expected Result**:
- SameSite=Strict or SameSite=Lax
- Prevents CSRF via cookie

**Test Code Pattern**:
```typescript
test('AUTH-050: SameSite cookie protection @high @security', async ({ page }) => {
  await page.goto('/sign-in');
  await page.fill('input[name="email"]', env.testUser.email);
  await page.fill('input[name="password"]', env.testUser.password);
  await page.click('button[type="submit"]');
  await page.waitForURL('/');

  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find(c => c.name.includes('session'));

  // SameSite should be Strict or Lax
  expect(['Strict', 'Lax']).toContain(sessionCookie?.sameSite);
});
```

---

### AUTH-055: User cannot elevate own role
**Priority**: Critical | **Type**: Security

**Prerequisites**: Logged in as Editor

**Steps**:
1. Try to change own role to Admin via UI
2. Try to change role via API

**Expected Result**:
- Role change fails
- 403 Forbidden error

**Test Code Pattern**:
```typescript
test('AUTH-055: User cannot elevate own role @critical @security', async ({ editorPage }) => {
  // Try to access role elevation API
  const response = await editorPage.request.patch('/api/members/self', {
    data: { role: 'admin' },
  });

  expect([400, 403]).toContain(response.status());
});
```

---

## Sensitive Data Tests

### AUTH-051: Organization invite email contains no sensitive data
**Priority**: High | **Type**: Security

**Test via**: Check email content (requires email testing setup)

**Expected Result**:
- Email contains only token link
- No credentials or sensitive org data in email

---

### AUTH-052: Password reset email contains no sensitive data
**Priority**: High | **Type**: Security

**Expected Result**:
- Email contains only reset link
- No passwords or sensitive data exposed

---

### AUTH-053: Sensitive data not logged
**Priority**: High | **Type**: Security

**Test via**: Application log review

**Expected Result**:
- Passwords not in logs
- Tokens not in logs
- API keys not in logs

---

## Tags
- `@critical` - Critical priority tests
- `@high` - High priority tests
- `@security` - Security tests
- `@negative` - Tests that verify rejection of bad input
