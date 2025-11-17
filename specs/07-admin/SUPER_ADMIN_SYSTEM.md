# Super Admin System

## Overview

The Super Admin System provides **platform-level management** capabilities for system administrators, including user management, organization oversight, and system health monitoring.

---

## Architecture

```mermaid
graph TB
    subgraph "👑 Super Admin Panel"
        DASHBOARD[System Dashboard]
        USERS[User Management]
        ORGS[Organization Management]
        SCHEDULER[Scheduler Control]
        QUEUES[Queue Monitor]
        HEALTH[Health Checks]
    end

    subgraph "🔐 Access Control"
        AUTH[Super Admin Auth<br/>user.role = 'super_admin']
    end

    subgraph "💾 Data Management"
        DB[(PostgreSQL<br/>All system data)]
        REDIS[(Redis<br/>Queue stats)]
    end

    DASHBOARD & USERS & ORGS & SCHEDULER & QUEUES & HEALTH --> AUTH
    AUTH --> DB
    AUTH --> REDIS

    classDef admin fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef auth fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef data fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class DASHBOARD,USERS,ORGS,SCHEDULER,QUEUES,HEALTH admin
    class AUTH auth
    class DB,REDIS data
```

---

## Key Features

### 1. System Statistics

```mermaid
graph TB
    STATS[System Stats] --> U[Total Users]
    STATS --> O[Total Organizations]
    STATS --> P[Total Projects]
    STATS --> J[Total Jobs]
    STATS --> T[Total Tests]
    STATS --> M[Total Monitors]
    STATS --> R[Total Runs]

    classDef stat fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    class U,O,P,J,T,M,R stat
```

### 2. User Management
- Create/update/delete users
- Ban/unban users with reason
- View all user organizations
- Impersonate users for debugging

### 3. Organization Management
- View all organizations
- Organization statistics
- Member management
- Resource allocation

### 4. Scheduler Control
- Initialize schedulers
- View scheduler status
- Manually trigger jobs
- Monitor queue health

### 5. Queue Dashboard
- Real-time queue statistics
- Job counts (waiting, active, completed, failed)
- Worker utilization
- Performance metrics

---

## API Endpoints

| Endpoint | Purpose | Permission |
|----------|---------|------------|
| `/api/admin/stats` | System statistics | super_admin |
| `/api/admin/users` | User CRUD | super_admin |
| `/api/admin/organizations` | Org management | super_admin |
| `/api/admin/scheduler/init` | Init schedulers | super_admin |
| `/api/admin/scheduler/status` | Scheduler status | super_admin |
| `/api/admin/queues` | Queue dashboard | super_admin |
| `/api/admin/check` | Health check | super_admin |

---

## User Ban System

```mermaid
sequenceDiagram
    participant Admin
    participant API as /api/admin/users
    participant DB as Database
    participant User

    Admin->>API: POST /api/admin/users/ban<br/>{userId, reason, expires}
    API->>DB: Update user (banned: true)
    DB-->>API: User updated
    API-->>Admin: Ban successful

    User->>API: Attempt login
    API->>DB: Check banned status
    DB-->>API: User banned
    API-->>User: 403 Account suspended
```

---

## Impersonation System

```mermaid
sequenceDiagram
    participant Admin
    participant System
    participant User as User Session

    Admin->>System: Impersonate user
    System->>System: Store original admin ID
    System->>User: Create user session
    User-->>Admin: Acting as user

    Admin->>System: Stop impersonation
    System->>System: Restore admin session
    System-->>Admin: Back to admin view
```

---

## Summary

✅ **Platform Oversight** - Complete system visibility
✅ **User Management** - Full user lifecycle control
✅ **Organization Management** - Multi-tenant administration
✅ **System Health** - Scheduler and queue monitoring
✅ **Debugging Tools** - Impersonation for troubleshooting

---

**Document Version:** 1.0
**Last Updated:** January 17, 2025
