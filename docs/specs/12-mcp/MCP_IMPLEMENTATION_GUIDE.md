# SuperCheck MCP Implementation Guide

## Overview

This guide provides step-by-step instructions for implementing the SuperCheck MCP Server, enabling AI assistants to interact with the SuperCheck testing and monitoring platform.

**Key Design Principles**:

- **Read-First**: Prioritize read operations; write operations limited to safe creates
- **No Destructive Actions**: Delete and update operations are excluded
- **RBAC-Aware**: All operations respect SuperCheck's role-based permissions
- **User-Identified**: API keys are tied to specific users for audit and permissions

---

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- npm or yarn
- Access to a SuperCheck instance
- SuperCheck API key (generated from SuperCheck UI)

### Installation

```bash
# Clone the repository (or create new)
git clone https://github.com/supercheck-io/mcp-server.git
cd mcp-server

# Install dependencies
npm install

# Build
npm run build

# Run locally
npm start
```

---

## 📦 Dependencies

### Core Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.0",
    "axios": "^1.7.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/node": "^20.0.0",
    "vitest": "^2.0.0",
    "tsx": "^4.0.0"
  }
}
```

### Package.json Configuration

```json
{
  "name": "@supercheck/mcp-server",
  "version": "1.0.0",
  "description": "MCP Server for SuperCheck Testing Platform",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "supercheck-mcp": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "test": "vitest",
    "lint": "eslint src/",
    "prepublishOnly": "npm run build"
  },
  "files": ["dist", "README.md"],
  "keywords": ["mcp", "supercheck", "testing", "monitoring", "playwright"],
  "license": "MIT"
}
```

---

## 🏗️ Core Implementation

### 1. Entry Point (`src/index.ts`)

```typescript
#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SuperCheckMcpServer } from "./server.js";
import { loadConfig } from "./config.js";
import { logger } from "./lib/logger.js";

async function main() {
  try {
    const config = loadConfig();

    logger.info("Starting SuperCheck MCP Server", {
      version: process.env.npm_package_version,
    });

    const server = new SuperCheckMcpServer(config);
    const transport = new StdioServerTransport();

    await server.connect(transport);

    logger.info("SuperCheck MCP Server started successfully");
  } catch (error) {
    logger.error("Failed to start MCP server", { error });
    process.exit(1);
  }
}

main();
```

### 2. Server Setup (`src/server.ts`)

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SuperCheckConfig } from "./config.js";
import { SuperCheckApiClient } from "./lib/api-client.js";
import { registerTestTools } from "./tools/tests.js";
import { registerMonitorTools } from "./tools/monitors.js";
import { registerJobTools } from "./tools/jobs.js";
import { registerAlertTools } from "./tools/alerts.js";
import { registerAITools } from "./tools/ai.js";
import { registerDashboardTools } from "./tools/dashboard.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";

export class SuperCheckMcpServer {
  private server: McpServer;
  private apiClient: SuperCheckApiClient;

  constructor(private config: SuperCheckConfig) {
    this.server = new McpServer({
      name: "SuperCheck MCP Server",
      version: "1.0.0",
    });

    this.apiClient = new SuperCheckApiClient(config);
    this.registerAllTools();
    this.registerAllResources();
    this.registerAllPrompts();
  }

  private registerAllTools() {
    registerTestTools(this.server, this.apiClient);
    registerMonitorTools(this.server, this.apiClient);
    registerJobTools(this.server, this.apiClient);
    registerAlertTools(this.server, this.apiClient);
    registerAITools(this.server, this.apiClient);
    registerDashboardTools(this.server, this.apiClient);
  }

  private registerAllResources() {
    registerResources(this.server, this.apiClient);
  }

  private registerAllPrompts() {
    registerPrompts(this.server);
  }

  public getInstance(): McpServer {
    return this.server;
  }

  public async connect(transport: any) {
    await this.server.connect(transport);
  }
}
```

### 3. Configuration (`src/config.ts`)

```typescript
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const ConfigSchema = z.object({
  supercheckUrl: z.string().url(),
  apiKey: z.string().min(1),
  projectId: z.string().optional(),
  organizationId: z.string().optional(),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type SuperCheckConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(): SuperCheckConfig {
  const config = {
    supercheckUrl: process.env.SUPERCHECK_URL,
    apiKey: process.env.SUPERCHECK_API_KEY,
    projectId: process.env.SUPERCHECK_PROJECT_ID,
    organizationId: process.env.SUPERCHECK_ORGANIZATION_ID,
    logLevel: process.env.SUPERCHECK_LOG_LEVEL || "info",
  };

  const result = ConfigSchema.safeParse(config);

  if (!result.success) {
    throw new Error(
      `Invalid configuration: ${result.error.issues
        .map((i) => i.message)
        .join(", ")}`
    );
  }

  return result.data;
}
```

---

## 🔐 Authentication & RBAC Implementation

### User Context from API Key

The API key identifies the user and their permissions. Here's how to extract and cache user context:

```typescript
// src/lib/auth.ts
import { SuperCheckApiClient } from "./api-client.js";
import { logger } from "./logger.js";

export interface UserContext {
  userId: string;
  email: string;
  name: string;
  role: string;
  organizationId: string;
  organizationName: string;
  permissions: string[];
  assignedProjectIds: string[];
  apiKeyScope: {
    projectId?: string;
    jobId?: string;
  };
}

export class AuthService {
  private userContext: UserContext | null = null;
  private contextFetchedAt: Date | null = null;
  private readonly CONTEXT_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private apiClient: SuperCheckApiClient) {}

  async getUserContext(): Promise<UserContext> {
    // Return cached context if still valid
    if (this.userContext && this.contextFetchedAt) {
      const age = Date.now() - this.contextFetchedAt.getTime();
      if (age < this.CONTEXT_TTL_MS) {
        return this.userContext;
      }
    }

    // Fetch fresh context
    try {
      const response = await this.apiClient.validateApiKey();

      this.userContext = {
        userId: response.user.id,
        email: response.user.email,
        name: response.user.name,
        role: response.member.role,
        organizationId: response.organization.id,
        organizationName: response.organization.name,
        permissions: response.permissions,
        assignedProjectIds: response.assignedProjectIds || [],
        apiKeyScope: {
          projectId: response.apiKey.projectId,
          jobId: response.apiKey.jobId,
        },
      };
      this.contextFetchedAt = new Date();

      logger.info("User context loaded", {
        userId: this.userContext.userId,
        role: this.userContext.role,
      });

      return this.userContext;
    } catch (error) {
      logger.error("Failed to validate API key", { error });
      throw new Error("Invalid API key or authentication failed");
    }
  }

  async hasPermission(
    resource: string,
    action: string,
    projectId?: string
  ): Promise<boolean> {
    const context = await this.getUserContext();

    // Super admin has all permissions
    if (context.role === "SUPER_ADMIN") {
      return true;
    }

    // Check if the required permission exists
    const requiredPermission = `${resource}:${action}`;
    if (!context.permissions.includes(requiredPermission)) {
      return false;
    }

    // For project-scoped roles, check project access
    if (
      projectId &&
      ["PROJECT_ADMIN", "PROJECT_EDITOR"].includes(context.role)
    ) {
      // These roles can only access assigned projects (except for view)
      if (
        action !== "view" &&
        !context.assignedProjectIds.includes(projectId)
      ) {
        return false;
      }
    }

    // Check API key scope restrictions
    if (context.apiKeyScope.projectId && projectId) {
      if (context.apiKeyScope.projectId !== projectId) {
        return false;
      }
    }

    return true;
  }

  async requirePermission(
    resource: string,
    action: string,
    projectId?: string
  ): Promise<void> {
    const hasAccess = await this.hasPermission(resource, action, projectId);
    if (!hasAccess) {
      const context = await this.getUserContext();
      throw new PermissionDeniedError(
        `User ${context.email} (role: ${
          context.role
        }) does not have ${resource}:${action} permission${
          projectId ? ` for project ${projectId}` : ""
        }`
      );
    }
  }
}

export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}
```

### Permission-Aware Tools

Each tool should check permissions before executing:

```typescript
// src/tools/tests.ts (updated with permission checks)
export function registerTestTools(
  server: McpServer,
  apiClient: SuperCheckApiClient,
  authService: AuthService
) {
  server.tool(
    "listTests",
    "List all tests in the project with optional filters",
    {
      projectId: z.string().optional().describe("Project ID to filter tests"),
      tags: z.array(z.string()).optional().describe("Filter by tags"),
      limit: z.number().optional().default(20).describe("Maximum results"),
    },
    async (args): Promise<CallToolResult> => {
      try {
        // Check permission
        await authService.requirePermission("test", "view", args.projectId);

        const tests = await apiClient.listTests(args);
        return {
          content: [{ type: "text", text: formatTestList(tests) }],
        };
      } catch (error) {
        return handleToolError("listTests", error);
      }
    }
  );

  server.tool(
    "executeTest",
    "Run a test immediately",
    {
      testId: z.string().describe("The test ID to execute"),
      variables: z
        .record(z.string())
        .optional()
        .describe("Environment variables"),
    },
    async (args): Promise<CallToolResult> => {
      try {
        // Get test to check project
        const test = await apiClient.getTest(args.testId);

        // Check execute permission for the test's project
        await authService.requirePermission("test", "run", test.projectId);

        const result = await apiClient.executeTest(args.testId, args.variables);
        return {
          content: [
            {
              type: "text",
              text: `🚀 Test execution started!\n\nRun ID: ${result.runId}\nStatus: ${result.status}`,
            },
          ],
        };
      } catch (error) {
        return handleToolError("executeTest", error);
      }
    }
  );

  // Create is allowed (safe operation)
  server.tool(
    "createTest",
    "Create a new Playwright or K6 test",
    {
      name: z.string().describe("Test name"),
      type: z.enum(["playwright", "k6"]).describe("Test type"),
      script: z
        .string()
        .max(1_000_000)
        .describe("Test script content (max 1MB)"),
      projectId: z.string().describe("Project ID"),
      tags: z.array(z.string()).optional().describe("Tags for the test"),
    },
    async (args): Promise<CallToolResult> => {
      try {
        // Check create permission
        await authService.requirePermission("test", "create", args.projectId);

        const test = await apiClient.createTest(args);
        return {
          content: [
            {
              type: "text",
              text: `✅ Test "${test.name}" created successfully!\n\nTest ID: ${test.id}\nType: ${test.type}\nProject: ${test.projectId}`,
            },
          ],
        };
      } catch (error) {
        return handleToolError("createTest", error);
      }
    }
  );

  // NOTE: updateTest and deleteTest are intentionally NOT implemented
  // These destructive actions must be performed in the SuperCheck UI
}
```

### Error Handling for Permission Issues

```typescript
// src/lib/errors.ts
export function handleToolError(
  toolName: string,
  error: unknown
): CallToolResult {
  const logger = getLogger();

  if (error instanceof PermissionDeniedError) {
    logger.warn(`Permission denied for ${toolName}`, { error: error.message });
    return {
      content: [
        {
          type: "text",
          text: `❌ Permission denied: ${error.message}\n\nYour API key doesn't have the required permissions for this action. Please check your role and project assignments in the SuperCheck UI.`,
        },
      ],
      isError: true,
    };
  }

  if (error instanceof ApiKeyError) {
    logger.error(`API key error for ${toolName}`, { error: error.message });
    return {
      content: [
        {
          type: "text",
          text: `❌ Authentication error: ${error.message}\n\nPlease verify your SUPERCHECK_API_KEY is valid and not expired.`,
        },
      ],
      isError: true,
    };
  }

  // Generic error handling
  const message = error instanceof Error ? error.message : "Unknown error";
  logger.error(`Tool ${toolName} failed`, { error });
  return {
    content: [{ type: "text", text: `❌ Failed to ${toolName}: ${message}` }],
    isError: true,
  };
}
```

---

### 4. API Client (`src/lib/api-client.ts`)

```typescript
import axios, { AxiosInstance, AxiosError } from "axios";
import { SuperCheckConfig } from "../config.js";
import { logger } from "./logger.js";

export class ApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiKeyError";
  }
}

export class SuperCheckApiClient {
  private client: AxiosInstance;

  constructor(private config: SuperCheckConfig) {
    this.client = axios.create({
      baseURL: config.supercheckUrl,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });

    this.setupInterceptors();
  }

  private setupInterceptors() {
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        logger.error("API request failed", {
          url: error.config?.url,
          status: error.response?.status,
          message: error.message,
        });
        throw this.formatError(error);
      }
    );
  }

  private formatError(error: AxiosError): Error {
    if (error.response?.status === 401) {
      return new ApiKeyError("Authentication failed. Check your API key.");
    }
    if (error.response?.status === 403) {
      return new PermissionDeniedError(
        "Permission denied. Check your API key permissions."
      );
    }
    if (error.response?.status === 404) {
      return new Error("Resource not found.");
    }
    if (error.response?.status === 429) {
      return new Error("Rate limit exceeded. Please wait before retrying.");
    }
    return new Error(error.message || "API request failed");
  }

  // Authentication
  async validateApiKey() {
    const response = await this.client.post("/api/auth/validate-key");
    return response.data;
  }

  // Test API methods
  async listTests(params: {
    projectId?: string;
    tags?: string[];
    limit?: number;
  }) {
    const response = await this.client.get("/api/tests", { params });
    return response.data;
  }

  async getTest(testId: string) {
    const response = await this.client.get(`/api/tests/${testId}`);
    return response.data;
  }

  async createTest(data: {
    name: string;
    type: "playwright" | "k6";
    script: string;
    projectId: string;
    tags?: string[];
  }) {
    const response = await this.client.post("/api/tests", data);
    return response.data;
  }

  async updateTest(
    testId: string,
    data: Partial<{
      name: string;
      script: string;
      tags: string[];
    }>
  ) {
    const response = await this.client.patch(`/api/tests/${testId}`, data);
    return response.data;
  }

  async deleteTest(testId: string) {
    await this.client.delete(`/api/tests/${testId}`);
  }

  async executeTest(testId: string, variables?: Record<string, string>) {
    const response = await this.client.post(`/api/tests/${testId}/execute`, {
      variables,
    });
    return response.data;
  }

  async getTestResults(
    testId: string,
    params?: { limit?: number; status?: string }
  ) {
    const response = await this.client.get(`/api/runs`, {
      params: { ...params, testId },
    });
    return response.data;
  }

  // Monitor API methods
  async listMonitors(params?: {
    projectId?: string;
    status?: string;
    type?: string;
  }) {
    const response = await this.client.get("/api/monitors", { params });
    return response.data;
  }

  async getMonitor(monitorId: string) {
    const response = await this.client.get(`/api/monitors/${monitorId}`);
    return response.data;
  }

  async getMonitorStatus(monitorId: string) {
    const response = await this.client.get(`/api/monitors/${monitorId}/status`);
    return response.data;
  }

  async getMonitorResults(
    monitorId: string,
    params?: { limit?: number; location?: string }
  ) {
    const response = await this.client.get(
      `/api/monitors/${monitorId}/results`,
      { params }
    );
    return response.data;
  }

  async createMonitor(data: {
    name: string;
    type: string;
    config: Record<string, any>;
    schedule: string;
    projectId: string;
  }) {
    const response = await this.client.post("/api/monitors", data);
    return response.data;
  }

  async updateMonitor(
    monitorId: string,
    data: Partial<{
      name: string;
      config: Record<string, any>;
      enabled: boolean;
    }>
  ) {
    const response = await this.client.patch(
      `/api/monitors/${monitorId}`,
      data
    );
    return response.data;
  }

  // Job API methods
  async listJobs(params?: { projectId?: string; status?: string }) {
    const response = await this.client.get("/api/jobs", { params });
    return response.data;
  }

  async triggerJob(jobId: string) {
    const response = await this.client.post(`/api/jobs/${jobId}/trigger`);
    return response.data;
  }

  // Dashboard API methods
  async getDashboard(projectId?: string) {
    const params = projectId ? { projectId } : {};
    const response = await this.client.get("/api/dashboard", { params });
    return response.data;
  }

  // Alert API methods
  async getAlertHistory(params?: { monitorId?: string; limit?: number }) {
    const response = await this.client.get("/api/alerts/history", { params });
    return response.data;
  }

  async listAlerts(params?: {
    projectId?: string;
    severity?: string;
    status?: string;
  }) {
    const response = await this.client.get("/api/alerts", { params });
    return response.data;
  }

  // AI API methods
  async analyzeFailure(runId: string) {
    const response = await this.client.post(`/api/ai/fix-test`, { runId });
    return response.data;
  }

  async validateScript(script: string, type: "playwright" | "k6") {
    const response = await this.client.post("/api/validate-script", {
      script,
      type,
    });
    return response.data;
  }

  // Billing API methods
  async getSubscriptionStatus() {
    const response = await this.client.get("/api/billing/subscription");
    return response.data;
  }

  async getUsageStats(params?: { periodStart?: string; periodEnd?: string }) {
    const response = await this.client.get("/api/billing/usage", { params });
    return response.data;
  }

  async getSpendingLimits() {
    const response = await this.client.get("/api/billing/spending-limits");
    return response.data;
  }

  // Status Page API methods (read-only)
  async listStatusPages(params?: { projectId?: string }) {
    const response = await this.client.get("/api/status-pages", { params });
    return response.data;
  }

  async getStatusPageHealth(statusPageId: string) {
    const response = await this.client.get(
      `/api/status-pages/${statusPageId}/health`
    );
    return response.data;
  }
}
```

---

## 💰 Billing Tools Implementation

### Billing Tools (`src/tools/billing.ts`)

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { SuperCheckApiClient } from "../lib/api-client.js";
import { AuthService } from "../lib/auth.js";
import { handleToolError } from "../lib/errors.js";

export function registerBillingTools(
  server: McpServer,
  apiClient: SuperCheckApiClient,
  authService: AuthService
) {
  // Get Subscription Status
  server.tool(
    "getSubscriptionStatus",
    "Get current subscription plan and status",
    {},
    async (): Promise<CallToolResult> => {
      try {
        await authService.requirePermission("organization", "view");

        const subscription = await apiClient.getSubscriptionStatus();
        return {
          content: [
            { type: "text", text: formatSubscriptionStatus(subscription) },
          ],
        };
      } catch (error) {
        return handleToolError("getSubscriptionStatus", error);
      }
    }
  );

  // Get Usage Statistics
  server.tool(
    "getUsageStats",
    "Get usage statistics for the billing period",
    {
      periodStart: z.string().optional().describe("Start date (ISO 8601)"),
      periodEnd: z.string().optional().describe("End date (ISO 8601)"),
    },
    async (args): Promise<CallToolResult> => {
      try {
        await authService.requirePermission("organization", "view");

        const usage = await apiClient.getUsageStats(args);
        return {
          content: [{ type: "text", text: formatUsageStats(usage) }],
        };
      } catch (error) {
        return handleToolError("getUsageStats", error);
      }
    }
  );

  // Get Spending Limits
  server.tool(
    "getSpendingLimits",
    "Get configured spending limits",
    {},
    async (): Promise<CallToolResult> => {
      try {
        await authService.requirePermission("organization", "view");

        const limits = await apiClient.getSpendingLimits();
        return {
          content: [{ type: "text", text: formatSpendingLimits(limits) }],
        };
      } catch (error) {
        return handleToolError("getSpendingLimits", error);
      }
    }
  );
}

function formatSubscriptionStatus(sub: any): string {
  const planEmoji =
    {
      free: "🆓",
      pro: "⭐",
      team: "👥",
      enterprise: "🏢",
    }[sub.plan] || "📦";

  const statusEmoji =
    sub.status === "active"
      ? "✅"
      : sub.status === "trialing"
      ? "🔄"
      : sub.status === "past_due"
      ? "⚠️"
      : "❌";

  return `
${planEmoji} **Subscription Status**

**Plan**: ${sub.plan.charAt(0).toUpperCase() + sub.plan.slice(1)}
**Status**: ${statusEmoji} ${sub.status}
**Period**: ${new Date(
    sub.currentPeriod.start
  ).toLocaleDateString()} - ${new Date(
    sub.currentPeriod.end
  ).toLocaleDateString()}

**Limits**:
- Tests per month: ${sub.limits.testsPerMonth.toLocaleString()}
- Monitors: ${sub.limits.monitorsPerMonth.toLocaleString()}
- Team members: ${sub.limits.teamMembers}
- Data retention: ${sub.limits.retentionDays} days

**Features**:
${sub.features.aiFixEnabled ? "✅" : "❌"} AI Fix Suggestions
${sub.features.multiLocation ? "✅" : "❌"} Multi-location Monitoring
${sub.features.ssoEnabled ? "✅" : "❌"} SSO
${sub.features.customDomains ? "✅" : "❌"} Custom Domains
`.trim();
}

function formatUsageStats(usage: any): string {
  const formatBar = (used: number, limit: number): string => {
    const percentage = Math.min((used / limit) * 100, 100);
    const filled = Math.round(percentage / 10);
    const empty = 10 - filled;
    return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${percentage.toFixed(
      0
    )}%`;
  };

  return `
📊 **Usage Statistics**

**Period**: ${new Date(usage.period.start).toLocaleDateString()} - ${new Date(
    usage.period.end
  ).toLocaleDateString()}

**Test Executions**:
${formatBar(usage.usage.testExecutions.used, usage.usage.testExecutions.limit)}
${usage.usage.testExecutions.used.toLocaleString()} / ${usage.usage.testExecutions.limit.toLocaleString()}

**Monitor Checks**:
${formatBar(usage.usage.monitorChecks.used, usage.usage.monitorChecks.limit)}
${usage.usage.monitorChecks.used.toLocaleString()} / ${usage.usage.monitorChecks.limit.toLocaleString()}

**AI Fix Requests**:
${formatBar(usage.usage.aiFixRequests.used, usage.usage.aiFixRequests.limit)}
${usage.usage.aiFixRequests.used} / ${usage.usage.aiFixRequests.limit}

**Spending**:
- Current: $${(usage.spending.current / 100).toFixed(2)}
- Limit: ${
    usage.spending.limit
      ? `$${(usage.spending.limit / 100).toFixed(2)}`
      : "No limit"
  }
- Projected: $${(usage.spending.projectedMonthEnd / 100).toFixed(2)}
`.trim();
}

function formatSpendingLimits(limits: any): string {
  const statusIcon = limits.enabled ? "✅" : "❌";
  const percentUsed = limits.percentUsed || 0;
  const warningLevel =
    percentUsed >= 90
      ? "🔴"
      : percentUsed >= 80
      ? "🟡"
      : percentUsed >= 50
      ? "🟠"
      : "🟢";

  return `
💰 **Spending Limits**

**Status**: ${statusIcon} ${limits.enabled ? "Enabled" : "Disabled"}
${
  limits.enabled
    ? `**Monthly Limit**: $${(limits.monthlyLimitCents / 100).toFixed(2)}`
    : ""
}
${
  limits.enabled
    ? `**Current Spending**: $${(limits.currentSpendingCents / 100).toFixed(
        2
      )} (${percentUsed.toFixed(1)}%)`
    : ""
}
${
  limits.enabled
    ? `**Behavior on Limit**: ${
        limits.hardStopOnLimit ? "🛑 Hard stop" : "⚠️ Warning only"
      }`
    : ""
}

${warningLevel} **Spending Status**: ${percentUsed.toFixed(1)}% of limit used

**Notification Thresholds**:
${limits.notifications.at50Percent ? "✅" : "❌"} Alert at 50%
${limits.notifications.at80Percent ? "✅" : "❌"} Alert at 80%
${limits.notifications.at90Percent ? "✅" : "❌"} Alert at 90%
${limits.notifications.at100Percent ? "✅" : "❌"} Alert at 100%
`.trim();
}
```

---

## 🔧 Tool Implementation

### Test Tools (`src/tools/tests.ts`)

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { SuperCheckApiClient } from "../lib/api-client.js";
import { logger } from "../lib/logger.js";

export function registerTestTools(
  server: McpServer,
  apiClient: SuperCheckApiClient
) {
  // List Tests
  server.tool(
    "listTests",
    "List all tests in the project with optional filters",
    {
      projectId: z.string().optional().describe("Project ID to filter tests"),
      tags: z.array(z.string()).optional().describe("Filter by tags"),
      limit: z.number().optional().default(20).describe("Maximum results"),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const tests = await apiClient.listTests(args);
        return {
          content: [
            {
              type: "text",
              text: formatTestList(tests),
            },
          ],
        };
      } catch (error) {
        return handleToolError("listTests", error);
      }
    }
  );

  // Get Test
  server.tool(
    "getTest",
    "Get detailed information about a specific test",
    {
      testId: z.string().describe("The test ID"),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const test = await apiClient.getTest(args.testId);
        return {
          content: [
            {
              type: "text",
              text: formatTestDetails(test),
            },
          ],
        };
      } catch (error) {
        return handleToolError("getTest", error);
      }
    }
  );

  // Create Test
  server.tool(
    "createTest",
    "Create a new Playwright or K6 test",
    {
      name: z.string().describe("Test name"),
      type: z.enum(["playwright", "k6"]).describe("Test type"),
      script: z.string().describe("Test script content"),
      projectId: z.string().describe("Project ID"),
      tags: z.array(z.string()).optional().describe("Tags for the test"),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const test = await apiClient.createTest(args);
        return {
          content: [
            {
              type: "text",
              text: `✅ Test "${test.name}" created successfully!\n\nTest ID: ${test.id}\nType: ${test.type}\nProject: ${test.projectId}`,
            },
          ],
        };
      } catch (error) {
        return handleToolError("createTest", error);
      }
    }
  );

  // Execute Test
  server.tool(
    "executeTest",
    "Run a test immediately",
    {
      testId: z.string().describe("The test ID to execute"),
      variables: z
        .record(z.string())
        .optional()
        .describe("Environment variables"),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const result = await apiClient.executeTest(args.testId, args.variables);
        return {
          content: [
            {
              type: "text",
              text: `🚀 Test execution started!\n\nRun ID: ${result.runId}\nStatus: ${result.status}\n\nUse getTestResults to check the results.`,
            },
          ],
        };
      } catch (error) {
        return handleToolError("executeTest", error);
      }
    }
  );

  // Get Test Results
  server.tool(
    "getTestResults",
    "Get results from test runs",
    {
      testId: z.string().describe("The test ID"),
      limit: z.number().optional().default(10).describe("Number of results"),
      status: z.string().optional().describe("Filter by status"),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const results = await apiClient.getTestResults(args.testId, {
          limit: args.limit,
          status: args.status,
        });
        return {
          content: [
            {
              type: "text",
              text: formatTestResults(results),
            },
          ],
        };
      } catch (error) {
        return handleToolError("getTestResults", error);
      }
    }
  );
}

// Helper functions
function formatTestList(tests: any[]): string {
  if (!tests.length) {
    return "No tests found.";
  }

  const lines = ["📋 **Tests**\n"];
  for (const test of tests) {
    const status =
      test.lastRunStatus === "passed"
        ? "✅"
        : test.lastRunStatus === "failed"
        ? "❌"
        : "⏳";
    lines.push(`${status} **${test.name}** (ID: ${test.id})`);
    lines.push(
      `   Type: ${test.type} | Tags: ${test.tags?.join(", ") || "none"}`
    );
  }
  return lines.join("\n");
}

function formatTestDetails(test: any): string {
  return `
📝 **Test Details**

**Name**: ${test.name}
**ID**: ${test.id}
**Type**: ${test.type}
**Project**: ${test.projectId}
**Tags**: ${test.tags?.join(", ") || "none"}
**Created**: ${new Date(test.createdAt).toLocaleString()}
**Last Run**: ${
    test.lastRunAt ? new Date(test.lastRunAt).toLocaleString() : "Never"
  }
**Last Status**: ${test.lastRunStatus || "N/A"}

**Script Preview**:
\`\`\`${test.type === "playwright" ? "typescript" : "javascript"}
${test.script?.substring(0, 500)}${test.script?.length > 500 ? "..." : ""}
\`\`\`
`.trim();
}

function formatTestResults(results: any[]): string {
  if (!results.length) {
    return "No test results found.";
  }

  const lines = ["📊 **Test Results**\n"];
  for (const result of results) {
    const status =
      result.status === "passed"
        ? "✅"
        : result.status === "failed"
        ? "❌"
        : "⏳";
    lines.push(`${status} **Run ${result.id}**`);
    lines.push(`   Status: ${result.status} | Duration: ${result.duration}ms`);
    lines.push(`   Started: ${new Date(result.startedAt).toLocaleString()}`);
    if (result.error) {
      lines.push(`   Error: ${result.error.substring(0, 100)}...`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function handleToolError(toolName: string, error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : "Unknown error";
  logger.error(`Tool ${toolName} failed`, { error });
  return {
    content: [
      {
        type: "text",
        text: `❌ Failed to ${toolName}: ${message}`,
      },
    ],
    isError: true,
  };
}
```

### Monitor Tools (`src/tools/monitors.ts`)

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { SuperCheckApiClient } from "../lib/api-client.js";
import { logger } from "../lib/logger.js";

export function registerMonitorTools(
  server: McpServer,
  apiClient: SuperCheckApiClient
) {
  // List Monitors
  server.tool(
    "listMonitors",
    "List all monitors in the project",
    {
      projectId: z.string().optional().describe("Project ID"),
      status: z
        .enum(["up", "down", "degraded"])
        .optional()
        .describe("Filter by status"),
      type: z.string().optional().describe("Filter by monitor type"),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const monitors = await apiClient.listMonitors(args);
        return {
          content: [
            {
              type: "text",
              text: formatMonitorList(monitors),
            },
          ],
        };
      } catch (error) {
        return handleToolError("listMonitors", error);
      }
    }
  );

  // Get Monitor Status
  server.tool(
    "getMonitorStatus",
    "Get current status of a monitor",
    {
      monitorId: z.string().describe("The monitor ID"),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const status = await apiClient.getMonitorStatus(args.monitorId);
        return {
          content: [
            {
              type: "text",
              text: formatMonitorStatus(status),
            },
          ],
        };
      } catch (error) {
        return handleToolError("getMonitorStatus", error);
      }
    }
  );

  // Get Monitor Results
  server.tool(
    "getMonitorResults",
    "Get recent check results for a monitor",
    {
      monitorId: z.string().describe("The monitor ID"),
      limit: z.number().optional().default(20).describe("Number of results"),
      location: z.string().optional().describe("Filter by location"),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const results = await apiClient.getMonitorResults(args.monitorId, {
          limit: args.limit,
          location: args.location,
        });
        return {
          content: [
            {
              type: "text",
              text: formatMonitorResults(results),
            },
          ],
        };
      } catch (error) {
        return handleToolError("getMonitorResults", error);
      }
    }
  );

  // Create Monitor
  server.tool(
    "createMonitor",
    "Create a new monitor",
    {
      name: z.string().describe("Monitor name"),
      type: z.enum(["http", "ping", "port", "ssl"]).describe("Monitor type"),
      config: z
        .object({
          url: z.string().optional(),
          host: z.string().optional(),
          port: z.number().optional(),
          method: z.string().optional(),
          expectedStatus: z.number().optional(),
          timeout: z.number().optional(),
        })
        .describe("Monitor configuration"),
      schedule: z.string().describe("Check interval (e.g., '5m', '1h')"),
      projectId: z.string().describe("Project ID"),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const monitor = await apiClient.createMonitor(args);
        return {
          content: [
            {
              type: "text",
              text: `✅ Monitor "${monitor.name}" created successfully!\n\nMonitor ID: ${monitor.id}\nType: ${monitor.type}\nSchedule: ${monitor.schedule}`,
            },
          ],
        };
      } catch (error) {
        return handleToolError("createMonitor", error);
      }
    }
  );
}

function formatMonitorList(monitors: any[]): string {
  if (!monitors.length) {
    return "No monitors found.";
  }

  const lines = ["📡 **Monitors**\n"];
  for (const monitor of monitors) {
    const status =
      monitor.status === "up" ? "🟢" : monitor.status === "down" ? "🔴" : "🟡";
    lines.push(`${status} **${monitor.name}** (ID: ${monitor.id})`);
    lines.push(`   Type: ${monitor.type} | Schedule: ${monitor.schedule}`);
  }
  return lines.join("\n");
}

function formatMonitorStatus(status: any): string {
  const statusIcon =
    status.status === "up" ? "🟢" : status.status === "down" ? "🔴" : "🟡";

  return `
${statusIcon} **Monitor Status**

**Name**: ${status.name}
**Status**: ${status.status.toUpperCase()}
**Uptime**: ${status.uptime}%
**Last Check**: ${new Date(status.lastCheckAt).toLocaleString()}
**Response Time**: ${status.responseTime}ms

**Location Status**:
${
  status.locations
    ?.map((loc: any) => `  - ${loc.name}: ${loc.status === "up" ? "🟢" : "🔴"}`)
    .join("\n") || "N/A"
}
`.trim();
}

function formatMonitorResults(results: any[]): string {
  if (!results.length) {
    return "No monitor results found.";
  }

  const lines = ["📊 **Monitor Results**\n"];
  for (const result of results.slice(0, 10)) {
    const status = result.success ? "🟢" : "🔴";
    lines.push(`${status} ${new Date(result.checkedAt).toLocaleString()}`);
    lines.push(
      `   Response: ${result.responseTime}ms | Location: ${result.location}`
    );
    if (!result.success && result.error) {
      lines.push(`   Error: ${result.error}`);
    }
  }
  return lines.join("\n");
}

function handleToolError(toolName: string, error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : "Unknown error";
  logger.error(`Tool ${toolName} failed`, { error });
  return {
    content: [{ type: "text", text: `❌ Failed to ${toolName}: ${message}` }],
    isError: true,
  };
}
```

---

## 📚 Resources Implementation

### Resource Registration (`src/resources/index.ts`)

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SuperCheckApiClient } from "../lib/api-client.js";

export function registerResources(
  server: McpServer,
  apiClient: SuperCheckApiClient
) {
  // Test Resource
  server.resource(
    "supercheck://tests/{testId}",
    "Get test information",
    async (uri) => {
      const testId = uri.pathname.split("/").pop();
      if (!testId) throw new Error("Invalid test ID");

      const test = await apiClient.getTest(testId);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(test, null, 2),
          },
        ],
      };
    }
  );

  // Dashboard Resource
  server.resource(
    "supercheck://dashboard",
    "Get dashboard summary",
    async () => {
      const dashboard = await apiClient.getDashboard();
      return {
        contents: [
          {
            uri: "supercheck://dashboard",
            mimeType: "application/json",
            text: JSON.stringify(dashboard, null, 2),
          },
        ],
      };
    }
  );

  // Monitor Resource
  server.resource(
    "supercheck://monitors/{monitorId}",
    "Get monitor information",
    async (uri) => {
      const monitorId = uri.pathname.split("/").pop();
      if (!monitorId) throw new Error("Invalid monitor ID");

      const monitor = await apiClient.getMonitor(monitorId);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(monitor, null, 2),
          },
        ],
      };
    }
  );
}
```

---

## 💬 Prompts Implementation

### Prompt Registration (`src/prompts/index.ts`)

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer) {
  // Create Playwright Test Prompt
  server.prompt(
    "create-playwright-test",
    {
      description: z
        .string()
        .describe("Description of what the test should do"),
      url: z.string().optional().describe("Target URL to test"),
    },
    async ({ description, url }) => {
      return {
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: `I'll help you create a Playwright test. Based on your description: "${description}"
              
Here's a template to get started:

\`\`\`typescript
import { test, expect } from '@playwright/test';

test('${description}', async ({ page }) => {
  ${url ? `await page.goto('${url}');` : "// Navigate to your target URL"}
  
  // Add your test steps here
  // Example: await page.click('button');
  // Example: await expect(page.locator('h1')).toBeVisible();
});
\`\`\`

Would you like me to:
1. Create this test in SuperCheck using the createTest tool?
2. Add more specific test steps based on your requirements?
3. Run this test to verify it works?`,
            },
          },
        ],
      };
    }
  );

  // Debug Test Failure Prompt
  server.prompt(
    "debug-test-failure",
    {
      testId: z.string().describe("The failing test ID"),
      runId: z.string().optional().describe("Specific run ID to analyze"),
    },
    async ({ testId, runId }) => {
      return {
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: `I'll help you debug the test failure. Let me:

1. First, get the test details using getTest with testId: ${testId}
2. Then fetch the recent results using getTestResults
3. If needed, analyze the failure using analyzeTestFailure

After gathering this information, I'll:
- Identify the root cause
- Suggest potential fixes
- Help you update the test if needed

Should I proceed with this analysis?`,
            },
          },
        ],
      };
    }
  );

  // Setup Monitor Prompt
  server.prompt(
    "setup-monitor",
    {
      type: z.enum(["http", "ping", "port", "ssl"]).describe("Monitor type"),
      target: z.string().describe("URL or host to monitor"),
    },
    async ({ type, target }) => {
      const configs = {
        http: `URL: ${target}\nMethod: GET\nExpected Status: 200\nTimeout: 30s`,
        ping: `Host: ${target}\nPacket Count: 4\nTimeout: 5s`,
        port: `Host: ${target.split(":")[0]}\nPort: ${
          target.split(":")[1] || 443
        }`,
        ssl: `URL: ${target}\nExpiry Threshold: 30 days`,
      };

      return {
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: `I'll help you set up a ${type.toUpperCase()} monitor for ${target}.

**Recommended Configuration:**
${configs[type]}

**Schedule Options:**
- Every 1 minute (for critical services)
- Every 5 minutes (standard monitoring)
- Every 15 minutes (low-priority checks)

**Locations:**
- US East (default)
- EU Central
- Asia Pacific

Would you like me to create this monitor with the createMonitor tool?`,
            },
          },
        ],
      };
    }
  );
}
```

---

## 🧪 Testing

### Test Setup (`tests/setup.ts`)

```typescript
import { vi } from "vitest";

// Mock the API client
export const mockApiClient = {
  listTests: vi.fn(),
  getTest: vi.fn(),
  createTest: vi.fn(),
  executeTest: vi.fn(),
  getTestResults: vi.fn(),
  listMonitors: vi.fn(),
  getMonitor: vi.fn(),
  getMonitorStatus: vi.fn(),
  getMonitorResults: vi.fn(),
  getDashboard: vi.fn(),
};

// Reset mocks before each test
beforeEach(() => {
  vi.resetAllMocks();
});
```

### Tool Tests (`tests/tools/tests.test.ts`)

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTestTools } from "../../src/tools/tests.js";
import { mockApiClient } from "../setup.js";

describe("Test Tools", () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    registerTestTools(server, mockApiClient as any);
  });

  describe("listTests", () => {
    it("should return formatted test list", async () => {
      mockApiClient.listTests.mockResolvedValue([
        {
          id: "test_1",
          name: "Login Test",
          type: "playwright",
          lastRunStatus: "passed",
        },
        {
          id: "test_2",
          name: "Checkout Test",
          type: "playwright",
          lastRunStatus: "failed",
        },
      ]);

      const result = await server.callTool("listTests", {});

      expect(result.content[0].text).toContain("Login Test");
      expect(result.content[0].text).toContain("Checkout Test");
      expect(mockApiClient.listTests).toHaveBeenCalledTimes(1);
    });

    it("should handle empty results", async () => {
      mockApiClient.listTests.mockResolvedValue([]);

      const result = await server.callTool("listTests", {});

      expect(result.content[0].text).toBe("No tests found.");
    });
  });

  describe("executeTest", () => {
    it("should start test execution", async () => {
      mockApiClient.executeTest.mockResolvedValue({
        runId: "run_123",
        status: "running",
      });

      const result = await server.callTool("executeTest", { testId: "test_1" });

      expect(result.content[0].text).toContain("run_123");
      expect(result.content[0].text).toContain("running");
    });
  });
});
```

---

## 📖 Documentation

### README.md Template

```markdown
# @supercheck/mcp-server

MCP Server for SuperCheck Testing Platform - enables AI assistants to manage tests, monitors, and alerts.

## Installation

\`\`\`bash
npm install -g @supercheck/mcp-server
\`\`\`

## Configuration

### VS Code / Cursor

Add to \`.vscode/mcp.json\` or \`.cursor/mcp.json\`:

\`\`\`json
{
"servers": {
"supercheck": {
"command": "npx",
"args": ["-y", "@supercheck/mcp-server@latest"],
"env": {
"SUPERCHECK_URL": "https://your-instance.supercheck.io",
"SUPERCHECK_API_KEY": "your-api-key"
}
}
}
}
\`\`\`

### Claude Desktop

Add to \`claude_desktop_config.json\`:

\`\`\`json
{
"mcpServers": {
"supercheck": {
"command": "npx",
"args": ["-y", "@supercheck/mcp-server@latest"],
"env": {
"SUPERCHECK_URL": "https://your-instance.supercheck.io",
"SUPERCHECK_API_KEY": "your-api-key"
}
}
}
}
\`\`\`

## Available Tools

### Test Management

- \`listTests\` - List all tests
- \`getTest\` - Get test details
- \`createTest\` - Create a new test
- \`executeTest\` - Run a test
- \`getTestResults\` - Get test results

### Monitor Management

- \`listMonitors\` - List all monitors
- \`getMonitorStatus\` - Get monitor status
- \`getMonitorResults\` - Get check results
- \`createMonitor\` - Create a new monitor

### Dashboard

- \`getDashboardStats\` - Get project statistics

## Examples

### Create and run a test

\`\`\`
User: Create a test that checks if google.com loads

AI: I'll create a Playwright test for you...
[Uses createTest tool]

Test created! ID: test_abc123
Would you like me to run it?

User: Yes

AI: [Uses executeTest tool]
Test running... Run ID: run_xyz789
\`\`\`

## License

MIT
```

---

## 🚀 Deployment

### NPM Publishing

```bash
# Build
npm run build

# Test
npm test

# Publish
npm publish --access public
```

### Docker (Optional)

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist ./dist

ENTRYPOINT ["node", "dist/index.js"]
```

---

## 📝 Best Practices

### From Playwright MCP

1. **Clear tool naming**: Use descriptive, action-oriented names
2. **Comprehensive error messages**: Include context for debugging
3. **Session management**: Handle long-running operations properly

### From BrowserStack MCP

1. **Tool grouping**: Organize by domain (tests, monitors, etc.)
2. **Telemetry**: Track tool usage for improvement
3. **Prompts**: Provide guided workflows for complex tasks

### General MCP Best Practices

1. **Never write to stdout in STDIO mode**: Use stderr for logging
2. **Validate all inputs**: Use Zod schemas
3. **Handle errors gracefully**: Return helpful error messages
4. **Use meaningful descriptions**: Help AI understand tool purpose
5. **Implement rate limiting**: Protect against abuse
6. **Support pagination**: For list operations
7. **Provide resource URIs**: For data retrieval

---

## 📎 References

- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Specification](https://modelcontextprotocol.io/specification/latest)
- [SuperCheck API Documentation](/docs/specs/01-core/API_ROUTES_ANALYSIS.md)
