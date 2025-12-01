# Authentication System Specification

## Overview

Supercheck uses **Better Auth 1.2.8** as its comprehensive authentication framework, providing:
- **Email/Password Authentication**: Traditional credential-based sign-in
- **Social Authentication**: GitHub and Google OAuth 2.0 sign-in
- **Multi-Tenant Organization Management**: Built-in organization support
- **Role-Based Access Control (RBAC)**: Fine-grained permissions
- **Admin Capabilities**: User impersonation and management
- **Polar Billing Integration**: Automatic customer creation for cloud deployments

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
        UI5[Auth Callback Page]
        CLIENT[Better Auth Client]
    end

    subgraph "🔐 Better Auth Server"
        SERVER[Auth Server Core]
        PLUGINS[Plugins]
        SOCIAL[Social Providers]

        subgraph "Plugin System"
            ORG[Organization Plugin]
            ADMIN[Admin Plugin]
            APIKEY[API Key Plugin]
            POLAR[Polar Plugin<br/>Optional]
        end

        subgraph "OAuth Providers"
            GITHUB[GitHub OAuth]
            GOOGLE[Google OAuth]
        end
    end

    subgraph "⚙️ Middleware & Guards"
        MW1[Session Middleware]
        MW2[RBAC Guard]
        MW3[API Route Protection]
    end

    subgraph "💾 Data Layer"
        DB[(PostgreSQL)]
    end

    subgraph "📧 External Services"
        SMTP[SMTP Email Service]
        GHAPI[GitHub API]
        GAPI[Google API]
        PAPI[Polar API<br/>Optional]
    end

    UI1 & UI2 & UI3 & UI4 --> CLIENT
    UI5 --> CLIENT
    CLIENT --> SERVER
    SERVER --> PLUGINS
    PLUGINS --> ORG & ADMIN & APIKEY & POLAR

    SERVER --> SOCIAL
    SOCIAL --> GITHUB & GOOGLE
    GITHUB --> GHAPI
    GOOGLE --> GAPI
    POLAR --> PAPI

    SERVER --> MW1
    MW1 --> MW2
    MW2 --> MW3

    SERVER --> DB
    SERVER --> SMTP

    classDef frontend fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef auth fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef middleware fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef data fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef external fill:#ffebee,stroke:#d32f2f,stroke-width:2px

    class UI1,UI2,UI3,UI4,UI5,CLIENT frontend
    class SERVER,PLUGINS,ORG,ADMIN,APIKEY,POLAR,SOCIAL,GITHUB,GOOGLE auth
    class MW1,MW2,MW3 middleware
    class DB data
    class SMTP,GHAPI,GAPI,PAPI external
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

### Social Sign-In Flow (GitHub/Google)

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant BetterAuth
    participant OAuth as GitHub/Google
    participant Callback as Auth Callback Page
    participant Setup as /api/auth/setup-defaults
    participant Database
    participant Polar as Polar API<br/>(Cloud Mode)

    User->>Frontend: Click "Sign in with GitHub/Google"
    Frontend->>BetterAuth: Initiate OAuth flow
    BetterAuth->>OAuth: Redirect to provider
    User->>OAuth: Authenticate & authorize

    OAuth->>BetterAuth: Redirect with auth code
    BetterAuth->>OAuth: Exchange code for tokens
    OAuth-->>BetterAuth: Access token + refresh token

    BetterAuth->>Database: Query user by email

    alt Existing User
        BetterAuth->>Database: Link social account
        BetterAuth->>Database: Store tokens
    else New User
        BetterAuth->>Database: Create user record
        BetterAuth->>Database: Create account record

        Note over BetterAuth,Polar: Cloud Mode: Polar customer creation
        opt Polar Enabled
            BetterAuth->>Polar: Create customer
            Polar-->>BetterAuth: Customer ID
            BetterAuth->>Database: Store polar_customer_id
        end
    end

    BetterAuth->>Database: Create session
    BetterAuth-->>Callback: Redirect to /auth-callback
    Callback->>Setup: POST setup-defaults
    Setup->>Database: Create org + project (if new user)
    Setup-->>Callback: Defaults created

    Callback-->>User: Redirect to dashboard
```

### Social Sign-Up Flow Details

```mermaid
sequenceDiagram
    participant User
    participant UI as Sign Up Page
    participant Social as Social Buttons
    participant OAuth as OAuth Provider
    participant Auth as Better Auth
    participant Callback as /auth-callback
    participant DB as Database

    User->>UI: Visit /sign-up
    UI->>Social: Render social buttons
    User->>Social: Click "Sign up with GitHub"

    Social->>Auth: signIn.social({provider: "github"})
    Auth->>OAuth: Redirect to OAuth consent
    OAuth-->>User: Show authorization screen

    User->>OAuth: Grant permissions
    OAuth->>Auth: Callback with auth code
    Auth->>OAuth: Exchange code for tokens

    Auth->>DB: Check if user exists
    alt New User
        Auth->>DB: INSERT user
        Auth->>DB: INSERT account (social)
        Auth->>DB: INSERT session
        Note over Auth: New user flag set
    else Existing User
        Auth->>DB: Link social account
        Auth->>DB: INSERT session
        Note over Auth: No new user flag
    end

    Auth-->>Callback: Redirect to /auth-callback
    Callback->>Callback: Check session

    alt New User
        Callback->>DB: Call /api/auth/setup-defaults
        Note over Callback: Create org + project
    else Existing User
        Note over Callback: Skip org creation
    end

    Callback-->>User: Redirect to dashboard
```

## Better Auth Configuration

### Core Configuration

**Location:** `app/src/utils/auth.ts`

**Key Features:**
- **Email/Password Authentication**: Traditional credential-based auth
- **Social Authentication**:
  - GitHub OAuth 2.0 (conditionally enabled)
  - Google OAuth 2.0 (conditionally enabled, with offline access and refresh tokens)
- **Organization Plugin**: Org creation handled in the API layer (`/api/auth/setup-defaults` + invitations)
- **Admin Plugin**: Super admin roles with impersonation support
- **API Key Plugin**: Programmatic access for jobs and monitors
- **Polar Plugin** *(Optional)*: Automatic customer creation for cloud deployments
- **Session Duration**: 7 days
- **Session Update Age**: 24 hours (refreshes with activity)
- **Database Adapter**: Drizzle ORM with PostgreSQL

### Social Authentication Configuration

**GitHub OAuth:**
```typescript
socialProviders: {
  github: {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    enabled: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
  },
}
```

**Google OAuth:**
```typescript
socialProviders: {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    enabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    accessType: "offline",  // Always get refresh tokens
    prompt: "select_account consent",  // Force account selection
  },
}
```

**Environment Variables:**
```bash
# GitHub OAuth (Optional - buttons shown automatically when configured)
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# Google OAuth (Optional - buttons shown automatically when configured)
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

> **Note:** Social auth buttons are dynamically loaded via `/api/config/auth-providers` endpoint, allowing runtime configuration without rebuilding the application.

**Callback URLs:**
- GitHub: `{BASE_URL}/api/auth/callback/github`
- Google: `{BASE_URL}/api/auth/callback/google`

**Setup Requirements:**
- GitHub: Create OAuth App at [GitHub Developer Settings](https://github.com/settings/developers)
  - **Important**: For GitHub Apps, enable email read permissions
- Google: Create OAuth credentials at [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
  - **Important**: Configure OAuth consent screen first
  - Add authorized redirect URIs exactly matching your callback URLs

### Plugins Enabled

```mermaid
graph TB
    A[Better Auth Core] --> B[Organization Plugin]
    A --> C[Admin Plugin]
    A --> D[API Key Plugin]

    B --> B1[Default org creation via /api/auth/setup-defaults]
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
    A[Email Request] --> B[SMTP Service]

    B --> E[Outbound email via nodemailer/SMTP]

    G[Template Engine] --> H[React Email]
    H --> I[HTML Generation]
    I --> J[Inline CSS]

    E --> K[Send Email]
    K --> L[Delivery Confirmation]

    classDef service fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef template fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef delivery fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class B,E service
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

## Organization Management

### Organization Creation Flow

```mermaid
sequenceDiagram
    participant User
    participant System
    participant Database

    User->>System: Sign in or sign up
    System->>Database: Check existing memberships
    Database-->>System: Memberships (if any)

    alt Already in org or pending invite
        System-->>User: Skip default org creation
    else No org and no pending invites
        System->>/api/auth/setup-defaults: Create org + default project
        Database-->>System: Org and project created
        System-->>User: Default org ready
    end
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

**Better Auth handlers (App Router):**
- `/api/auth/[...all]` and `/api/auth` handle sign-in, sign-up, sign-out, password reset, and session retrieval.
- `/api/auth/sign-in/email` and `/api/auth/sign-up/email` are dedicated email/password entrypoints used by the auth pages.
- `/api/auth/callback/github` - GitHub OAuth callback handler
- `/api/auth/callback/google` - Google OAuth callback handler
- `/api/auth/impersonation-status`, `/api/admin/stop-impersonation` surface impersonation state/stop controls.
- `/api/auth/user` returns the current session's user.
- `/api/auth/setup-defaults` creates a default org/project when the user has no memberships and no pending invites.
- `/api/auth/verify-key` validates job-scoped API keys.

**Frontend Routes:**
- `/sign-in` - Sign-in page with email/password and social auth buttons
- `/sign-up` - Sign-up page with email/password and social auth buttons
- `/auth-callback` - OAuth redirect handler, calls setup-defaults for new users
- `/forgot-password` - Password reset request page
- `/reset-password` - Password reset form page

**Organization & membership APIs (outside Better Auth):**
- `/api/organizations/*` and `/api/projects/*` manage orgs, projects, members, invitations, and variables; access is enforced via RBAC middleware rather than Better Auth plugins.

### Client SDK Methods

**Email/Password Authentication:**
- `authClient.signIn.email(credentials)` - Sign in with email/password
- `authClient.signUp.email(userData)` - Sign up with email/password
- `authClient.signOut()` - Sign out (all methods)
- `authClient.forgetPassword(email)` - Request password reset
- `authClient.resetPassword(data)` - Reset password with token

**Social Authentication:**
- `authClient.signIn.social({ provider: "github", callbackURL })` - Sign in with GitHub
- `authClient.signIn.social({ provider: "google", callbackURL })` - Sign in with Google
- Auto-redirects to OAuth provider, then back to callbackURL
- Handles both new user signup and existing user signin
- Automatically links social accounts to existing email accounts

**Organizations & Admin (Better Auth client plugins):**
- `organization.create/list/setActive(...)` - Manage org membership context
- `organization.inviteMember(...)`, `organization.removeMember(...)`, `organization.updateMemberRole(...)` - Org membership controls
- `admin.listUsers/createUser/banUser/unbanUser/impersonateUser/removeUser` - Super-admin actions

**React Hooks:**
- `useSession()` - Get current session (works for all auth methods)

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
