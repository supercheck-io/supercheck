# Testing & Quality Assurance Documentation

This section contains comprehensive testing specifications and quality assurance guidelines for SuperCheck.

## Files

- **[PLAYWRIGHT_UI_TEST_SPECIFICATION.md](PLAYWRIGHT_UI_TEST_SPECIFICATION.md)** - E2E test specification with 645 test cases covering all major features and workflows
- **[TEST_COVERAGE_SPECIFICATION.md](TEST_COVERAGE_SPECIFICATION.md)** - Test coverage dashboard with 1553 total tests (1094 app tests, 459 worker tests) following AAA pattern

## Test Structure

- **Framework**: Playwright + TypeScript, Jest for unit tests
- **Total Tests**: 1,553 tests across app and worker
- **E2E Tests**: ~645 test cases covering critical paths, edge cases, and security scenarios
- **Execution Time**: ~45-60 minutes (parallel execution)

## Quick Links

- [Back to Specs](../README.md)
- [Deployment & Setup](../09-deployment)
- [Operations & Optimization](../08-operations)
