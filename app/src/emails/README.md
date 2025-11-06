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
│  │  API: /api/emails/render                       │     │
│  │  - Renders templates for external services     │     │
│  │  - Returns HTML + Text + Subject               │     │
│  │  - Protected with API key                      │     │
│  │  - Response caching (5 min TTL)                │     │
│  └────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
                          ↓ HTTP Request (with API key)
┌─────────────────────────────────────────────────────────┐
│                    Worker (NestJS)                       │
│  ┌────────────────────────────────────────────────┐     │
│  │  EmailTemplateService                          │     │
│  │  - Fetches rendered templates from Next.js    │     │
│  │  - Retry logic (3 attempts with backoff)      │     │
│  │  - In-memory caching (5 min TTL)              │     │
│  │  - Fallback to basic HTML if API unavailable  │     │
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

The worker uses the centralized API:

```typescript
import { EmailTemplateService } from './email-template/email-template.service';

constructor(private emailTemplateService: EmailTemplateService) {}

async sendAlert() {
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
```

## API Endpoint

**Endpoint:** `POST /api/emails/render`

**Authentication:** Requires `x-api-key` header

**Request:**
```json
{
  "template": "monitor-alert",
  "data": {
    "title": "Monitor Alert",
    "message": "Your monitor has failed",
    "fields": [
      { "title": "Monitor", "value": "Example Monitor" }
    ],
    "type": "failure",
    "color": "#dc2626"
  }
}
```

**Response:**
```json
{
  "success": true,
  "html": "<html>...</html>",
  "text": "Plain text version...",
  "subject": "Monitor Alert"
}
```

**Health Check:** `GET /api/emails/render`

Returns list of available templates and service status.

## Configuration

### Environment Variables

**App (.env):**
```bash
# Email Template API Key (for worker-to-app communication)
EMAIL_API_KEY=your-secret-key-here

# SMTP Configuration
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASSWORD=your-password
SMTP_SECURE=false
SMTP_FROM_EMAIL=notifications@supercheck.io
```

**Worker (.env):**
```bash
# App URL for email template API
APP_URL=http://localhost:3000

# Must match the app's EMAIL_API_KEY
EMAIL_API_KEY=your-secret-key-here
```

### Security Recommendations

1. **Generate Strong API Key:**
   ```bash
   openssl rand -hex 32
   ```

2. **Production Security Options:**
   - Use internal network/VPC for worker-to-app communication
   - Implement IP whitelisting
   - Use HTTPS for all communications
   - Rotate API keys regularly

## Reliability Features

### Caching
- **App API:** 5-minute TTL cache for rendered templates
- **Worker Client:** 5-minute TTL cache for fetched templates
- Automatic cache size limits (100 entries max)

### Retry Logic
- Worker retries failed API calls 3 times
- Exponential backoff: 1s, 2s, 3s
- Detailed logging of retry attempts

### Fallback Mechanism
- If API is unavailable, worker generates basic HTML email
- Ensures notifications are always delivered
- Logs warnings when using fallback

### Error Handling
- Comprehensive error logging
- Graceful degradation
- No silent failures

## Development

### Testing Templates Locally

1. **Preview in Development:**
   ```bash
   cd app
   npm run dev
   # Visit http://localhost:3000/api/emails/render (GET)
   ```

2. **Test Email Rendering:**
   ```typescript
   // In any Next.js server component or API route
   import { renderTestEmail } from '@/lib/email-renderer';

   const email = await renderTestEmail({
     testMessage: 'Testing the email system',
   });

   console.log(email.html);
   ```

3. **Test API Endpoint:**
   ```bash
   curl -X POST http://localhost:3000/api/emails/render \
     -H "Content-Type: application/json" \
     -H "x-api-key: internal-email-service-key" \
     -d '{
       "template": "test-email",
       "data": {
         "testMessage": "Hello from API"
       }
     }'
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

4. **Add to API endpoint:**
   ```typescript
   // src/app/api/emails/render/route.ts
   case "my-new-template":
     emailComponent = MyNewTemplate({
       userName: data.userName,
     });
     subject = "Welcome!";
     break;
   ```

## Best Practices

1. **Keep Templates Consistent:** Use `BaseLayout` for all templates
2. **Mobile-First:** All templates are responsive by default
3. **Plain Text:** Always provide both HTML and text versions
4. **Accessibility:** Use semantic HTML and proper heading hierarchy
5. **Testing:** Test templates across email clients before production
6. **Performance:** Keep HTML size under 100KB for best deliverability

## Troubleshooting

### Worker Can't Fetch Templates

**Symptoms:** Worker logs show "Failed to fetch template" errors

**Solutions:**
1. Check `APP_URL` in worker's .env points to Next.js app
2. Verify `EMAIL_API_KEY` matches in both app and worker
3. Ensure Next.js app is running and accessible from worker
4. Check firewall/network rules

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
1. Verify caching is working (check logs)
2. Reduce template complexity
3. Consider pre-rendering common templates
4. Check network latency between worker and app

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
