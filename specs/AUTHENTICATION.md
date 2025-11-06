# Authentication System Documentation

## Overview

Supercheck uses **Better Auth 1.2.8** as its authentication framework, providing a secure, feature-rich authentication system with email/password authentication, organization management, comprehensive security features, and multi-tenant organization support.

## Architecture

```mermaid
graph TB
    subgraph "Frontend (Next.js)"
        A[Sign In Page] --> B[Auth Client]
        C[Sign Up Page] --> B
        D[Forgot Password Page] --> B
        E[Reset Password Page] --> B
        B --> F[Better Auth Client]
    end
    
    subgraph "Backend (Better Auth)"
        F --> G[Better Auth Server]
        G --> H[Rate Limiter]
        G --> I[Email Service]
        G --> J[Database Adapter]
    end
    
    subgraph "Infrastructure"
        H --> K[In-Memory Store]
        I --> L[SMTP Email]
        J --> M[PostgreSQL]
    end
    
    subgraph "Security"
        N[Session Security] --> G
        O[RBAC System] --> G
        P[Admin Plugins] --> G
    end
```

## Authentication Flow

### Sign In Flow

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant A as Auth Server
    participant DB as Database
    participant S as Session
    
    U->>F: Enter credentials
    F->>A: POST /api/auth/sign-in
    A->>DB: Validate user credentials
    DB-->>A: User data
    A->>S: Create session
    S-->>A: Session token
    A-->>F: Authentication response
    F-->>U: Redirect to dashboard
```

### Sign Up Flow

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant A as Auth Server
    participant DB as Database
    participant O as Organization
    
    U->>F: Enter user details
    F->>A: POST /api/auth/sign-up
    A->>DB: Create user account
    DB-->>A: User created
    A->>O: Create default organization
    O-->>A: Organization created
    A-->>F: Registration response
    F-->>U: Redirect to sign-in
```

### Forgot Password Flow

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant A as Auth Server
    participant R as Rate Limiter
    participant E as Email Service
    participant DB as Database
    
    U->>F: Enter email address
    F->>A: POST /api/auth/forget-password
    A->>R: Check rate limits (email + IP)
    
    alt Rate limit exceeded
        R-->>A: Rate limit error
        A-->>F: Error with wait time
        F-->>U: Show rate limit message
    else Rate limit OK
        R-->>A: Allow request
        A->>DB: Create reset token
        DB-->>A: Token stored
        A->>E: Send reset email
        E-->>A: Email sent
        A-->>F: Success response
        F-->>U: Check email message
    end
```

### Reset Password Flow

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant A as Auth Server
    participant DB as Database
    
    U->>F: Click email link with token
    F->>F: Extract token from URL
    U->>F: Enter new password
    F->>A: POST /api/auth/reset-password
    A->>DB: Validate reset token
    
    alt Token invalid/expired
        DB-->>A: Token invalid
        A-->>F: Error response
        F-->>U: Show error
    else Token valid
        DB-->>A: Token valid
        A->>DB: Update password & invalidate token
        DB-->>A: Password updated
        A-->>F: Success response
        F-->>U: Success + redirect to sign-in
    end
```

## Security Features

### Rate Limiting

```mermaid
graph TB
    A[Password Reset Request] --> B{Check Email Rate Limit}
    B -->|Exceeded| C[Return Error with Wait Time]
    B -->|OK| D{Check IP Rate Limit}
    D -->|Exceeded| C
    D -->|OK| E[Process Request]
    
    F[Rate Limit Store] --> B
    F --> D
    G[Cleanup Service] --> F
    
    subgraph "Rate Limits"
        H[Email: 3 attempts per 15 min]
        I[IP: 3 attempts per 15 min]
        J[Auto cleanup every 5 min]
    end
```

**Rate Limiting Rules:**
- **Password Reset**: 3 attempts per email per 15 minutes
- **IP Protection**: 3 attempts per IP address per 15 minutes
- **Dual Protection**: Both email and IP limits apply simultaneously
- **Automatic Cleanup**: Expired entries removed every 5 minutes

### Password Security

```mermaid
graph TB
    A[Password Requirements] --> B[Minimum 8 characters]
    A --> C[One uppercase letter]
    A --> D[One lowercase letter]  
    A --> E[One number]
    
    F[Reset Token Security] --> G[1-hour expiration]
    F --> H[Cryptographically secure]
    F --> I[Single-use only]
```

### Session Management

**Session Features:**
- **Duration**: 7 days with automatic renewal
- **Update Age**: 24 hours (session refreshes daily)
- **Security**: Secure HTTP-only cookies
- **IP Tracking**: Optional IP consistency checks

## User Interface

### Sign-In Page Features

- **Email/Password Authentication**
- **Password Visibility Toggle** 
- **"Forgot Password?" Link**
- **Organization Invitation Support**
- **Notification Context Awareness**
- **Responsive Design** with brand integration

### Forgot Password Page Features

- **Email Input with Validation**
- **Success State** with clear instructions
- **Rate Limiting Error Handling**
- **Retry Option** if email not received
- **Back to Sign-In Navigation**

### Reset Password Page Features

- **Token Validation** from URL parameters
- **Strong Password Requirements** with real-time validation
- **Password Confirmation** matching
- **Password Visibility Toggles** for both fields
- **Success State** with auto-redirect
- **Comprehensive Error Handling**

## Email Integration

### Email Service Architecture

```mermaid
graph TB
    A[Email Request] --> B[EmailService]
    B --> C{SMTP Connection}
    C -->|Success| D[Email Sent]
    C -->|Failed| E[Connection Failed]
    
    G[SMTP Config] --> C
```

### Email Templates

**Password Reset Email Features:**
- **Professional HTML Template** with inline CSS
- **Plain Text Fallback** for compatibility
- **Clear Call-to-Action** button
- **Security Warnings** about expiration and unauthorized requests
- **Branded Design** consistent with application
- **1-Hour Expiration Notice**

### Email Configuration

**Environment Variables:**
- **SMTP**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, `SMTP_FROM_EMAIL`

## Organization Integration

### Multi-Tenant Architecture

```mermaid
graph TB
    A[User Registration] --> B[Create User Account]
    B --> C[Create Default Organization]
    C --> D[Assign Owner Role]
    
    E[Organization Invitations] --> F[Send Invite Email]
    F --> G[User Signs In]
    G --> H[Accept Invitation]
    H --> I[Join Organization]
```

**Organization Features:**
- **Automatic Organization Creation** on user registration
- **Role-Based Access Control** (Owner, Admin, Editor, Viewer)
- **Organization Invitations** via email
- **Multi-Organization Support** per user
- **Organization Switching** in UI

## API Integration

### Better Auth Endpoints

**Available Endpoints:**
- `POST /api/auth/sign-in` - User authentication
- `POST /api/auth/sign-up` - User registration  
- `POST /api/auth/sign-out` - Session termination
- `POST /api/auth/forget-password` - Password reset request
- `POST /api/auth/reset-password` - Password reset execution
- `GET /api/auth/session` - Current session info

### Client SDK Integration

**Available Methods:**
- `signIn.email({ email, password })` - Email/password sign-in
- `signUp.email({ email, password, name })` - User registration
- `forgetPassword({ email, redirectTo })` - Password reset request
- `resetPassword({ newPassword, token })` - Password reset
- `signOut()` - Session termination
- `useSession()` - React hook for session state

## Database Schema

### Authentication Tables

**Core Tables:**
- **user**: User accounts with email, hashed passwords, roles
- **session**: Active user sessions with tokens and metadata
- **account**: OAuth and email/password account linkings
- **verification**: Password reset tokens and email verifications

**Organization Tables:**
- **organization**: Organization entities with metadata
- **member**: User-organization relationships with roles
- **invitation**: Pending organization invitations

## Security Best Practices

### Implementation Security

✅ **Password Storage**: Secure bcrypt hashing with salt
✅ **Token Security**: Cryptographically secure random tokens
✅ **Session Security**: HTTP-only, secure cookies
✅ **Rate Limiting**: Multi-layer abuse prevention
✅ **Email Security**: Professional templates with warnings
✅ **Input Validation**: Client and server-side validation
✅ **Error Handling**: Secure error messages without information leakage

### Production Considerations

**Required Security Setup:**
1. **Change Default Secrets**: Generate strong `BETTER_AUTH_SECRET`
2. **Configure Email**: Set up SMTP for production email delivery
3. **Environment Variables**: Secure all email credentials
4. **HTTPS Only**: Ensure all authentication happens over HTTPS
5. **Rate Limiting**: Monitor and adjust rate limits based on usage patterns
6. **Session Monitoring**: Implement session monitoring and suspicious activity detection

## Monitoring and Logging

### Security Events Logged

- **Authentication Attempts**: Success/failure with IP addresses
- **Password Reset Requests**: Email addresses and IP addresses
- **Rate Limiting Events**: Blocked requests with timing
- **Session Events**: Creation, expiration, and termination
- **Email Delivery**: Success/failure status for password resets

### Metrics to Monitor

- **Authentication Success Rate**
- **Password Reset Request Volume**  
- **Rate Limiting Trigger Frequency**
- **Email Delivery Success Rate**
- **Session Duration Patterns**

## Future Enhancements

### Planned Features

- **Two-Factor Authentication (2FA)** integration
- **OAuth Provider Support** (Google, GitHub, etc.)
- **Advanced Session Security** with device tracking
- **Enhanced Rate Limiting** with Redis backend
- **Audit Logging** for compliance requirements
- **Password Policy Configuration** via environment variables

### Scalability Considerations

- **Redis Rate Limiting**: Move from in-memory to Redis for multi-instance deployments
- **Email Queue**: Implement email queuing for high-volume scenarios  
- **Session Storage**: Consider Redis session storage for better scalability
- **Monitoring Integration**: Add metrics collection and alerting