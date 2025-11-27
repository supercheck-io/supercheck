# Polar Integration Setup Guide

This guide explains how to set up and configure the Polar payment integration for Supercheck.

## Prerequisites

- Polar account (production or sandbox)
- Organization created in Polar dashboard
- Plus and Pro products created in Polar

## Environment Variables

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

## Database Migration

Run the database migration to add subscription fields:

```bash
cd app
npm run db:migrate
```

This will:
- Add subscription fields to `organization` table
- Create `plan_limits` table with Plus/Pro/Unlimited configurations
- Seed plan limits with default values

## Polar Dashboard Setup

### 1. Create Organization Access Token

1. Go to Polar Dashboard → Settings → Access Tokens
2. Click "Create Organization Access Token"
3. Give it a name (e.g., "Supercheck Production")
4. Copy the token and add to `POLAR_ACCESS_TOKEN`

### 2. Create Products

Create two products for Plus and Pro plans:

**Plus Plan**:
- Name: "Supercheck Plus"
- Price: $49/month
- Billing interval: Monthly
- Copy the Product ID to `POLAR_PLUS_PRODUCT_ID`

**Pro Plan**:
- Name: "Supercheck Pro"
- Price: $149/month
- Billing interval: Monthly
- Copy the Product ID to `POLAR_PRO_PRODUCT_ID`

### 3. Configure Webhook

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

## Testing

### Self-Hosted Mode

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

### Cloud Mode with Polar

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

##Features

### Automatic Customer Creation

When a user signs up:
1. User account created in Better Auth
2. Polar customer automatically created  
3. Customer ID stored in `organization.polar_customer_id`
4. Organization defaults to "unlimited" plan

### Subscription Management

- Users can upgrade/downgrade via `/billing` page
- Checkout handled by Polar (hosted)
- Webhooks update subscription status automatically
- Usage resets on subscription renewal

### Usage-Based Billing

**Playwright Execution Minutes**:
- Tracked automatically after test execution
- Overage charged at $0.10/min (Plus) or $0.08/min (Pro)

**K6 VU Hours**:
- Calculated as: `(virtualUsers × durationMs) / 3600000`
- Overage charged at $0.50/VU·h (Plus) or $0.40/VU·h (Pro)

### Plan Enforcement

Limits enforced based on subscription:

**Monitor Limits**:
- Plus: 25 monitors
- Pro: 100 monitors
- Unlimited: No limit

**Capacity Limits**:
- Plus: 3 concurrent, 25 queued
- Pro: 10 concurrent, 100 queued  
- Unlimited: Environment defaults

**Feature Access**:
- Custom domains: Pro+ only
- SSO: Pro+ only

## API Integration

### Check Plan Limits

```typescript
import {checkMonitorLimit} from "@/lib/middleware/plan-enforcement";

const limitCheck = await checkMonitorLimit(organizationId, currentCount);
if (!limitCheck.allowed) {
  return res.status(403).json({ error: limitCheck.error });
}
```

### Track Usage

```typescript
import { usageTracker } from "@/lib/services/usage-tracker";

// After Playwright execution
await usageTracker.trackPlaywrightExecution(
  organizationId,
  executionTimeMs,
  { testId, jobId }
);

// After K6 execution
await usageTracker.trackK6Execution(
  organizationId,
  virtualUsers,
  durationMs, 
  { testId, jobId }
);
```

### Get Usage Stats

```typescript
import { subscriptionService } from "@/lib/services/subscription-service";

const usage = await subscriptionService.getUsage(organizationId);
console.log(usage.playwrightMinutes.used); // Current usage
console.log(usage.playwrightMinutes.overage); // Overage amount
```

## Troubleshooting

**Webhook not receiving events**:
- Check webhook URL is publicly accessible
- Verify webhook secret matches environment variable
- Check Polar dashboard webhook logs

**Customer not created on signup**:
- Verify `POLAR_ACCESS_TOKEN` is valid
- Check `SELF_HOSTED` is set to `false`
- Review application logs for errors

**Plan limits not enforcing**:
- Verify database migration ran successfully
- Check `plan_limits` table has 3 rows
- Confirm organization has correct `subscription_plan`

**Usage not tracking**:
- Verify Polar plugin initialized (check logs)
- Confirm usage tracking called after execution
- Check organization has active subscription

## Production Checklist

Before deploying to production:

- [ ] Set `POLAR_SERVER=production`
- [ ] Use production Polar access token
- [ ] Create production Plus/Pro products  
- [ ] Configure production webhook
- [ ] Test full checkout flow
- [ ] Verify webhook processing
- [ ] Test plan limit enforcement
- [ ] Monitor usage tracking
- [ ] Set up billing alerts

## Support

For issues with Polar integration:
- Check [Polar Documentation](https://polar.sh/docs)
- Review implementation logs
- Contact Polar support for payment issues
