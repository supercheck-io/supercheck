<div align="center">
  <img src="./supercheck-logo.png" alt="Supercheck Logo" width="120">
  
  # Supercheck

**Automation & Monitoring Platform for Modern Applications**

</div>

[Supercheck](https://supercheck.io) is a modern distributed platform built for scalability, reliability, and enterprise-grade security. It enables comprehensive automation testing with real-time monitoring, intelligent job scheduling, and parallel test execution, giving teams a robust and resilient solution to accelerate quality and delivery.

[![Deploy](https://img.shields.io/badge/Deploy%20with-Docker%20Compose-blue?logo=docker)](./docker-compose.yml)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## 🚀 Quick Start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or alternative like [Orbstack](https://orbstack.dev))
- At least 4GB of available RAM
- At least 10GB of available disk space

### 1. Clone and Setup

```bash
git clone https://github.com/supercheck-io/supercheck.git
cd supercheck
```

### 2. Start Application Services

```bash
# Start the full application stack
docker-compose up -d
```

### 3. Access the Application

```bash
# Main app
http://localhost:3000
```

### 4. Stop Application Services

```bash
# Stop the full application stack
docker-compose down
```

## ⚙️ Configuration

### Environment Variables

Key configuration options in `.env`:

```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/supercheck

# Redis
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=supersecure-redis-password-change-this

# MinIO/S3
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
S3_ENDPOINT=http://localhost:9000

# Capacity Management
RUNNING_CAPACITY=5         # Max concurrent test/job executions
QUEUED_CAPACITY=50         # Max queued jobs

# Security
SUPER_ADMIN_EMAILS=admin@example.com  # Comma-separated super admin emails
BETTER_AUTH_SECRET=7pQ4ME2JCMxhcinoTtvUYpque24t2uh1
CREDENTIAL_ENCRYPTION_KEY=your-credential-encryption-key-change-this-in-production
VARIABLES_ENCRYPTION_KEY=your-64-character-encryption-key-for-variable-secrets

# Playwright Configuration
PLAYWRIGHT_HEADLESS=true
PLAYWRIGHT_RETRIES=1
ENABLE_FIREFOX=false      # Disabled by default for performance
ENABLE_WEBKIT=false
ENABLE_MOBILE=false

# Playground Cleanup for redundant playwright reports
PLAYGROUND_CLEANUP_ENABLED=true
PLAYGROUND_CLEANUP_CRON="0 */12 * * *"  # Every 12 hours

# SMTP Email Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=test@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM_EMAIL=test@gmail.com
```

### Production Security

**Critical Security Variables (Must Change in Production):**

- `REDIS_PASSWORD`
- `BETTER_AUTH_SECRET`
- `VARIABLES_ENCRYPTION_KEY`
- `CREDENTIAL_ENCRYPTION_KEY`
- `SMTP_PASSWORD`

## 📚 Usage

### 🧪 Creating Tests

1. Navigate to the Tests section
2. Click "New Test" to create a Playwright test
3. Write your test script or use the visual editor
4. Configure test settings (timeouts, retries, etc.)
5. Run immediately or schedule for later

### 📊 Setting Up Monitoring

1. Go to the Monitors section
2. Add HTTP/HTTPS endpoints or heartbeat monitors
3. Configure check intervals and alert thresholds
4. Set up notification channels (email, webhooks, Slack)

### 📈 Using the Dashboard

1. Navigate to the main Dashboard for system overview
2. View real-time test execution status and metrics
3. Monitor system health and performance indicators
4. Track recent activity across tests, jobs, and monitors
5. Access quick creation shortcuts for common tasks

### ⏰ Managing Jobs

1. Go to the Jobs section to schedule automated test execution
2. Create new jobs with cron-based scheduling
3. Configure job settings: timeouts, retries, and execution parameters
4. Link jobs to specific tests or test suites
5. Monitor job execution history and status

### 📋 Viewing Test Runs

1. Navigate to the Runs section for execution history
2. Filter runs by test, status, date range, or execution type
3. View detailed run reports with logs and artifacts
4. Download test results and Playwright reports
5. Analyze performance trends and failure patterns

### 🎮 Using the Playground

1. Access the Playground for interactive test creation
2. Choose test type: Browser Test, API Test, Database Test, or Custom Test
3. Write and edit test scripts with real-time syntax highlighting
4. Run tests immediately with live feedback
5. Save successful tests to your test library

### 🏢 Organization Administration

1. Access the Organization Admin panel at `/org-admin`
2. Manage organization members and their roles
3. Configure organization-wide settings and preferences
4. Monitor organization usage and capacity
5. Set up billing and subscription management

### 🔧 Super Admin Management

1. Access the Super Admin Dashboard at `/super-admin`
2. View system-wide statistics and user activity
3. Manage user roles and permissions across all organizations
4. Impersonate users for support and testing purposes
5. Monitor system performance and capacity limits

### 🔄 CI/CD Remote Job Trigger

```bash
# Get API key from the Jobs section by editing a specific job
curl -H "Authorization: Bearer your-api-key" \
     -X POST http://localhost:3000/api/jobs/[job-id]/trigger \
     -H "Content-Type: application/json"
```

## 🔐 Security Features

### Role-Based Access Control (RBAC)

### The 6 Unified Roles

1. **SUPER_ADMIN** (`super_admin`) - System-wide access
2. **ORG_OWNER** (`org_owner`) - Full organization control
3. **ORG_ADMIN** (`org_admin`) - Organization management
4. **PROJECT_ADMIN** (`project_admin`) - Full project administration within assigned projects
5. **PROJECT_EDITOR** (`project_editor`) - Project-specific editing
6. **PROJECT_VIEWER** (`project_viewer`) - Read-only access

### Role Hierarchy & Access Levels

```mermaid
graph TD
    subgraph "System Level"
        SA[SUPER_ADMIN<br/>System-wide Control]
        SA --> SA1[User Management]
        SA --> SA2[System Impersonation]
        SA --> SA3[All Org & Project Access]
    end

    subgraph "Organization Level"
        OO[ORG_OWNER<br/>Organization Control]
        OA[ORG_ADMIN<br/>Organization Management]

        OO --> OO1[Delete Organization]
        OO --> OO2[Full Member Management]
        OO --> OO3[All Projects Access]

        OA --> OA1[Manage Organization]
        OA --> OA2[Member Management]
        OA --> OA3[All Projects Access]
        OA -.->|Cannot| OO1
    end

    subgraph "Project Level"
        PA[PROJECT_ADMIN<br/>Assigned Projects Only]
        PE[PROJECT_EDITOR<br/>Assigned Projects Only]
        PV[PROJECT_VIEWER<br/>Read Only]

        PA --> PA1[Manage Project Members]
        PA --> PA2[Full Project Resources]
        PA --> PA3[Create/Edit/Delete]

        PE --> PE1[Edit Project Resources]
        PE --> PE2[Create/Edit Only - No Delete]
        PE -.->|Cannot| PA1

        PV --> PV1[View All Resources]
        PV -.->|Cannot| PE1
        PV -.->|Cannot| PA1
    end

    SA -.-> OO
    SA -.-> OA
    OO -.-> PA
    OA -.-> PA
    PA -.-> PE
    PE -.-> PV

    style SA fill:#ff6b6b,stroke:#d63031,color:#fff
    style OO fill:#fd79a8,stroke:#e84393,color:#fff
    style OA fill:#fdcb6e,stroke:#e17055,color:#fff
    style PA fill:#a29bfe,stroke:#6c5ce7,color:#fff
    style PE fill:#55a3ff,stroke:#2d96ff,color:#fff
    style PV fill:#74b9ff,stroke:#0984e3,color:#fff
```

### Current Permission Matrix

| Resource              | Super Admin | Org Owner | Org Admin | Project Admin          | Project Editor         | Project Viewer         |
| --------------------- | ----------- | --------- | --------- | ---------------------- | ---------------------- | ---------------------- |
| Users (ban/unban)     | ✅          | ❌        | ❌        | ❌                     | ❌                     | ❌                     |
| Organizations         | ✅          | ✅ (own)  | ✅ (own)  | 👁️ (view)              | 👁️ (view)              | 👁️ (view)              |
| Organization Members  | ✅          | ✅        | ✅        | 👁️ (view)              | 👁️ (view)              | 👁️ (view)              |
| Projects              | ✅          | ✅        | ✅        | ✅ (assigned)          | 👁️ (assigned)          | 👁️ (assigned)          |
| Project Members       | ✅          | ✅        | ✅        | ✅ (assigned projects) | 👁️ (assigned projects) | 👁️ (assigned projects) |
| Jobs                  | ✅          | ✅        | ✅        | ✅ (assigned projects) | ✏️ (assigned projects) | 👁️ (assigned projects) |
| Tests                 | ✅          | ✅        | ✅        | ✅ (assigned projects) | ✏️ (assigned projects) | 👁️ (assigned projects) |
| Monitors              | ✅          | ✅        | ✅        | ✅ (assigned projects) | ✏️ (assigned projects) | 👁️ (assigned projects) |
| Runs                  | ✅          | ✅        | ✅        | ✅ (assigned projects) | 👁️ (assigned projects) | 👁️ (assigned projects) |
| API Keys              | ✅          | ✅        | ✅        | ✅ (assigned projects) | ✏️ (assigned projects) | ❌                     |
| Notifications         | ✅          | ✅        | ✅        | ✅ (assigned projects) | ✏️ (assigned projects) | 👁️ (assigned projects) |
| Tags                  | ✅          | ✅        | ✅        | ✅ (assigned projects) | ✏️ (assigned projects) | 👁️ (assigned projects) |
| **Variables/Secrets** |
| Variable Create/Edit  | ✅          | ✅        | ✅        | ✅ (assigned projects) | ✅ (assigned projects) | ❌                     |
| Variable Delete       | ✅          | ✅        | ✅        | ✅ (assigned projects) | ❌                     | ❌                     |
| Secret Values View    | ✅          | ✅        | ✅        | ✅ (assigned projects) | ❌                     | ❌                     |

Legend: ✅ = Full Access, ✏️ = Create/Edit Only (no delete), 👁️ = View Only, ❌ = No Access

### Security Best Practices

- Database audit logging for all security events
- Rate limiting on admin operations
- Session token hashing and validation
- Multi-factor authentication framework
- Comprehensive permission checking
- Secure impersonation with context switching

## 🏗️ Organization and Project System

### Overview

Supercheck uses a hierarchical multi-tenancy model with organizations containing projects. This provides secure resource isolation and flexible team collaboration while maintaining proper data segregation.

### Architecture

#### **Three-Level Hierarchy**

```
System Level → Organization Level → Project Level
     ↓              ↓                    ↓
Super Admin → Org Owner/Admin → Project Admin/Editor/Viewer
```

#### **Automatic Setup**

- **New User Registration**: Automatically creates a default organization and project
- **Default Organization**: Named after the user or custom name
- **Default Project**: Named "Default Project" within the organization
- **Role Assignment**: User becomes the owner of both organization and project

### Organization Management

#### **Key Features**

- **Multi-Organization Support**: Users can belong to multiple organizations
- **Organization Switching**: Session-based context switching between organizations
- **Member Management**: Invite, manage, and assign roles to organization members
- **Resource Isolation**: Complete data separation between organizations
- **Admin Oversight**: Super admins can view and manage all organizations

#### **Organization Roles**

- **Org Owner** (`org_owner`): Full organization control including deletion
- **Org Admin** (`org_admin`): Organization management without deletion rights
- **Member** (`member`): Basic organization membership

### Project Management

#### **Key Features**

- **Project-Scoped Resources**: Tests, jobs, monitors, variables are scoped to projects
- **Project Switching**: Session-based context switching within the active organization
- **Member Assignment**: Granular assignment of users to specific projects
- **Default Project**: Every organization has a default project for immediate use
- **Resource Limits**: Configurable limits on projects per organization

#### **Project Roles**

- **Project Admin** (`project_admin`): Full project control and member management
- **Project Editor** (`project_editor`): Create and edit resources, no delete permissions
- **Project Viewer** (`project_viewer`): Read-only access to all project resources

### Session-Based Context Management

#### **Active Context**

- **Active Organization**: Current organization in user session
- **Active Project**: Current project within the active organization
- **Context Switching**: API endpoints for switching between organizations and projects
- **Impersonation Support**: Admin impersonation preserves organization and project context

### Data Scoping and Security

#### **Resource Isolation**

- **Organization Isolation**: Complete data separation between organizations
- **Project Scoping**: All resources (tests, jobs, monitors, variables) scoped to projects
- **Cross-Project Protection**: No accidental access to resources across projects
- **Audit Trail**: Complete tracking of all organization and project activities

#### **Permission Inheritance**

- **Organization Roles**: Higher organization roles inherit project permissions
- **Project Assignment**: Project-specific roles only apply to assigned projects
- **Super Admin Override**: System-level access bypasses organization/project restrictions

### Multi-Tenancy Benefits

#### **For Teams**

- **Resource Organization**: Separate testing environments per project
- **Team Collaboration**: Granular role assignment for different projects
- **Secure Sharing**: Share specific projects without exposing entire organization

#### **For Enterprises**

- **Department Isolation**: Separate organizations for different departments
- **Client Separation**: Dedicated organizations for different clients
- **Compliance**: Audit trails and access controls for regulatory requirements

### Configuration Limits

```bash
# Organization & Project Limits (Configurable)
MAX_PROJECTS_PER_ORG=10                  # Maximum projects per organization (default: 10)

# Default Settings
DEFAULT_PROJECT_NAME="Default Project"   # Name for auto-created projects
```

## 🔑 Variables and Secrets Management

### Overview

Supercheck provides a comprehensive variable and secret management system for secure handling of configuration data and sensitive information across your testing and monitoring projects.

### Key Features

- **Project-Scoped Variables**: Variables are isolated within projects for better organization
- **Encrypted Secrets**: Sensitive data is encrypted using AES-256-GCM encryption
- **Role-Based Access Control**: Different permission levels for viewing, creating, editing, and deleting variables
- **Audit Trail**: Complete tracking of variable creation and modifications
- **Test Integration**: Easy access to variables in test scripts using helper functions

### Variable Types

#### **Regular Variables**

- Plain text configuration values
- Visible to all project members with appropriate permissions
- Used for non-sensitive configuration like URLs, usernames, timeouts

#### **Secret Variables**

- Encrypted at rest using AES-256-GCM encryption
- Values masked in the UI for security
- Only visible to users with management permissions
- Used for sensitive data like passwords, API keys, tokens

### Access Control Matrix

| Role               | View Variables         | Create/Edit Variables  | Delete Variables       | View Secret Values     |
| ------------------ | ---------------------- | ---------------------- | ---------------------- | ---------------------- |
| **Super Admin**    | ✅                     | ✅                     | ✅                     | ✅                     |
| **Org Owner**      | ✅                     | ✅                     | ✅                     | ✅                     |
| **Org Admin**      | ✅                     | ✅                     | ✅                     | ✅                     |
| **Project Admin**  | ✅ (assigned projects) | ✅ (assigned projects) | ✅ (assigned projects) | ✅ (assigned projects) |
| **Project Editor** | ✅ (assigned projects) | ✅ (assigned projects) | ❌                     | ❌                     |
| **Project Viewer** | ✅ (assigned projects) | ❌                     | ❌                     | ❌                     |

### Usage in Tests

Variables can be accessed in Playwright test scripts using built-in helper functions:

```javascript
// Access regular variables
const apiUrl = await getVariable("API_URL");
const timeout = await getVariable("REQUEST_TIMEOUT");

// Access encrypted secrets
const apiKey = await getSecret("API_KEY");
const password = await getSecret("USER_PASSWORD");

// Use in your tests
await page.goto(apiUrl);
await page.fill('[name="password"]', password);
```

## 🚨 Alerts and Notifications System

### Overview

Supercheck includes a sophisticated multi-channel alerting system that keeps your team informed about test failures, monitor status changes, and system events through various notification providers.

### Supported Notification Providers

#### **Email**

- **Configuration**: SMTP-based email delivery
- **Features**: Professional HTML templates, batch processing, responsive design
- **Use Cases**: Formal notifications, compliance reporting, executive summaries

#### **Slack**

- **Configuration**: Webhook URL and channel configuration
- **Features**: Rich formatting, @mentions, custom emojis, thread support
- **Use Cases**: Team collaboration, real-time developer notifications

#### **Webhook**

- **Configuration**: Custom URL, HTTP method, headers, and payload templates
- **Features**: Flexible integration with any HTTP-based system
- **Use Cases**: Integration with ticketing systems, custom dashboards, external tools

#### **Telegram**

- **Configuration**: Bot token and chat ID
- **Features**: Instant mobile delivery, cross-platform support
- **Use Cases**: Personal alerts, mobile-first teams, remote monitoring

#### **Discord**

- **Configuration**: Discord webhook URL
- **Features**: Rich embeds, custom formatting, community integration
- **Use Cases**: Gaming teams, developer communities, informal notifications

### Alert Types

#### **Monitor Alerts**

- **Failure Alerts**: Sent when monitors change from 'up' to 'down' status
- **Recovery Alerts**: Sent when monitors return from 'down' to 'up' status
- **SSL Expiration Alerts**: Warnings for expiring SSL certificates

#### **Job Alerts**

- **Failure Alerts**: Triggered when test jobs fail
- **Success Alerts**: Confirmation when critical jobs complete successfully
- **Timeout Alerts**: Notifications for jobs that exceed time limits

### Smart Alert Management

#### **Threshold-Based Alerting**

- **Failure Threshold**: Number of consecutive failures before alerting (prevents false positives)
- **Recovery Threshold**: Number of consecutive successes before recovery alerts
- **Configurable Sensitivity**: Different thresholds for different monitors/jobs

#### **Alert Limiting**

- **Maximum 3 failure alerts** per failure sequence to prevent notification spam
- **Unlimited recovery alerts** to ensure resolution visibility
- **Status change detection** for intelligent alert triggers

### Alert History and Monitoring

- **Complete audit trail** of all sent notifications
- **Delivery status tracking** for each notification provider
- **Failed delivery logging** with error details and retry information
- **Alert frequency analysis** to optimize threshold settings

## 🙏 Acknowledgments

Built with modern, battle-tested technologies:

- [Next.js](https://nextjs.org/) - Full-stack React framework for building fast, scalable web applications
- [NestJS](https://nestjs.com/) - Scalable server-side applications
- [Playwright](https://playwright.dev/) - End-to-end testing framework
- [PostgreSQL](https://postgresql.org/) - Advanced relational database
- [Redis](https://redis.io/) - In-memory database
- [BullMQ](https://bullmq.io/) - Robust job/message queue for Node.js
- [MinIO](https://min.io/) - S3-compatible object storage
- [Shadcn/ui](https://ui.shadcn.com/) - UI components
- [Better Auth](https://better-auth.com/) - Authentication system

---
