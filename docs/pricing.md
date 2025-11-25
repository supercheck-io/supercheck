# Supercheck Pricing

> **Important**: This pricing is for cloud-hosted Supercheck. Self-hosted installations have unlimited usage.

## Plans Overview

| Feature | Plus | Pro |
|---------|------|-----|
| **Monthly Price** | $49/month | $149/month |
| **Monitors** | 25 monitors | 100 monitors |
| **Playwright Minutes** | 500 minutes/month | 2,000 minutes/month |
| **K6 VU Hours** | 100 VU hours/month | 500 VU hours/month |
| **Concurrent Executions** | 3 | 10 |
| **Queued Jobs** | 25 | 100 |
| **Team Members** | 5 users | 25 users |
| **Organizations** | 2 organizations | 10 organizations |
| **Projects** | 10 projects | 50 projects |
| **Monitoring Locations** | All 3 locations | All 3 locations |
| **Check Interval** | 1 minute (Synthetic: 5 min) | 1 minute (Synthetic: 5 min) |
| **Data Retention** | 30 days | 90 days |
| **Email Support** | ✓ | ✓ Priority |
| **Slack/Webhook Alerts** | ✓ | ✓ |
| **Status Pages** | 3 status pages | 15 status pages |
| **Custom Domains** | ✗ | ✓ |
| **API Access** | ✓ | ✓ Enhanced |
| **SSO/SAML** | ✗ | ✓ |

## Usage-Based Billing

### Playwright Execution Minutes

Billed per minute of browser test execution time.

- **Plus Plan**: $0.10 per additional minute after 500 minutes
- **Pro Plan**: $0.08 per additional minute after 2,000 minutes

**Example**: Running a 5-minute Playwright test:
- Consumes: 5 execution minutes
- Cost (overage): $0.50 (Plus) or $0.40 (Pro) per execution

### K6 VU Hours

Billed per Virtual User (VU) hour for load testing.

- **Plus Plan**: $0.50 per additional VU hour after 100 hours
- **Pro Plan**: $0.40 per additional VU hour after 500 hours

**Example**: Running a load test with 100 VUs for 10 minutes:
- Consumes: (100 VUs × 10 minutes) / 60 = 16.67 VU hours
- Cost (overage): $8.33 (Plus) or $6.67 (Pro) per execution

### Monitor Executions

Monitors count against Playwright minutes for each execution.

**Example**: 25 monitors checking every 5 minutes for 30 days:
- Executions per month: 25 × (30 days × 24 hours × 60 minutes / 5 minutes) = 216,000 executions
- Average execution time: ~0.5 minutes per check
- Total minutes: 108,000 minutes
- Plus plan includes: 500 minutes
- Overage: 107,500 minutes × $0.10 = $10,750/month

**Recommendation**: For high-frequency monitoring, consider increasing check intervals or upgrading to Pro plan.

## Plan Features

### Plus Plan - $49/month

**Best for**: Small teams and growing projects

- 25 uptime monitors with 1-minute intervals
- Synthetic monitors: 5-minute minimum intervals
- 500 Playwright execution minutes
- 100 K6 VU hours for load testing
- Up to 5 team members
- 2 organizations, 10 projects
- 3 public status pages
- Email and Slack notifications
- 30-day data retention
- All monitoring locations (US, EU, APAC)

**Typical Usage**:
- 10-15 monitors checking every 5-10 minutes
- 20-30 Playwright test runs per month
- Light load testing (1-2 tests per week)

### Pro Plan - $149/month

**Best for**: Production applications and larger teams

- 100 uptime monitors with 1-minute intervals
- Synthetic monitors: 5-minute minimum intervals
- 2,000 Playwright execution minutes
- 500 K6 VU hours for load testing
- Up to 25 team members
- 10 organizations, 50 projects
- 15 public status pages with custom domains
- Priority support
- 90-day data retention
- SSO/SAML authentication
- All monitoring locations (US, EU, APAC)
- Enhanced API access with higher rate limits

**Typical Usage**:
- 50-75 monitors checking every 1-5 minutes
- 100-150 Playwright test runs per month
- Regular load testing (2-4 tests per week)

## Self-Hosted Edition

For teams that want to run Supercheck on their own infrastructure:

- **Free and Open Source**
- Unlimited monitors, executions, and usage
- No subscription fees
- Full control over data and infrastructure
- Community support
- All features included

Visit our [GitHub repository](https://github.com/supercheck-io/supercheck) to get started.

## FAQs

### How is usage tracked?

- **Playwright Minutes**: Total time browsers are executing tests
- **K6 VU Hours**: Virtual users × execution time
- **Monitors**: Count against Playwright minutes for each check

### What happens if I exceed my limits?

Usage-based billing automatically applies:
- Overage charges are billed monthly
- Real-time usage tracking in dashboard
- Automatic email alerts at 80% and 100% of quota

### Can I change plans?

Yes! Upgrade or downgrade anytime:
- **Upgrades**: Immediate access to new features and limits
- **Downgrades**: Effective at next billing cycle
- Pro-rated billing for mid-cycle changes

### What's the difference between concurrent and queued limits?

- **Concurrent Executions**: Maximum tests running simultaneously
- **Queued Jobs**: Maximum tests waiting to run
- Exceeding limits returns "system at capacity" error

### Do unused minutes roll over?

No, plan quotas reset monthly on your billing date.

### What payment methods do you accept?

We accept all major credit cards through Polar.sh:
- Visa, Mastercard, American Express, Discover
- Automatic tax/VAT calculation and collection
- Secure payment processing

### Is there a free trial?

We don't offer a free tier, but you can:
- Try the self-hosted edition (fully featured, free forever)
- Request a demo to see Supercheck in action
- Start with the Plus plan ($49/month) with no long-term commitment

## Transaction Fees

Powered by Polar.sh:
- **Transaction Fee**: 4% + $0.40 per transaction
- **Included**: Payment processing, tax handling, invoicing
- **No additional fees**: No platform fees, no surprise charges

## Contact Us

Have questions about pricing or need a custom plan?

- **Email**: [email protected]
- **Chat**: Available in the dashboard
- **Enterprise**: Contact us for custom pricing and dedicated support

---

*Pricing is subject to change. Self-hosted pricing remains free and open source forever.*
