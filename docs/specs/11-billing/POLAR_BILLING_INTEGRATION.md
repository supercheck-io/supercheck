# Polar Billing Integration - Complete Guide

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Setup Guide](#setup-guide)
4. [Pricing & Plans](#pricing--plans)
5. [Architecture](#architecture)
6. [Implementation](#implementation)
7. [Hard Stop Limits](#hard-stop-limits)
8. [API Reference](#api-reference)
9. [UI Components](#ui-components)
10. [Database Schema](#database-schema)
11. [Testing](#testing)
12. [Deployment](#deployment)
13. [Troubleshooting](#troubleshooting)

---

## Overview

### Purpose

Integrate Polar.sh payment platform to provide subscription-based billing for cloud-hosted Supercheck installations while maintaining a free, unlimited self-hosted option.

### Goals

- ✅ Implement usage-based billing for Playwright minutes and K6 VU minutes
- ✅ Enforce plan limits for monitors, status pages, projects, and team members
- ✅ Provide seamless upgrade/downgrade flows
- ✅ Support self-hosted installations without billing dependencies
- ✅ Track and display real-time usage metrics
- ✅ Handle webhook events for subscription lifecycle management
- ✅ **Paid-only cloud model**: Cloud users must subscribe to Plus or Pro

### Non-Goals

- Custom enterprise pricing tiers (handled manually)
- Multi-currency support (Polar handles this)
- Annual billing (monthly only for now)
- Free tier for cloud users (self-hosted is free and unlimited)

---

## Quick Start

**For immediate setup, jump to the [Setup Guide](#setup-guide) section.**

**Key requirements:**

- Polar account with Plus/Pro products created
- Environment variables configured
- Database migration run
- Webhook endpoint configured

**Estimated setup time:** 30 minutes

---

## Setup Guide

### Prerequisites

- Polar account (production or sandbox)
- Organization created in Polar dashboard
- Plus and Pro products created in Polar

### Environment Variables

Add the following environment variables to your `.env` file:

```bash
# Self-Hosted Mode (set to 'true' for unlimited features without billing)
SELF_HOSTED=false

# Polar Configuration
POLAR_ACCESS_TOKEN=your_polar_access_token_here
POLAR_SERVER=production  # or 'sandbox' for testing
POLAR_WEBHOOK_SECRET=your_webhook_secret_here

# Product IDs from Polar Dashboard
POLAR_PLUS_PRODUCT_ID=your_plus_product_id
POLAR_PRO_PRODUCT_ID=your_pro_product_id
```

### Database Migration

Run the database migration to add subscription fields:

```bash
cd app
npm run db:migrate
```

This will:

- Add subscription fields to `organization` table
- Create `plan_limits` table with Plus/Pro/Unlimited configurations
- Seed plan limits with default values

### Polar Dashboard Setup

#### 1. Create Organization Access Token

1. Go to Polar Dashboard → Settings → Access Tokens
2. Click "Create Organization Access Token"
3. Give it a name (e.g., "Supercheck Production")
4. Copy the token and add to `POLAR_ACCESS_TOKEN`

#### 2. Create Products with Usage-Based Billing

Create two products in Polar Dashboard with overage pricing:

**Plus Product**:

- Name: "Plus"
- Price: $49/month
- Description: "Advanced monitoring with 3,000 Playwright minutes, 20,000 K6 VU minutes"
- **Billing Mode**: "Usage-based" (enable overage billing)
- **Included Usage**: 3,000 playwright minutes, 20,000 K6 VU minutes

**Pro Product**:

- Name: "Pro"
- Price: $199/month
- Description: "Professional monitoring with 10,000 Playwright minutes, 75,000 K6 VU minutes"
- **Billing Mode**: "Usage-based" (enable overage billing)
- **Included Usage**: 10,000 playwright minutes, 75,000 K6 VU minutes

Copy the Product IDs from URL or product settings to your environment variables.

#### 3. Configure Usage Meters for Overage Reporting

For usage-based overage billing, create meters in Polar:

1. Go to Polar Dashboard → Products → Meters
2. Click "Create Meter" for each usage type

---

**Meter 1: Playwright Execution Minutes**

| Field                                | Value                          |
| ------------------------------------ | ------------------------------ |
| **Name**                             | `Playwright Execution Minutes` |
| **Filters → Condition group**        |                                |
| - First dropdown (Name)              | `Name`                         |
| - Second dropdown                    | `equals`                       |
| - Third dropdown (Select event name) | `playwright_minutes`           |
| **Aggregation**                      | Select **Sum**                 |
| **Over property**                    | `value`                        |

---

**Meter 2: K6 Virtual User Minutes**

| Field                                | Value                     |
| ------------------------------------ | ------------------------- |
| **Name**                             | `K6 Virtual User Minutes` |
| **Filters → Condition group**        |                           |
| - First dropdown (Name)              | `Name`                    |
| - Second dropdown                    | `equals`                  |
| - Third dropdown (Select event name) | `k6_vu_minutes`           |
| **Aggregation**                      | Select **Sum**            |
| **Over property**                    | `value`                   |

---

**Meter 3: AI Credits**

| Field                                | Value          |
| ------------------------------------ | -------------- |
| **Name**                             | `AI Credits`   |
| **Filters → Condition group**        |                |
| - First dropdown (Name)              | `Name`         |
| - Second dropdown                    | `equals`       |
| - Third dropdown (Select event name) | `ai_credits`   |
| **Aggregation**                      | Select **Sum** |
| **Over property**                    | `value`        |

---

> **How it works**:
>
> - The **Name** field is the display name shown on invoices
> - The **Filter** matches incoming usage events by their event name (`playwright_minutes`, `k6_vu_minutes`, or `ai_credits`)
> - **Sum** aggregation adds up all the `value` property from matched events
> - The `value` property contains the number of minutes/credits used per event

#### 4. Configure Overage Pricing

After creating meters, set up overage pricing:

1. Go to Polar Dashboard → Products → Select your product
2. In "Pricing" section, configure overage rates:
   - **Plus Plan**:
     - Playwright Minutes: $0.03 per minute beyond included quota
     - K6 VU Minutes: $0.01 per VU-minute beyond included quota
     - AI Credits: $0.05 per credit beyond included quota
   - **Pro Plan**:
     - Playwright Minutes: $0.02 per minute beyond included quota
     - K6 VU Minutes: $0.01 per VU-minute beyond included quota
     - AI Credits: $0.03 per credit beyond included quota
3. Enable "Charge for overage" option
4. Set billing cycle to "Monthly"

#### 5. Enable Usage Reporting

Configure usage reporting and notifications:

1. Go to Polar Dashboard → Settings → Usage Reporting
2. Enable "Real-time usage tracking"
3. Set up usage alerts:
   - Alert at 80% of included quota
   - Alert at 100% of included quota
4. Configure customer notifications for overage charges
5. Enable "Usage breakdown in customer portal"

> [!IMPORTANT]
> The meter names (`playwright_minutes`, `k6_vu_minutes`, and `ai_credits`) must exactly match what's configured in the code. These names are used when syncing usage events to Polar.

#### 6. Configure Webhook

1. Go to Polar Dashboard → Settings → Webhooks
2. Click "Create Webhook"
3. Set URL to: `https://your-domain.com/api/auth/polar/webhooks`
4. Select these events:
   - `subscription.active`
   - `subscription.updated`
   - `subscription.canceled`
   - `order.paid`
   - `customer.updated`
5. Copy the webhook secret to `POLAR_WEBHOOK_SECRET`

### Set Up Scheduled Sync Job

To automatically sync usage events to Polar, create a cron job:

```bash
# Add to crontab: crontab -e
# Sync usage events every 5 minutes
*/5 * * * * curl -X POST http://localhost:3000/api/admin/sync-usage-events \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY"
```

The sync endpoint calls the Polar usage service to batch sync pending events:

```typescript
// app/api/admin/sync-usage-events/route.ts
import { polarUsageService } from "@/lib/services/polar-usage-service";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    const result = await polarUsageService.syncPendingEvents(50);

    return NextResponse.json({
      success: true,
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
      errors: result.errors,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Sync failed",
        details: error instanceof Error ? error.message : "Unknown",
      },
      { status: 500 }
    );
  }
}
```

### Usage Sync with Polar

**Sync Frequency**:

- **Real-time**: Usage events are recorded locally immediately after execution
- **Batch Sync**: Pending events are synced to Polar every 5 minutes via scheduled job
- **Retry Logic**: Failed syncs are retried up to 5 times with exponential backoff

**Sync Process**:

1. Event occurs (Playwright/K6 execution)
2. UsageTracker records event to `usage_events` table locally
3. Updates organization usage counters immediately
4. Background job syncs pending events to Polar meters
5. Events marked as `synced_to_polar = true` on success

**Error Handling & Robustness**:

- ✅ **Decoupled Architecture**: Local tracking works even if Polar is down
- ✅ **Automatic Retries**: Failed syncs are retried with increasing delays
- ✅ **Retry Limit**: Stops retrying after 5 failed attempts
- ✅ **Audit Trail**: All events stored locally with sync status
- ✅ **Graceful Degradation**: Usage continues to be tracked even if sync fails
- ✅ **Monitoring**: Detailed logging for troubleshooting sync issues

**What Happens if Sync Fails**:

1. Event remains in `usage_events` table with `synced_to_polar = false`
2. `sync_attempts` counter increments
3. `sync_error` stores the error message
4. Retry mechanism attempts again every 5 minutes
5. After 5 failures, event is marked as permanently failed
6. Manual intervention may be needed (check logs, fix Polar config)

**Best Practices**:

- Monitor `usage_events` table for failed syncs
- Set up alerts for high sync failure rates
- Keep Polar access tokens fresh and valid
- Ensure webhook endpoints are always accessible
- Regularly audit usage vs. Polar billing reports

### Testing

#### Self-Hosted Mode

Test that self-hosted mode works correctly:

```bash
# Set in .env
SELF_HOSTED=true

# Restart server
npm run dev
```

Expected behavior:

- All plan limits return "unlimited"
- No Polar customer creation on signup
- No usage tracking to Polar
- Full access to all features

#### Cloud Mode with Polar

```bash
# Set in .env
SELF_HOSTED=false
POLAR_ACCESS_TOKEN=...
POLAR_SERVER=sandbox  # Use sandbox for testing

# Restart server
npm run dev
```

Expected behavior:

- Customer created in Polar on signup
- Plan limits enforced based on subscription
- Usage tracked to Polar for billing
- Checkout flows work correctly

### API Integration

#### Check Plan Limits

```typescript
import { checkMonitorLimit } from "@/lib/middleware/plan-enforcement";

const limitCheck = await checkMonitorLimit(organizationId, currentCount);
if (!limitCheck.allowed) {
  return res.status(403).json({ error: limitCheck.error });
}
```

#### Track Usage

```typescript
import { usageTracker } from "@/lib/services/usage-tracker";

// After Playwright execution
await usageTracker.trackPlaywrightExecution(organizationId, executionTimeMs, {
  testId,
  jobId,
});

// After K6 execution
await usageTracker.trackK6Execution(organizationId, virtualUsers, durationMs, {
  testId,
  jobId,
});

// After AI fix or create action
await usageTracker.trackAIUsage(
  organizationId,
  "ai_fix", // or "ai_create"
  { testId }
);
```

#### Get Usage Stats

```typescript
import { subscriptionService } from "@/lib/services/subscription-service";

const usage = await subscriptionService.getUsage(organizationId);
console.log(usage.playwrightMinutes.used); // Current usage
console.log(usage.playwrightMinutes.overage); // Overage amount
```

### Production Checklist

Before deploying to production:

- [ ] Set `POLAR_SERVER=production`
- [ ] Use production Polar access token
- [ ] Create production Plus/Pro products
- [ ] Configure production webhook
- [ ] Create usage meters (`playwright_minutes`, `k6_vu_minutes`, `ai_credits`)
- [ ] Test full checkout flow
- [ ] Verify webhook processing
- [ ] Test plan limit enforcement
- [ ] Test usage tracking and sync to Polar
- [ ] Set up scheduled sync job (cron/Vercel/GitHub Actions)
- [ ] Set up monitoring for sync failures
- [ ] Set up billing alerts
- [ ] Verify billing period calculation uses subscription dates

### Support

For issues with Polar integration:

- Check [Polar Documentation](https://polar.sh/docs)
- Review implementation logs
- Contact Polar support for payment issues

---

## Pricing & Plans

> **Important**: This pricing is for cloud-hosted Supercheck. Self-hosted installations have unlimited usage.

### Plans Overview

| Feature                   | Plus                        | Pro                         |
| ------------------------- | --------------------------- | --------------------------- |
| **Monthly Price**         | $49/month                   | $149/month                  |
| **Monitors**              | 25 monitors                 | 100 monitors                |
| **Playwright Minutes**    | 3,000 minutes/month         | 10,000 minutes/month        |
| **K6 VU Minutes**         | 20,000 VU-minutes/month     | 75,000 VU-minutes/month     |
| **AI Credits**            | 100 credits/month           | 300 credits/month           |
| **Concurrent Executions** | 5                           | 10                          |
| **Queued Jobs**           | 50                          | 100                         |
| **Team Members**          | 5 users                     | 25 users                    |
| **Organizations**         | 2 organizations             | 10 organizations            |
| **Projects**              | 10 projects                 | 50 projects                 |
| **Monitoring Locations**  | All 3 locations             | All 3 locations             |
| **Check Interval**        | 1 minute (Synthetic: 5 min) | 1 minute (Synthetic: 5 min) |
| **Data Retention (Raw)**  | 7 days                      | 30 days                     |
| **Data Retention (Agg)**  | 30 days (metrics)           | 365 days (metrics)          |
| **Job Runs Retention**    | 30 days                     | 90 days                     |
| **Email Support**         | ✓                           | ✓ Priority                  |
| **Slack/Webhook Alerts**  | ✓                           | ✓                           |
| **Status Pages**          | 3 status pages              | 15 status pages             |
| **Custom Domains**        | ✓                           | ✓                           |
| **API Access**            | ✓                           | ✓ Enhanced                  |
| **SSO/SAML**              | ✓                           | ✓                           |

### Usage-Based Billing

#### Playwright Execution Minutes

Billed per minute of browser test execution time. All test executions are timed to the nearest minute and rounded up.

- **Plus Plan**: $0.03 per additional minute after 3,000 minutes
- **Pro Plan**: $0.02 per additional minute after 10,000 minutes

**Example 1**: Running a 5-minute Playwright test:

- Consumes: 5 execution minutes
- Cost per execution (if over quota): $0.15 (Plus) or $0.10 (Pro)

**Example 2**: Running 30 Playwright tests averaging 1 minute each:

- Consumes: 30 execution minutes
- Plus plan includes 3,000 minutes, Pro includes 10,000 minutes
- Both plans: No overage charge ✓

#### K6 VU Minutes

Billed per Virtual User minute for load testing. Calculated as: Virtual Users × Duration (in minutes), rounded up.

- **Plus Plan**: $0.01 per additional VU-minute after 20,000 minutes
- **Pro Plan**: $0.01 per additional VU-minute after 75,000 minutes

**Example 1**: Running a load test with 100 VUs for 10 minutes:

- Consumes: 100 VUs × 10 minutes = 1,000 VU-minutes
- Cost per test (if over quota): **$10.00 (Plus)** or **$10.00 (Pro)**

#### AI Credits

Billed per AI action (AI Fix or AI Create). Each action consumes 1 credit.

- **Plus Plan**: $0.05 per additional credit after 100 credits
- **Pro Plan**: $0.03 per additional credit after 300 credits

**Example 1**: Using AI Fix 10 times in a month:

- Consumes: 10 AI credits
- Plus plan includes 100 credits: No overage charge ✓
- Pro plan includes 300 credits: No overage charge ✓

**Example 2**: Heavy AI usage with 100 AI Fix + 50 AI Create:

- Consumes: 150 AI credits
- Plus plan: 50 credits overage × $0.05 = **$2.50 overage**
- Pro plan includes 300 credits: No overage charge ✓

**What counts as an AI Credit:**

- Each AI Fix request (fix failing test) = 1 credit
- Each AI Create request (generate new test) = 1 credit
- Failed requests are NOT charged

#### Monitor Executions (Synthetic Monitors)

Synthetic monitors count against Playwright minutes for each execution. Monitor execution time is typically much shorter than full Playwright tests.

**Example**: 25 monitors checking every 5 minutes for 30 days:

- Executions per month: 25 × (30 days × 24 hours × 60 minutes / 5 minutes) = 216,000 executions
- Average execution time per check: ~0.2 minutes (12 seconds)
- Total minutes: ~43,200 minutes per month
- Plus plan includes: 3,000 minutes
- **Overage cost**: 40,200 minutes × $0.03 = **$1,206/month** (upgrade to Pro recommended)
- Pro plan includes: 10,000 minutes
- **Overage cost**: 33,200 minutes × $0.02 = **$664/month** (consider reducing check frequency)

### Plan Features

#### Plus Plan - $49/month

**Best for**: Startups and small teams (2-5 developers)

- 25 uptime monitors with 1-minute intervals
- Synthetic monitors: 5-minute minimum intervals
- 3,000 Playwright execution minutes/month
- 20,000 K6 VU-minutes/month for load testing
- 100 AI credits/month for AI Fix and AI Create
- Up to 5 team members
- 2 organizations, 10 projects
- 3 public status pages with custom domains
- Email support
- Slack and Webhook notifications
- 7-day raw data retention, 30-day aggregated metrics
- 30-day job runs retention
- All monitoring locations (US, EU, APAC)
- Standard API access
- SSO/SAML authentication

#### Pro Plan - $149/month

**Best for**: Growing teams and production applications (10-25 developers)

- 100 uptime monitors with 1-minute intervals
- Synthetic monitors: 5-minute minimum intervals
- 10,000 Playwright execution minutes/month
- 75,000 K6 VU-minutes/month for load testing
- 300 AI credits/month for AI Fix and AI Create
- Up to 25 team members
- 10 organizations, 50 projects
- 15 public status pages with custom domains
- Priority email support
- Slack and Webhook notifications
- 30-day raw data retention, 365-day (1 year) aggregated metrics
- 90-day job runs retention
- SSO/SAML authentication
- All monitoring locations (US, EU, APAC)
- Enhanced API access with higher rate limits

### Self-Hosted Edition

For teams that want to run Supercheck on their own infrastructure:

- **Free and Open Source**
- Unlimited monitors, executions, and usage
- No subscription fees
- Full control over data and infrastructure
- Community support
- All features included

Visit our [GitHub repository](https://github.com/supercheck-io/supercheck) to get started.

### FAQs

#### How is usage tracked?

- **Playwright Minutes**: Total browser execution time (rounded up to nearest minute)
  - Example: 45-second test = 1 minute, 65-second test = 2 minutes
- **K6 VU Minutes**: Virtual users × execution duration (rounded up)
  - Example: 100 VUs × 5.5 minutes = 550 VU-minutes (rounded from 550)
- **Monitors**: Count against Playwright minutes for each check execution
  - Example: 25 monitors, 5-minute interval = 288 Playwright minutes/day = 8,640 minutes/month
- **AI Credits**: Each successful AI Fix or AI Create action = 1 credit
  - Example: 10 AI Fix + 5 AI Create = 15 AI credits used
  - Failed AI requests are NOT charged

#### What happens if I exceed my limits?

Usage-based billing automatically applies:

- Overage charges are billed monthly
- Real-time usage tracking in dashboard
- Automatic email alerts at 80% and 100% of quota

#### Can I change plans?

Yes! Upgrade or downgrade anytime:

- **Upgrades**: Immediate access to new features and limits
- **Downgrades**: Effective at next billing cycle
- Pro-rated billing for mid-cycle changes

#### Do unused minutes roll over?

No, plan quotas reset monthly on your billing date.

#### What payment methods do you accept?

We accept all major credit cards through Polar.sh:

- Visa, Mastercard, American Express, Discover
- Automatic tax/VAT calculation and collection
- Secure payment processing

---

## Architecture

### System Overview

```mermaid
graph TB
    subgraph "Supercheck Application"
        subgraph "Frontend"
            UI[Billing UI<br/>Components]
            BillingPage["Billing Page"]
        end

        subgraph "Authentication & Billing"
            BetterAuth[Better Auth<br/>Session Management]
            PolarPlugin[Polar Plugin<br/>Customer & Checkout]
        end

        subgraph "API Layer"
            BillingAPI[Billing APIs<br/>/api/billing/*]
            MonitorAPI[Monitor API<br/>+Enforcement]
            ProjectAPI[Project API<br/>+Enforcement]
        end

        subgraph "Services"
            SubService[Subscription Service<br/>Plan & Usage]
            Enforcement[Plan Enforcement<br/>Middleware]
            WebhookHandler[Webhook Handlers<br/>Polar Events]
        end

        subgraph "Database"
            OrgTable[(Organization<br/>+Subscription Fields)]
            PlanTable[(Plan Limits<br/>Configuration)]
        end
    end

    subgraph "Worker Service"
        PWProcessor[Playwright<br/>Processor]
        K6Processor[K6<br/>Processor]
        UsageTracker[Usage Tracker<br/>Service]
    end

    subgraph "External Services"
        PolarAPI[Polar.sh API<br/>Payments]
        PolarWebhooks[Polar Webhooks<br/>Events]
    end

    %% User flows
    UI --> BillingAPI
    BillingPage --> BillingAPI

    %% Auth integration
    BetterAuth --> PolarPlugin
    PolarPlugin <--> PolarAPI

    %% API to Services
    BillingAPI --> SubService
    MonitorAPI --> Enforcement
    ProjectAPI --> Enforcement

    %% Services to Database
    SubService --> OrgTable
    SubService --> PlanTable
    Enforcement --> PlanTable
    Enforcement --> OrgTable

    %% Webhook flow
    PolarWebhooks --> WebhookHandler
    WebhookHandler --> SubService

    %% Worker usage tracking
    PWProcessor --> UsageTracker
    K6Processor --> UsageTracker
    UsageTracker --> OrgTable

    style BetterAuth fill:#e1f5ff
    style PolarPlugin fill:#e1f5ff
    style SubService fill:#fff4e6
    style Enforcement fill:#fff4e6
    style UsageTracker fill:#f3e5f5
    style PolarAPI fill:#e8f5e9
    style PolarWebhooks fill:#e8f5e9
```

### Key Components

#### 1. **Better Auth + Polar Plugin**

- Location: `app/src/utils/auth.ts`
- Purpose: Integrate Polar checkout, customer management, and webhooks
- Features:
  - Conditional loading based on `SELF_HOSTED` flag
  - Customer creation on signup
  - Checkout sessions for plan upgrades
  - Webhook signature verification

#### 2. **Subscription Service**

- Location: `app/src/lib/services/subscription-service.ts`
- Purpose: Manage subscription state and usage tracking
- Methods:
  - `requiresSubscription()` - Check if running in cloud mode (requires Polar)
  - `hasActiveSubscription(orgId)` - Verify org has active paid subscription
  - `getOrganizationPlan()` - Retrieve plan limits (throws if cloud + no subscription)
  - `getOrganizationPlanSafe()` - Non-throwing version for display purposes
  - `getEffectivePlan(orgId)` - Get plan with better error messages
  - `blockUntilSubscribed(orgId)` - Throw error if subscription required but missing
  - `trackPlaywrightUsage()` - Increment Playwright minutes
  - `trackK6Usage()` - Increment K6 VU minutes
  - `getUsage()` - Get current usage with overage calculations
  - `getUsageSafe()` - Non-throwing version using safe plan lookup
  - `updateSubscription()` - Update plan from webhooks
  - `resetUsageCounters()` - Reset for new billing period
  - `resetUsageCountersWithDates()` - Reset using Polar's subscription dates
  - `validatePolarCustomer(orgId, customerId)` - Check if customer exists in Polar API
  - `requireValidPolarCustomer(orgId)` - Block operations if Polar customer doesn't exist

#### 3. **Plan Enforcement Middleware**

- Location: `app/src/lib/middleware/plan-enforcement.ts`
- Purpose: Enforce plan limits at API level
- Features:
  - Monitor count limits
  - Project count limits
  - Status page count limits
  - Team member limits
  - Organization count limits

#### 4. **Usage Tracker (Worker)**

- Location: `worker/src/execution/services/usage-tracker.service.ts`
- Purpose: Track usage from test executions
- Features:
  - Integrated into Playwright execution processor
  - Integrated into K6 execution processor
  - Unconditional tracking (tracks usage for both cloud and self-hosted)
  - Error handling without breaking execution

**Execution Points Where Usage is Tracked:**

| Execution Type                             | Processor/Service                            | Usage Tracked                   |
| ------------------------------------------ | -------------------------------------------- | ------------------------------- |
| Job Executions (scheduled/triggered)       | `PlaywrightExecutionProcessor.processJob()`  | ✅ Playwright minutes           |
| Single Test Executions (playground/manual) | `PlaywrightExecutionProcessor.processTest()` | ✅ Playwright minutes           |
| Synthetic Monitor Executions               | `MonitorService.executeSyntheticTest()`      | ✅ Playwright minutes           |
| K6 Load Tests                              | `K6ExecutionProcessor`                       | ✅ K6 VU minutes                |
| HTTP/Ping/Port Monitors                    | `MonitorService`                             | ❌ Not tracked (not Playwright) |

**Calculation Logic:**

- **Playwright Minutes**: `Math.ceil(executionTimeMs / 1000 / 60)` - Rounds UP to nearest minute
  - Example: 30 seconds = 1 minute, 61 seconds = 2 minutes
- **K6 VU Minutes**: `Math.ceil(virtualUsers * durationMinutes)` - VUs × duration rounded UP

**Overage Calculation:**

Overage is calculated ONLY after included quota is exhausted:

```typescript
const playwrightOverage = Math.max(
  0,
  playwrightMinutesUsed - includedPlaywrightMinutes
);
const k6Overage = Math.max(0, k6VuMinutesUsed - includedK6VuMinutes);
const aiCreditsOverage = Math.max(0, aiCreditsUsed - includedAiCredits);
const totalOverageCents =
  playwrightOverage * playwrightPriceCents +
  k6Overage * k6PriceCents +
  aiCreditsOverage * aiCreditPriceCents;
```

**Plan Included Quotas** (from `0001_seed_plan_limits.sql`):

| Plan      | Playwright Minutes | K6 VU Minutes | AI Credits |
| --------- | ------------------ | ------------- | ---------- |
| Plus      | 3,000/month        | 20,000/month  | 100/month  |
| Pro       | 10,000/month       | 75,000/month  | 300/month  |
| Unlimited | Unlimited          | Unlimited     | Unlimited  |

**Overage Pricing** (competitive, protocol-only K6):

| Plan | Playwright | K6 VU Minutes | AI Credits   |
| ---- | ---------- | ------------- | ------------ |
| Plus | $0.03/min  | $0.01/VU-min  | $0.05/credit |
| Pro  | $0.02/min  | $0.01/VU-min  | $0.03/credit |

**K6 Pricing Justification (Protocol-Only Tests):**

- Supercheck only supports **HTTP/protocol-based** K6 tests (no browser-based)
- Protocol tests are cheaper to run than browser tests (~10-20x less resource intensive)
- Pricing is competitive with Grafana k6 Cloud ($0.0025/VU-min at scale)
- Value-add: integrated status pages, monitoring, alerting, and single dashboard

**Polar Sync:**

Usage events are synced to Polar in real-time:

1. Worker records event locally with `synced_to_polar = false`
2. Worker immediately syncs to Polar API (`POST /v1/events/ingest`)
3. On success, event is marked `synced_to_polar = true`
4. On failure, event is marked with `sync_error` for retry

**Fallback Sync Endpoint:**

For failed syncs, a cron job should call:

```
POST /api/admin/sync-usage-events
Header: x-cron-secret: YOUR_CRON_SECRET
```

**Retry Configuration for Test Executions:**

Tests have `attempts: 3` with exponential backoff configured in `app/src/lib/queue.ts`:

```typescript
const defaultJobOptions = {
  attempts: 3, // Retry up to 3 times for transient failures
  backoff: {
    type: "exponential",
    delay: 5000, // Start with 5 second delay, then 10s, 20s
  },
};
```

**Why retries are safe for billing:**

- Usage tracking only happens on **successful completion**
- Retries help with transient failures (container startup, network issues)
- Failed attempts don't trigger usage recording
- Only the final successful execution is billed

**Architecture: Worker vs App Polar Integration**

Usage tracking happens in the **worker** (not the app) because:

- Executions happen in the worker process
- Worker has direct access to execution timing
- Real-time sync requires worker-to-Polar communication

The worker makes direct Polar API calls (not via Better Auth) because:

- Better Auth's `usage()` plugin requires authenticated user session
- Worker runs independently without user context
- Direct API calls with `POLAR_ACCESS_TOKEN` are the correct approach

**Troubleshooting: Meter Events Not Showing in Polar**

If K6 or Playwright meter events don't appear in Polar dashboard:

1. **Check Worker Environment Variables:**

   ```bash
   # Required in worker/.env
   POLAR_ACCESS_TOKEN=your_polar_access_token
   POLAR_SERVER=sandbox  # or production
   ```

2. **Check Organization has `polarCustomerId`:**

   - User must subscribe via Polar checkout first
   - Check database: `SELECT polar_customer_id FROM organization WHERE id = 'org-id'`
   - If NULL, events won't sync (user hasn't subscribed)

3. **Check Meter Filter Configuration in Polar:**

   - Go to Polar Dashboard → Products → Meters → Edit Meter
   - **CRITICAL**: Set Filter to `Name` equals `k6_vu_minutes` (or `playwright_minutes`)
   - The filter must match the `name` field in the event payload
   - Without this filter, the meter won't aggregate events

4. **Check Worker Logs:**

   - Look for: `[Usage] Syncing k6_vu_minutes=X to Polar for customer...`
   - Look for: `[Usage] ✅ Synced event...`
   - Look for: `[Usage] POLAR_ACCESS_TOKEN not configured` (error)
   - Look for: `[Usage] No Polar customer ID for org...` (user hasn't subscribed)
   - Look for: `Polar API error (404)` - This means the API endpoint was wrong (fixed)

5. **Check `usage_events` Table:**

   ```sql
   SELECT id, event_name, units, synced_to_polar, sync_error
   FROM usage_events
   WHERE organization_id = 'org-id'
   ORDER BY created_at DESC LIMIT 10;
   ```

   - `synced_to_polar = false` with `sync_error` shows failed syncs
   - `synced_to_polar = true` means events were sent to Polar

6. **Retry Failed Syncs:**

   ```bash
   curl -X POST https://your-app/api/admin/sync-usage-events \
     -H "x-cron-secret: YOUR_CRON_SECRET"
   ```

7. **Update Plan Limits (if not applied):**
   ```bash
   cd app && npm run db:update-limits
   ```

**Polar API Endpoint:**

The worker uses the correct Polar Events Ingestion API:

```
POST https://api.polar.sh/v1/events/ingest
# or for sandbox:
POST https://sandbox-api.polar.sh/v1/events/ingest

Body:
{
  "events": [{
    "customer_id": "polar-customer-uuid",
    "name": "k6_vu_minutes",  // Must match meter filter
    "timestamp": "2024-01-01T00:00:00.000Z",
    "metadata": {
      "event_id": "usage-event-uuid",
      "value": 1000  // VU minutes used
    }
  }]
}
```

#### 5. **Webhook Handlers**

- Location: `app/src/lib/webhooks/polar-webhooks.ts`
- Purpose: Process Polar subscription events
- **Implementation**: Uses Better Auth's `@polar-sh/better-auth` webhooks plugin
  - Signature verification is handled automatically by the plugin (Standard Webhooks spec)
  - Webhook endpoint: `/api/auth/polar/webhooks` (handled by Better Auth's `[...all]` catch-all route)
  - Uses **specific event handlers** for critical events + `onPayload` catch-all for logging
- **Handlers configured** (in `app/src/utils/auth.ts`):
  ```typescript
  onCustomerCreated: async (payload) => {
    // Link new Polar customer to user's organization
    // Critical for checkout flow
  },
  onCustomerDeleted: async (payload) => {
    // CRITICAL: Revoke subscription when customer deleted from Polar
    // Prevents access after customer deletion
  },
  onCustomerStateChanged: async (payload) => {
    // Aggregated event for customer changes
    // Used for syncing customer data
  },
  onSubscriptionActive: async (payload) => {
    // Extract customerId, productId, orgId from payload
    // Update organization subscription status
    // Reset usage counters for new billing period
  },
  onSubscriptionCreated: async (payload) => {
    // Handle new subscription creation
    // Same logic as onSubscriptionActive
  },
  onSubscriptionUpdated: async (payload) => {
    // Handle plan changes (upgrade/downgrade)
    // Update limits accordingly
  },
  onSubscriptionCanceled: async (payload) => {
    // Mark as canceled but keep access until period ends (grace period)
    // Send cancellation notifications
  },
  onSubscriptionUncanceled: async (payload) => {
    // Restore subscription when cancellation is reversed
    // User re-subscribed during grace period
  },
  onSubscriptionRevoked: async (payload) => {
    // CRITICAL: Immediate access termination
    // Set status to 'none' immediately
  },
  onOrderPaid: async (payload) => {
    // Log payment confirmation
    // Activate subscription for subscription products
    // Handle one-time purchases if any
  },
  onPayload: async (payload) => {
    // Catch-all for logging all events
    // Debug/monitoring purposes
  }
  ```

#### 6. **Polar Usage Service**

- Location: `app/src/lib/services/polar-usage.service.ts`
- Purpose: Sync usage events to Polar for billing
- Features:
  - Event ingestion API integration
  - Batch sync with retry logic
  - Spending limit enforcement
  - Usage metrics calculation
  - Spending status tracking for hard stop enforcement

#### 7. **Billing Settings Service**

- Location: `app/src/lib/services/billing-settings.service.ts`
- Purpose: Manage organization billing settings
- Features:
  - Spending limit configuration
  - Notification preference management
  - Notification threshold tracking
  - Prevents duplicate notifications in billing period

#### 8. **Usage Notification Service**

- Location: `app/src/lib/services/usage-notification.service.ts`
- Purpose: Send usage and spending notifications
- Features:
  - Threshold-based notification triggering
  - Email delivery with retry
  - Duplicate prevention using notification history
  - Support for multiple recipient emails

### Data Flow

#### 1. **Customer Creation Flow**

```mermaid
sequenceDiagram
    participant User
    participant UI
    participant Auth
    participant Polar
    participant DB

    User->>UI: Sign up
    UI->>Auth: POST /api/auth/sign-up
    Auth->>Polar: Create customer (if cloud mode)
    Polar-->>Auth: Customer ID
    Auth->>DB: INSERT organization WITH polar_customer_id
    Auth-->>UI: User created
    UI-->>User: Welcome! Please select a plan
```

#### 2. **Subscription Activation Flow**

```mermaid
sequenceDiagram
    participant User
    participant UI
    participant Polar
    participant Webhook
    participant SubService
    participant DB

    User->>UI: Click "Upgrade to Plus"
    UI->>Polar: Open checkout session
    User->>Polar: Complete payment
    Polar->>Webhook: POST subscription.active
    Webhook->>SubService: handleSubscriptionActive(payload)
    SubService->>DB: UPDATE organization SET plan='plus', status='active'
    SubService->>DB: RESET usage counters
    SubService-->>Webhook: Success
    Webhook-->>Polar: 200 OK
    UI->>API: GET /api/billing/current
    API-->>UI: { plan: 'plus', status: 'active' }
    UI-->>User: ✅ Plus plan activated!
```

#### 3. **Usage Tracking Flow**

```mermaid
sequenceDiagram
    participant Worker
    participant UsageTracker
    participant DB
    participant PolarSync
    participant PolarAPI

    Worker->>UsageTracker: trackPlaywrightExecution(orgId, durationMs)
    UsageTracker->>UsageTracker: minutes = ceil(durationMs / 1000 / 60)
    UsageTracker->>DB: UPDATE organization SET playwright_minutes_used += minutes
    UsageTracker->>DB: INSERT INTO usage_events (type, units, synced=false)
    Note over UsageTracker: Local tracking complete

    loop Every 5 minutes
        PolarSync->>DB: SELECT * FROM usage_events WHERE synced=false
        PolarSync->>PolarAPI: POST /customers/{id}/meters/events
        PolarAPI-->>PolarSync: Event recorded
        PolarSync->>DB: UPDATE usage_events SET synced=true
    end
```

#### 4. **Plan Enforcement Flow**

```mermaid
sequenceDiagram
    participant User
    participant UI
    participant API
    participant Enforcement
    participant SubService
    participant DB

    User->>UI: Create new monitor
    UI->>API: POST /api/monitors
    API->>Enforcement: checkMonitorLimit(orgId)
    Enforcement->>SubService: getOrganizationPlan(orgId)
    SubService->>DB: Get plan limits
    DB-->>SubService: maxMonitors: 25
    SubService-->>Enforcement: PlanLimits

    Enforcement->>Enforcement: Check: currentCount >= maxMonitors ✗
    Enforcement-->>API: {<br/>  allowed: false,<br/>  error: "Monitor limit reached",<br/>  currentPlan: "plus",<br/>  upgrade: "pro"<br/>}

    API-->>UI: 403 Forbidden
    UI-->>User: "Monitor limit reached.<br/>Upgrade to Pro for 100 monitors."
```

#### 5. **Webhook Processing Flow**

```mermaid
sequenceDiagram
    participant Polar as Polar.sh
    participant Webhook as /api/auth/polar/webhooks
    participant Handler as Webhook Handler
    participant SubService as Subscription Service
    participant DB as Database
    participant Audit as Audit Log

    Polar->>Webhook: POST webhook<br/>{<br/>  type: "subscription.updated",<br/>  data: {...}<br/>}

    Note over Webhook: Verify signature

    Webhook->>Webhook: Verify POLAR_WEBHOOK_SECRET

    alt Signature invalid
        Webhook-->>Polar: 401 Unauthorized
    else Signature valid
        Webhook->>Handler: Route event by type

        alt subscription.updated
            Handler->>Handler: Extract customerId, productId, status, startsAt, endsAt
            Handler->>DB: SELECT * FROM organization<br/>WHERE polar_customer_id = customerId
            DB-->>Handler: Organization

            Handler->>Handler: Map productId to plan<br/>(plus/pro/unlimited)

            Handler->>SubService: updateSubscription(orgId, {<br/>  plan: "pro",<br/>  status: "active",<br/>  subscriptionStartedAt: startsAt,<br/>  subscriptionEndsAt: endsAt<br/>})

            SubService->>DB: UPDATE organization SET<br/>  subscription_plan = 'pro',<br/>  subscription_status = 'active',<br/>  subscription_started_at = startsAt,<br/>  subscription_ends_at = endsAt
            DB-->>SubService: Updated

            SubService->>SubService: resetUsageCountersWithDates(orgId, startsAt, endsAt)
            SubService->>DB: RESET usage counters<br/>SET usage_period_start = startsAt<br/>SET usage_period_end = endsAt

            SubService->>Audit: Log subscription change
            Audit->>DB: INSERT INTO audit_logs

            SubService-->>Handler: Success
            Handler-->>Webhook: Event processed

        else subscription.canceled
            Handler->>SubService: updateSubscription(orgId, {<br/>  status: "canceled"<br/>})
            Note over Handler,SubService: Keep plan active until<br/>end of billing period

        else order.paid
            Handler->>Handler: Log payment confirmation
            Note over Handler: No action needed<br/>(handled by subscription.active)
        end

        Webhook-->>Polar: 200 OK
    end

    Note over Polar: Webhook delivery confirmed
```

#### 6. **Data Flow Diagram**

```mermaid
graph LR
    subgraph "User Actions"
        Signup[User Signup]
        Upgrade[Plan Upgrade]
        Execute[Run Test]
        Create[Create Resource]
    end

    subgraph "Polar Integration"
        CreateCustomer[Create Customer]
        Checkout[Checkout Session]
        Webhooks[Webhook Events]
        UsageSync[Usage Sync]
    end

    subgraph "Database State"
        OrgData[(Organization<br/>- polar_customer_id<br/>- subscription_plan<br/>- subscription_status<br/>- subscription_started_at<br/>- subscription_ends_at<br/>- usage counters)]
        PlanData[(Plan Limits<br/>- max resources<br/>- included usage<br/>- features)]
        UsageEvents[(Usage Events<br/>- event_type<br/>- units<br/>- synced_to_polar)]
    end

    subgraph "Enforcement & Tracking"
        CheckLimits{Check<br/>Limits}
        TrackUsage[Track<br/>Usage]
        UpdateDB[Update<br/>Counters]
    end

    Signup --> CreateCustomer
    CreateCustomer --> OrgData
    Upgrade --> Checkout
    Checkout --> Webhooks
    Webhooks --> OrgData
    Execute --> TrackUsage
    TrackUsage --> UpdateDB
    UpdateDB --> OrgData
    TrackUsage --> UsageEvents
    UsageEvents --> UsageSync
    Create --> CheckLimits
    CheckLimits --> PlanData
    PlanData --> OrgData

    style OrgData fill:#e8f5e9
    style PlanData fill:#fff3e0
    style UsageEvents fill:#f3e5f5
```

---

## Implementation

### Environment Configuration

**Feature Flag System**: Controls Polar integration based on deployment mode

- `isPolarEnabled()` - Returns true only in cloud mode with valid Polar token
- `getPolarConfig()` - Retrieves Polar configuration from environment variables
- Required env vars: `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_SERVER`, product IDs

### Better Auth Integration

**Polar Plugin Setup**: Conditional plugin loading based on feature flags

- Polar SDK client initialization with server (sandbox/production)
- Customer creation on signup with metadata linking to user ID
- Checkout session configuration for Plus/Pro products
- Webhook handlers for subscription lifecycle events
- Customer portal access for subscription management

### Subscription Service

**Core Service**: Manages subscription state and usage tracking

- **Plan Validation**: `requiresSubscription()`, `hasActiveSubscription()`, `blockUntilSubscribed()`
- **Plan Retrieval**: `getOrganizationPlan()` (throws), `getOrganizationPlanSafe()` (non-throwing)
- **Usage Tracking**: `trackPlaywrightUsage()`, `trackK6Usage()`, `getUsage()`
- **Subscription Updates**: `updateSubscription()`, `resetUsageCounters()`, `resetUsageCountersWithDates()`
- **Customer Validation**: `validatePolarCustomer()`, `requireValidPolarCustomer()`
- **Security**: Blocks unlimited plans in cloud mode

### Webhook Handlers

**Event Processing**: Handles Polar webhook events with signature verification

- **Subscription Active**: Extracts customer/product info, updates org subscription, resets usage counters using Polar's subscription dates
- **Subscription Updated**: Handles plan changes and status updates
- **Subscription Canceled**: Marks as canceled but maintains access until period end
- **Order Paid**: Logs payment confirmation
- **Date Extraction**: Processes `startsAt` and `endsAt` from webhook payload for accurate billing periods

### Usage Tracking (Worker)

**Service Integration**: Tracks usage from test executions in worker processes

- **Execution Tracking**: Integrated into Playwright and K6 processors
- **Unconditional Recording**: Tracks usage for both cloud and self-hosted modes
- **Local Updates**: Increments organization usage counters immediately
- **Event Recording**: Stores detailed usage events in `usage_events` table for Polar sync
- **Error Handling**: Non-blocking usage tracking with comprehensive logging

### Polar Usage Sync

**Event Synchronization**: Syncs usage events to Polar for billing

- **API Integration**: Uses Polar's `/customers/{id}/meters/events` endpoint
- **Meter Mapping**: Maps `playwright_execution` → `playwright_minutes`, `k6_execution` → `k6_vu_minutes`
- **Batch Processing**: Processes pending events in configurable batch sizes
- **Retry Logic**: Automatic retries with exponential backoff, max 5 attempts
- **Error Tracking**: Records sync errors and attempt counts in database
- **Retry Limit**: Stops retrying permanently failed events (max attempts reached)

### Related Files

- `app/src/lib/feature-flags.ts` - Feature flag and configuration utilities
- `app/src/utils/auth.ts` - Better Auth setup with Polar plugin
- `app/src/lib/services/subscription-service.ts` - Core subscription management
- `app/src/lib/webhooks/polar-webhooks.ts` - Webhook event handlers
- `app/src/lib/services/polar-usage.service.ts` - Usage sync to Polar
- `app/src/lib/services/billing-settings.service.ts` - Billing settings management
- `app/src/lib/services/usage-notification.service.ts` - Notification delivery
- `worker/src/execution/services/usage-tracker.service.ts` - Usage tracking in worker
- `app/src/components/billing/spending-limits.tsx` - Spending limit UI
- `app/src/components/billing/hard-stop-alert.tsx` - Hard stop status indicator

## Hard Stop Limits

### Overview

Hard stop limits allow organizations to automatically block test executions when their monthly overage spending reaches a configured threshold. This prevents unexpected large bills while still allowing graceful planning and temporary disabling of the limit.

### Features

**Spending Limit Configuration**:

- Set monthly spending cap in dollars (e.g., $100/month)
- Enable/disable hard stop enforcement
- Automatically syncs to billing system

**Usage Alerts**:

- Configurable notification thresholds: 50%, 80%, 90%, 100%
- Custom recipient emails (in addition to org admins)
- Prevents duplicate notifications per billing period
- Email notifications with current usage breakdown

**Hard Stop Behavior**:

- When limit is reached, test executions are blocked
- Explicit error message: "Hard stop limit reached - executions blocked"
- Org admins can temporarily disable limit without waiting
- Non-blocking: existing running jobs complete normally

### API Endpoints

#### GET /api/billing/settings

Retrieve organization's billing settings including spending limit configuration.

```typescript
Response: {
  id: string;
  organizationId: string;
  monthlySpendingLimitCents: number | null;
  monthlySpendingLimitDollars: number | null;
  enableSpendingLimit: boolean;
  hardStopOnLimit: boolean;
  notifyAt50Percent: boolean;
  notifyAt80Percent: boolean;
  notifyAt90Percent: boolean;
  notifyAt100Percent: boolean;
  notificationEmails: string[];
  createdAt: Date;
  updatedAt: Date;
}
```

#### PATCH /api/billing/settings

Update billing settings including spending limits and notification preferences.

```typescript
Request: {
  enableSpendingLimit?: boolean;
  monthlySpendingLimitDollars?: number | null;
  hardStopOnLimit?: boolean;
  notifyAt50Percent?: boolean;
  notifyAt80Percent?: boolean;
  notifyAt90Percent?: boolean;
  notifyAt100Percent?: boolean;
  notificationEmails?: string[];
}

Response: BillingSettingsResponse
```

#### GET /api/billing/usage

Retrieve current usage metrics and spending status.

```typescript
Response: {
  usage: {
    playwrightMinutes: {
      used: number;
      included: number;
      overage: number;
    }
    k6VuMinutes: {
      used: number;
      included: number;
      overage: number;
    }
    aiCredits: {
      used: number;
      included: number;
      overage: number;
    }
    totalOverageCents: number;
  }
  spending: {
    currentDollars: number;
    limitDollars: number | null;
    limitEnabled: boolean;
    hardStopEnabled: boolean;
    percentageUsed: number;
    isAtLimit: boolean;
    remainingDollars: number | null;
  }
}
```

#### POST /api/auth/sync-polar-customer

Ensures Polar customer exists and syncs user data (called on signup and profile changes).

```typescript
Response: {
  success: boolean;
  customerId: string;
  action: "created" | "updated" | "linked";
  message: string;
}
```

### Implementation Details

#### Spending Status Calculation

```typescript
// From PolarUsageService.getSpendingStatus()
interface SpendingStatus {
  currentSpendingCents: number; // Total overage charges this period
  limitCents: number | null; // Monthly spending limit
  limitEnabled: boolean;
  hardStopEnabled: boolean;
  percentageUsed: number; // currentSpending / limit * 100
  isAtLimit: boolean; // currentSpending >= limit
  remainingCents: number | null; // limit - currentSpending
}

// Calculation:
percentageUsed = (currentSpendingCents / limitCents) * 100;
isAtLimit = currentSpendingCents >= limitCents;
remainingCents = Math.max(0, limitCents - currentSpendingCents);
```

#### Hard Stop Enforcement

Hard stop is checked before test execution:

```typescript
// In test execution routes
const spending = await polarUsageService.getSpendingStatus(orgId);
if (spending.hardStopEnabled && spending.isAtLimit) {
  return NextResponse.json(
    {
      error: "Hard stop limit reached - executions blocked",
      currentSpending: spending.currentSpendingCents / 100,
      limit: spending.limitCents / 100,
    },
    { status: 429 }
  );
}
```

#### Notification Flow

1. **Usage events trigger notifications**:

   - After each test execution, usage is updated
   - If usage crosses a threshold (80%, 90%, 100%), notification is queued
   - `billingSettingsService.markNotificationSent()` prevents duplicates

2. **Notification dispatch**:

   - `usageNotificationService` sends emails asynchronously
   - Records in `usage_notifications` table for audit
   - Includes current usage, limit, and remaining budget

3. **Email content**:
   - Shows usage breakdown (Playwright, K6, AI minutes/credits)
   - Displays overage charges and costs
   - Provides action links (manage settings, upgrade plan)
   - Always includes org admin notification

#### Notification Recipients

Notifications are sent to:

1. Organization admins (always)
2. Additional emails configured in `notificationEmails` array

Org admins can customize recipients without affecting other billing settings.

### UI Components

#### SpendingLimits Component

Location: `app/src/components/billing/spending-limits.tsx`

**Features:**

- Two-column layout: Spending Limit | Usage Alerts
- Dollar amount input with validation
- Switch to enable/disable limit
- Email list management (add/remove)
- Real-time spending display with color indicators
- Save button with loading state

```typescript
<SpendingLimits className="billing-section" />
```

#### HardStopAlert Component

Location: `app/src/components/billing/hard-stop-alert.tsx`

**Features:**

- Compact badge indicator
- Shows current spending vs limit
- Destructive (red) styling
- Displays when hard stop is active

```typescript
<HardStopAlert
  isActive={spending.hardStopEnabled && spending.isAtLimit}
  currentSpending={spending.currentSpendingCents / 100}
  limit={spending.limitCents / 100}
/>
```

### Billing Period Reset

When billing period resets (new subscription or monthly reset):

```typescript
// From subscriptionService.resetUsageCountersWithDates()
// Hard stop limits carry over to new period
// Previously sent notifications are cleared
await billingSettingsService.resetNotificationsForPeriod(orgId);
```

### Monitoring & Alerts

**Key Metrics to Monitor:**

- Organizations with hard stop enabled
- Percentage of orgs hitting hard stop limit
- Average spending vs limit ratio
- Notification delivery failures
- Execution blocks due to hard stop

**Alert Thresholds:**

- Alert if >5% of orgs hit hard stop daily (potential revenue impact)
- Alert if notification delivery failure rate >2%
- Alert if spending limit feature is disabled (monitoring)

---

## API Reference

### Billing Endpoints

#### Current Billing Status

- **Endpoint**: `GET /api/billing/current`
- **Purpose**: Retrieve organization subscription status, usage metrics, and plan limits
- **Response includes**: Organization details (plan, status, dates), usage breakdown (Playwright/K6 minutes), resource limits (monitors, projects, team members), current billing period, overage calculations

#### Available Plans

- **Endpoint**: `GET /api/billing/plans`
- **Purpose**: List all available subscription plans with features and pricing
- **Response includes**: Plan IDs, names, pricing, feature limits, overage rates

#### Checkout Session

- **Endpoint**: `POST /api/billing/checkout`
- **Purpose**: Create Polar checkout session for plan upgrades
- **Request**: Plan ID, success/cancel URLs
- **Response**: Polar checkout URL for redirect

#### Usage Metrics and Spending Status

- **Endpoint**: `GET /api/billing/usage`
- **Purpose**: Retrieve detailed usage metrics and spending status
- **Response includes**:
  - Usage breakdown (Playwright, K6, AI minutes/credits with overage)
  - Spending status (current, limit, percentage, hard stop status)
  - Remaining budget information

#### Billing Settings

- **Endpoint**: `GET /api/billing/settings`
- **Purpose**: Retrieve organization's billing settings
- **Response includes**: Spending limit, notification thresholds, recipient emails

- **Endpoint**: `PATCH /api/billing/settings`
- **Purpose**: Update billing settings (spending limits, notification preferences)
- **Request**: Spending limit amount, thresholds, recipient emails
- **Response**: Updated billing settings

#### Sync Polar Customer

- **Endpoint**: `POST /api/auth/sync-polar-customer`
- **Purpose**: Ensure Polar customer exists and syncs user data
- **Called**: On signup, social auth, and profile changes
- **Response**: Customer ID, action (created/updated/linked)

### Plan Enforcement API

#### Resource Limit Checks

- **checkMonitorLimit(orgId, currentCount)** - Returns allowed/error status
- **checkProjectLimit(orgId, currentCount)** - Project limit validation
- **checkStatusPageLimit(orgId, currentCount)** - Status page limit validation
- **checkTeamMemberLimit(orgId, currentCount)** - Team member limit validation

### Usage Tracking API

#### Usage Recording

- **trackPlaywrightExecution(orgId, durationMs, metadata)** - Record Playwright usage
- **trackK6Execution(orgId, virtualUsers, durationMs, metadata)** - Record K6 usage
- **getUsage(organizationId)** - Get current usage with overage calculations

### Polar Integration

#### Event Ingestion

- Usage events recorded locally in `usage_events` table
- Synced to Polar via `/customers/{id}/meters/events` endpoint
- Meter names: `playwright_minutes`, `k6_vu_minutes`
- Batch processing with retry logic

#### Better Auth Usage Plugin

- Client-side event ingestion via `authClient.usage.ingestion()`
- Customer meter listing via `authClient.usage.meters.list()`

---

## UI Components

### Billing Page Integration

The billing system integrates seamlessly with the existing UI:

#### Billing Dashboard

```typescript
// app/components/billing/billing-dashboard.tsx
import { BillingDashboard } from "@/components/billing/billing-dashboard";

export default function BillingPage() {
  return (
    <div className="container mx-auto py-8">
      <BillingDashboard />
    </div>
  );
}
```

#### Usage Display Components

**UsageMeter Component**:

```typescript
<UsageMeter
  label="Playwright Execution Minutes"
  used={usage.playwrightMinutes.used}
  included={usage.playwrightMinutes.included}
  unit="minutes"
  icon={<Activity className="h-4 w-4" />}
  showOverage
  overage={usage.playwrightMinutes.overage}
  overageCost={playwrightOverageCost}
/>
```

**UsageDashboard Component**:

```typescript
<UsageDashboard
  usage={billingData.usage}
  limits={billingData.limits}
  plan={{ name: "Plus", overagePricing: pricing }}
  periodEnd={billingData.currentPeriod.end}
/>
```

### Subscription Management

#### Plan Selection

```typescript
// app/components/billing/plan-selection.tsx
export function PlanSelection() {
  const { data: plans } = useQuery({
    queryKey: ["billing-plans"],
    queryFn: () => fetch("/api/billing/plans").then((r) => r.json()),
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {plans?.map((plan) => (
        <PlanCard
          key={plan.id}
          plan={plan}
          currentPlan={currentPlan}
          onUpgrade={() => handleUpgrade(plan.id)}
        />
      ))}
    </div>
  );
}
```

#### Upgrade Flow

```typescript
// app/components/billing/upgrade-button.tsx
export function UpgradeButton({ planId }: { planId: string }) {
  const handleUpgrade = async () => {
    const response = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId }),
    });

    const { checkoutUrl } = await response.json();
    window.location.href = checkoutUrl;
  };

  return (
    <Button onClick={handleUpgrade}>
      Upgrade to {planId === "pro" ? "Pro" : "Plus"}
    </Button>
  );
}
```

### Customer Portal

> [!IMPORTANT] > **Access Control**: Only Organization Owners (`org_owner` role) can access the Manage Subscription button and Polar customer portal. This is because:
>
> 1. The Polar customer is created and linked to the organization owner's email during signup
> 2. The Polar customer portal authenticates based on the customer's email
> 3. Org admins invited later have different emails that don't match the Polar customer
>
> **Implementation**: The `SubscriptionTab` component receives `currentUserRole` prop and conditionally renders the "Manage Subscription" button only for `org_owner` role.

```typescript
// app/components/org-admin/subscription-tab.tsx
interface SubscriptionTabProps {
  /**
   * Current user's role in the organization.
   * Only org_owner can manage subscription (access Polar customer portal).
   */
  currentUserRole?: string;
}

export function SubscriptionTab({ currentUserRole }: SubscriptionTabProps) {
  // Only org owners can manage subscription (access Polar customer portal)
  const canManageSubscription = currentUserRole === "org_owner";

  // ... component logic ...

  return (
    <div>
      {/* Only show Manage Subscription button for org owners */}
      {canManageSubscription && (
        <Button onClick={handleManageSubscription}>Manage Subscription</Button>
      )}
    </div>
  );
}
```

### Usage Alerts

```typescript
// app/components/billing/usage-alerts.tsx
export function UsageAlerts({ usage }: { usage: UsageData }) {
  const isNearLimit = usage.playwrightMinutes.percentage >= 80;
  const isOverLimit = usage.playwrightMinutes.percentage >= 100;

  if (!isNearLimit) return null;

  return (
    <Alert variant={isOverLimit ? "destructive" : "default"}>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>
        {isOverLimit ? "Usage Limit Exceeded" : "Approaching Usage Limit"}
      </AlertTitle>
      <AlertDescription>
        You've used {usage.playwrightMinutes.percentage}% of your Playwright
        minutes.
        {isOverLimit && " Overage charges will apply."}
      </AlertDescription>
    </Alert>
  );
}
```

---

## Database Schema

### Organization Table (Modified)

Added fields for subscription management:

```sql
ALTER TABLE organization ADD COLUMN polar_customer_id VARCHAR(255);
ALTER TABLE organization ADD COLUMN subscription_plan VARCHAR(50); -- Nullable: cloud users start without plan
ALTER TABLE organization ADD COLUMN subscription_status VARCHAR(50) DEFAULT 'none';
ALTER TABLE organization ADD COLUMN subscription_id VARCHAR(255);

-- Subscription period dates from Polar webhooks (startsAt/endsAt)
-- These track the actual billing cycle for accurate billing period calculation
ALTER TABLE organization ADD COLUMN subscription_started_at TIMESTAMP; -- When subscription period starts
ALTER TABLE organization ADD COLUMN subscription_ends_at TIMESTAMP;    -- When subscription period ends

-- Usage tracking fields
ALTER TABLE organization ADD COLUMN playwright_minutes_used INTEGER DEFAULT 0;
ALTER TABLE organization ADD COLUMN k6_vu_minutes_used INTEGER DEFAULT 0; -- Integer for whole VU-minutes
ALTER TABLE organization ADD COLUMN usage_period_start TIMESTAMP;  -- Start of current usage/billing period
ALTER TABLE organization ADD COLUMN usage_period_end TIMESTAMP;    -- End of current usage/billing period
```

> [!NOTE] > **Billing Period Calculation**: The `usage_period_start` and `usage_period_end` fields are set from Polar's `startsAt` and `endsAt` webhook payload fields. This ensures billing periods align with the actual subscription cycle (e.g., subscription starting Nov 15 → billing period Nov 15 - Dec 15) rather than calendar months (which would incorrectly be Nov 15 - Dec 1).

> [!IMPORTANT] > **Cloud Mode Defaults**: Organizations created in cloud mode start with `subscription_plan = NULL` and `subscription_status = 'none'`. Users must subscribe to Plus or Pro via Polar to create resources.
>
> **Self-Hosted Mode Defaults**: Organizations created in self-hosted mode get `subscription_plan = 'unlimited'` and `subscription_status = 'active'` immediately.

### Plan Limits Table (New)

Stores plan configuration:

```sql
CREATE TABLE plan_limits (
  plan VARCHAR(50) PRIMARY KEY,
  max_monitors INTEGER NOT NULL,
  max_status_pages INTEGER NOT NULL,
  max_team_members INTEGER NOT NULL,
  max_organizations INTEGER NOT NULL,
  max_projects INTEGER NOT NULL,
  playwright_minutes_included INTEGER NOT NULL,
  k6_vu_minutes_included INTEGER NOT NULL,
  running_capacity INTEGER NOT NULL,
  queued_capacity INTEGER NOT NULL,
  data_retention_days INTEGER NOT NULL,
  custom_domains BOOLEAN DEFAULT FALSE,
  sso_enabled BOOLEAN DEFAULT FALSE
);

-- Seed data (Plus, Pro, Unlimited only - no free tier)
INSERT INTO plan_limits VALUES
('plus', 25, 5, 5, 1, 10, 500, 6000, 5, 50, 30, false, false),
('pro', 100, 20, 20, 3, 50, 2000, 30000, 10, 100, 90, true, true),
('unlimited', 999999, 999999, 999999, 999999, 999999, 999999, 999999, 999, 9999, 365, true, true);
```

### Usage Events Table (New)

Tracks individual usage events for audit and billing:

```sql
CREATE TABLE usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id),
  event_type VARCHAR(50) NOT NULL, -- 'playwright_execution', 'k6_execution', 'monitor_execution'
  event_name VARCHAR(100) NOT NULL, -- 'playwright_minutes', 'k6_vu_minutes'
  units NUMERIC(10,4) NOT NULL,
  unit_type TEXT NOT NULL, -- 'minutes', 'vu_minutes'
  metadata TEXT, -- JSON
  synced_to_polar BOOLEAN DEFAULT false,
  polar_event_id TEXT,
  sync_attempts INTEGER DEFAULT 0,
  sync_error TEXT,
  last_sync_attempt TIMESTAMP,
  billing_period_start TIMESTAMP,
  billing_period_end TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_usage_events_org_id ON usage_events(organization_id);
CREATE INDEX idx_usage_events_synced ON usage_events(synced_to_polar);
CREATE INDEX idx_usage_events_period ON usage_events(billing_period_start, billing_period_end);
```

### Billing Settings Table (New)

Organization-specific billing preferences including spending limits and notification controls:

```sql
CREATE TABLE billing_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id) UNIQUE,

  -- Spending limits (in cents to avoid floating point issues)
  monthly_spending_limit_cents INTEGER, -- null = no limit
  enable_spending_limit BOOLEAN DEFAULT false,
  hard_stop_on_limit BOOLEAN DEFAULT false, -- Hard stop when limit reached vs soft warning

  -- Usage notification thresholds (percentages)
  notify_at_50_percent BOOLEAN DEFAULT false,
  notify_at_80_percent BOOLEAN DEFAULT true,
  notify_at_90_percent BOOLEAN DEFAULT true,
  notify_at_100_percent BOOLEAN DEFAULT true,

  -- Notification recipients (JSON array of emails, null = org admins only)
  notification_emails TEXT, -- JSON array

  -- Track which notifications have been sent this period
  last_notification_sent_at TIMESTAMP,
  notifications_sent_this_period TEXT, -- JSON array of thresholds

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Features:**

- **Spending Limits**: Set monthly overage spending cap in dollars
- **Hard Stop Enforcement**: When enabled, blocks test executions when limit is reached
- **Usage Alerts**: Configurable notifications at 50%, 80%, 90%, 100% of quota
- **Custom Recipients**: Specify additional emails for notifications beyond org admins
- **Notification Tracking**: Prevents duplicate notifications in same billing period

### Usage Notifications Table (New)

Tracks all usage-related notifications sent to organizations:

```sql
CREATE TABLE usage_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id),

  -- Notification type
  notification_type VARCHAR(50) NOT NULL, -- 'usage_50_percent', 'usage_80_percent',
                                          -- 'usage_90_percent', 'usage_100_percent',
                                          -- 'spending_limit_warning', 'spending_limit_reached'

  -- Resource type (playwright, k6, combined, or spending)
  resource_type VARCHAR(50) NOT NULL, -- 'playwright', 'k6', 'combined', 'spending'

  -- Usage details at time of notification
  usage_amount NUMERIC(10,4) NOT NULL,
  usage_limit NUMERIC(10,4) NOT NULL,
  usage_percentage INTEGER NOT NULL,

  -- Spending details (for spending limit notifications)
  current_spending_cents INTEGER,
  spending_limit_cents INTEGER,

  -- Recipients
  sent_to TEXT NOT NULL, -- JSON array of emails

  -- Delivery status
  delivery_status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'sent', 'failed'
  delivery_error TEXT,

  -- Billing period
  billing_period_start TIMESTAMP NOT NULL,
  billing_period_end TIMESTAMP NOT NULL,

  created_at TIMESTAMP DEFAULT NOW(),
  sent_at TIMESTAMP
);

CREATE INDEX idx_usage_notifications_org_id ON usage_notifications(organization_id);
CREATE INDEX idx_usage_notifications_type ON usage_notifications(notification_type);
```

**Purpose**: Audit trail of all notifications sent, enabling:

- Duplicate prevention within billing period
- Delivery failure tracking and retry
- Historical record for support and debugging

### Overage Pricing Table (New)

Configures overage rates for each plan:

```sql
CREATE TABLE overage_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan VARCHAR(50) NOT NULL UNIQUE,

  -- Overage pricing (in cents per unit)
  playwright_minute_price_cents INTEGER NOT NULL, -- e.g., 10 = $0.10 per minute
  k6_vu_minute_price_cents INTEGER NOT NULL,     -- e.g., 1 = $0.01 per VU-minute
  ai_credit_price_cents INTEGER NOT NULL DEFAULT 5, -- e.g., 5 = $0.05 per credit

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Seed overage pricing
INSERT INTO overage_pricing VALUES
(gen_random_uuid(), 'plus', 10, 1, 5),   -- $0.10/min, $0.01/VU-min, $0.05/credit
(gen_random_uuid(), 'pro', 8, 1, 3);    -- $0.08/min, $0.01/VU-min, $0.03/credit
```

### Migration Script

```sql
-- File: 0002_add_subscription_dates.sql
-- Add subscription date fields to organization table
ALTER TABLE organization ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMP;
ALTER TABLE organization ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMP;

-- Add comments
COMMENT ON COLUMN organization.subscription_started_at IS 'Start of current subscription period from Polar webhook (startsAt)';
COMMENT ON COLUMN organization.subscription_ends_at IS 'End of current subscription period from Polar webhook (endsAt) - used for billing cycle';

-- Migrate existing data
UPDATE organization
SET
  usage_period_start = COALESCE(usage_period_start, subscription_started_at, created_at),
  usage_period_end = COALESCE(usage_period_end, subscription_ends_at,
    CASE
      WHEN subscription_started_at IS NOT NULL THEN subscription_started_at + INTERVAL '30 days'
      WHEN usage_period_start IS NOT NULL THEN usage_period_start + INTERVAL '30 days'
      ELSE created_at + INTERVAL '30 days'
    END
  )
WHERE subscription_status = 'active'
  AND (usage_period_start IS NULL OR usage_period_end IS NULL);
```

---

## Testing

### Unit Tests

#### Subscription Service Tests

```typescript
// tests/unit/subscription-service.test.ts
describe("SubscriptionService", () => {
  let service: SubscriptionService;
  let mockDb: jest.Mocked<Database>;

  beforeEach(() => {
    mockDb = createMockDatabase();
    service = new SubscriptionService(mockDb);
  });

  describe("requiresSubscription", () => {
    it("should return false in self-hosted mode", () => {
      process.env.SELF_HOSTED = "true";
      expect(service.requiresSubscription()).toBe(false);
    });

    it("should return true in cloud mode with Polar configured", () => {
      process.env.SELF_HOSTED = "false";
      process.env.POLAR_ACCESS_TOKEN = "test_token";
      expect(service.requiresSubscription()).toBe(true);
    });
  });

  describe("hasActiveSubscription", () => {
    it("should return true for active Plus subscription", async () => {
      mockDb.query.organization.findFirst.mockResolvedValue({
        subscriptionStatus: "active",
        subscriptionPlan: "plus",
      });

      const result = await service.hasActiveSubscription("org_123");
      expect(result).toBe(true);
    });

    it("should return false for canceled subscription", async () => {
      mockDb.query.organization.findFirst.mockResolvedValue({
        subscriptionStatus: "canceled",
        subscriptionPlan: "plus",
      });

      const result = await service.hasActiveSubscription("org_123");
      expect(result).toBe(false);
    });
  });

  describe("blockUntilSubscribed", () => {
    it("should throw error in cloud mode without subscription", async () => {
      process.env.SELF_HOSTED = "false";
      process.env.POLAR_ACCESS_TOKEN = "test_token";

      jest.spyOn(service, "hasActiveSubscription").mockResolvedValue(false);

      await expect(service.blockUntilSubscribed("org_123")).rejects.toThrow(
        "requires an active subscription"
      );
    });

    it("should pass in self-hosted mode", async () => {
      process.env.SELF_HOSTED = "true";

      await expect(
        service.blockUntilSubscribed("org_123")
      ).resolves.not.toThrow();
    });
  });
});
```

#### Webhook Handler Tests

```typescript
// tests/unit/polar-webhooks.test.ts
describe("Polar Webhooks", () => {
  describe("handleSubscriptionActive", () => {
    it("should activate Plus subscription", async () => {
      const payload = {
        type: "subscription.active",
        data: {
          id: "sub_123",
          customerId: "cus_456",
          productId: "prod_plus",
          status: "active",
          startsAt: "2025-01-15T00:00:00Z",
          endsAt: "2025-02-15T00:00:00Z",
        },
      };

      mockDb.query.organization.findFirst.mockResolvedValue({
        id: "org_789",
        polarCustomerId: "cus_456",
      });

      await handleSubscriptionActive(payload);

      expect(mockSubscriptionService.updateSubscription).toHaveBeenCalledWith(
        "org_789",
        expect.objectContaining({
          subscriptionPlan: "plus",
          subscriptionStatus: "active",
          subscriptionStartedAt: new Date("2025-01-15T00:00:00Z"),
          subscriptionEndsAt: new Date("2025-02-15T00:00:00Z"),
        })
      );
    });

    it("should handle missing customer ID", async () => {
      const payload = {
        type: "subscription.active",
        data: { id: "sub_123" },
      };

      await handleSubscriptionActive(payload);

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Missing customerId")
      );
    });
  });
});
```

#### Usage Tracker Tests

```typescript
// tests/unit/usage-tracker.test.ts
describe("UsageTrackerService", () => {
  let service: UsageTrackerService;
  let mockDb: jest.Mocked<Database>;

  beforeEach(() => {
    mockDb = createMockDatabase();
    service = new UsageTrackerService(mockDb);
  });

  describe("trackPlaywrightExecution", () => {
    it("should track usage and update counters", async () => {
      const organizationId = "org_123";
      const executionTimeMs = 125000; // ~3 minutes

      mockDb.query.organization.findFirst.mockResolvedValue({
        id: organizationId,
        usagePeriodStart: new Date(),
        usagePeriodEnd: new Date(),
      });

      const result = await service.trackPlaywrightExecution(
        organizationId,
        executionTimeMs
      );

      expect(result.blocked).toBe(false);
      expect(mockDb.update).toHaveBeenCalledWith(
        expect.objectContaining({
          playwrightMinutesUsed: expect.any(Object),
        })
      );
    });

    it("should handle errors gracefully", async () => {
      mockDb.query.organization.findFirst.mockRejectedValue(
        new Error("Database error")
      );

      const result = await service.trackPlaywrightExecution("org_123", 60000);

      expect(result.blocked).toBe(false);
      expect(console.error).toHaveBeenCalled();
    });
  });
});
```

### Integration Tests

#### End-to-End Subscription Flow

```typescript
// tests/integration/subscription-flow.test.ts
describe("Subscription Flow", () => {
  let testApp: TestApplication;
  let polarClient: MockPolarClient;

  beforeAll(async () => {
    testApp = await createTestApplication();
    polarClient = createMockPolarClient();
  });

  it("should complete full subscription flow", async () => {
    // 1. User signs up
    const signupResponse = await testApp.request
      .post("/api/auth/sign-up")
      .send({
        email: "test@example.com",
        password: "password123",
        name: "Test User",
      });

    expect(signupResponse.status).toBe(200);
    const { user } = signupResponse.body;

    // 2. Customer created in Polar
    expect(polarClient.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "test@example.com",
        name: "Test User",
      })
    );

    // 3. User creates organization
    const orgResponse = await testApp.request
      .post("/api/organizations")
      .set("Authorization", `Bearer ${user.sessionToken}`)
      .send({
        name: "Test Org",
      });

    expect(orgResponse.status).toBe(200);
    const { organization } = orgResponse.body;

    // 4. User subscribes to Plus plan
    const checkoutResponse = await testApp.request
      .post("/api/billing/checkout")
      .set("Authorization", `Bearer ${user.sessionToken}`)
      .send({
        planId: "plus",
      });

    expect(checkoutResponse.status).toBe(200);
    const { checkoutUrl } = checkoutResponse.body;

    // 5. Simulate successful payment webhook
    const webhookResponse = await testApp.request
      .post("/api/auth/polar/webhooks")
      .set("X-Polar-Signature", "valid_signature")
      .send({
        type: "subscription.active",
        data: {
          id: "sub_123",
          customerId: organization.polarCustomerId,
          productId: process.env.POLAR_PLUS_PRODUCT_ID,
          status: "active",
          startsAt: "2025-01-15T00:00:00Z",
          endsAt: "2025-02-15T00:00:00Z",
        },
      });

    expect(webhookResponse.status).toBe(200);

    // 6. Verify subscription activated
    const billingResponse = await testApp.request
      .get("/api/billing/current")
      .set("Authorization", `Bearer ${user.sessionToken}`);

    expect(billingResponse.status).toBe(200);
    expect(billingResponse.body.organization.subscriptionPlan).toBe("plus");
    expect(billingResponse.body.organization.subscriptionStatus).toBe("active");
  });
});
```

#### Usage Tracking Integration

```typescript
// tests/integration/usage-tracking.test.ts
describe("Usage Tracking Integration", () => {
  it("should track usage and sync to Polar", async () => {
    const organizationId = "org_123";

    // 1. Track Playwright usage
    await usageTracker.trackPlaywrightExecution(
      organizationId,
      125000, // ~3 minutes
      { testId: "test_456" }
    );

    // 2. Verify local tracking
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
    });

    expect(org?.playwrightMinutesUsed).toBe(3);

    // 3. Verify usage event recorded
    const events = await db.query.usageEvents.findMany({
      where: eq(usageEvents.organizationId, organizationId),
    });

    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("playwright_execution");
    expect(events[0].units).toBe("3");
    expect(events[0].syncedToPolar).toBe(false);

    // 4. Sync to Polar
    const syncResult = await polarUsageService.syncPendingEvents();

    expect(syncResult.succeeded).toBe(1);
    expect(syncResult.failed).toBe(0);

    // 5. Verify synced
    const syncedEvents = await db.query.usageEvents.findFirst({
      where: eq(usageEvents.id, events[0].id),
    });

    expect(syncedEvents?.syncedToPolar).toBe(true);
  });
});
```

### Performance Tests

#### Usage Tracking Performance

```typescript
// tests/performance/usage-tracking.test.ts
describe("Usage Tracking Performance", () => {
  it("should handle high-volume usage tracking", async () => {
    const startTime = Date.now();
    const promises = [];

    // Track 1000 usage events concurrently
    for (let i = 0; i < 1000; i++) {
      promises.push(
        usageTracker.trackPlaywrightExecution(
          `org_${i % 10}`, // 10 different orgs
          Math.random() * 60000, // Random execution time
          { testId: `test_${i}` }
        )
      );
    }

    await Promise.all(promises);
    const duration = Date.now() - startTime;

    // Should complete within 5 seconds
    expect(duration).toBeLessThan(5000);

    // Verify all events recorded
    const eventCount = await db.query.usageEvents.findMany();
    expect(eventCount).toHaveLength(1000);
  });
});
```

---

## Deployment

### Environment Configuration

#### Production Environment Variables

```bash
# Production .env
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://app.supercheck.io
BETTER_AUTH_URL=https://app.supercheck.io
BETTER_AUTH_SECRET=your_production_secret

# Polar Production
SELF_HOSTED=false
POLAR_ACCESS_TOKEN=prod_live_xxxx
POLAR_SERVER=production
POLAR_WEBHOOK_SECRET=whsec_xxxx
POLAR_PLUS_PRODUCT_ID=prod_plus_xxxx
POLAR_PRO_PRODUCT_ID=prod_pro_xxxx

# Database
DATABASE_URL=postgresql://user:pass@host:5432/supercheck_prod

# Redis (for caching)
REDIS_URL=redis://user:pass@host:6379

# Email (for billing notifications)
SMTP_HOST=smtp.sendgrid.net
SMTP_USER=apikey
SMTP_PASS=your_sendgrid_api_key
```

#### Staging Environment

```bash
# Staging .env
NODE_ENV=staging
NEXT_PUBLIC_APP_URL=https://staging.supercheck.io
BETTER_AUTH_URL=https://staging.supercheck.io

# Polar Sandbox
POLAR_ACCESS_TOKEN=sandbox_test_xxxx
POLAR_SERVER=sandbox
POLAR_WEBHOOK_SECRET=whsec_test_xxxx
POLAR_PLUS_PRODUCT_ID=sandbox_plus_xxxx
POLAR_PRO_PRODUCT_ID=sandbox_pro_xxxx
```

### Database Migration

```bash
# Run migrations in production
cd app
npm run db:migrate

# Verify migration success
npm run db:studio
# Check that new columns exist in organization table
```

### Webhook Configuration

#### Production Webhook Setup

1. **Configure Polar Webhook**:

   - URL: `https://app.supercheck.io/api/auth/polar/webhooks`
   - Secret: Copy from `POLAR_WEBHOOK_SECRET`
   - Events: `subscription.active`, `subscription.updated`, `subscription.canceled`, `order.paid`

2. **Verify Webhook Reachability**:

   ```bash
   curl -v -X POST https://app.supercheck.io/api/auth/polar/webhooks \
     -H "Content-Type: application/json" \
     -d '{"test": true}'
   # Expected: 401 (signature verification failed)
   ```

3. **Test Webhook Delivery**:
   - Create test subscription in Polar sandbox
   - Check application logs for webhook processing
   - Verify subscription status updates in database

### Monitoring Setup

#### Metrics to Monitor

```typescript
// Custom metrics for billing system
const billingMetrics = {
  // Subscription metrics
  activeSubscriptions: new Counter("billing_active_subscriptions_total"),
  subscriptionActivations: new Counter(
    "billing_subscription_activations_total"
  ),
  subscriptionFailures: new Counter("billing_subscription_failures_total"),

  // Usage metrics
  usageEventsTracked: new Counter("billing_usage_events_total"),
  usageSyncAttempts: new Counter("billing_usage_sync_attempts_total"),
  usageSyncFailures: new Counter("billing_usage_sync_failures_total"),

  // Enforcement metrics
  planEnforcementBlocks: new Counter("billing_plan_enforcement_blocks_total"),
  limitExceededEvents: new Counter("billing_limit_exceeded_total"),
};
```

#### Alert Rules

```yaml
# alerts/billing.yml
groups:
  - name: billing
    rules:
      - alert: HighSyncFailureRate
        expr: billing_usage_sync_failures_total / billing_usage_sync_attempts_total > 0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Usage sync failure rate is above 5%"

      - alert: PendingUsageEvents
        expr: billing_pending_events_count > 1000
        for: 10m
        labels:
          severity: critical
        annotations:
          summary: "Too many pending usage events"

      - alert: SubscriptionWebhookFailure
        expr: increase(billing_subscription_failures_total[1h]) > 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Subscription webhook failures detected"
```

### Cron Job Setup

#### Production Sync Job

```bash
# Add to production crontab
# Sync usage events every 5 minutes
*/5 * * * * curl -X POST https://app.supercheck.io/api/admin/sync-usage-events \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  >> /var/log/supercheck/sync.log 2>&1

# Daily billing report
0 8 * * * curl -X POST https://app.supercheck.io/api/admin/billing-report \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  >> /var/log/supercheck/billing-report.log 2>&1
```

#### Kubernetes CronJob

```yaml
# k8s/cronjobs/sync-usage.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: sync-usage-events
spec:
  schedule: "*/5 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: sync-usage
              image: supercheck/app:latest
              command:
                - curl
                - -X POST
                - http://app:3000/api/admin/sync-usage-events
                - -H
                - Authorization: Bearer $ADMIN_API_KEY
              env:
                - name: ADMIN_API_KEY
                  valueFrom:
                    secretKeyRef:
                      name: app-secrets
                      key: admin-api-key
          restartPolicy: OnFailure
```

### Security Considerations

#### Defense-in-Depth Billing Enforcement (Updated December 2024)

The billing system uses a defense-in-depth approach with multiple layers of protection:

**Layer 1: `blockUntilSubscribed()`**

- Checks if organization has an active subscription (plan !== null AND status === 'active')
- Throws error immediately if no subscription, preventing any resource creation
- Self-hosted mode: Always passes (unlimited access)

**Layer 2: `requireValidPolarCustomer()`**

- Validates that the Polar customer ID still exists in Polar's system
- Uses caching (60s TTL) to prevent excessive API calls
- If customer was deleted from Polar, blocks access immediately
- Handles timeouts gracefully (fails closed for safety)

**Layer 3: `getOrganizationPlan()`**

- Retrieves plan limits from database
- SECURITY: Validates plan is legitimate ("plus" or "pro" only in cloud mode)
- Throws error if "unlimited" plan detected in cloud mode (possible DB tampering)

**Layer 4: Resource-specific limit checks**

- `checkMonitorLimit()`, `checkProjectLimit()`, `checkTeamMemberLimit()`, etc.
- Validates against plan-specific quotas
- Returns detailed error messages for UI

#### Protected API Routes

All resource-creation routes MUST include billing guards in cloud mode:

| Route                                    | Guards Applied                                       |
| ---------------------------------------- | ---------------------------------------------------- |
| `POST /api/tests`                        | `blockUntilSubscribed` + `requireValidPolarCustomer` |
| `POST /api/jobs`                         | `blockUntilSubscribed` + `requireValidPolarCustomer` |
| `POST /api/monitors`                     | `blockUntilSubscribed` + `requireValidPolarCustomer` |
| `POST /api/projects`                     | `blockUntilSubscribed` + `requireValidPolarCustomer` |
| `POST /api/jobs/[id]/trigger`            | `blockUntilSubscribed` + `requireValidPolarCustomer` |
| `POST /api/tests/[id]/execute`           | `blockUntilSubscribed` + `requireValidPolarCustomer` |
| `POST /api/ai/fix-test`                  | `blockUntilSubscribed` + `requireValidPolarCustomer` |
| `POST /api/ai/create-test`               | `blockUntilSubscribed` + `requireValidPolarCustomer` |
| `POST /api/organizations/members/invite` | `checkTeamMemberLimit` (includes subscription check) |

#### Webhook Handlers for Access Revocation

Critical webhook handlers that IMMEDIATELY revoke access:

1. **`subscription.revoked`** - Called when:

   - Payment fails permanently
   - Fraud detected
   - Admin manually revokes subscription
   - Sets `subscriptionStatus = 'none'` and `subscriptionPlan = null`

2. **`customer.deleted`** - Called when:

   - Customer deleted from Polar dashboard
   - Account cleanup/deletion
   - Sets `subscriptionStatus = 'none'`
   - Keeps `polarCustomerId` for audit trail (customer will fail validation in Polar API)

3. **`subscription.canceled`** - Called when:
   - User cancels subscription
   - Sets `subscriptionStatus = 'canceled'`
   - User retains access until billing period ends (graceful cancellation)

#### Plan Validation Security

```typescript
// SECURITY: In updateSubscription()
if (isPolarEnabled() && data.subscriptionPlan === "unlimited") {
  console.error(`[SECURITY] Attempted to set unlimited plan in cloud mode`);
  throw new Error("Unlimited plan is only available in self-hosted mode");
}

// SECURITY: In getOrganizationPlan()
if (org.subscriptionPlan === "unlimited") {
  console.error(
    `[SECURITY] Organization has unlimited plan in cloud mode - possible DB tampering`
  );
  throw new Error(
    "Invalid subscription plan detected. Please contact support."
  );
}
```

#### Webhook Security

```typescript
// Verify webhook signatures in production
app.post("/api/auth/polar/webhooks", (req, res) => {
  const signature = req.headers["x-polar-signature"];
  const payload = req.body;

  if (
    !verifyWebhookSignature(
      payload,
      signature,
      process.env.POLAR_WEBHOOK_SECRET!
    )
  ) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  // Process webhook...
});
```

#### API Rate Limiting

```typescript
// Rate limit billing endpoints
import rateLimit from "express-rate-limit";

const billingRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  message: "Too many billing requests",
});

app.use("/api/billing", billingRateLimit);
```

#### Database Security

```sql
-- Restrict access to billing tables
CREATE ROLE billing_readonly;
GRANT SELECT ON plan_limits, overage_pricing TO billing_readonly;
GRANT SELECT, INSERT, UPDATE ON usage_events TO billing_service;

-- Row Level Security for organization data
ALTER TABLE organization ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON organization
  FOR ALL TO application_user
  USING (id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = current_user_id()
  ));
```

---

## Troubleshooting

### Common Issues

#### 1. Polar Plugin Not Loading

**Symptoms**:

- No customer created on signup
- `/billing` page shows "Polar not configured"
- Webhook events not being processed

**Debug Steps**:

```bash
# Check environment variables
echo $POLAR_ACCESS_TOKEN
echo $POLAR_WEBHOOK_SECRET
echo $SELF_HOSTED

# Check application logs
tail -f logs/app.log | grep -i polar

# Verify plugin initialization
curl http://localhost:3000/api/auth/session | jq .
```

**Solution**:

1. Verify all Polar environment variables are set
2. Check that `SELF_HOSTED=false` for cloud mode
3. Restart the application after fixing environment variables
4. Ensure Polar access token is valid and has proper permissions

#### 2. Webhook Not Receiving Events

**Symptoms**:

- Subscription not activating after payment
- Plan limits not updating
- No webhook logs in application

**Debug Steps**:

```bash
# Test webhook endpoint
curl -v -X POST https://your-domain.com/api/auth/polar/webhooks \
  -H "Content-Type: application/json" \
  -d '{"test": true}'

# Check webhook configuration in Polar dashboard
# Verify URL matches exactly
# Check webhook secret matches POLAR_WEBHOOK_SECRET

# Check webhook delivery logs in Polar dashboard
# Look for failed deliveries and error messages
```

**Solution**:

1. Ensure webhook URL is publicly accessible (not localhost)
2. Verify webhook secret matches environment variable exactly
3. Check SSL certificate is valid for production URLs
4. Review Polar webhook delivery logs for specific errors

#### 3. Usage Not Tracking

**Symptoms**:

- Usage meters showing 0 despite test executions
- No overage charges when expected
- `usage_events` table empty

**Debug Steps**:

```sql
-- Check organization has subscription
SELECT id, subscription_plan, subscription_status, polar_customer_id
FROM organization
WHERE id = 'your-org-id';

-- Check recent usage events
SELECT * FROM usage_events
WHERE organization_id = 'your-org-id'
  AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;

-- Check worker logs for usage tracking
tail -f logs/worker.log | grep "Usage"
```

**Solution**:

1. Verify organization has active subscription in cloud mode
2. Check that usage tracking is called after test execution
3. Ensure worker service is running and connected to database
4. Review worker logs for tracking errors

#### 4. Usage Sync Failing

**Symptoms**:

- Growing number of pending usage events
- `synced_to_polar = false` in database
- Overages not billed to customers

**Debug Steps**:

```sql
-- Check sync status
SELECT
  COUNT(*) as total,
  COUNT(CASE WHEN synced_to_polar = true THEN 1 END) as synced,
  COUNT(CASE WHEN synced_to_polar = false THEN 1 END) as pending
FROM usage_events;

-- Check recent sync errors
SELECT event_type, sync_error, sync_attempts, last_sync_attempt
FROM usage_events
WHERE synced_to_polar = false
  AND sync_error IS NOT NULL
ORDER BY last_sync_attempt DESC
LIMIT 10;

-- Test Polar API connection
curl -H "Authorization: Bearer $POLAR_ACCESS_TOKEN" \
  https://api.polar.sh/v1/customers
```

**Solution**:

1. Verify Polar access token is valid and not expired
2. Check that meters are created in Polar dashboard
3. Ensure customer IDs match between database and Polar
4. Run manual sync to test connection

#### 5. Plan Enforcement Not Working

**Symptoms**:

- Users can exceed monitor limits
- Resource creation not blocked
- Enforcement middleware not triggered

**Debug Steps**:

```typescript
// Check enforcement middleware is applied
console.log(app._router.stack); // Look for enforcement middleware

// Test plan enforcement directly
const result = await checkMonitorLimit(orgId, currentCount);
console.log(result); // Should show blocked: true

// Check organization plan
const org = await db.query.organization.findFirst({
  where: eq(organization.id, orgId),
});
console.log(org.subscriptionPlan); // Should be 'plus' or 'pro'
```

**Solution**:

1. Verify enforcement middleware is applied to relevant routes
2. Check that database migration ran successfully
3. Ensure organization has correct subscription plan set
4. Review plan limits table has correct values

### Debugging Tools

#### Webhook Endpoint Testing

```bash
# Webhook endpoint only accepts POST requests (handled by Better Auth)
# Test by triggering a webhook redelivery from Polar dashboard
# Check logs for: [Polar] Webhook: <event_type>

# If you need to verify the route is reachable:
curl -v -X POST https://demo.supercheck.io/api/auth/polar/webhooks \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
# Expected: 401 (signature verification failure) - this confirms route is reachable
```

#### Database Verification

```sql
-- Check plan limits are seeded correctly
SELECT plan, max_monitors, running_capacity, max_team_members
FROM plan_limits
ORDER BY max_monitors;

-- Check organizations with Polar customers
SELECT id, name, subscription_plan, subscription_status, polar_customer_id
FROM organization
WHERE polar_customer_id IS NOT NULL;

-- Check subscription dates are properly set
SELECT id, name, subscription_started_at, subscription_ends_at,
       usage_period_start, usage_period_end
FROM organization
WHERE subscription_status = 'active';

-- Check usage sync status
SELECT
  event_type,
  COUNT(*) as total_events,
  COUNT(CASE WHEN synced_to_polar = true THEN 1 END) as synced,
  COUNT(CASE WHEN synced_to_polar = false THEN 1 END) as pending,
  MAX(last_sync_attempt) as last_sync
FROM usage_events
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY event_type;
```

#### Manual Sync Testing

```typescript
// Test manual sync of pending events
const polarUsageService = new PolarUsageService();
const result = await polarUsageService.syncPendingEvents(10);

console.log(`Synced ${result.succeeded}/${result.processed} events`);
if (result.errors.length > 0) {
  console.error("Sync errors:", result.errors);
}
```

#### Plan Enforcement Testing

```typescript
// Test each enforcement function
const enforcementResults = {
  monitors: await checkMonitorLimit(orgId, currentMonitorCount),
  projects: await checkProjectLimit(orgId, currentProjectCount),
  statusPages: await checkStatusPageLimit(orgId, currentPageCount),
  teamMembers: await checkTeamMemberLimit(orgId, currentMemberCount),
};

console.log(enforcementResults);
// Each should show: { allowed: boolean, error?: string }
```

### Performance Issues

#### High Database Load

**Symptoms**:

- Slow billing API responses
- Database connection exhaustion
- Usage tracking delays

**Solutions**:

```sql
-- Add indexes for better performance
CREATE INDEX CONCURRENTLY idx_organization_polar_customer
  ON organization(polar_customer_id);

CREATE INDEX CONCURRENTLY idx_usage_events_sync_batch
  ON usage_events(synced_to_polar, created_at)
  WHERE synced_to_polar = false;

-- Partition usage_events table by month
CREATE TABLE usage_events_y2025m01 PARTITION OF usage_events
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
```

#### Sync Job Performance

**Optimizations**:

```typescript
// Batch size optimization
const optimalBatchSize = 100; // Adjust based on testing
const result = await polarUsageService.syncPendingEvents(optimalBatchSize);

// Parallel sync processing
const events = await getPendingEvents(500);
const chunks = chunk(events, 50); // Process in parallel chunks
await Promise.all(chunks.map((chunk) => syncChunk(chunk)));
```

### Emergency Procedures

#### Manual Subscription Activation

```sql
-- Emergency: Activate subscription manually
UPDATE organization
SET
  subscription_status = 'active',
  subscription_plan = 'plus',
  subscription_started_at = NOW(),
  subscription_ends_at = NOW() + INTERVAL '30 days',
  usage_period_start = NOW(),
  usage_period_end = NOW() + INTERVAL '30 days'
WHERE id = 'org-id-here';
```

#### Reset Usage Counters

```sql
-- Emergency: Reset usage for organization
UPDATE organization
SET
  playwright_minutes_used = 0,
  k6_vu_minutes_used = 0,
  usage_period_start = NOW(),
  usage_period_end = NOW() + INTERVAL '30 days'
WHERE id = 'org-id-here';
```

#### Force Sync All Events

```typescript
// Emergency: Force resync of all events
await db.execute(sql`
  UPDATE usage_events 
  SET synced_to_polar = false, 
      sync_attempts = 0, 
      sync_error = NULL
  WHERE created_at > NOW() - INTERVAL '7 days'
`);

// Then run sync job
const result = await polarUsageService.syncPendingEvents(1000);
```

---

## Monitoring & Alerting

### Key Metrics

#### Subscription Metrics

- Active subscriptions by plan
- Subscription activation rate
- Churn rate (cancellations)
- Failed webhook deliveries

#### Usage Metrics

- Usage events per minute
- Sync success rate
- Pending event count
- Overages by plan

#### Business Metrics

- Monthly recurring revenue (MRR)
- Average revenue per user (ARPU)
- Customer acquisition cost (CAC)
- Lifetime value (LTV)

### Dashboard Configuration

```typescript
// Grafana dashboard panels
const dashboardPanels = [
  {
    title: "Active Subscriptions",
    type: "stat",
    query: "sum by (plan) (billing_active_subscriptions_total)",
  },
  {
    title: "Usage Sync Success Rate",
    type: "gauge",
    query:
      "rate(billing_usage_sync_success_total[5m]) / rate(billing_usage_sync_attempts_total[5m])",
  },
  {
    title: "Pending Usage Events",
    type: "stat",
    query: "billing_pending_events_count",
  },
  {
    title: "Plan Enforcement Blocks",
    type: "graph",
    query: "rate(billing_plan_enforcement_blocks_total[1h])",
  },
];
```

### Health Checks

```typescript
// app/api/health/billing/route.ts
export async function GET() {
  const health = {
    polar: {
      configured: isPolarEnabled(),
      tokenValid: await validatePolarToken(),
      webhookWorking: await testWebhookEndpoint(),
    },
    database: {
      connected: await testDatabaseConnection(),
      migrationsCurrent: await checkMigrations(),
    },
    sync: {
      lastSync: await getLastSuccessfulSync(),
      pendingEvents: await getPendingEventCount(),
    },
  };

  const isHealthy = Object.values(health).every((category) =>
    Object.values(category).every((status) => status !== false)
  );

  return NextResponse.json(health, {
    status: isHealthy ? 200 : 503,
  });
}
```

---

## Security Audit (December 2024)

### Audit Overview

This section documents a comprehensive security audit of the Polar billing integration, identifying potential loopholes and the fixes implemented.

### Findings Summary

| ID      | Severity     | Status   | Issue                                      | Resolution                                                                                                 |
| ------- | ------------ | -------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| SEC-001 | **CRITICAL** | ✅ Fixed | AI routes missing subscription checks      | Added `blockUntilSubscribed` + `requireValidPolarCustomer` to `/api/ai/fix-test` and `/api/ai/create-test` |
| SEC-002 | **HIGH**     | ✅ Fixed | Test execute missing billing guards        | Enhanced `/api/tests/[id]/execute` with full defense-in-depth checks                                       |
| SEC-003 | **MEDIUM**   | ✅ Fixed | Missing customer deletion handler          | Added `handleCustomerDeleted` webhook handler                                                              |
| SEC-004 | **MEDIUM**   | ✅ Fixed | Missing subscription revocation handler    | Added `handleSubscriptionRevoked` webhook handler                                                          |
| SEC-005 | **LOW**      | ⚠️ Noted | Webhook idempotency cache is in-memory     | Consider database-backed idempotency for production                                                        |
| SEC-006 | **LOW**      | ⚠️ Noted | `subscription.past_due` allows full access | Consider degraded access for past_due subscriptions                                                        |

### SEC-001: AI Routes Missing Subscription Checks (CRITICAL)

**Problem**: The AI fix and create endpoints (`/api/ai/fix-test`, `/api/ai/create-test`) did not check for active subscriptions. Users could consume AI credits without paying in cloud mode.

**Impact**: Potential revenue loss and resource abuse in cloud mode.

**Fix Applied**:

```typescript
// Added to both AI routes before any AI processing
const activeOrg = await getActiveOrganization();
if (activeOrg) {
  try {
    await subscriptionService.blockUntilSubscribed(activeOrg.id);
    await subscriptionService.requireValidPolarCustomer(activeOrg.id);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        reason: "subscription_required",
        message:
          error instanceof Error ? error.message : "Subscription required",
        guidance: "Please subscribe to a plan at /billing to use AI features",
      },
      { status: 402 }
    );
  }
}
```

### SEC-002: Test Execute Missing Billing Guards (HIGH)

**Problem**: The `/api/tests/[id]/execute` route only called `getOrganizationPlan()` which can throw but doesn't validate customer existence in Polar.

**Impact**: Users could trigger test executions without full billing validation.

**Fix Applied**:

```typescript
// Enhanced validation chain
await subscriptionService.blockUntilSubscribed(organizationId);
await subscriptionService.requireValidPolarCustomer(organizationId);
await subscriptionService.getOrganizationPlan(organizationId);
```

### SEC-003: Missing Customer Deletion Handler (MEDIUM)

**Problem**: When a customer was deleted from Polar dashboard, the webhook event wasn't handled, potentially allowing continued access.

**Impact**: Deleted Polar customers could retain access to resources.

**Fix Applied**: Added `handleCustomerDeleted` webhook handler:

```typescript
export async function handleCustomerDeleted(payload: PolarWebhookPayload) {
  const customerId = payload.data.id;
  const org = await db.query.organization.findFirst({
    where: eq(organization.polarCustomerId, customerId),
  });
  if (org) {
    await db
      .update(organization)
      .set({ subscriptionStatus: "none" })
      .where(eq(organization.id, org.id));
  }
}
```

### SEC-004: Missing Subscription Revocation Handler (MEDIUM)

**Problem**: No handler for `subscription.revoked` event, which means immediate termination scenarios weren't handled.

**Impact**: Users with revoked subscriptions (fraud, failed payment) could continue accessing resources.

**Fix Applied**: Added `handleSubscriptionRevoked` webhook handler:

```typescript
export async function handleSubscriptionRevoked(payload: PolarWebhookPayload) {
  const webhookId = payload.data.id;
  const org = await db.query.organization.findFirst({
    where: eq(organization.subscriptionId, webhookId),
  });
  if (org) {
    await subscriptionService.updateSubscription(org.id, {
      subscriptionStatus: "none",
      subscriptionPlan: null,
    });
  }
}
```

### SEC-005: In-Memory Webhook Idempotency Cache (LOW)

**Current Behavior**: Webhook idempotency is tracked in an in-memory Map with 24-hour TTL.

**Risk**: Server restarts could cause webhook events to be re-processed.

**Recommendation**: For high-availability production deployments, consider:

1. Database-backed idempotency table
2. Redis-based cache with TTL
3. Distributed cache for multi-instance deployments

**Current Mitigation**: The handlers are designed to be idempotent - re-processing typically results in no-op updates.

**Update (Jan 2025)**: Webhook idempotency is now database-backed using the `webhook_idempotency` table to handle multi-instance deployments. The in-memory Map has been replaced with persistent storage that survives restarts and works across multiple server instances.

### SEC-006: Full Access for `past_due` Subscriptions (LOW) ✅ RESOLVED

**Current Behavior**: Subscriptions with `status = 'past_due'` are **BLOCKED** from creating new resources.

**How It Works**: The `hasActiveSubscription()` function in `subscription-service.ts` explicitly checks:

```typescript
return (
  org.subscriptionPlan !== null && org.subscriptionStatus === "active" // Only "active" status passes
);
```

This means `past_due`, `canceled`, and `none` statuses are all blocked.

**User Experience**:

- Users with `past_due` status see subscription required errors when trying to create resources
- They can still view existing data and access the billing page to resolve payment issues
- Once payment is resolved, Polar sends `subscription.active` webhook to restore access

### Best Practices Implemented

1. **Defense-in-Depth**: Multiple validation layers (`blockUntilSubscribed` → `requireValidPolarCustomer` → `getOrganizationPlan`)
2. **Fail Closed**: Timeout errors and API failures result in blocked access, not allowed access
3. **Plan Validation**: Explicit checks that "unlimited" plan can never exist in cloud mode
4. **Audit Logging**: Webhook handlers log all subscription changes with truncated IDs
5. **Graceful Degradation**: Cancellation allows access until period end, revocation terminates immediately
6. **Database-Backed Idempotency**: Webhook deduplication survives restarts and works across instances

### Testing Coverage

All billing enforcement is covered by tests in:

- `app/src/app/api/handlers.spec.ts` - API route billing checks
- `app/src/lib/middleware/plan-enforcement.spec.ts` - Plan limit enforcement

Run tests with:

```bash
cd app && npm test -- --testPathPatterns="handlers" --testPathPatterns="plan-enforcement"
```

---

## Member Access Scenarios

### Overview

Subscription checks are **organization-level**, not user-level. This means all members of an organization are equally affected by the organization's subscription status.

### Subscription Status Impact on Members

| Subscription Status | Owner Access                | Member Access               | Notes                                            |
| ------------------- | --------------------------- | --------------------------- | ------------------------------------------------ |
| `active`            | ✅ Full access              | ✅ Full access              | Normal operation                                 |
| `past_due`          | ❌ Blocked                  | ❌ Blocked                  | Payment failed, can view billing page to resolve |
| `canceled`          | ⚠️ Limited until period end | ⚠️ Limited until period end | Can still access until subscriptionEndsAt        |
| `none`              | ❌ Blocked                  | ❌ Blocked                  | No subscription, must subscribe                  |
| Customer deleted    | ❌ Blocked                  | ❌ Blocked                  | Polar customer no longer exists                  |

### Detailed Scenarios

#### Scenario 1: Payment Failure (past_due)

**Trigger**: Polar sends `subscription.updated` with `status: 'past_due'`

**Impact**:

- ALL organization members are blocked from creating new resources
- Existing data remains accessible (read-only)
- Scheduled jobs/monitors continue running (they were already created)
- Billing page shows warning and link to resolve payment

**Resolution**:

- Organization owner updates payment method in Polar
- Polar sends `subscription.active` webhook
- Full access restored for all members

#### Scenario 2: Subscription Cancellation

**Trigger**: User cancels subscription via billing portal

**Impact**:

- Members retain access until `subscriptionEndsAt` date
- At period end, `subscription.revoked` webhook fires
- All members lose access to create new resources

**Behavior**:

```typescript
// In subscription-service.ts
// "canceled" status is NOT equal to "active", so hasActiveSubscription returns false
return org.subscriptionStatus === "active";
```

**Note**: The current implementation blocks immediately on cancellation. For grace period access, the code would need modification to check `subscriptionEndsAt`.

#### Scenario 3: Customer Deletion from Polar

**Trigger**: Polar admin deletes customer OR account fraud detected

**Impact**:

- `customer.deleted` webhook fires
- Organization's `subscriptionStatus` set to `none`
- ALL members immediately lose access

**Webhook Handler**:

```typescript
// In polar-webhooks.ts
await db
  .update(organization)
  .set({
    subscriptionStatus: "none",
  })
  .where(eq(organization.id, org.id));
```

#### Scenario 4: Subscription Revocation

**Trigger**: Polar sends `subscription.revoked` (fraud, repeated payment failures, etc.)

**Impact**:

- `subscriptionStatus` set to `none`
- `subscriptionPlan` cleared
- ALL members immediately lose access
- More severe than cancellation

#### Scenario 5: Plan Downgrade (Pro → Plus)

**Trigger**: User downgrades plan in billing portal

**Impact**:

- New plan limits apply immediately
- If over new limits, users see warnings but can continue
- No new resources can be created above new limits
- All members get new (lower) limits

#### Scenario 6: Plan Upgrade (Plus → Pro)

**Trigger**: User upgrades plan in billing portal

**Impact**:

- New (higher) limits apply immediately
- All members benefit from increased limits
- Usage counters continue (not reset)

### Member Permission Matrix

| Action             | Owner (active) | Owner (no sub) | Member (org active) | Member (org no sub) |
| ------------------ | -------------- | -------------- | ------------------- | ------------------- |
| Create test        | ✅             | ❌             | ✅                  | ❌                  |
| Create job         | ✅             | ❌             | ✅                  | ❌                  |
| Create monitor     | ✅             | ❌             | ✅                  | ❌                  |
| Create project     | ✅             | ❌             | ✅ (if admin+)      | ❌                  |
| Execute test       | ✅             | ❌             | ✅                  | ❌                  |
| Trigger job        | ✅             | ❌             | ✅                  | ❌                  |
| Use AI features    | ✅             | ❌             | ✅                  | ❌                  |
| View existing data | ✅             | ✅             | ✅                  | ✅                  |
| Access billing     | ✅             | ✅             | ❌                  | ❌                  |
| Invite members     | ✅             | ❌             | ❌                  | ❌                  |

### Edge Cases

#### Already Running Jobs

**Question**: What happens to running jobs when subscription becomes invalid?

**Answer**: Jobs that are already running will complete. The subscription check happens at job **trigger** time, not execution time. The worker doesn't re-check subscription during execution.

#### Scheduled Monitors

**Question**: Do monitors stop running when subscription is invalid?

**Answer**: Monitor execution is handled by the worker, which checks subscription status before each execution. Monitors will fail to run until subscription is restored.

#### Multiple Organizations

**Question**: If a user is a member of multiple organizations, does subscription status affect all?

**Answer**: No. Each organization has its own subscription. A user can have:

- Org A: Active subscription (full access)
- Org B: No subscription (blocked)

Access is checked per-organization, not per-user.

---

## Security Audit (December 2025)

### Audit Overview

This section documents a comprehensive security audit of the Polar billing integration, identifying critical issues and the fixes implemented to ensure production-ready, secure code.

### Findings Summary

| ID      | Severity     | Status   | Issue                                            | Resolution                                                    |
| ------- | ------------ | -------- | ------------------------------------------------ | ------------------------------------------------------------- |
| SEC-101 | **CRITICAL** | ✅ Fixed | Webhook idempotency race condition               | Changed to atomic INSERT ON CONFLICT pattern                  |
| SEC-102 | **HIGH**     | ✅ Fixed | Missing unique constraint on idempotency table   | Changed `index()` to `uniqueIndex()` in schema                |
| SEC-103 | **HIGH**     | ✅ Fixed | Customer ID linking race condition               | Added conditional update with `isNull()` check                |
| SEC-104 | **HIGH**     | ✅ Fixed | Canceled subscription loses access immediately   | Fixed `hasActiveSubscription()` to check `subscriptionEndsAt` |
| SEC-105 | **MEDIUM**   | ✅ Fixed | order.paid handler missing subscriptionId        | Now extracts and sets subscription ID from order payload      |
| SEC-106 | **MEDIUM**   | ✅ Fixed | Manage Subscription button visible to non-owners | Added role check to only show for `org_owner`                 |

### SEC-101: Webhook Idempotency Race Condition (CRITICAL)

**Problem**: The idempotency check and mark operations were not atomic:

```typescript
// BEFORE: Race condition possible between check and mark
if (await isWebhookProcessed(webhookId, eventType)) return;
// ... process webhook ...
await markWebhookProcessed(webhookId, eventType);
```

**Impact**: If Polar sends the same webhook twice simultaneously (retries), both could pass the idempotency check before either marks as processed, leading to double processing.

**Fix Applied**: Changed to atomic INSERT ON CONFLICT pattern:

```typescript
// AFTER: Atomic claim using database unique constraint
async function tryClaimWebhook(
  webhookId: string,
  eventType: string
): Promise<boolean> {
  const result = await db
    .insert(webhookIdempotency)
    .values({ webhookId, eventType, resultStatus: "success", expiresAt })
    .onConflictDoNothing({
      target: [webhookIdempotency.webhookId, webhookIdempotency.eventType],
    })
    .returning();
  return result.length > 0; // Only process if insert succeeded
}
```

### SEC-102: Missing Unique Constraint on Idempotency Table (HIGH)

**Problem**: The schema used `index()` instead of `uniqueIndex()`:

```typescript
// BEFORE: Regular index doesn't prevent duplicates
uniqueWebhookEvent: index("webhook_idempotency_unique_idx")
  .on(table.webhookId, table.eventType)
  .concurrently(),
```

**Impact**: The idempotency mechanism couldn't prevent duplicate inserts.

**Fix Applied**:

```typescript
// AFTER: Proper unique constraint
uniqueWebhookEvent: uniqueIndex("webhook_idempotency_unique_idx").on(
  table.webhookId,
  table.eventType
),
```

### SEC-103: Customer ID Linking Race Condition (HIGH)

**Problem**: Customer ID linking used simple update without conditional check:

```typescript
// BEFORE: Race condition - another customer could be linked between check and update
if (!org.polarCustomerId) {
  await db
    .update(organization)
    .set({ polarCustomerId: customerId })
    .where(eq(organization.id, org.id));
}
```

**Impact**: An attacker triggering multiple webhooks could potentially link their customer ID to another organization.

**Fix Applied**:

```typescript
// AFTER: Conditional update with null check
await db
  .update(organization)
  .set({ polarCustomerId: customerId })
  .where(
    and(eq(organization.id, org.id), isNull(organization.polarCustomerId))
  );
```

### SEC-104: Canceled Subscription Loses Access Immediately (HIGH)

**Problem**: The `hasActiveSubscription()` method only checked for `status === "active"`:

```typescript
// BEFORE: Canceled subscriptions lose access immediately
return org.subscriptionPlan !== null && org.subscriptionStatus === "active";
```

**Impact**: Users who canceled their subscription lost access immediately instead of at the end of their billing period.

**Fix Applied**:

```typescript
// AFTER: Proper handling of subscription status with grace period
switch (org.subscriptionStatus) {
  case "active":
    return true;
  case "canceled":
    // Access until period end
    if (org.subscriptionEndsAt) {
      return new Date() < new Date(org.subscriptionEndsAt);
    }
    return false;
  case "past_due":
    return true; // Access while payment retried
  default:
    return false;
}
```

### SEC-105: order.paid Handler Missing subscriptionId (MEDIUM)

**Problem**: The `handleOrderPaid` function didn't set the `subscriptionId`:

```typescript
// BEFORE: Missing subscriptionId
await subscriptionService.updateSubscription(org.id, {
  subscriptionPlan: plan,
  subscriptionStatus: "active",
  polarCustomerId: customerId,
  // subscriptionId not set!
});
```

**Impact**: Future webhook handlers that look up by `subscriptionId` would fail for subscriptions activated via `order.paid`.

**Fix Applied**:

```typescript
// AFTER: Extract subscription ID from order payload
const subscriptionId =
  payload.data.subscription?.id || payload.data.subscriptionId || webhookId;

await subscriptionService.updateSubscription(org.id, {
  subscriptionPlan: plan,
  subscriptionStatus: "active",
  subscriptionId: subscriptionId,
  polarCustomerId: customerId,
});
```

### SEC-106: Manage Subscription Button Visible to Non-Owners (MEDIUM)

**Problem**: The "Manage Subscription" button in org admin was visible to all org admins, but only the org owner's email is linked to the Polar customer.

**Impact**: Org admins clicking the button would see an error because their email doesn't match the Polar customer.

**Fix Applied**:

```typescript
// SubscriptionTab now accepts currentUserRole prop
interface SubscriptionTabProps {
  currentUserRole?: string;
}

export function SubscriptionTab({ currentUserRole }: SubscriptionTabProps) {
  const canManageSubscription = currentUserRole === "org_owner";

  return (
    <div>
      {canManageSubscription && (
        <Button onClick={handleManageSubscription}>Manage Subscription</Button>
      )}
    </div>
  );
}
```

### Best Practices Implemented

1. **Atomic Operations**: All webhook idempotency now uses database-level atomic operations
2. **Conditional Updates**: All customer linking uses conditional updates to prevent race conditions
3. **Proper Unique Constraints**: Changed from index to uniqueIndex for actual uniqueness enforcement
4. **Grace Period Handling**: Canceled subscriptions retain access until billing period ends
5. **Role-Based Access**: Billing management restricted to organization owners only
6. **Comprehensive Logging**: All webhook handlers log truncated IDs for debugging without exposing sensitive data

### Polar Documentation Verification (December 2025)

This section documents a thorough verification of our implementation against official Polar documentation.

#### Documentation Sources Reviewed

1. https://polar.sh/docs/features/usage-based-billing/introduction
2. https://polar.sh/docs/features/usage-based-billing/event-ingestion
3. https://polar.sh/docs/features/usage-based-billing/meters
4. https://polar.sh/docs/features/usage-based-billing/billing
5. https://polar.sh/docs/features/usage-based-billing/ingestion-strategies
6. https://polar.sh/docs/features/products
7. https://polar.sh/docs/features/orders
8. https://polar.sh/docs/integrate/sdk/adapters/better-auth

#### Verification Results

| Feature                        | Status        | Notes                                                                     |
| ------------------------------ | ------------- | ------------------------------------------------------------------------- |
| Better Auth Plugin Integration | ✅ Compliant  | Uses `checkout()`, `portal()`, `usage()`, `webhooks()` plugins            |
| Event Ingestion API            | ✅ Compliant  | Uses `/v1/events/ingest` endpoint with correct payload format             |
| Customer ID Format             | ✅ Compliant  | Uses `customer_id` (Polar's ID) since we store `polarCustomerId`          |
| Event Immutability             | ✅ Understood | Events cannot be changed/deleted once ingested                            |
| Meter Configuration            | ✅ Compliant  | Documentation updated with correct filter setup                           |
| Grace Period Handling          | ✅ Compliant  | Per Polar docs: "subscription remains active until end of billing period" |
| Webhook Handlers               | ✅ Complete   | All critical handlers + `onSubscriptionUncanceled` now implemented        |
| Usage-Based Billing Workflow   | ✅ Compliant  | Event ingestion → Meter aggregation → Metered prices on products          |

#### Polar Event Ingestion Format Verification

Our implementation matches Polar's documented format:

```typescript
// Polar-documented format:
{
  events: [
    {
      name: "<event_name>", // ✅ We use: "playwright_minutes", "k6_vu_minutes", "ai_credits"
      customer_id: "<polar_customer_id>", // ✅ We use org.polarCustomerId
      // OR external_customer_id: "<your_user_id>",  // Alternative - we use customer_id
      timestamp: "ISO-8601-timestamp", // ✅ We pass timestamp
      metadata: {
        // ✅ We include:
        event_id: "...", //    - event_id for deduplication
        value: 123, //    - value for meter aggregation
        // ... additional fields
      },
    },
  ];
}
```

#### Meter Configuration Alignment

Per Polar docs, meters use filters to aggregate events:

| Our Event Name       | Meter Filter Setup               | Aggregation |
| -------------------- | -------------------------------- | ----------- |
| `playwright_minutes` | Name equals `playwright_minutes` | Sum(value)  |
| `k6_vu_minutes`      | Name equals `k6_vu_minutes`      | Sum(value)  |
| `ai_credits`         | Name equals `ai_credits`         | Sum(value)  |

#### Webhook Handler Completeness

Per Better Auth Polar plugin documentation, we now implement all critical handlers:

- ✅ `onCustomerCreated` - Link customer to organization
- ✅ `onCustomerDeleted` - Revoke access on deletion
- ✅ `onCustomerStateChanged` - Log state changes
- ✅ `onSubscriptionActive` - Activate subscription
- ✅ `onSubscriptionCreated` - Handle new subscriptions
- ✅ `onSubscriptionUpdated` - Handle plan changes
- ✅ `onSubscriptionCanceled` - Mark canceled with grace period
- ✅ `onSubscriptionUncanceled` - Restore reversed cancellations **(Added)**
- ✅ `onSubscriptionRevoked` - Immediate access termination
- ✅ `onOrderPaid` - Payment confirmation
- ✅ `onPayload` - Catch-all logging

#### Key Polar Behaviors Verified

1. **Grace Period on Cancellation**: Per Polar docs, "subscription remains active until the end of the current billing period" - our `hasActiveSubscription()` correctly handles this
2. **Usage Charges on Cancel**: Per Polar billing docs, "all accumulated usage-based charges continue to be tracked" during grace period - our implementation continues tracking
3. **Events are Immutable**: Per Polar docs, "events cannot be changed or deleted" - we handle this by using unique event IDs

---
