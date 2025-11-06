# Centralized Email Templates

This directory contains all email templates for Supercheck, built using [react-email](https://react.email). This provides a single source of truth for all email communications across the application and worker services.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Next.js App                           │
│  ┌────────────────────────────────────────────────┐     │
│  │  React-Email Templates (/src/emails)           │     │
│  │  - base-layout.tsx                             │     │
│  │  - password-reset.tsx                          │     │
│  │  - organization-invitation.tsx                 │     │
│  │  - status-page-verification.tsx                │     │
│  │  - status-page-welcome.tsx                     │     │
│  │  - incident-notification.tsx                   │     │
│  │  - monitor-alert.tsx                           │     │
│  │  - test-email.tsx                              │     │
│  └────────────────────────────────────────────────┘     │
│                          ↓                               │
│  ┌────────────────────────────────────────────────┐     │
│  │  Email Renderer (/src/lib/email-renderer.ts)  │     │
│  │  - Direct rendering for app usage              │     │
│  └────────────────────────────────────────────────┘     │
│                          ↓                               │
│  ┌────────────────────────────────────────────────┐     │
│  │  Email Template Processor                      │     │
│  │  (/src/lib/processors/email-template-processor)│     │
│  │  - BullMQ worker for template rendering        │     │
│  │  - Processes jobs from email-template queue    │     │
│  │  - Returns HTML + Text + Subject               │     │
│  │  - Handles all template types                  │     │
│  └────────────────────────────────────────────────┘     │
│                          ↑                               │
└──────────────────────────┼───────────────────────────────┘
                           │
                    ┌──────┴──────┐
                    │    Redis     │
                    │   (BullMQ)   │
                    └──────┬──────┘
                           │
┌──────────────────────────┼───────────────────────────────┐
│                          ↓                                │
│                    Worker (NestJS)                        │
│  ┌────────────────────────────────────────────────┐     │
│  │  EmailTemplateService                          │     │
│  │  - Adds jobs to email-template-render queue   │     │
│  │  - Waits for rendered results (10s timeout)   │     │
│  │  - In-memory caching (5 min TTL)              │     │
│  │  - Fallback to basic HTML if queue fails      │     │
│  └────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

## Available Templates

### 1. Password Reset Email
**File:** `password-reset.tsx`
**Usage:** When users request a password reset
**Parameters:**
- `resetUrl`: Password reset link
- `userEmail`: User's email address

### 2. Organization Invitation
**File:** `organization-invitation.tsx`
**Usage:** When inviting users to join an organization
**Parameters:**
- `inviteUrl`: Invitation acceptance link
- `organizationName`: Name of the organization
- `role`: Role being assigned
- `projectInfo`: (optional) HTML string of project access details

### 3. Status Page Verification
**File:** `status-page-verification.tsx`
**Usage:** Email verification for status page subscribers
**Parameters:**
- `verificationUrl`: Email verification link
- `statusPageName`: Name of the status page

### 4. Status Page Welcome
**File:** `status-page-welcome.tsx`
**Usage:** Welcome email after successful verification
**Parameters:**
- `statusPageName`: Name of the status page
- `statusPageUrl`: Link to the status page
- `unsubscribeUrl`: Unsubscribe link

### 5. Incident Notification
**File:** `incident-notification.tsx`
**Usage:** Notify subscribers about incidents
**Parameters:**
- `statusPageName`: Name of the status page
- `statusPageUrl`: Link to the status page
- `incidentName`: Name of the incident
- `incidentStatus`: Current status (investigating, identified, monitoring, resolved)
- `incidentImpact`: Impact level (critical, major, minor, none)
- `incidentDescription`: Detailed description
- `affectedComponents`: Array of affected component names
- `updateTimestamp`: Last update time
- `unsubscribeUrl`: Unsubscribe link

### 6. Monitor Alert
**File:** `monitor-alert.tsx`
**Usage:** Alert emails for monitor/job failures
**Parameters:**
- `title`: Alert title
- `message`: Alert message
- `fields`: Array of `{ title: string, value: string }` for details
- `footer`: Footer text
- `type`: Alert type (`failure`, `success`, `warning`)
- `color`: Color code for styling

### 7. Test Email
**File:** `test-email.tsx`
**Usage:** Test SMTP configuration
**Parameters:**
- `testMessage`: (optional) Custom test message

## Usage

### From App (Next.js)

Use the email renderer service directly:

```typescript
import { renderPasswordResetEmail } from '@/lib/email-renderer';
import { EmailService } from '@/lib/email-service';

const emailContent = await renderPasswordResetEmail({
  resetUrl: 'https://example.com/reset?token=abc123',
  userEmail: 'user@example.com',
});

const emailService = EmailService.getInstance();
await emailService.sendEmail({
  to: 'user@example.com',
  subject: emailContent.subject,
  text: emailContent.text,
  html: emailContent.html,
});
```

### From Worker (NestJS)

The worker uses BullMQ to request templates from the app:

```typescript
import { EmailTemplateService } from './email-template/email-template.service';

constructor(private emailTemplateService: EmailTemplateService) {}

async sendMonitorAlert() {
  // For monitor alerts
  const emailContent = await this.emailTemplateService.renderMonitorAlertEmail({
    title: 'Monitor Failed',
    message: 'Your monitor has detected an issue',
    fields: [
      { title: 'Monitor', value: 'API Health Check' },
      { title: 'Status', value: 'Failed' },
    ],
    footer: 'Supercheck Monitoring',
    type: 'failure',
    color: '#dc2626',
  });

  // Send email using emailContent.html, emailContent.text, emailContent.subject
}

async sendJobAlert() {
  // For job failures
  const emailContent = await this.emailTemplateService.renderJobFailureEmail({
    jobName: 'Nightly Test Suite',
    duration: 45000,
    errorMessage: 'Test timeout exceeded',
    totalTests: 100,
    passedTests: 85,
    failedTests: 15,
    runId: 'run-123',
    dashboardUrl: 'https://app.supercheck.io/jobs/run-123',
  });

  // Send email using emailContent
}
```

## BullMQ Queue Communication

The worker and app communicate via a dedicated BullMQ queue:

**Queue Name:** `email-template-render`

**Flow:**
1. Worker adds a rendering job to the queue
2. App's email template processor picks up the job
3. Template is rendered using react-email
4. Result is returned to worker
5. Worker sends email via SMTP

**Reliability:**
- 10-second timeout for queue operations
- 5-minute cache to reduce queue load
- Automatic fallback to basic HTML if queue fails

## Configuration

### Environment Variables

**Both App and Worker (.env):**
```bash
# Redis Configuration (required for BullMQ)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
REDIS_TLS_ENABLED=false

# SMTP Configuration (for sending emails)
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASSWORD=your-password
SMTP_SECURE=false
SMTP_FROM_EMAIL=notifications@supercheck.io
```

**Worker only (.env):**
```bash
# App URL (used for dashboard links in emails)
APP_URL=http://localhost:3000
```

### Security Recommendations

1. **Redis Security:**
   - Use strong Redis password
   - Enable Redis TLS in production
   - Use private network/VPC for Redis connection
   - Restrict Redis access with firewall rules

2. **Production Best Practices:**
   - Use internal network/VPC for all services
   - Enable Redis authentication
   - Use TLS for Redis connections
   - Monitor queue health and performance

## Reliability Features

### Caching
- **Worker Client:** 5-minute TTL in-memory cache for rendered templates
- Automatic cache size limits (100 entries max)
- Cache key based on template type and parameters

### Queue Timeout
- 10-second timeout for template rendering jobs
- Prevents indefinite blocking on worker side
- Logs detailed timeout information

### Fallback Mechanism
- If queue is unavailable, worker generates basic HTML email
- If template rendering fails, worker falls back to simple format
- Ensures notifications are always delivered
- Logs warnings when using fallback

### Error Handling
- Comprehensive error logging on both app and worker
- Graceful degradation at every layer
- No silent failures
- Queue connection retries with exponential backoff

## Development

### Testing Templates Locally

1. **Test Email Rendering (App):**
   ```typescript
   // In any Next.js server component or API route
   import { renderTestEmail } from '@/lib/email-renderer';

   const email = await renderTestEmail({
     testMessage: 'Testing the email system',
   });

   console.log(email.html);
   ```

2. **Test Queue-Based Rendering (Worker):**
   - Ensure Redis is running
   - Start the Next.js app (initializes the email template processor)
   - Start the worker
   - Trigger a notification (e.g., create a monitor alert)
   - Check worker logs for template rendering success

3. **Monitor Queue Health:**
   ```typescript
   // Check email template service health from worker
   const health = await emailTemplateService.healthCheck();
   console.log(health); // { healthy: true/false, message: '...' }
   ```

### Adding New Templates

1. **Create Template File:**
   ```typescript
   // src/emails/my-new-template.tsx
   import { Text } from "@react-email/components";
   import { BaseLayout } from "./base-layout";

   interface MyNewTemplateProps {
     userName: string;
   }

   export const MyNewTemplate = ({ userName }: MyNewTemplateProps) => {
     return (
       <BaseLayout
         preview="Welcome to Supercheck"
         title="Welcome!"
       >
         <Text>Hello {userName}!</Text>
       </BaseLayout>
     );
   };
   ```

2. **Add to exports:**
   ```typescript
   // src/emails/index.ts
   export { MyNewTemplate } from "./my-new-template";
   ```

3. **Add renderer function:**
   ```typescript
   // src/lib/email-renderer.ts
   export async function renderMyNewTemplate(params: {
     userName: string;
   }): Promise<RenderedEmail> {
     const component = MyNewTemplate(params);
     return {
       subject: "Welcome!",
       html: await render(component),
       text: await render(component, { plainText: true }),
     };
   }
   ```

4. **Add to email template processor:**
   ```typescript
   // src/lib/processors/email-template-processor.ts
   // Add to EmailTemplateType union
   export type EmailTemplateType =
     | "monitor-alert"
     | "job-failure"
     | "my-new-template"; // Add new type

   // Add to processEmailTemplateJob switch statement
   case "my-new-template":
     return await renderMyNewTemplate(data as { userName: string });
   ```

5. **Add to worker EmailTemplateService:**
   ```typescript
   // worker/src/email-template/email-template.service.ts
   async renderMyNewTemplate(params: {
     userName: string;
   }): Promise<RenderedEmail> {
     return this.fetchTemplate('my-new-template', params);
   }
   ```

## Best Practices

1. **Keep Templates Consistent:** Use `BaseLayout` for all templates
2. **Mobile-First:** All templates are responsive by default
3. **Plain Text:** Always provide both HTML and text versions
4. **Accessibility:** Use semantic HTML and proper heading hierarchy
5. **Testing:** Test templates across email clients before production
6. **Performance:** Keep HTML size under 100KB for best deliverability

## Troubleshooting

### Worker Can't Render Templates

**Symptoms:** Worker logs show "Failed to fetch template from queue" errors

**Solutions:**
1. Verify Redis is running and accessible from both app and worker
2. Check Redis connection settings (REDIS_HOST, REDIS_PORT, REDIS_PASSWORD)
3. Ensure Next.js app is running (it initializes the email template processor)
4. Check BullMQ queue health using the healthCheck() method
5. Verify network connectivity between services and Redis
6. Check Redis logs for connection errors

### Templates Not Rendering

**Symptoms:** Blank or malformed emails

**Solutions:**
1. Check browser console for React errors
2. Verify all required props are provided
3. Test template rendering in isolation
4. Check for missing imports

### Performance Issues

**Symptoms:** Slow email generation

**Solutions:**
1. Verify caching is working (check worker logs for cache hits)
2. Check Redis performance and network latency
3. Monitor BullMQ queue length and processing time
4. Reduce template complexity if rendering takes > 1 second
5. Consider increasing queue timeout if templates are complex

## Migration Notes

This centralized system replaces the previous approach where:
- App had templates in `/lib/email-templates/status-page-emails.ts`
- Worker had inline HTML templates in `notification.service.ts`

All existing functionality has been preserved with improved:
- Professional design
- Consistent branding
- Better maintainability
- Centralized management

No breaking changes to existing email functionality.
