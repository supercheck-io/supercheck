# Password Reset Test Specification

## Overview
Tests for the password reset flow including the forgot password page (`/forgot-password`) and reset password page (`/reset-password`). Covers email sending, token validation, and password update.

## Pages
- **Forgot Password Route**: `/forgot-password`
- **Reset Password Route**: `/reset-password?token=<token>`
- **Page Object**: `ForgotPasswordPage` from `pages/auth/forgot-password.page.ts`

## Test Cases

### AUTH-009: Password reset email flow
**Priority**: Critical | **Type**: Positive

**Prerequisites**:
- User account exists with verified email

**Steps**:
1. Navigate to `/forgot-password`
2. Enter email address (`[data-testid="forgot-password-email-input"]`)
3. Click submit button (`[data-testid="forgot-password-submit"]`)
4. Wait for success message

**Expected Result**:
- Success message displayed: "Reset email sent" or similar
- Email sent with secure reset token
- Token expires after a set time (e.g., 1 hour)

**Test Code Pattern**:
```typescript
test('AUTH-009: Password reset email flow @critical @positive', async ({ page }) => {
  const forgotPasswordPage = new ForgotPasswordPage(page);
  await forgotPasswordPage.navigate();

  await forgotPasswordPage.requestResetAndWaitForSuccess(env.testUser.email);
  await forgotPasswordPage.expectSuccess(/email sent|check your email/i);
});
```

---

### AUTH-010: Password reset with invalid token
**Priority**: High | **Type**: Negative

**Prerequisites**:
- Invalid or expired token

**Steps**:
1. Navigate to `/reset-password?token=invalid-token`
2. Try to submit new password
3. Check for error

**Expected Result**:
- Error message: "Invalid or expired reset link"
- User cannot reset password
- Prompted to request new reset link

**Test Code Pattern**:
```typescript
test('AUTH-010: Password reset with invalid token @high @negative', async ({ page }) => {
  await page.goto('/reset-password?token=invalid-or-expired-token');

  // Fill password form
  await page.fill('[data-testid="reset-password-input"]', 'NewPassword123!');
  await page.fill('[data-testid="reset-password-confirm-input"]', 'NewPassword123!');
  await page.click('[data-testid="reset-password-submit"]');

  // Expect error
  await expect(page.locator('[role="alert"]')).toContainText(/invalid|expired/i);
});
```

---

### AUTH-011: Password reset successful
**Priority**: High | **Type**: Positive

**Prerequisites**:
- Valid reset token

**Steps**:
1. Click reset email link with valid token
2. Enter new password (`[data-testid="reset-password-input"]`)
3. Confirm new password (`[data-testid="reset-password-confirm-input"]`)
4. Submit form (`[data-testid="reset-password-submit"]`)
5. Wait for redirect

**Expected Result**:
- Password updated successfully
- User redirected to `/sign-in`
- Can sign in with new password
- Old password no longer works

**Test Code Pattern**:
```typescript
test('AUTH-011: Password reset successful @high @positive', async ({ page }) => {
  // This test requires a valid reset token
  const resetToken = 'valid-test-reset-token';
  await page.goto(`/reset-password?token=${resetToken}`);

  const newPassword = 'NewSecurePassword123!';

  await page.fill('[data-testid="reset-password-input"]', newPassword);
  await page.fill('[data-testid="reset-password-confirm-input"]', newPassword);
  await page.click('[data-testid="reset-password-submit"]');

  // Expect redirect to sign-in
  await expect(page).toHaveURL(/sign-in/);

  // Verify success message (toast or on page)
  await expect(page.locator('text=password updated')).toBeVisible();
});
```

---

### AUTH-046: Rate limiting on password reset
**Priority**: High | **Type**: Security

**Prerequisites**: None

**Steps**:
1. Request password reset 5+ times for same email
2. Check for rate limit message

**Expected Result**:
- After N attempts, rate limit kicks in
- Message: "Too many requests, please wait"
- Must wait before next attempt

**Test Code Pattern**:
```typescript
test('AUTH-046: Rate limiting on password reset @high @security', async ({ page }) => {
  const forgotPasswordPage = new ForgotPasswordPage(page);
  await forgotPasswordPage.navigate();

  // Make multiple requests
  for (let i = 0; i < 6; i++) {
    await forgotPasswordPage.requestReset('test@example.com');
    await page.waitForTimeout(500); // Small delay between requests
    await forgotPasswordPage.clearForm();
  }

  // Should see rate limit message
  await forgotPasswordPage.expectRateLimited();
});
```

---

## Validation Tests

### Password validation rules
**Priority**: Medium | **Type**: Negative

Test that password reset enforces password requirements:
- Minimum length (e.g., 8 characters)
- Must contain uppercase
- Must contain lowercase
- Must contain number
- Must contain special character

```typescript
test('Password validation on reset @medium @negative', async ({ page }) => {
  await page.goto('/reset-password?token=valid-token');

  // Test weak password
  await page.fill('[data-testid="reset-password-input"]', 'weak');
  await page.fill('[data-testid="reset-password-confirm-input"]', 'weak');
  await page.click('[data-testid="reset-password-submit"]');

  await expect(page.locator('[role="alert"]')).toContainText(/password must|too weak|minimum/i);
});
```

### Password confirmation mismatch
**Priority**: Medium | **Type**: Negative

```typescript
test('Password confirmation must match @medium @negative', async ({ page }) => {
  await page.goto('/reset-password?token=valid-token');

  await page.fill('[data-testid="reset-password-input"]', 'SecurePass123!');
  await page.fill('[data-testid="reset-password-confirm-input"]', 'DifferentPass123!');
  await page.click('[data-testid="reset-password-submit"]');

  await expect(page.locator('[role="alert"]')).toContainText(/match|same/i);
});
```

---

## Selectors Reference

### Forgot Password Page
| Element | Primary Selector | Fallback Selectors |
|---------|------------------|-------------------|
| Email Input | `[data-testid="forgot-password-email-input"]` | `#email`, `input[name="email"]` |
| Submit Button | `[data-testid="forgot-password-submit"]` | `button[type="submit"]` |
| Success Message | `[data-testid="forgot-password-success"]` | `text=email sent` |
| Error Message | `[data-testid="forgot-password-error"]` | `[role="alert"]` |
| Rate Limit Message | `[data-testid="rate-limit-message"]` | `text=too many` |
| Back to Sign In | `[data-testid="back-to-signin-link"]` | `a:has-text("Sign in")` |

### Reset Password Page
| Element | Primary Selector | Fallback Selectors |
|---------|------------------|-------------------|
| New Password | `[data-testid="reset-password-input"]` | `#password`, `input[name="password"]` |
| Confirm Password | `[data-testid="reset-password-confirm-input"]` | `#confirmPassword` |
| Submit Button | `[data-testid="reset-password-submit"]` | `button[type="submit"]` |
| Error Message | `[data-testid="reset-password-error"]` | `[role="alert"]` |
| Success Message | `[data-testid="reset-password-success"]` | `text=updated` |

## Tags
- `@critical` - Critical priority tests
- `@high` - High priority tests
- `@positive` - Happy path tests
- `@negative` - Error case tests
- `@security` - Security tests
