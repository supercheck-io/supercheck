# Supercheck Test Coverage Specification

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                         TEST COVERAGE DASHBOARD                               ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         ║
║   │   TOTAL TESTS   │    │    APP TESTS    │    │  WORKER TESTS   │         ║
║   │                 │    │                 │    │                 │         ║
║   │      1427       │    │      968        │    │      459        │         ║
║   │                 │    │   (19 files)    │    │   (8 files)     │         ║
║   └─────────────────┘    └─────────────────┘    └─────────────────┘         ║
║                                                                              ║
║   Framework: Jest + TypeScript    Pattern: AAA (Arrange-Act-Assert)         ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## Summary

| Metric | Value |
|--------|-------|
| **Total Tests** | 1,427 |
| **Test Files** | 27 |
| **App Tests** | 968 (19 files) |
| **Worker Tests** | 459 (8 files) |
| **Test Framework** | Jest + TypeScript |
| **Test Pattern** | AAA (Arrange-Act-Assert) |

---

## App Test Files (19 files)

### Library & Utility Tests (18 files)

| # | File | Tests | Domain | Priority |
|---|------|-------|--------|----------|
| 1 | `input-sanitizer.spec.ts` | 101 | Security - XSS Prevention | Critical |
| 2 | `subscription-service.spec.ts` | 83 | Billing - Subscription Management | Critical |
| 3 | `role-normalizer.spec.ts` | 65 | RBAC - Role Conversion | High |
| 4 | `permissions.spec.ts` | 61 | RBAC - Permission Matrix | High |
| 5 | `middleware.spec.ts` | 61 | RBAC - Permission Middleware | High |
| 6 | `capacity-manager.spec.ts` | 58 | Queue - Redis Capacity | High |
| 7 | `ai-classifier.spec.ts` | 54 | AI - Error Classification | Medium |
| 8 | `k6-validator.spec.ts` | 46 | Validation - K6 Scripts | Medium |
| 9 | `secret-crypto.spec.ts` | 45 | Security - AES-128-GCM | Critical |
| 10 | `session.spec.ts` | 43 | Auth - Session Management | High |
| 11 | `variable-resolver.spec.ts` | 42 | Variables - Resolution | High |
| 12 | `alert-service.spec.ts` | 40 | Alerts - CRUD & History | High |
| 13 | `plan-enforcement.spec.ts` | 39 | Billing - Plan Limits | Critical |
| 14 | `date-utils.spec.ts` | 38 | Utilities - Date Formatting | Low |
| 15 | `job-scheduler.spec.ts` | 26 | Jobs - BullMQ Scheduling | High |
| 16 | `encryption.spec.ts` | 22 | Security - Encryption Wrapper | Medium |
| 17 | `cron-utils.spec.ts` | 21 | Utilities - Cron Parsing | Low |
| 18 | `use-form-validation.spec.tsx` | 18 | Hooks - Form Validation | Medium |

### API Route Tests (1 file - COLOCATED)

| # | File | Tests | Domain | Priority |
|---|------|-------|--------|----------|
| 1 | `handlers.spec.ts` | 74 | API - Route Handler Logic | High |

---

## Worker Test Files (8 files)

| # | File | Tests | Domain | Priority |
|---|------|-------|--------|----------|
| 1 | `k6-execution.service.spec.ts` | 85 | K6 - Load Testing | High |
| 2 | `monitor.service.spec.ts` | 83 | Monitoring - HTTP/Ping | High |
| 3 | `path-validator.spec.ts` | 64 | Security - Path Validation | Critical |
| 4 | `notification.service.spec.ts` | 60 | Notifications - Multi-channel | High |
| 5 | `playwright-execution.processor.spec.ts` | 59 | Execution - Playwright | Critical |
| 6 | `data-sanitizer.spec.ts` | 53 | Security - PII Redaction | Critical |
| 7 | `error-handler.spec.ts` | 31 | Utilities - Error Handling | Medium |
| 8 | `execution.service.spec.ts` | 22 | Execution - Helpers | Medium |

---

## Test Categories

### By Domain

| Domain | Tests | Coverage |
|--------|-------|----------|
| Security & Encryption | ~263 | 95%+ |
| RBAC & Permissions | ~187 | 80%+ |
| Billing & Subscriptions | ~122 | 96% |
| Validation | ~147 | 97% |
| Execution Pipeline | ~105 | 70% |
| Notifications | ~60 | 75% |
| Monitoring | ~83 | 70% |
| Utilities | ~79 | 90% |
| API Route Logic | ~74 | 60% |
| Session & Auth | ~43 | 60% |

### By Test Type

| Type | Description | Count |
|------|-------------|-------|
| Positive | Happy path scenarios | ~550 |
| Negative | Error conditions, invalid inputs | ~350 |
| Security | Authorization, injection, tampering | ~200 |
| Boundary | Edge values, limits, empty inputs | ~120 |
| Edge | Concurrent ops, timeouts, race conditions | ~93 |

---

## Test File Details

### Security Tests

**input-sanitizer.spec.ts (101 tests)**
- HTML/script tag removal
- XSS attack prevention
- URL sanitization
- SQL injection prevention
- Unicode handling
- Nested injection attempts

**secret-crypto.spec.ts (45 tests)**
- AES-128-GCM encryption/decryption
- Key derivation
- IV generation
- Tampering detection
- Invalid input handling

**path-validator.spec.ts (64 tests)**
- Path traversal prevention
- Symlink attack detection
- Null byte injection
- Relative path validation

**data-sanitizer.spec.ts (53 tests)**
- PII redaction
- Credit card masking
- SSN detection
- Email sanitization

### RBAC Tests

**permissions.spec.ts (61 tests)**
- Permission matrix validation
- Role hierarchy
- Resource access control
- Cross-organization checks

**middleware.spec.ts (61 tests)**
- Route protection
- Context injection
- Super admin bypass
- API key validation

**role-normalizer.spec.ts (65 tests)**
- Role conversion (6 types)
- Legacy role migration
- Invalid role handling

### Billing Tests

**subscription-service.spec.ts (83 tests)**
- Plan limit retrieval
- Usage tracking
- Upgrade/downgrade flows
- Self-hosted mode

**plan-enforcement.spec.ts (39 tests)**
- Resource limits
- Feature gating
- Overage handling

### Execution Tests

**playwright-execution.processor.spec.ts (59 tests)**
- Test execution flow
- Docker container management
- Report generation
- Error recovery

**k6-execution.service.spec.ts (24 tests)**
- Load test execution
- Dashboard port allocation
- Resource cleanup

**execution.service.spec.ts (22 tests)**
- Execution helpers
- State management

### Notification Tests

**notification.service.spec.ts (60 tests)**
- Email notifications (SMTP)
- Slack webhooks
- Discord embeds
- Telegram bot API
- Generic webhooks
- Multi-provider delivery
- Error scenarios

### API Route Tests

**handlers.spec.ts (74 tests) - Colocated at `/app/src/app/api/`**
- Jobs API handler logic (permissions, validation, execution)
- Monitors API handler logic (CRUD, plan limits, audit, sanitization)
- Tests API handler logic (CRUD, project scoping, script handling)
- Monitor types (6 types: HTTP, Website, Ping, Port, Heartbeat, Synthetic)
- Test priorities and types (5 priorities × 5 types)
- API Security (auth, subscription validation, error handling)
- Edge cases (long values, special characters, concurrent operations)

### Session & Auth Tests

**session.spec.ts (43 tests)**
- getCurrentUser
- getUserOrganizations
- getUserProjectRole
- Impersonation handling
- Role conversion
- Error recovery

### Other Tests

**ai-classifier.spec.ts (54 tests)**
- Error classification
- Pattern matching
- Confidence scoring

**variable-resolver.spec.ts (42 tests)**
- Variable resolution
- Secret decryption
- Script injection

**alert-service.spec.ts (40 tests)**
- Alert CRUD
- History tracking
- Status management

**capacity-manager.spec.ts (58 tests)**
- Redis capacity tracking
- Rate limiting
- Queue management

**job-scheduler.spec.ts (26 tests)**
- BullMQ scheduling
- Cron triggers
- Job removal

**monitor.service.spec.ts (24 tests)**
- HTTP monitoring
- Website checks
- Ping operations

---

## Running Tests

```bash
# All app tests
cd app && npm test

# All worker tests  
cd worker && npm test

# With coverage report
npm run test:cov

# Specific file
npm test -- --testPathPatterns="subscription-service"

# Watch mode
npm test -- --watch
```

---

## Test Quality Standards

All tests follow these requirements:

1. **Positive Cases** - Happy path scenarios with valid inputs
2. **Negative Cases** - Error conditions, invalid inputs, missing data
3. **Security Cases** - Authorization, injection attacks, tampering
4. **Boundary Cases** - Max/min values, empty arrays, null handling
5. **Edge Cases** - Concurrent operations, timeouts, race conditions

### Code Pattern (AAA)

```typescript
describe('ServiceName', () => {
  describe('methodName', () => {
    it('should handle expected scenario', async () => {
      // Arrange
      const input = createTestInput();
      
      // Act
      const result = await service.method(input);
      
      // Assert
      expect(result).toEqual(expected);
    });
  });
});
```

---

## Coverage Targets

| Domain | Target | Status |
|--------|--------|--------|
| Security Utilities | 95% | ✅ Met |
| RBAC Core | 80% | ✅ Met |
| Billing | 90% | ✅ Met |
| Validation | 90% | ✅ Met |
| Execution | 70% | ✅ Met |
| Notifications | 70% | ✅ Met |
| API Routes | 60% | ✅ Met |
| Session | 60% | ✅ Met |
| Monitoring | 70% | ✅ Met |
| K6 Execution | 70% | ✅ Met |

---

## File Locations

```
app/src/
├── app/
│   └── api/                          # API Route Tests (1 file - COLOCATED)
│       └── handlers.spec.ts
├── lib/                              # Library & Utility Tests (18 files)
│   ├── ai-classifier.spec.ts
│   ├── alert-service.spec.ts
│   ├── capacity-manager.spec.ts
│   ├── cron-utils.spec.ts
│   ├── date-utils.spec.ts
│   ├── encryption.spec.ts
│   ├── input-sanitizer.spec.ts
│   ├── job-scheduler.spec.ts
│   ├── k6-validator.spec.ts
│   ├── session.spec.ts
│   ├── variable-resolver.spec.ts
│   ├── middleware/
│   │   └── plan-enforcement.spec.ts
│   ├── rbac/
│   │   ├── middleware.spec.ts
│   │   ├── permissions.spec.ts
│   │   └── role-normalizer.spec.ts
│   ├── security/
│   │   └── secret-crypto.spec.ts
│   └── services/
│       └── subscription-service.spec.ts
└── hooks/
    └── use-form-validation.spec.tsx

worker/src/
├── common/
│   ├── security/
│   │   └── path-validator.spec.ts
│   ├── utils/
│   │   └── error-handler.spec.ts
│   └── validation/
│       └── data-sanitizer.spec.ts
├── execution/
│   ├── processors/
│   │   └── playwright-execution.processor.spec.ts
│   └── services/
│       └── execution.service.spec.ts
├── k6/
│   └── services/
│       └── k6-execution.service.spec.ts
├── monitor/
│   └── monitor.service.spec.ts
└── notification/
    └── notification.service.spec.ts
```
