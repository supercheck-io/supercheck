# Authentication System Specification

## Overview

Supercheck uses **Better Auth 1.2.8** as its comprehensive authentication framework, providing secure email/password authentication, multi-tenant organization management, role-based access control (RBAC), and admin capabilities including user impersonation.

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Authentication Flows](#authentication-flows)
3. [Better Auth Configuration](#better-auth-configuration)
4. [RBAC System](#rbac-system)
5. [Session Management](#session-management)
6. [Security Features](#security-features)
7. [Email Integration](#email-integration)
8. [Organization Management](#organization-management)
9. [API Integration](#api-integration)
10. [Database Schema](#database-schema)
11. [Testing Guide](#testing-guide)

## System Architecture

```mermaid
graph TB
    subgraph "🎨 Frontend Layer"
        UI1[Sign In Page]
        UI2[Sign Up Page]
        UI3[Forgot Password Page]
        UI4[Reset Password Page]
        CLIENT[Better Auth Client]
    end

    subgraph "🔐 Better Auth Server"
        SERVER[Auth Server Core]
        PLUGINS[Plugins]

        subgraph "Plugin System"
            ORG[Organization Plugin]
            ADMIN[Admin Plugin]
            APIKEY[API Key Plugin]
        end
    end

    subgraph "⚙️ Middleware & Guards"
        MW1[Session Middleware]
        MW2[RBAC Guard]
        MW3[API Route Protection]
    end

    subgraph "💾 Data Layer"
        DB[(PostgreSQL)]
        CACHE[Redis Session Cache]
    end

    subgraph "📧 External Services"
        SMTP[SMTP Email Service]
        RESEND[Resend.com API]
    end

    UI1 & UI2 & UI3 & UI4 --> CLIENT
    CLIENT --> SERVER
    SERVER --> PLUGINS
    PLUGINS --> ORG & ADMIN & APIKEY

    SERVER --> MW1
    MW1 --> MW2
    MW2 --> MW3

    SERVER --> DB
    MW1 --> CACHE
    SERVER --> SMTP
    SERVER --> RESEND

    classDef frontend fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef auth fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef middleware fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef data fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef external fill:#ffebee,stroke:#d32f2f,stroke-width:2px

    class UI1,UI2,UI3,UI4,CLIENT frontend
    class SERVER,PLUGINS,ORG,ADMIN,APIKEY auth
    class MW1,MW2,MW3 middleware
    class DB,CACHE data
    class SMTP,RESEND external
```

## Authentication Flows

### Sign In Flow

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant BetterAuth
    participant Database
    participant Session

    User->>Frontend: Enter email & password
    Frontend->>BetterAuth: POST /api/auth/sign-in/email
    BetterAuth->>Database: Query user by email
    Database-->>BetterAuth: User record

    BetterAuth->>BetterAuth: Verify password hash

    alt Password Valid
        BetterAuth->>Session: Create session (7-day expiry)
        Session->>Database: Store session token
        BetterAuth-->>Frontend: Set secure cookie + user data
        Frontend->>Frontend: Redirect to dashboard
        Frontend-->>User: Show dashboard
    else Password Invalid
        BetterAuth-->>Frontend: 401 Invalid credentials
        Frontend-->>User: Show error message
    end
```

### Sign Up Flow

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant BetterAuth
    participant Database
    participant OrgPlugin

    User->>Frontend: Enter name, email, password
    Frontend->>BetterAuth: POST /api/auth/sign-up/email
    BetterAuth->>BetterAuth: Validate password strength
    BetterAuth->>Database: Check email uniqueness

    alt Email Already Exists
        BetterAuth-->>Frontend: 400 Email already registered
        Frontend-->>User: Show error
    else Email Available
        BetterAuth->>Database: Create user record
        Database-->>BetterAuth: User created

        BetterAuth->>OrgPlugin: Create default organization
        OrgPlugin->>Database: Insert organization
        OrgPlugin->>Database: Add user as owner
        Database-->>OrgPlugin: Org created

        BetterAuth-->>Frontend: 200 Success
        Frontend->>Frontend: Redirect to sign-in
        Frontend-->>User: Show success message
    end
```

### Forgot Password Flow

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant BetterAuth
    participant RateLimit
    participant Database
    participant Email

    User->>Frontend: Enter email
    Frontend->>BetterAuth: POST /api/auth/forget-password

    BetterAuth->>RateLimit: Check email rate limit (3/15min)
    BetterAuth->>RateLimit: Check IP rate limit (3/15min)

    alt Rate Limit Exceeded
        RateLimit-->>BetterAuth: Rate limit error
        BetterAuth-->>Frontend: 429 Too Many Requests
        Frontend-->>User: Show wait time message
    else Rate Limit OK
        RateLimit-->>BetterAuth: Allow
        BetterAuth->>Database: Query user by email

        alt User Not Found
            Note over BetterAuth: Security: Don't reveal if email exists
            BetterAuth-->>Frontend: 200 Success (silent)
            Frontend-->>User: "Check your email"
        else User Found
            BetterAuth->>Database: Generate reset token (1-hour expiry)
            Database-->>BetterAuth: Token stored
            BetterAuth->>Email: Send reset email
            Email-->>User: Password reset email
            BetterAuth-->>Frontend: 200 Success
            Frontend-->>User: "Check your email"
        end
    end
```

### Reset Password Flow

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant BetterAuth
    participant Database

    User->>User: Click email link
    User->>Frontend: Access reset page with token
    Frontend->>Frontend: Extract token from URL

    User->>Frontend: Enter new password
    Frontend->>BetterAuth: POST /api/auth/reset-password
    BetterAuth->>Database: Validate token

    alt Token Invalid/Expired
        Database-->>BetterAuth: Token not found/expired
        BetterAuth-->>Frontend: 400 Invalid token
        Frontend-->>User: Show error + request new link
    else Token Valid
        Database-->>BetterAuth: Token valid
        BetterAuth->>BetterAuth: Hash new password
        BetterAuth->>Database: Update password hash
        BetterAuth->>Database: Invalidate reset token
        Database-->>BetterAuth: Password updated
        BetterAuth-->>Frontend: 200 Success
        Frontend->>Frontend: Auto-redirect to sign-in
        Frontend-->>User: Success message
    end
```

## Better Auth Configuration

### Core Configuration

**Location:** `app/src/utils/auth.ts`

**Key Features:**
- Email/password authentication
- Organization plugin with automatic org creation
- Admin plugin with impersonation support
- API key plugin for programmatic access
- Session duration: 7 days
- Session update age: 24 hours
- Database adapter: Drizzle ORM with PostgreSQL

### Plugins Enabled

```mermaid
graph TB
    A[Better Auth Core] --> B[Organization Plugin]
    A --> C[Admin Plugin]
    A --> D[API Key Plugin]

    B --> B1[Auto-create org on signup]
    B --> B2[Multi-org support]
    B --> B3[Invitation system]
    B --> B4[Member management]

    C --> C1[Super admin role]
    C --> C2[User impersonation]
    C --> C3[Admin dashboard access]

    D --> D1[API key generation]
    D --> D2[Job-specific keys]
    D --> D3[Rate limiting]
    D --> D4[Expiration handling]

    classDef core fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef plugin fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef feature fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class A core
    class B,C,D plugin
    class B1,B2,B3,B4,C1,C2,C3,D1,D2,D3,D4 feature
```

## RBAC System

### Role Hierarchy

```mermaid
graph TB
    A[super_admin] -->|Platform-wide access| B[All Organizations]

    C[org_owner] -->|Organization-level| D[All Projects in Org]
    E[org_admin] -->|Organization-level| D

    F[project_admin] -->|Project-level| G[Specific Project]
    H[project_editor] -->|Project-level| G
    I[project_viewer] -->|Project-level| G

    B --> D
    D --> G

    classDef superadmin fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef org fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef project fill:#e3f2fd,stroke:#1976d2,stroke-width:2px

    class A superadmin
    class C,E org
    class F,H,I project
```

### Permission Matrix

| Role | Create Project | Create Test | Execute Test | Create Job | Trigger Job | Manage Members | View Only |
|------|----------------|-------------|--------------|------------|-------------|----------------|-----------|
| `super_admin` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `org_owner` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `org_admin` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `project_admin` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ (project) | ✅ |
| `project_editor` | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `project_viewer` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

### Authorization Flow

```mermaid
sequenceDiagram
    participant Request
    participant Middleware
    participant RBAC
    participant Database
    participant Handler

    Request->>Middleware: API Request
    Middleware->>Middleware: Validate session

    alt No Session
        Middleware-->>Request: 401 Unauthorized
    else Valid Session
        Middleware->>RBAC: Check permissions
        RBAC->>Database: Get user roles
        Database-->>RBAC: Role list
        RBAC->>RBAC: Evaluate permissions

        alt Permission Denied
            RBAC-->>Request: 403 Forbidden
        else Permission Granted
            RBAC->>Handler: Execute handler
            Handler-->>Request: Success response
        end
    end
```

## Session Management

### Session Lifecycle

```mermaid
graph LR
    A[User Signs In] --> B[Create Session]
    B --> C[Store in Database]
    C --> D[Set Secure Cookie]
    D --> E[Session Active]
    E --> F{Activity Detected?}
    F -->|Yes, <24h| G[Extend Session]
    F -->|No, <7d| E
    F -->|>7d| H[Session Expired]
    G --> E
    H --> I[Redirect to Sign In]

    classDef active fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef expired fill:#ffebee,stroke:#d32f2f,stroke-width:2px

    class E,G active
    class H,I expired
```

### Session Configuration

**Properties:**
- **Duration:** 7 days (604800 seconds)
- **Update Age:** 24 hours (session token refreshes daily with activity)
- **Cookie Settings:**
  - `httpOnly: true` (prevents XSS)
  - `secure: true` (HTTPS only in production)
  - `sameSite: 'lax'` (CSRF protection)
  - `path: '/'` (application-wide)

**Security Features:**
- IP address tracking (optional verification)
- User agent tracking
- Last activity timestamp
- Automatic token rotation on update
- Secure session invalidation on sign out

## Security Features

### Rate Limiting

```mermaid
graph TB
    A[Password Reset Request] --> B{Check Rate Limits}

    subgraph "Dual Rate Limiting"
        B --> C{Email Limit<br/>3 per 15min}
        B --> D{IP Limit<br/>3 per 15min}
    end

    C -->|Exceeded| E[Block Request]
    D -->|Exceeded| E
    C -->|OK| F{Both OK?}
    D -->|OK| F

    F -->|Yes| G[Process Request]
    F -->|No| E

    E --> H[Return 429 + Wait Time]
    G --> I[Send Reset Email]

    classDef check fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef block fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef success fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class B,C,D,F check
    class E,H block
    class G,I success
```

**Rate Limiting Implementation:**
- In-memory rate limit store (production should use Redis)
- Automatic cleanup every 5 minutes
- Separate limits for email and IP
- Clear error messages with wait time
- Prevents both user-targeted and distributed attacks

### Password Security

**Requirements:**
```mermaid
graph TB
    A[Password Policy] --> B[Minimum 8 characters]
    A --> C[At least 1 uppercase]
    A --> D[At least 1 lowercase]
    A --> E[At least 1 number]
    A --> F[At least 1 special character]

    G[Storage Security] --> H[Bcrypt hashing]
    G --> I[Automatic salt]
    G --> J[Cost factor: 10]

    K[Reset Security] --> L[1-hour token expiry]
    K --> M[Single-use tokens]
    K --> N[Cryptographically secure]

    classDef policy fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef storage fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef reset fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class A,B,C,D,E,F policy
    class G,H,I,J storage
    class K,L,M,N reset
```

### Additional Security Measures

**Implementation:**
- CSRF protection via SameSite cookies
- XSS prevention via httpOnly cookies
- SQL injection prevention via parameterized queries
- Password visibility toggle (UX improvement)
- Secure error messages (no information leakage)
- Token invalidation after successful reset
- Automatic session cleanup on suspicious activity

## Email Integration

### Email Service Architecture

```mermaid
graph TB
    A[Email Request] --> B{Email Service Type}

    B -->|Production| C[Resend.com API]
    B -->|Development| D[SMTP Service]

    C --> E[Professional Email Delivery]
    D --> F[Local SMTP Server]

    G[Template Engine] --> H[React Email]
    H --> I[HTML Generation]
    I --> J[Inline CSS]

    E --> K[Send Email]
    F --> K
    K --> L[Delivery Confirmation]

    classDef service fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef template fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef delivery fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class C,D,E,F service
    class G,H,I,J template
    class K,L delivery
```

### Email Templates

**Password Reset Email Features:**
- Professional HTML template with branding
- Plain text fallback for compatibility
- Clear call-to-action button
- Security warnings about expiration
- Advice for unauthorized requests
- Consistent application branding
- Mobile-responsive design

**Configuration Variables:**
- `SMTP_HOST` - SMTP server hostname
- `SMTP_PORT` - SMTP server port
- `SMTP_USER` - SMTP username
- `SMTP_PASSWORD` - SMTP password
- `SMTP_SECURE` - Use TLS/SSL (true/false)
- `SMTP_FROM_EMAIL` - Sender email address
- `RESEND_API_KEY` - Resend.com API key (production)

## Organization Management

### Organization Creation Flow

```mermaid
sequenceDiagram
    participant User
    participant System
    participant Database
    participant OrgPlugin

    User->>System: Sign Up
    System->>Database: Create user account
    Database-->>System: User created

    System->>OrgPlugin: Trigger auto-org creation
    OrgPlugin->>OrgPlugin: Generate org name from email
    OrgPlugin->>Database: Create organization
    Database-->>OrgPlugin: Organization created

    OrgPlugin->>Database: Add user as owner
    Database-->>OrgPlugin: Member role assigned
    OrgPlugin-->>System: Org setup complete
    System-->>User: Registration successful
```

### Invitation System

```mermaid
sequenceDiagram
    participant Owner
    participant System
    participant Database
    participant Email
    participant NewUser

    Owner->>System: Send invitation
    System->>Database: Create invitation record
    Database-->>System: Invitation created

    System->>Email: Send invitation email
    Email-->>NewUser: Invitation received

    NewUser->>System: Click invitation link
    System->>Database: Verify invitation token

    alt Valid Invitation
        Database-->>System: Token valid
        NewUser->>System: Sign in/sign up
        System->>Database: Accept invitation
        Database->>Database: Add user to organization
        Database-->>System: Member added
        System-->>NewUser: Welcome to organization
    else Invalid/Expired
        Database-->>System: Invalid token
        System-->>NewUser: Invitation expired
    end
```

## API Integration

### Authentication Endpoints

**User Authentication:**
- `POST /api/auth/sign-in/email` - Email/password sign-in
- `POST /api/auth/sign-up/email` - User registration
- `POST /api/auth/sign-out` - Session termination
- `GET /api/auth/get-session` - Current session info

**Password Management:**
- `POST /api/auth/forget-password` - Request password reset
- `POST /api/auth/reset-password` - Execute password reset

**Organization Management:**
- `POST /api/auth/organization/create` - Create new organization
- `POST /api/auth/organization/invite-member` - Send invitation
- `GET /api/auth/organization/members` - List organization members
- `DELETE /api/auth/organization/remove-member` - Remove member

**Admin Functions:**
- `POST /api/auth/admin/impersonate` - Impersonate user
- `POST /api/auth/admin/stop-impersonating` - Stop impersonation

### Client SDK Methods

**Authentication:**
- `authClient.signIn.email(credentials)` - Sign in
- `authClient.signUp.email(userData)` - Sign up
- `authClient.signOut()` - Sign out
- `authClient.forgetPassword(email)` - Request reset
- `authClient.resetPassword(data)` - Reset password

**React Hooks:**
- `useSession()` - Get current session
- `useActiveOrganization()` - Get active org
- `useOrganizations()` - List all user orgs

## Database Schema

### Authentication Tables

```mermaid
erDiagram
    USER ||--o{ SESSION : has
    USER ||--o{ ACCOUNT : has
    USER ||--o{ MEMBER : has
    ORGANIZATION ||--o{ MEMBER : has
    ORGANIZATION ||--o{ INVITATION : sends
    ORGANIZATION ||--o{ PROJECT : contains

    USER {
        uuid id PK
        string email UK
        string name
        timestamp emailVerified
        string image
        timestamp createdAt
        timestamp updatedAt
        string role
    }

    SESSION {
        uuid id PK
        string token UK
        uuid userId FK
        timestamp expiresAt
        string ipAddress
        string userAgent
        timestamp createdAt
    }

    ACCOUNT {
        uuid id PK
        uuid userId FK
        string accountId
        string providerId
        string accessToken
        string refreshToken
        timestamp expiresAt
    }

    ORGANIZATION {
        uuid id PK
        string name
        string slug UK
        string logo
        jsonb metadata
        timestamp createdAt
    }

    MEMBER {
        uuid id PK
        uuid organizationId FK
        uuid userId FK
        string role
        timestamp createdAt
    }

    INVITATION {
        uuid id PK
        uuid organizationId FK
        string email
        string role
        string token UK
        timestamp expiresAt
        timestamp createdAt
    }
```

## Testing Guide

### Test Scenarios

#### 1. Sign Up Flow
**Steps:**
1. Navigate to sign-up page
2. Enter valid email, name, password
3. Submit form
4. Verify user created in database
5. Verify default organization created
6. Verify user assigned as owner

**Expected:** User redirected to sign-in with success message

#### 2. Sign In Flow
**Steps:**
1. Navigate to sign-in page
2. Enter registered email and password
3. Submit form
4. Verify session created
5. Verify secure cookie set

**Expected:** User redirected to dashboard

#### 3. Password Reset Flow
**Steps:**
1. Navigate to forgot password
2. Enter registered email
3. Check email received
4. Click reset link
5. Enter new password
6. Submit form
7. Attempt sign in with new password

**Expected:** Password successfully reset, sign in works

#### 4. Rate Limiting
**Steps:**
1. Request password reset 4 times in quick succession
2. Verify 4th request blocked
3. Check error message includes wait time

**Expected:** Rate limit enforced after 3 attempts

#### 5. Organization Invitation
**Steps:**
1. Owner sends invitation to email
2. New user receives invitation email
3. New user clicks link and signs up/in
4. Verify user added to organization
5. Verify correct role assigned

**Expected:** New member added to organization

## Related Documentation

- **RBAC System:** See `RBAC_DOCUMENTATION.md` for detailed permission model
- **API Keys:** See `API_KEY_SYSTEM.md` for programmatic access
- **Database Schema:** See `ERD_DIAGRAM.md` for complete database structure
- **Organization Management:** See `ORGANIZATION_AND_PROJECT_IMPLEMENTATION.md`

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 3.0 | 2025-01-12 | Updated for Better Auth 1.2.8, enhanced diagrams |
| 2.0 | 2024-12-01 | Added organization plugin details |
| 1.0 | 2024-10-15 | Initial specification |
