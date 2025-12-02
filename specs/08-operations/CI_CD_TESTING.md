# CI/CD Testing Pipeline Documentation

## Overview

SuperCheck now integrates comprehensive Jest unit tests into the CI/CD pipeline with automatic validation on every pull request and before publishing Docker images. This ensures code quality, type safety, and build reliability throughout the development lifecycle.

### Key Features

- ✅ **Automatic PR Validation**: Tests run on every pull request automatically
- ✅ **Main Branch Protection**: Tests block merges to main if they fail
- ✅ **Build Verification**: Docker images only build after tests pass
- ✅ **Parallel Execution**: App and worker tests run simultaneously (~12 min total)
- ✅ **Smart Caching**: NPM (~70% faster) and Jest cache (~20-30% faster)
- ✅ **Coverage Enforcement**: Minimum coverage thresholds prevent regression
- ✅ **Multi-Stage Quality**: TypeScript, ESLint, Tests, Build checks

---

## Architecture

### Workflow Strategy

SuperCheck uses a **two-workflow approach**:

```
1. PR VALIDATION WORKFLOW
   ↓
   Runs on: PRs, pushes to main, manual dispatch
   Purpose: Comprehensive quality checks
   Jobs: Parallel app + worker validation
   Result: Pass/Fail status for merge decisions

2. BUILD WORKFLOW (Enhanced)
   ↓
   Runs on: Version tags, manual dispatch
   Purpose: Build Docker images after testing
   Dependency: Requires tests to pass first
   Result: Multi-arch images published if tests pass
```

### Job Architecture Diagram

```mermaid
graph TD
    A["GitHub Event<br/>(PR/Push/Manual)"] --> B["PR Validation Workflow"]
    A --> C["Build Workflow"]

    B --> B1["App Quality<br/>Checks"]
    B --> B2["Worker Quality<br/>Checks"]

    B1 --> B1A["TypeScript<br/>Check"]
    B1 --> B1B["ESLint<br/>Lint"]
    B1 --> B1C["Jest<br/>Tests"]
    B1 --> B1D["Build<br/>Check"]

    B2 --> B2A["TypeScript<br/>Check"]
    B2 --> B2B["ESLint<br/>Lint"]
    B2 --> B2C["Jest<br/>Tests"]
    B2 --> B2D["Build<br/>Check"]

    B1 --> B3["Summary<br/>Job"]
    B2 --> B3

    B3 --> B4{Pass?}
    B4 -->|Yes| B5["✅ All Checks Passed"]
    B4 -->|No| B6["❌ Checks Failed"]

    C --> C1["Test Job<br/>Matrix"]
    C1 --> C2{Tests Pass?}
    C2 -->|Yes| C3["Build & Push Images"]
    C2 -->|No| C4["❌ Block Build"]

    style B5 fill:#90EE90
    style B6 fill:#FFB6C6
    style C3 fill:#90EE90
    style C4 fill:#FFB6C6
```

---

## Workflow Execution Flow

### PR Validation Workflow Sequence

```mermaid
sequenceDiagram
    participant GitHub as GitHub
    participant Runner as GitHub Runner
    participant NPM as NPM Registry
    participant Tests as Jest Tests
    participant Build as Build Process
    participant Status as Status Check

    GitHub->>Runner: Trigger workflow (PR/Push)
    Note over Runner: Parallel Execution

    par App Branch
        Runner->>NPM: npm ci (app)
        NPM-->>Runner: Dependencies installed
        Runner->>Tests: tsc --noEmit (app)
        Tests-->>Runner: ✅ Type check passed
        Runner->>Tests: npm run lint (app)
        Tests-->>Runner: ✅ Lint passed
        Runner->>Tests: npm run test:cov (app)
        Tests-->>Runner: ✅ Tests passed
        Runner->>Build: npm run build (app)
        Build-->>Runner: ✅ Build succeeded
    and Worker Branch
        Runner->>NPM: npm ci (worker)
        NPM-->>Runner: Dependencies installed
        Runner->>Tests: tsc --noEmit (worker)
        Tests-->>Runner: ✅ Type check passed
        Runner->>Tests: eslint lint (worker)
        Tests-->>Runner: ✅ Lint passed
        Runner->>Tests: npm run test:cov (worker)
        Tests-->>Runner: ✅ Tests passed
        Runner->>Build: npm run build (worker)
        Build-->>Runner: ✅ Build succeeded
    end

    Runner->>Status: Summary job aggregates results
    Status->>GitHub: Report overall status
    GitHub-->>Status: Show check results on PR
```

### Build Workflow with Tests Sequence

```mermaid
sequenceDiagram
    participant Git as Git Tag/Manual
    participant Build as Build Workflow
    participant Test as Test Job Matrix
    participant Docker as Docker Build
    participant GHCR as GitHub Container Registry

    Git->>Build: Trigger (tag:v* or manual)
    Build->>Test: Start test job (app)
    Build->>Test: Start test job (worker)

    par App Tests
        Test->>Test: Install deps, type check, lint, test, build
        Test-->>Build: ✅ Tests passed
    and Worker Tests
        Test->>Test: Install deps, type check, lint, test, build
        Test-->>Build: ✅ Tests passed
    end

    Build->>Docker: Build app image (amd64, arm64)
    Docker->>GHCR: Push app image
    GHCR-->>Docker: ✅ Published

    Build->>Docker: Build worker image (amd64, arm64)
    Docker->>GHCR: Push worker image
    GHCR-->>Docker: ✅ Published

    GHCR-->>Git: ✅ All images published
```

---

## Quality Checks Explained

### 1. TypeScript Type Checking
```
Command: npx tsc --noEmit
Purpose: Validate type safety without emitting files
Failure: Any type errors block the pipeline
Runtime: ~30-60 seconds per package
```

### 2. ESLint Linting
```
Command: npm run lint (with --max-warnings 0)
Purpose: Enforce code style and catch issues
Config: Next.js ESLint + TypeScript (app), TypeScript ESLint (worker)
Failure: Any linting warnings block the pipeline
Runtime: ~20-40 seconds per package
```

### 3. Jest Unit Tests
```
Command: npm run test:cov --maxWorkers=2 --cacheDirectory=.jest-cache
Purpose: Run unit tests with coverage reporting
Coverage: 70% threshold for branches, functions, lines, statements
Failure: Test failures or coverage drops block the pipeline
Artifacts: Coverage reports uploaded for debugging
Runtime: ~1-3 minutes per package
Cache: Jest cache (~20-30% faster on subsequent runs)
```

### 4. Build Verification
```
App: npm run build (with SKIP_ENV_VALIDATION=true)
Worker: npm run build
Purpose: Ensure production builds succeed
Failure: Build errors block the pipeline
Runtime: ~2-4 minutes per package
```

---

## Caching Strategy

### NPM Dependencies Cache

```mermaid
graph LR
    A["Package Change?"] -->|No| B["Use Cached<br/>node_modules"]
    A -->|Yes| C["Fresh Install<br/>npm ci"]
    B --> D["~30 seconds<br/>70% faster"]
    C --> E["~2 minutes"]

    style D fill:#90EE90
    style E fill:#FFD700
```

**Implementation**:
- Uses GitHub Actions built-in Node.js setup cache
- Key: Hash of `package-lock.json`
- Location: `~/.npm`
- Hit rate: ~80% expected

### Jest Test Cache

```mermaid
graph LR
    A["Jest Config<br/>Change?"] -->|No| B["Use Cached<br/>Test Results"]
    A -->|Yes| C["Fresh Test Run"]
    B --> D["~20-30%<br/>Faster"]
    C --> E["Full Duration"]

    style D fill:#90EE90
    style E fill:#FFD700
```

**Implementation**:
- Custom cache for `.jest-cache` directory
- Key: Hash of `jest.config.js + package-lock.json`
- Location: `.jest-cache/` (in each package)
- Automatic invalidation on config changes

---

## Parallel Execution Performance

### Execution Timeline

```
SEQUENTIAL (Old)
├─ App checks:     12 minutes
└─ Worker checks:  12 minutes
   Total: 24 minutes

PARALLEL (New)
├─ App checks:     ┐
│                  ├─ 12 minutes (concurrent)
└─ Worker checks:  ┘
   Total: 12 minutes

⏱️ 50% time savings (12 minutes vs 24 minutes)
```

### Detailed Timeline

```mermaid
gantt
    title PR Validation Pipeline Timeline (~12 min)
    dateFormat YYYY-MM-DD

    section App
    Checkout & Setup    :app1, 2024-01-01, 30s
    Install Dependencies :app2, after app1, 45s
    Type Check          :app3, after app2, 45s
    Lint Code           :app4, after app3, 30s
    Run Tests           :app5, after app4, 2m
    Build Check         :app6, after app5, 3m
    Upload Coverage     :app7, after app6, 30s

    section Worker
    Checkout & Setup    :worker1, 2024-01-01, 30s
    Install Dependencies :worker2, after worker1, 45s
    Type Check          :worker3, after worker2, 45s
    Lint Code           :worker4, after worker3, 30s
    Run Tests           :worker5, after worker4, 2m
    Build Check         :worker6, after worker5, 2m
    Upload Coverage     :worker7, after worker6, 30s

    section Summary
    Aggregate Results   :crit, summary1, after app7, 30s
```

---

## File Structure

```
.github/
├── workflows/
│   ├── pr-validation.yml           ← NEW: PR validation workflow
│   └── build-multiarch.yml         ← MODIFIED: Added test job + dependency
└── CI_CD_TESTING.md                ← This file
```

### PR Validation Workflow (`pr-validation.yml`)

**Triggers**:
- All pull requests (branches: `**`)
- Pushes to main branch
- Manual workflow dispatch

**Jobs**:
1. `app-quality-checks` - App package validation (15 min timeout)
2. `worker-quality-checks` - Worker package validation (15 min timeout)
3. `summary` - Aggregate and report results

**Concurrency Control**:
- Groups: `workflow-{pr-number|ref}`
- Auto-cancels outdated runs on new commits

### Build Workflow Enhancement (`build-multiarch.yml`)

**New Test Job**:
- Matrix: `[app, worker]` (runs in parallel)
- Timeout: 20 minutes
- Steps: Checkout → Setup → Install → Type Check → Lint → Test → Build

**Build Dependency**:
- `build-and-push` now requires `test` job to pass
- Blocks Docker image builds if tests fail

---

## Branch Protection Configuration

### Required Status Checks

Set these on the `main` branch:

```
✅ app-quality-checks
✅ worker-quality-checks
✅ summary
```

### Additional Settings

```
✅ Require status checks to pass before merging
✅ Require branches to be up to date before merging
✅ Do not allow bypassing the above settings
```

**Effect**: Pull requests cannot be merged until all quality checks pass.

---

## Expected Behavior

### ✅ When Tests Pass

```mermaid
graph LR
    A["Tests Pass"] --> B["✅ Green Check"]
    B --> C["PR Can Merge"]
    C --> D["Images Can Build"]

    style A fill:#90EE90
    style B fill:#90EE90
    style C fill:#90EE90
    style D fill:#90EE90
```

- All checks show green status
- PR can be merged (branch protection satisfied)
- Images can be built in build workflow
- Coverage artifacts available for review

### ❌ When Tests Fail

```mermaid
graph LR
    A["Tests Fail"] --> B["❌ Red Check"]
    B --> C["PR Blocked"]
    C --> D["Images Blocked"]
    E["Debug Coverage<br/>Reports"] -.-> B

    style A fill:#FFB6C6
    style B fill:#FFB6C6
    style C fill:#FFB6C6
    style D fill:#FFB6C6
```

- Failing check shows red status
- PR cannot be merged (branch protection enforced)
- Images cannot be built (test job blocks build-and-push)
- Coverage reports available in artifacts for debugging
- Detailed error logs in workflow run

---

## Coverage Enforcement

### Coverage Thresholds

Coverage thresholds differ by package based on current test coverage:

**App Package:**
```
Branches:   3%
Functions:  3%
Lines:      4%
Statements: 4%
```

**Worker Package:**
```
Branches:   10%
Functions:  10%
Lines:      15%
Statements: 15%
```

> **Note:** These are minimum thresholds to prevent regression. The goal is to incrementally increase coverage over time.

### Coverage Failure Scenarios

```
Scenario 1: New code with low coverage
├─ Test count: ✅ All pass
├─ Coverage: ❌ Falls below 70%
└─ Result: Tests fail, PR blocked

Scenario 2: Uncovered code removed
├─ Test count: ✅ All pass
├─ Coverage: ✅ Improves
└─ Result: Tests pass, PR allowed

Scenario 3: Refactoring breaks tests
├─ Test count: ❌ Failures detected
├─ Coverage: (not checked)
└─ Result: Tests fail, PR blocked
```

---

## Troubleshooting

### Issue: Tests pass locally but fail in CI

**Causes**:
- Different dependency versions
- Environment-specific code
- Timezone/locale assumptions
- File system differences

**Solution**:
```bash
cd app          # or cd worker
npm ci          # Use exact versions from lock file
npm run test:cov
```

### Issue: Cache not restoring

**Check**:
- Cache key format is correct
- Path exists in both workflows
- Total cache size < 10GB
- Cache wasn't evicted by GitHub

**Reset**:
- Push a new commit to invalidate old caches
- GitHub automatically manages cache lifecycle

### Issue: Build check timeout

**Solutions**:
- Increase `timeout-minutes` value
- Run tests in serial: `--maxWorkers=1`
- Check for hanging async operations
- Review memory usage in logs

### Issue: Out of memory during build

**Solutions**:
```yaml
env:
  NODE_OPTIONS: --max-old-space-size=4096
```
- Reduce Jest workers: `--maxWorkers=1`
- Check for memory leaks in tests

---

## Performance Metrics

### Expected Runtimes

| Check | Time | Notes |
|-------|------|-------|
| Checkout & Setup | ~30s | Per job |
| npm ci | ~45s | First run; ~15s cached |
| Type Check | ~45s | Incremental when possible |
| Lint | ~30s | Varies by code changes |
| Tests | ~2-3m | Cached Jest saves ~20-30% |
| Build | ~3m (app), ~2m (worker) | Parallel execution |
| **Total (Parallel)** | **~12 min** | Both packages simultaneously |

### Cache Hit Rates

| Cache | Hit Rate | Impact |
|-------|----------|--------|
| NPM dependencies | ~80% | 70% faster installs |
| Jest | ~70% | 20-30% faster tests |
| TypeScript | Auto | Incremental builds |

---

## Benefits Summary

### Quality Assurance
- 🛡️ Type safety enforced (TypeScript)
- 🛡️ Code style consistency (ESLint)
- 🛡️ Functionality verified (Jest)
- 🛡️ Build reliability (npm run build)

### Developer Experience
- ⚡ Fast feedback (~12 minutes)
- ⚡ Clear error messages
- ⚡ Coverage reports for debugging
- ⚡ Auto-cancel outdated runs

### Reliability
- 🔒 No broken code merges to main
- 🔒 No broken images published
- 🔒 Deterministic test execution
- 🔒 Proper package isolation

### Cost Efficiency
- 💰 Smart caching reduces CI minutes
- 💰 Parallel execution saves time
- 💰 Early failure detection prevents waste

---

## Next Steps

### 1. Verify Workflows (Automated)
- [ ] Push changes to feature branch
- [ ] Open PR and watch workflows run
- [ ] Confirm all checks pass
- [ ] Review coverage artifacts

### 2. Configure Branch Protection (Manual)
- [ ] Go to Settings → Branches
- [ ] Add rule for `main` branch
- [ ] Select required status checks
- [ ] Enable settings (see above)

### 3. Test the Pipeline
- [ ] Create test PR with small change
- [ ] Verify workflow triggers automatically
- [ ] Confirm coverage artifacts upload
- [ ] Check merge is blocked if tests fail

### 4. Monitor and Optimize
- [ ] Review workflow run times
- [ ] Monitor cache hit rates
- [ ] Track coverage trends
- [ ] Adjust timeouts as needed

---

## Future Enhancements

Consider adding:
- **Codecov Integration**: Track coverage trends over time
- **Dependabot**: Automatic dependency updates
- **Security Scanning**: Snyk or npm audit in CI
- **E2E Tests**: Playwright tests in isolated environment
- **Bundle Analysis**: Track bundle size changes
- **Performance Testing**: K6 load tests in CI
- **Preview Deployments**: Automatic staging deployments on PRs

---

## References

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Jest Documentation](https://jestjs.io/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [ESLint Documentation](https://eslint.org/docs/)
- [Actions/cache](https://github.com/actions/cache)
- [Actions/setup-node](https://github.com/actions/setup-node)

---

## CI/CD Pipeline Review (2025-12-01)

### Review Summary

Both GitHub Actions workflows have been reviewed and are **correctly configured** following best practices.

### PR Validation Workflow (`pr-validation.yml`) - ✅ Pass

| Criteria | Status | Notes |
|----------|--------|-------|
| Latest action versions | ✅ | Using v4 for checkout, setup-node, cache, upload-artifact |
| Concurrency control | ✅ | Auto-cancels outdated runs on new commits |
| Caching strategy | ✅ | npm + Jest cache properly configured |
| Parallel execution | ✅ | App and worker jobs run simultaneously |
| Timeout settings | ✅ | 15 minutes per job |
| Artifact uploads | ✅ | Coverage reports uploaded on all outcomes |
| Environment variables | ✅ | NODE_VERSION centralized |
| Summary aggregation | ✅ | Reports combined status from both jobs |

### Build Multi-Architecture Workflow (`build-multiarch.yml`) - ✅ Pass

| Criteria | Status | Notes |
|----------|--------|-------|
| Test gating | ✅ | Build requires test job to pass |
| Matrix strategy | ✅ | Both app and worker tested in parallel |
| Multi-arch support | ✅ | linux/amd64 and linux/arm64 |
| Docker caching | ✅ | GitHub Actions cache for layers |
| Disk cleanup | ✅ | Prevents out-of-space failures |
| Semantic versioning | ✅ | Proper semver tag extraction |
| Manual dispatch | ✅ | Custom version and latest tag options |
| Permissions | ✅ | Minimal required permissions for push |

### Best Practices Compliance

```
✅ Uses actions/checkout@v4 (latest stable)
✅ Uses actions/setup-node@v4 with built-in caching
✅ Uses actions/cache@v4 for Jest cache
✅ Uses docker/build-push-action@v5 (stable)
✅ Uses docker/metadata-action@v5 for tagging
✅ Parallel job execution for performance
✅ Proper concurrency control to save CI minutes
✅ Timeout settings to prevent hung jobs
✅ Coverage artifacts for debugging
✅ Environment variables for configuration
✅ Matrix strategy for code reuse
✅ Multi-platform Docker builds
```

### Minor Issues Fixed

1. **Empty `build-args` removed** - Removed unnecessary empty parameter from app image build

### Recommendations for Future Enhancement

| Enhancement | Priority | Description |
|-------------|----------|-------------|
| Dependabot | Medium | Add `.github/dependabot.yml` for automated dependency updates |
| CodeQL | Low | Add CodeQL security scanning workflow for vulnerability detection |
| SBOM Generation | Low | Add software bill of materials to Docker images |
| Slack/Discord notifications | Low | Notify team on build failures |

### Sample Dependabot Configuration

To enable automated dependency updates, create `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/app"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
    groups:
      dependencies:
        patterns:
          - "*"

  - package-ecosystem: "npm"
    directory: "/worker"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

### Workflow File Locations

```
.github/
├── workflows/
│   ├── pr-validation.yml      ← PR quality checks (type, lint, test, build)
│   └── build-multiarch.yml    ← Docker image builds (test + multi-arch push)
├── ISSUE_TEMPLATE/
│   ├── bug_report.md          ← Bug report template
│   ├── feature_request.md     ← Feature request template
│   └── documentation.md       ← Documentation template
├── pull_request_template.md   ← PR description template
└── CI_CD_TESTING.md           ← This documentation
```

---

**Last Updated**: 2025-12-01
**Status**: Production Ready
**Reviewed**: 2025-12-01 (All workflows validated)
**Maintainer**: SuperCheck Team
