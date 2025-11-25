# SuperCheck: Implementation Guide

**Single Codebase + SaaS Monetization with Business Source License**

---

## Quick Overview

```
┌──────────────────────────────────────────────────────────┐
│              SAME CODEBASE, DIFFERENT CONFIG             │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Open Source (GitHub)              SaaS (SuperCheck.io) │
│  ├─ Self-hosted                    ├─ Cloud hosted     │
│  ├─ All features                   ├─ All features     │
│  ├─ Unlimited usage                ├─ Usage limits     │
│  ├─ No billing                     ├─ Subscription     │
│  └─ Free forever                   └─ Free/Paid tiers  │
│                                                          │
│  License: BSL (converts to MIT in 2 years)             │
│  Self-hosted: Always free                              │
│  Competing SaaS: Requires license                       │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## License Strategy: Business Source License (BSL)

### Why BSL?

**Problem with Apache 2.0/MIT:**
- Anyone can fork and launch competing SaaS
- Subscription model not enforceable legally
- No protection against clones

**Solution with BSL:**
- Self-hosted users: FREE (always)
- Your SaaS: Subscription-based (protected)
- Competing SaaS: Requires commercial license
- Auto-converts to MIT in 2 years (community wins)

### License File Content

Create `LICENSE` file:

```
BUSINESS SOURCE LICENSE (SuperCheck Custom)

Version 1.0

Definitions

- "Commercial Use": Offering SuperCheck as a managed service, SaaS
  product, or any commercial hosting solution competing with SuperCheck.

- "Self-Hosted Use": Running SuperCheck in your own infrastructure for
  internal operations, private use, or non-commercial purposes.

License Grant

Subject to the restrictions in Section 2, SuperCheck grants you a
non-exclusive, royalty-free license to use, copy, modify, and
redistribute this software for:

1. Self-hosted deployments of any size
2. Internal business operations
3. Non-commercial purposes
4. Open source projects

Restrictions

You may NOT use SuperCheck for Commercial Use without:
- A written commercial license from SuperCheck, OR
- Until the Conversion Date (2 years from release)

After the Conversion Date, this license automatically converts to MIT.

Self-Hosted Exception

Self-hosted deployments are expressly permitted and free, regardless
of organization size or use case.

Commercial Licensing

For commercial SaaS or hosting inquiries: licensing@supercheck.io

Conversion to Open Source

This Business Source License automatically converts to the MIT License
on [DATE_2_YEARS_FROM_NOW]. After that date, you may use this software
under the MIT License for any purpose.

Disclaimer

THIS SOFTWARE IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND.
```

---

## Architecture Overview

### Single Codebase, Two Deployments

```
supercheck/
├── app/src/
│   ├── lib/
│   │   ├── config.ts              # Deployment config
│   │   └── limits/
│   │       └── limit-checker.ts    # Usage limit checking
│   │
│   ├── components/
│   │   ├── billing/               # Conditional billing UI
│   │   ├── auth/                  # Auth components
│   │   └── shared/                # Shared components
│   │
│   ├── app/
│   │   ├── (auth)/                # Auth pages
│   │   ├── (main)/                # Main app pages
│   │   └── api/                   # API routes
│   │
│   └── db/
│       ├── schema/
│       │   ├── organization.ts    # Updated with plan/limits
│       │   └── usage.ts           # Usage tracking
│       └── migrations/
│
├── LICENSE                         # BSL
├── .env.example.self-hosted        # Open source config
├── .env.example.saas               # SaaS config
└── docker-compose.yml              # Local development
```

---

## Phase 1: Database Schema & Configuration

### 1.1 Organization Table

```typescript
// app/src/db/schema/organization.ts
import { pgTable, text, varchar, timestamp, integer, boolean } from "drizzle-orm/pg-core";

export const organization = pgTable("organization", {
  id: varchar("id", { length: 21 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),

  // Deployment info
  deployment_type: varchar("deployment_type", { length: 50 })
    .notNull()
    .default("self-hosted"), // 'self-hosted' | 'saas'
  is_saas: boolean("is_saas").default(false),

  // Plan info (SaaS only)
  plan: varchar("plan", { length: 50 }), // 'community' | 'team' | 'enterprise'
  subscription_id: varchar("subscription_id", { length: 255 }), // Polar subscription ID
  subscription_status: varchar("subscription_status", { length: 50 }), // 'active' | 'canceled' | 'past_due'
  subscription_expires_at: timestamp("subscription_expires_at"),

  // Usage limits per plan
  monitor_limit: integer("monitor_limit"), // NULL = unlimited
  jobs_per_month_limit: integer("jobs_per_month_limit"), // NULL = unlimited
  api_calls_per_day_limit: integer("api_calls_per_day_limit"), // NULL = unlimited
  test_execution_limit: integer("test_execution_limit"), // NULL = unlimited

  // Metadata
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
});
```

### 1.2 Usage Tracking Table

```typescript
// app/src/db/schema/usage.ts
export const usage = pgTable("usage", {
  id: varchar("id", { length: 21 }).primaryKey(),
  organization_id: varchar("organization_id", { length: 21 }).notNull(),

  // Daily tracking
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  api_calls: integer("api_calls").default(0),
  jobs_executed: integer("jobs_executed").default(0),
  tests_executed: integer("tests_executed").default(0),

  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),

  // Unique constraint for daily tracking
});
```

### 1.3 Configuration File

```typescript
// app/src/lib/config.ts
export const config = {
  deploymentType: process.env.DEPLOYMENT_TYPE || 'self-hosted',

  // Feature flags
  showBilling: process.env.NEXT_PUBLIC_SHOW_BILLING === 'true',
  paymentRequired: process.env.NEXT_PUBLIC_PAYMENT_REQUIRED === 'true',
  showUsageLimits: process.env.NEXT_PUBLIC_SHOW_BILLING === 'true',

  // Polar config (only for SaaS)
  polar: {
    accessToken: process.env.POLAR_ACCESS_TOKEN || '',
    organizationId: process.env.POLAR_ORGANIZATION_ID || '',
    publishableKey: process.env.NEXT_PUBLIC_POLAR_PUBLISHABLE_KEY || '',
    webhookSecret: process.env.POLAR_WEBHOOK_SECRET || '',
  },

  // Plan limits (SaaS)
  planLimits: {
    'community': {
      monitors: 5,
      jobsPerMonth: 10,
      apiCallsPerDay: 100,
      testExecutionsPerMonth: 50,
    },
    'team': {
      monitors: 50,
      jobsPerMonth: 1000,
      apiCallsPerDay: 10000,
      testExecutionsPerMonth: 5000,
    },
    'enterprise': {
      monitors: null, // unlimited
      jobsPerMonth: null,
      apiCallsPerDay: null,
      testExecutionsPerMonth: null,
    },
  },

  validate() {
    if (this.deploymentType === 'saas' && !this.polar.accessToken) {
      throw new Error('POLAR_ACCESS_TOKEN required for SaaS deployment');
    }
  },
};

config.validate();
```

### 1.4 Environment Variables

**Open Source (.env.self-hosted)**
```env
DEPLOYMENT_TYPE=self-hosted
NEXT_PUBLIC_SHOW_BILLING=false
NEXT_PUBLIC_PAYMENT_REQUIRED=false

DATABASE_URL=postgresql://user:pass@localhost/supercheck
REDIS_URL=redis://localhost:6379

# Not needed
POLAR_ACCESS_TOKEN=
POLAR_ORGANIZATION_ID=
NEXT_PUBLIC_POLAR_PUBLISHABLE_KEY=
POLAR_WEBHOOK_SECRET=
```

**SaaS (.env.saas)**
```env
DEPLOYMENT_TYPE=saas
NEXT_PUBLIC_SHOW_BILLING=true
NEXT_PUBLIC_PAYMENT_REQUIRED=true

DATABASE_URL=postgresql://user:pass@supercheck.io/supercheck
REDIS_URL=redis://supercheck.io:6379

# Polar Configuration (Required for SaaS)
POLAR_ACCESS_TOKEN=pol_xxxxx
POLAR_ORGANIZATION_ID=org_xxxxx
NEXT_PUBLIC_POLAR_PUBLISHABLE_KEY=pk_xxxxx
POLAR_WEBHOOK_SECRET=whsec_xxxxx
```

---

## Phase 2: Authentication & Signup Flow

### 2.1 Signup Action (Deployment-Aware)

```typescript
// app/src/app/(auth)/sign-up/action.ts
import { config } from '@/lib/config';

export async function signUpAction(email: string, password: string, selectedPlan?: string) {
  // 1. Create user
  const user = await auth.api.signUpEmail({
    email,
    password,
    name: email.split('@')[0],
  });

  // 2. Determine organization setup based on deployment
  let orgData: any = {
    id: generateId(),
    name: `${user.name}'s Organization`,
    deployment_type: config.deploymentType,
    is_saas: config.deploymentType === 'saas',
  };

  // For SaaS deployment
  if (config.deploymentType === 'saas') {
    if (!selectedPlan) {
      throw new Error('Plan selection required for SaaS');
    }

    // For paid plans, don't create org yet - let Polar webhook do it
    if (selectedPlan !== 'community') {
      return { success: true, requiresPayment: true, planSelected: selectedPlan };
    }

    // Community plan - create org with limits
    const limits = config.planLimits.community;
    orgData = {
      ...orgData,
      plan: 'community',
      subscription_status: 'active',
      monitor_limit: limits.monitors,
      jobs_per_month_limit: limits.jobsPerMonth,
      api_calls_per_day_limit: limits.apiCallsPerDay,
    };
  }

  // For open source deployment - no plan
  if (config.deploymentType === 'self-hosted') {
    orgData = {
      ...orgData,
      plan: null,
      monitor_limit: null,
      jobs_per_month_limit: null,
      api_calls_per_day_limit: null,
    };
  }

  // 3. Create organization
  const organization = await db.insert(organizations).values(orgData).returning();

  // 4. Add user as owner
  await db.insert(members).values({
    id: generateId(),
    organization_id: organization.id,
    user_id: user.id,
    role: 'ORG_OWNER',
  });

  // 5. Create session
  const session = await auth.api.createSession({
    userId: user.id,
    activeOrganizationId: organization.id,
  });

  return { success: true, session };
}
```

### 2.2 Signup Page

```typescript
// app/src/app/(auth)/sign-up/page.tsx
import { config } from '@/lib/config';

export default function SignUpPage() {
  return (
    <div>
      <h1>Create Account</h1>

      {config.deploymentType === 'saas' ? (
        <SignUpWithPlanSelection />
      ) : (
        <BasicSignUpForm />
      )}
    </div>
  );
}
```

```typescript
// app/src/components/auth/sign-up-with-plan-selection.tsx
export function SignUpWithPlanSelection() {
  const [selectedPlan, setSelectedPlan] = useState('community');

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      signUpAction(email, password, selectedPlan);
    }}>
      <input placeholder="Email" />
      <input placeholder="Password" type="password" />

      <div>
        <h3>Choose Your Plan</h3>

        <label>
          <input
            type="radio"
            value="community"
            checked={selectedPlan === 'community'}
            onChange={(e) => setSelectedPlan(e.target.value)}
          />
          <span>Community - FREE</span>
          <small>5 monitors, 10 jobs/month</small>
        </label>

        <label>
          <input
            type="radio"
            value="team"
            checked={selectedPlan === 'team'}
            onChange={(e) => setSelectedPlan(e.target.value)}
          />
          <span>Team - $29/month</span>
          <small>50 monitors, 1000 jobs/month</small>
        </label>

        <label>
          <input
            type="radio"
            value="enterprise"
            checked={selectedPlan === 'enterprise'}
            onChange={(e) => setSelectedPlan(e.target.value)}
          />
          <span>Enterprise - Custom</span>
          <small>Unlimited everything</small>
        </label>
      </div>

      <button>
        {selectedPlan === 'community' ? 'Create Account' : 'Continue to Payment'}
      </button>
    </form>
  );
}
```

---

## Phase 3: Login & Session

### 3.1 Login with Subscription Check

```typescript
// app/src/app/(auth)/sign-in/action.ts
import { config } from '@/lib/config';

export async function signInAction(email: string, password: string) {
  const user = await authenticateUser(email, password);

  // Check subscription status (SaaS only)
  if (config.paymentRequired) {
    const org = await db.query.organization.findFirst({
      where: eq(member.user_id, user.id),
    });

    if (!org) {
      throw new Error('Organization not found');
    }

    // Must have active subscription
    if (org.subscription_status !== 'active') {
      throw new Error('Subscription inactive or expired. Please update payment at /billing');
    }

    // Check if subscription has expired
    if (org.subscription_expires_at && new Date() > org.subscription_expires_at) {
      throw new Error('Subscription expired');
    }
  }

  const session = await auth.api.createSession({
    userId: user.id,
    activeOrganizationId: org.id,
  });

  return { success: true, session };
}
```

---

## Phase 4: Usage Limits Enforcement

### 4.1 Limit Checker Service

```typescript
// app/src/lib/limits/limit-checker.ts
import { config } from '@/lib/config';

export interface UsageLimits {
  monitorLimit: number | null;
  jobsPerMonthLimit: number | null;
  apiCallsPerDayLimit: number | null;
}

export async function getOrganizationLimits(organizationId: string): Promise<UsageLimits> {
  const org = await db.query.organization.findFirst({
    where: eq(organization.id, organizationId),
  });

  return {
    monitorLimit: org.monitor_limit,
    jobsPerMonthLimit: org.jobs_per_month_limit,
    apiCallsPerDayLimit: org.api_calls_per_day_limit,
  };
}

export async function canCreateMonitor(organizationId: string): Promise<boolean> {
  // Open source: always allow
  if (config.deploymentType === 'self-hosted') {
    return true;
  }

  const limits = await getOrganizationLimits(organizationId);

  if (limits.monitorLimit === null) {
    return true;
  }

  const monitorCount = await db.query.monitor.findMany({
    where: eq(monitor.organization_id, organizationId),
  });

  return monitorCount.length < limits.monitorLimit;
}

export async function canExecuteJob(organizationId: string): Promise<boolean> {
  // Open source: always allow
  if (config.deploymentType === 'self-hosted') {
    return true;
  }

  const limits = await getOrganizationLimits(organizationId);

  if (limits.jobsPerMonthLimit === null) {
    return true;
  }

  const currentMonth = new Date();
  const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);

  const jobCount = await db.query.jobRun.findMany({
    where: and(
      eq(jobRun.organization_id, organizationId),
      gte(jobRun.created_at, monthStart)
    ),
  });

  return jobCount.length < limits.jobsPerMonthLimit;
}

export async function recordApiCall(organizationId: string): Promise<void> {
  if (config.deploymentType === 'self-hosted') {
    return;
  }

  const today = new Date().toISOString().split('T')[0];

  await db
    .insert(usage)
    .values({
      id: generateId(),
      organization_id: organizationId,
      date: today,
      api_calls: 1,
    })
    .onConflictDoUpdate({
      target: [usage.organization_id, usage.date],
      set: {
        api_calls: sql`${usage.api_calls} + 1`,
      },
    });
}

export async function isApiCallLimited(organizationId: string): Promise<boolean> {
  if (config.deploymentType === 'self-hosted') {
    return false;
  }

  const limits = await getOrganizationLimits(organizationId);

  if (limits.apiCallsPerDayLimit === null) {
    return false;
  }

  const today = new Date().toISOString().split('T')[0];

  const dailyUsage = await db.query.usage.findFirst({
    where: and(
      eq(usage.organization_id, organizationId),
      eq(usage.date, today)
    ),
  });

  return (dailyUsage?.api_calls || 0) >= limits.apiCallsPerDayLimit;
}

export async function getUsageStats(organizationId: string) {
  const org = await db.query.organization.findFirst({
    where: eq(organization.id, organizationId),
  });

  const monitors = await db.query.monitor.findMany({
    where: eq(monitor.organization_id, organizationId),
  });

  const currentMonth = new Date();
  const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);

  const jobsThisMonth = await db.query.jobRun.findMany({
    where: and(
      eq(jobRun.organization_id, organizationId),
      gte(jobRun.created_at, monthStart)
    ),
  });

  const today = new Date().toISOString().split('T')[0];
  const apiCallsToday = await db.query.usage.findFirst({
    where: and(
      eq(usage.organization_id, organizationId),
      eq(usage.date, today)
    ),
  });

  return {
    monitors: {
      used: monitors.length,
      limit: org.monitor_limit,
      percentage: org.monitor_limit
        ? Math.round((monitors.length / org.monitor_limit) * 100)
        : 0,
    },
    jobsThisMonth: {
      used: jobsThisMonth.length,
      limit: org.jobs_per_month_limit,
      percentage: org.jobs_per_month_limit
        ? Math.round((jobsThisMonth.length / org.jobs_per_month_limit) * 100)
        : 0,
    },
    apiCallsToday: {
      used: apiCallsToday?.api_calls || 0,
      limit: org.api_calls_per_day_limit,
      percentage: org.api_calls_per_day_limit
        ? Math.round(((apiCallsToday?.api_calls || 0) / org.api_calls_per_day_limit) * 100)
        : 0,
    },
  };
}
```

### 4.2 API Route with Limit Check

```typescript
// app/src/app/api/monitors/create/route.ts
import { canCreateMonitor } from '@/lib/limits/limit-checker';

export async function POST(req: NextRequest) {
  const { organizationId } = await requireProjectContext();
  const data = await req.json();

  const canCreate = await canCreateMonitor(organizationId);

  if (!canCreate) {
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
    });

    return NextResponse.json(
      {
        error: 'Monitor limit reached',
        limit: org.monitor_limit,
        message: `You've reached your limit of ${org.monitor_limit} monitors`,
        upgradePath: config.showBilling ? '/enterprise/billing' : undefined,
      },
      { status: 429 }
    );
  }

  const monitor = await db.insert(monitors).values({
    id: generateId(),
    organization_id: organizationId,
    ...data,
  }).returning();

  return NextResponse.json(monitor);
}
```

---

## Phase 5: Billing & Payments (SaaS Only)

### 5.1 Billing Page

```typescript
// app/src/app/(main)/enterprise/billing/page.tsx
import { config } from '@/lib/config';

export default function BillingPage() {
  // Hide billing page for open source
  if (!config.showBilling) {
    return <NotFound />;
  }

  return <BillingPageContent />;
}

function BillingPageContent() {
  const { organization } = useOrganization();

  return (
    <div>
      <h1>Billing & Plans</h1>

      <div>
        <h2>Current Plan: {organization.plan}</h2>
        {organization.subscription_expires_at && (
          <p>Renews: {new Date(organization.subscription_expires_at).toLocaleDateString()}</p>
        )}
      </div>

      <PricingTable currentPlan={organization.plan} />
    </div>
  );
}
```

### 5.2 Checkout Route

```typescript
// app/src/app/api/billing/checkout/route.ts
import { config } from '@/lib/config';
import { polarClient } from '@/lib/payments/polar-client';

export async function POST(req: NextRequest) {
  if (!config.showBilling) {
    return NextResponse.json({ error: 'Billing disabled' }, { status: 403 });
  }

  const { organizationId, planId } = await req.json();
  const { userId } = await requireAuth();

  const session = await polarClient.createCheckoutSession({
    organizationId,
    planId,
    email: user.email,
    successUrl: `${process.env.APP_URL}/enterprise/billing?success=true`,
  });

  return NextResponse.json({ checkoutUrl: session.checkoutUrl });
}
```

### 5.3 Webhook Handler (Polar)

```typescript
// app/src/app/api/billing/webhook/route.ts
import { config } from '@/lib/config';
import { polarClient } from '@/lib/payments/polar-client';

export async function POST(req: NextRequest) {
  if (!config.showBilling) {
    return NextResponse.json({ error: 'Billing disabled' }, { status: 403 });
  }

  const body = await req.text();
  const signature = req.headers.get('x-polar-signature') || '';

  if (!await polarClient.validateWebhookSignature(body, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = JSON.parse(body);

  if (event.type === 'subscription.created') {
    const { organizationId, planId, subscriptionId } = event.data;
    const limits = config.planLimits[planId];

    await db.insert(organizations).values({
      id: generateId(),
      plan: planId,
      subscription_id: subscriptionId,
      subscription_status: 'active',
      subscription_expires_at: new Date(event.data.currentPeriodEnd),
      monitor_limit: limits.monitors,
      jobs_per_month_limit: limits.jobsPerMonth,
      api_calls_per_day_limit: limits.apiCallsPerDay,
    }).onConflictDoUpdate({
      target: [organizations.id],
      set: {
        plan: planId,
        subscription_id: subscriptionId,
        subscription_status: 'active',
        subscription_expires_at: new Date(event.data.currentPeriodEnd),
        monitor_limit: limits.monitors,
        jobs_per_month_limit: limits.jobsPerMonth,
        api_calls_per_day_limit: limits.apiCallsPerDay,
      },
    });
  }

  if (event.type === 'subscription.canceled') {
    await db.update(organizations)
      .set({
        plan: 'community',
        subscription_status: 'canceled',
        monitor_limit: config.planLimits.community.monitors,
        jobs_per_month_limit: config.planLimits.community.jobsPerMonth,
        api_calls_per_day_limit: config.planLimits.community.apiCallsPerDay,
      })
      .where(eq(organization.subscription_id, event.data.subscriptionId));
  }

  return NextResponse.json({ received: true });
}
```

---

## Phase 6: Frontend - Usage Display

### 6.1 Usage Stats Component

```typescript
// app/src/components/billing/usage-stats.tsx
import { config } from '@/lib/config';
import { getUsageStats } from '@/lib/limits/limit-checker';

export async function UsageStats({ organizationId }: { organizationId: string }) {
  if (!config.showUsageLimits) {
    return null;
  }

  const stats = await getUsageStats(organizationId);

  return (
    <div className="space-y-4">
      <UsageBar
        label="Monitors"
        used={stats.monitors.used}
        limit={stats.monitors.limit}
        percentage={stats.monitors.percentage}
        ctaPath="/enterprise/billing"
      />
      <UsageBar
        label="Jobs (this month)"
        used={stats.jobsThisMonth.used}
        limit={stats.jobsThisMonth.limit}
        percentage={stats.jobsThisMonth.percentage}
        ctaPath="/enterprise/billing"
      />
      <UsageBar
        label="API Calls (today)"
        used={stats.apiCallsToday.used}
        limit={stats.apiCallsToday.limit}
        percentage={stats.apiCallsToday.percentage}
        ctaPath="/enterprise/billing"
      />
    </div>
  );
}

function UsageBar({ label, used, limit, percentage, ctaPath }: any) {
  const isUnlimited = limit === null;
  const isLimitReached = !isUnlimited && percentage >= 100;

  return (
    <div className="p-4 border rounded-lg">
      <div className="flex justify-between mb-2">
        <span className="font-medium">{label}</span>
        <span className="text-sm text-gray-600">
          {used} {isUnlimited ? '' : `/ ${limit}`}
        </span>
      </div>

      {!isUnlimited && (
        <>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${
                percentage >= 80 ? 'bg-red-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(percentage, 100)}%` }}
            />
          </div>

          {isLimitReached && (
            <div className="mt-2 p-2 bg-red-50 rounded text-sm text-red-700">
              Limit reached. <Link href={ctaPath}>Upgrade plan</Link>
            </div>
          )}
        </>
      )}

      {isUnlimited && (
        <p className="text-sm text-gray-600">Unlimited</p>
      )}
    </div>
  );
}
```

### 6.2 Sidebar - Conditional Links

```typescript
// app/src/components/shared/sidebar.tsx
import { config } from '@/lib/config';

export function Sidebar() {
  return (
    <nav>
      <Link href="/monitors">Monitors</Link>
      <Link href="/jobs">Jobs</Link>
      <Link href="/tests">Tests</Link>

      {/* Only show billing for SaaS */}
      {config.showBilling && (
        <Link href="/enterprise/billing">Manage Billing</Link>
      )}
    </nav>
  );
}
```

---

## Deployment

### Open Source Docker

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY . .

RUN npm ci && npm run build

ENV DEPLOYMENT_TYPE=self-hosted
ENV NEXT_PUBLIC_SHOW_BILLING=false
ENV NEXT_PUBLIC_PAYMENT_REQUIRED=false

EXPOSE 3000

CMD ["npm", "run", "start"]
```

```bash
docker build -t supercheck:latest .
docker run -e DATABASE_URL="postgresql://..." -e REDIS_URL="redis://..." supercheck:latest
```

### SaaS Docker

```bash
docker run \
  -e DEPLOYMENT_TYPE=saas \
  -e NEXT_PUBLIC_SHOW_BILLING=true \
  -e NEXT_PUBLIC_PAYMENT_REQUIRED=true \
  -e POLAR_ACCESS_TOKEN=pol_xxxxx \
  -e POLAR_ORGANIZATION_ID=org_xxxxx \
  -e NEXT_PUBLIC_POLAR_PUBLISHABLE_KEY=pk_xxxxx \
  -e POLAR_WEBHOOK_SECRET=whsec_xxxxx \
  supercheck:latest
```

---

## File Structure

```
app/src/
├── lib/
│   ├── config.ts                    # Configuration based on deployment
│   └── limits/
│       └── limit-checker.ts         # Usage limit checking
│
├── components/
│   ├── billing/
│   │   ├── pricing-table.tsx
│   │   ├── usage-stats.tsx
│   │   └── upgrade-button.tsx
│   ├── auth/
│   │   ├── sign-up-with-plan-selection.tsx
│   │   └── basic-sign-up-form.tsx
│   └── shared/
│       └── sidebar.tsx
│
├── app/
│   ├── (auth)/
│   │   └── sign-up/page.tsx
│   ├── (main)/
│   │   └── enterprise/billing/page.tsx
│   └── api/
│       ├── billing/
│       │   ├── checkout/route.ts
│       │   └── webhook/route.ts
│       ├── monitors/create/route.ts
│       └── jobs/execute/route.ts
│
└── db/
    ├── schema/
    │   ├── organization.ts
    │   └── usage.ts
    └── migrations/
        └── 001_add-saas-fields.ts
```

---

## Key Comparison

| Aspect | Open Source | SaaS |
|--------|-------------|------|
| **Deployment** | Self-hosted | SuperCheck.io |
| **Code** | Same | Same |
| **Features** | All | All |
| **Billing UI** | Hidden | Visible |
| **Subscription** | Not required | Required |
| **Monitor Limit** | None | 5 (free), 50 (team), ∞ (enterprise) |
| **Jobs/Month** | None | 10 (free), 1000 (team), ∞ (enterprise) |
| **Cost** | Free | Free/Paid |
| **License** | BSL (converts to MIT in 2 years) | BSL |

---

## License FAQ

**Q: Can I self-host for free?**
A: Yes, always. Self-hosting is expressly permitted under BSL.

**Q: Can I launch a competing SaaS?**
A: Not until 2 years from release date (conversion to MIT). After that, yes.

**Q: What about my current paying customers if I use BSL?**
A: They benefit from the conversion. Product becomes MIT after 2 years, but you've built a sustainable business by then.

**Q: Is BSL really "open source"?**
A: No, it's "source available." But it's designed to become MIT, so it's open source eventually.

---

## Summary

✅ **Same Codebase**: Open source and SaaS run identical code
✅ **Different Behavior**: Config determines UI and limits
✅ **No Feature Gating**: All features available in both versions
✅ **Limits-Based Monetization**: Money through subscription, not features
✅ **Fair Self-Hosting**: Never blocked or limited
✅ **Protected SaaS**: BSL prevents competing SaaS without license
✅ **Community Friendly**: Auto-converts to MIT in 2 years
