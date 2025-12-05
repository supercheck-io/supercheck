# SuperCheck MCP Server Specification

## 📋 Executive Summary

This document specifies the design and implementation of an MCP (Model Context Protocol) server for SuperCheck, enabling AI applications like Claude Code, VS Code Copilot, Cursor, and other MCP-enabled clients to interact with SuperCheck's testing and monitoring platform through natural language.

**Version**: 1.0.0  
**Status**: Draft  
**Last Updated**: December 2025

---

## 🎯 Goals & Objectives

### Primary Goals

1. **Enable AI-Assisted Testing**: Allow developers to create, run, and manage Playwright tests through natural language
2. **Integrate Monitoring Management**: Provide capabilities to configure, execute, and analyze monitors
3. **Real-time Observability**: Surface test results, monitoring data, and alerts directly to AI assistants
4. **Debugging Support**: Leverage AI to analyze failures and suggest fixes
5. **Seamless Workflow Integration**: Reduce context-switching by bringing SuperCheck capabilities into IDEs

### Target Users

- **Developers** using VS Code, Cursor, or Claude Code
- **QA Engineers** managing test suites and monitoring
- **DevOps Engineers** configuring CI/CD integration
- **SREs** monitoring system health and responding to alerts

---

## 🏗️ Architecture Overview

### MCP Protocol Fundamentals

MCP follows a client-server architecture:

- **MCP Host**: AI application (Claude Code, VS Code Copilot, Cursor)
- **MCP Client**: Component within the host that connects to MCP servers
- **MCP Server**: SuperCheck MCP server providing tools, resources, and prompts

```
┌─────────────────────────────────────────────────────────────────┐
│                        MCP Host                                  │
│  ┌────────────────┐   ┌────────────────┐   ┌────────────────┐  │
│  │  VS Code +     │   │    Claude      │   │    Cursor      │  │
│  │  Copilot       │   │    Code        │   │                │  │
│  └───────┬────────┘   └───────┬────────┘   └───────┬────────┘  │
│          │                    │                    │            │
│          └────────────────────┼────────────────────┘            │
│                               │                                  │
│                    ┌──────────▼──────────┐                      │
│                    │    MCP Client       │                      │
│                    │ (manages connection)│                      │
│                    └──────────┬──────────┘                      │
└───────────────────────────────┼─────────────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │   SuperCheck MCP      │
                    │       Server          │
                    │  ┌─────────────────┐  │
                    │  │     Tools       │  │
                    │  │   Resources     │  │
                    │  │    Prompts      │  │
                    │  └─────────────────┘  │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │   SuperCheck API      │
                    │  ┌─────────────────┐  │
                    │  │  Tests & Jobs   │  │
                    │  │    Monitors     │  │
                    │  │     Alerts      │  │
                    │  │   Status Pages  │  │
                    │  └─────────────────┘  │
                    └───────────────────────┘
```

### Transport Mechanisms

The SuperCheck MCP server will support:

1. **STDIO Transport** (Primary - Local)
   - Direct process communication
   - Ideal for local development
   - No network overhead
2. **Streamable HTTP Transport** (Secondary - Remote)
   - HTTP POST for client-to-server
   - Server-Sent Events for streaming
   - OAuth/API key authentication
   - Enterprise and cloud deployments

---

## 🛠️ MCP Primitives

### 1. Tools (Actions)

Tools are executable functions that AI can invoke. Based on SuperCheck's API and similar implementations (Playwright MCP, BrowserStack MCP), we propose:

#### Test Management Tools

| Tool Name        | Description                        | Parameters                                      |
| ---------------- | ---------------------------------- | ----------------------------------------------- |
| `createTest`     | Create a new Playwright or K6 test | `name`, `type`, `script`, `projectId`, `tags[]` |
| `updateTest`     | Update an existing test            | `testId`, `name?`, `script?`, `tags[]?`         |
| `deleteTest`     | Delete a test                      | `testId`                                        |
| `listTests`      | List tests with filters            | `projectId`, `tags[]?`, `status?`, `limit?`     |
| `getTest`        | Get test details                   | `testId`                                        |
| `executeTest`    | Run a test immediately             | `testId`, `variables?`                          |
| `getTestResults` | Fetch test run results             | `testId`, `limit?`, `status?`                   |

#### Job Management Tools

| Tool Name       | Description              | Parameters                               |
| --------------- | ------------------------ | ---------------------------------------- |
| `createJob`     | Create a scheduled job   | `name`, `testId`, `schedule`, `enabled?` |
| `updateJob`     | Update job configuration | `jobId`, `schedule?`, `enabled?`         |
| `triggerJob`    | Manually trigger a job   | `jobId`                                  |
| `listJobs`      | List all jobs            | `projectId`, `status?`, `limit?`         |
| `getJobStatus`  | Get current job status   | `jobId`                                  |
| `getJobHistory` | Get job run history      | `jobId`, `limit?`                        |

#### Monitor Management Tools

| Tool Name           | Description                 | Parameters                           |
| ------------------- | --------------------------- | ------------------------------------ |
| `createMonitor`     | Create a new monitor        | `name`, `type`, `config`, `schedule` |
| `updateMonitor`     | Update monitor settings     | `monitorId`, `config?`, `enabled?`   |
| `deleteMonitor`     | Delete a monitor            | `monitorId`                          |
| `listMonitors`      | List monitors               | `projectId`, `status?`, `type?`      |
| `getMonitorStatus`  | Get current monitor status  | `monitorId`                          |
| `getMonitorResults` | Fetch monitor check results | `monitorId`, `limit?`, `location?`   |
| `pauseMonitor`      | Pause a monitor             | `monitorId`                          |
| `resumeMonitor`     | Resume a paused monitor     | `monitorId`                          |

#### Alert & Notification Tools

| Tool Name               | Description                | Parameters                          |
| ----------------------- | -------------------------- | ----------------------------------- |
| `listAlerts`            | List active alerts         | `projectId`, `severity?`, `status?` |
| `getAlertHistory`       | Get alert history          | `monitorId?`, `limit?`              |
| `acknowledgeAlert`      | Acknowledge an alert       | `alertId`                           |
| `configureNotification` | Setup notification channel | `type`, `config`                    |
| `testNotification`      | Send test notification     | `channelId`                         |

#### Status Page Tools

| Tool Name             | Description              | Parameters                                          |
| --------------------- | ------------------------ | --------------------------------------------------- |
| `listStatusPages`     | List status pages        | `projectId`                                         |
| `getStatusPageHealth` | Get status page overview | `statusPageId`                                      |
| `createIncident`      | Create a new incident    | `statusPageId`, `title`, `severity`, `components[]` |
| `updateIncident`      | Update incident status   | `incidentId`, `status`, `message?`                  |
| `resolveIncident`     | Mark incident resolved   | `incidentId`, `message?`                            |

#### AI-Assisted Tools

| Tool Name            | Description                    | Parameters                    |
| -------------------- | ------------------------------ | ----------------------------- |
| `analyzeTestFailure` | AI analysis of test failure    | `runId`                       |
| `suggestTestFix`     | Get AI-powered fix suggestions | `testId`, `runId`             |
| `generateTest`       | Generate test from description | `description`, `url?`, `type` |
| `validateScript`     | Validate Playwright/K6 script  | `script`, `type`              |

#### Dashboard & Reporting Tools

| Tool Name             | Description                 | Parameters                |
| --------------------- | --------------------------- | ------------------------- |
| `getDashboardStats`   | Get project dashboard stats | `projectId`               |
| `getQueueStatus`      | Get queue/worker status     | -                         |
| `getExecutionMetrics` | Get execution metrics       | `projectId`, `dateRange?` |

### 2. Resources (Data Sources)

Resources provide contextual data that AI can read:

| Resource URI                                  | Description                  | MIME Type          |
| --------------------------------------------- | ---------------------------- | ------------------ |
| `supercheck://tests/{testId}`                 | Test definition and metadata | `application/json` |
| `supercheck://tests/{testId}/script`          | Test script content          | `text/plain`       |
| `supercheck://tests/{testId}/report`          | Latest test report           | `text/html`        |
| `supercheck://jobs/{jobId}`                   | Job configuration            | `application/json` |
| `supercheck://monitors/{monitorId}`           | Monitor configuration        | `application/json` |
| `supercheck://monitors/{monitorId}/results`   | Recent monitor results       | `application/json` |
| `supercheck://projects/{projectId}`           | Project information          | `application/json` |
| `supercheck://projects/{projectId}/variables` | Project variables (masked)   | `application/json` |
| `supercheck://dashboard`                      | Dashboard summary            | `application/json` |
| `supercheck://alerts/active`                  | Active alerts                | `application/json` |
| `supercheck://status-pages/{pageId}`          | Status page info             | `application/json` |

### 3. Prompts (Interaction Templates)

Prompts help structure common interactions:

| Prompt Name              | Description                              | Arguments                     |
| ------------------------ | ---------------------------------------- | ----------------------------- |
| `create-playwright-test` | Guide for creating a new Playwright test | `description`, `url?`         |
| `create-k6-test`         | Guide for creating K6 performance test   | `description`, `endpoints[]?` |
| `debug-test-failure`     | Structured debugging workflow            | `testId`, `runId`             |
| `setup-monitor`          | Guided monitor creation                  | `type`, `target`              |
| `configure-alerts`       | Alert configuration workflow             | `monitorId`                   |
| `investigate-incident`   | Incident investigation guide             | `incidentId`                  |
| `optimize-test`          | Test optimization suggestions            | `testId`                      |

---

## 🔐 Authentication & Security

### Authentication Methods

1. **API Key Authentication** (Primary)

   ```json
   {
     "env": {
       "SUPERCHECK_API_KEY": "<api-key>",
       "SUPERCHECK_URL": "https://supercheck.example.com"
     }
   }
   ```

2. **OAuth 2.0** (Enterprise)
   - PKCE flow for secure authentication
   - Token refresh support
   - Scoped permissions

### Security Considerations

1. **Input Validation**

   - Validate all tool parameters using Zod schemas
   - Sanitize code inputs to prevent injection
   - Size limits on script content

2. **Authorization**

   - Respect SuperCheck RBAC permissions
   - API key scopes limit accessible tools
   - Project/Organization isolation

3. **Rate Limiting**

   - Per-user rate limits
   - Tool-specific throttling for expensive operations
   - Queue capacity checks before test execution

4. **Secrets Management**
   - Never expose API keys in responses
   - Mask sensitive project variables
   - Secure credential storage in config

---

## 📦 Implementation Plan

### Phase 1: Core Foundation (MVP)

**Duration**: 2-3 weeks

- [ ] Project setup with TypeScript + MCP SDK
- [ ] STDIO transport implementation
- [ ] Authentication (API key)
- [ ] Core tools:
  - `listTests`, `getTest`, `executeTest`, `getTestResults`
  - `listMonitors`, `getMonitorStatus`, `getMonitorResults`
  - `getDashboardStats`
- [ ] Basic resources:
  - `supercheck://tests/{testId}`
  - `supercheck://dashboard`

### Phase 2: Test Management

**Duration**: 2 weeks

- [ ] Test CRUD tools: `createTest`, `updateTest`, `deleteTest`
- [ ] Job management: `createJob`, `triggerJob`, `getJobHistory`
- [ ] Script validation: `validateScript`
- [ ] Test resources with script content

### Phase 3: Monitoring & Alerts

**Duration**: 2 weeks

- [ ] Monitor CRUD: `createMonitor`, `updateMonitor`, `deleteMonitor`
- [ ] Monitor operations: `pauseMonitor`, `resumeMonitor`
- [ ] Alert tools: `listAlerts`, `acknowledgeAlert`
- [ ] Notification configuration

### Phase 4: AI Features & Prompts

**Duration**: 2 weeks

- [ ] AI analysis: `analyzeTestFailure`, `suggestTestFix`
- [ ] Test generation: `generateTest`
- [ ] Prompt templates for guided workflows
- [ ] Integration with SuperCheck AI fix system

### Phase 5: Status Pages & Advanced

**Duration**: 2 weeks

- [ ] Status page tools: `createIncident`, `updateIncident`
- [ ] HTTP transport for remote access
- [ ] OAuth authentication
- [ ] Advanced filtering and pagination

### Phase 6: Polish & Production

**Duration**: 1-2 weeks

- [ ] Comprehensive error handling
- [ ] Performance optimization
- [ ] Documentation and examples
- [ ] Testing and validation
- [ ] NPM package publication

---

## 🗂️ Project Structure

```
/mcp/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts                 # Entry point
│   ├── server.ts                # MCP server setup
│   ├── config.ts                # Configuration management
│   ├── tools/
│   │   ├── index.ts             # Tool registration
│   │   ├── tests.ts             # Test management tools
│   │   ├── jobs.ts              # Job management tools
│   │   ├── monitors.ts          # Monitor management tools
│   │   ├── alerts.ts            # Alert tools
│   │   ├── status-pages.ts      # Status page tools
│   │   ├── ai.ts                # AI-assisted tools
│   │   └── dashboard.ts         # Dashboard tools
│   ├── resources/
│   │   ├── index.ts             # Resource registration
│   │   ├── tests.ts             # Test resources
│   │   ├── monitors.ts          # Monitor resources
│   │   └── projects.ts          # Project resources
│   ├── prompts/
│   │   ├── index.ts             # Prompt registration
│   │   ├── test-creation.ts     # Test creation prompts
│   │   ├── debugging.ts         # Debugging prompts
│   │   └── monitoring.ts        # Monitoring prompts
│   ├── lib/
│   │   ├── api-client.ts        # SuperCheck API client
│   │   ├── auth.ts              # Authentication helpers
│   │   ├── schemas.ts           # Zod validation schemas
│   │   ├── errors.ts            # Error handling
│   │   └── utils.ts             # Utility functions
│   └── types/
│       ├── index.ts             # Type definitions
│       └── api.ts               # API response types
├── tests/
│   ├── tools/
│   ├── resources/
│   └── integration/
└── docs/
    ├── setup.md
    ├── tools-reference.md
    └── examples.md
```

---

## 📝 Configuration

### Standard MCP Configuration

**VS Code / Cursor (`.vscode/mcp.json` or `.cursor/mcp.json`)**:

```json
{
  "servers": {
    "supercheck": {
      "command": "npx",
      "args": ["-y", "@supercheck/mcp-server@latest"],
      "env": {
        "SUPERCHECK_URL": "https://your-instance.supercheck.io",
        "SUPERCHECK_API_KEY": "<your-api-key>"
      }
    }
  }
}
```

**Claude Desktop (`claude_desktop_config.json`)**:

```json
{
  "mcpServers": {
    "supercheck": {
      "command": "npx",
      "args": ["-y", "@supercheck/mcp-server@latest"],
      "env": {
        "SUPERCHECK_URL": "https://your-instance.supercheck.io",
        "SUPERCHECK_API_KEY": "<your-api-key>"
      }
    }
  }
}
```

### Configuration Options

| Environment Variable         | Description                              | Required |
| ---------------------------- | ---------------------------------------- | -------- |
| `SUPERCHECK_URL`             | SuperCheck instance URL                  | Yes      |
| `SUPERCHECK_API_KEY`         | API key for authentication               | Yes      |
| `SUPERCHECK_PROJECT_ID`      | Default project ID                       | No       |
| `SUPERCHECK_ORGANIZATION_ID` | Organization context                     | No       |
| `SUPERCHECK_LOG_LEVEL`       | Logging level (debug, info, warn, error) | No       |

---

## 🎮 Usage Examples

### Example 1: Create and Run a Test

```
User: Create a Playwright test that checks if the login page loads correctly on https://example.com/login

AI: I'll create a Playwright test for you.
[Calls createTest tool]

Created test "Login Page Load Test" (ID: test_abc123)
Would you like me to run this test now?

User: Yes, run it

AI: [Calls executeTest tool]
Test execution started. Run ID: run_xyz789
[Monitors progress via getTestResults]

Test completed successfully!
- Duration: 3.2s
- Status: Passed
- Screenshots: 2 captured
```

### Example 2: Investigate Monitor Alert

```
User: Why is my API health monitor failing?

AI: Let me check your monitor status.
[Calls listMonitors, getMonitorResults]

I found an issue with "API Health Monitor" (ID: mon_456):
- Current Status: DOWN
- Failed since: 10:45 AM
- Error: Connection timeout after 30s

Recent results show:
- us-east: 5 consecutive failures
- eu-central: 3 consecutive failures
- asia-pacific: 2 consecutive failures

The endpoint https://api.example.com/health is not responding.
Would you like me to create an incident for your status page?
```

### Example 3: Debug Test Failure

````
User: My checkout test is failing, can you help debug?

AI: [Calls getTest, getTestResults]

I see your "Checkout Flow Test" failed in the last run. Let me analyze:
[Calls analyzeTestFailure]

The test failed at step "Click checkout button":
- Element not found: button[data-testid="checkout-btn"]
- The page shows a loading spinner that doesn't disappear

Suggested fix:
[Calls suggestTestFix]

Add a wait for the spinner to disappear:
```typescript
await page.waitForSelector('.loading-spinner', { state: 'hidden' });
await page.click('[data-testid="checkout-btn"]');
````

Would you like me to update the test with this fix?

```

---

## 📊 Comparison with Similar Implementations

### Feature Comparison

| Feature | SuperCheck MCP | Playwright MCP | BrowserStack MCP |
|---------|----------------|----------------|------------------|
| Test Management | ✅ Full CRUD | ❌ Runtime only | ✅ Test Management |
| Test Execution | ✅ Playwright + K6 | ✅ Playwright | ✅ Multiple frameworks |
| Monitoring | ✅ Built-in | ❌ N/A | ❌ N/A |
| Status Pages | ✅ Built-in | ❌ N/A | ❌ N/A |
| AI Fix Suggestions | ✅ Built-in | ❌ N/A | ✅ Self-healing |
| Real Device Testing | ❌ N/A | ❌ Browsers only | ✅ Real devices |
| HTTP Transport | ✅ Planned | ✅ Supported | ✅ Remote MCP |
| Prompts | ✅ Guided workflows | ❌ N/A | ✅ Limited |

### Lessons from Existing Implementations

**From Playwright MCP**:
- Clear tool naming convention (`browser_click`, `browser_navigate`)
- Capability-based feature flags (`--caps=vision`, `--caps=pdf`)
- Session and state management
- Comprehensive error messages

**From BrowserStack MCP**:
- Tool grouping by domain (Test Management, Observability, etc.)
- Prompt templates for guided setup
- Telemetry and instrumentation
- Remote MCP server option for enterprise

---

## 🧪 Testing Strategy

### Unit Tests
- Test each tool handler in isolation
- Mock SuperCheck API responses
- Validate parameter schemas

### Integration Tests
- Test against a real SuperCheck instance (staging)
- Verify end-to-end tool execution
- Test authentication flows

### MCP Protocol Tests
- Use MCP Inspector for validation
- Test capability negotiation
- Verify JSON-RPC message format

---

## 📚 Documentation Requirements

1. **Setup Guide**: Installation and configuration
2. **Tools Reference**: Detailed documentation for each tool
3. **Examples Cookbook**: Common use cases with prompts
4. **API Reference**: TypeScript types and schemas
5. **Troubleshooting Guide**: Common issues and solutions

---

## 🚀 Next Steps

1. **Approve Specification**: Review and finalize this spec
2. **Setup Repository**: Create `@supercheck/mcp-server` package
3. **Implement MVP**: Phase 1 core foundation
4. **Internal Testing**: Test with VS Code + Copilot
5. **Documentation**: Complete setup and reference docs
6. **Beta Release**: Publish to NPM
7. **Community Feedback**: Iterate based on usage

---

## 📎 References

- [MCP Specification](https://modelcontextprotocol.io/specification/latest)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Playwright MCP](https://github.com/microsoft/playwright-mcp)
- [BrowserStack MCP](https://github.com/browserstack/mcp-server)
- [SuperCheck API Documentation](/docs/specs/01-core/API_ROUTES_ANALYSIS.md)
- [SuperCheck Architecture](/docs/specs/01-core/SUPERCHECK_ARCHITECTURE.md)

---

**Document Version History**:
- v1.0.0 (December 2025): Initial specification draft
```
