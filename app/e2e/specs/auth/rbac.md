# RBAC (Role-Based Access Control) Test Specification

## Overview
Tests for role-based access control across 6 roles: Super Admin, Org Owner, Org Admin, Project Admin, Editor, and Viewer. Verifies that each role has appropriate permissions and restrictions.

## Roles Hierarchy
```
Super Admin    → Full system access (admin panel, all orgs)
├── Org Owner  → Full org access (billing, delete org)
│   ├── Org Admin → Manage org members and projects
│   │   ├── Project Admin → Manage project members and settings
│   │   │   ├── Editor → Create and modify tests/jobs/monitors
│   │   │   │   └── Viewer → Read-only access
```

## Fixtures
- **File**: `fixtures/roles.fixture.ts`
- Use role-specific fixtures: `viewerPage`, `editorPage`, `projectAdminPage`, etc.

---

## Viewer Role Tests

### AUTH-020: Viewer cannot access admin panel
**Priority**: Critical | **Type**: RBAC

**Prerequisites**:
- Logged in as Viewer role

**Steps**:
1. Try to navigate to `/admin` or `/super-admin`
2. Check for access denied

**Expected Result**:
- 403 error page displayed
- Admin panel not accessible

**Test Code Pattern**:
```typescript
test('AUTH-020: Viewer cannot access admin panel @critical @rbac', async ({ viewerPage }) => {
  await viewerPage.goto('/super-admin');
  await expect(viewerPage).toHaveURL(/403|forbidden|access-denied/);
  // Or check for access denied component
  await expect(viewerPage.locator('text=Access Denied')).toBeVisible();
});
```

---

### AUTH-021: Viewer cannot create tests
**Priority**: Critical | **Type**: RBAC

**Prerequisites**:
- Logged in as Viewer in a project

**Steps**:
1. Navigate to tests page
2. Check that "Create Test" button is hidden
3. Try to navigate directly to `/tests/create`
4. Verify access denied

**Expected Result**:
- Create button hidden in UI
- Direct navigation to create page returns 403

**Test Code Pattern**:
```typescript
test('AUTH-021: Viewer cannot create tests @critical @rbac', async ({ viewerPage }) => {
  await viewerPage.goto('/tests');

  // Button should be hidden
  const createButton = viewerPage.locator('[data-testid="create-test-button"]');
  await expect(createButton).toBeHidden();

  // Direct navigation should fail
  await viewerPage.goto('/tests/create');
  await expect(viewerPage).toHaveURL(/403|forbidden/);
});
```

---

### AUTH-022: Viewer cannot modify tests
**Priority**: Critical | **Type**: RBAC

**Prerequisites**:
- Logged in as Viewer
- Test exists in project

**Steps**:
1. Navigate to test edit page
2. Check form is disabled or access denied

**Expected Result**:
- Edit form disabled or not accessible
- API returns 403 on modification attempt

**Test Code Pattern**:
```typescript
test('AUTH-022: Viewer cannot modify tests @critical @rbac', async ({ viewerPage }) => {
  const testId = 'existing-test-id';
  await viewerPage.goto(`/tests/${testId}/edit`);

  // Either 403 page or disabled form
  const is403 = viewerPage.url().includes('403');
  if (!is403) {
    // Form should be disabled
    const submitButton = viewerPage.locator('button[type="submit"]');
    await expect(submitButton).toBeDisabled();
  }
});
```

---

### AUTH-023: Viewer can view test results
**Priority**: High | **Type**: RBAC

**Prerequisites**:
- Logged in as Viewer
- Test with results exists

**Steps**:
1. Navigate to test results page
2. Verify results are visible
3. Verify UI is read-only (no edit buttons)

**Expected Result**:
- Results visible and readable
- No edit/delete buttons shown

---

## Editor Role Tests

### AUTH-024: Editor can create tests
**Priority**: Critical | **Type**: RBAC

**Prerequisites**:
- Logged in as Editor

**Steps**:
1. Navigate to tests page
2. Verify "Create Test" button visible
3. Click button and create test
4. Verify test created

**Expected Result**:
- Create button visible and clickable
- Can successfully create new test

**Test Code Pattern**:
```typescript
test('AUTH-024: Editor can create tests @critical @rbac', async ({ editorPage }) => {
  await editorPage.goto('/tests');

  // Button should be visible
  const createButton = editorPage.locator('[data-testid="create-test-button"]');
  await expect(createButton).toBeVisible();
  await createButton.click();

  // Should navigate to create page
  await expect(editorPage).toHaveURL(/tests\/create/);
});
```

---

### AUTH-025: Editor cannot access admin panel
**Priority**: Critical | **Type**: RBAC

**Prerequisites**:
- Logged in as Editor

**Steps**:
1. Try to navigate to admin panel
2. Verify access denied

**Expected Result**:
- 403 error page

---

## Admin Role Tests

### AUTH-026: Project Admin can manage members
**Priority**: Critical | **Type**: RBAC

**Prerequisites**:
- Logged in as Project Admin

**Steps**:
1. Navigate to project members page
2. Verify can invite/remove members

**Expected Result**:
- Member management available
- Can invite new members
- Can remove members (except self if only admin)

---

### AUTH-027: Project Admin cannot manage organization
**Priority**: High | **Type**: RBAC

**Prerequisites**:
- Logged in as Project Admin

**Steps**:
1. Try to access org settings
2. Verify limited or no access

**Expected Result**:
- Org settings not accessible or read-only

---

### AUTH-028: Organization Admin can manage projects
**Priority**: Critical | **Type**: RBAC

**Prerequisites**:
- Logged in as Org Admin

**Steps**:
1. Navigate to projects page
2. Verify can create/delete projects

**Expected Result**:
- Project management available

---

### AUTH-029: Organization Admin can manage members
**Priority**: Critical | **Type**: RBAC

**Prerequisites**:
- Logged in as Org Admin

**Steps**:
1. Navigate to org members page
2. Verify can manage members

**Expected Result**:
- Member management available at org level

---

### AUTH-030: Organization Owner full access
**Priority**: Critical | **Type**: RBAC

**Prerequisites**:
- Logged in as Org Owner

**Steps**:
1. Navigate to all areas of organization
2. Verify full access to billing, settings, members

**Expected Result**:
- Full access to all organization features
- Can access billing and subscription

---

## Super Admin Tests

### AUTH-031: Super Admin can access admin panel
**Priority**: Critical | **Type**: RBAC

**Prerequisites**:
- Logged in as Super Admin

**Steps**:
1. Navigate to `/super-admin`
2. Verify admin panel accessible

**Expected Result**:
- Admin panel loads successfully
- Can view system-wide information

**Test Code Pattern**:
```typescript
test('AUTH-031: Super Admin can access admin panel @critical @rbac', async ({ superAdminPage }) => {
  await superAdminPage.goto('/super-admin');
  await expect(superAdminPage).toHaveURL('/super-admin');
  await expect(superAdminPage.locator('h1')).toContainText(/admin|dashboard/i);
});
```

---

### AUTH-032: Super Admin can view all organizations
**Priority**: Critical | **Type**: RBAC

**Prerequisites**:
- Logged in as Super Admin
- Multiple organizations exist

**Steps**:
1. Navigate to admin org listing
2. Verify all organizations visible

**Expected Result**:
- List of all organizations displayed
- Can view details of any organization

---

## RBAC Matrix Summary

| Action | Viewer | Editor | Project Admin | Org Admin | Org Owner | Super Admin |
|--------|--------|--------|---------------|-----------|-----------|-------------|
| View Tests | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create Tests | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edit Tests | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Delete Tests | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Manage Project Members | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Manage Org Members | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Access Billing | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Delete Organization | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Access Admin Panel | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| View All Orgs | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

## Tags
- `@critical` - Critical priority tests
- `@high` - High priority tests
- `@rbac` - Role-based access control tests
- `@security` - Security tests
