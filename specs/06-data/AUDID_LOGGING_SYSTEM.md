# Audit Logging System

## Overview

The Audit Logging System provides **comprehensive tracking** of user actions, system events, and security-relevant operations for compliance, debugging, and forensic analysis.

---

## Architecture

```mermaid
graph TB
    subgraph "📝 Event Sources"
        USER[User Actions]
        SYSTEM[System Events]
        SECURITY[Security Events]
        PLAYGROUND[Playground Executions]
    end

    subgraph "📊 Audit Logger"
        LOGGER[Audit Logger Service]
        PINO[Pino JSON Logger]
    end

    subgraph "💾 Storage"
        DB[(auditLogs Table)]
        FILES[Log Files<br/>Structured JSON]
    end

    USER & SYSTEM & SECURITY & PLAYGROUND --> LOGGER
    LOGGER --> PINO
    LOGGER --> DB
    PINO --> FILES

    classDef source fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef logger fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef storage fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class USER,SYSTEM,SECURITY,PLAYGROUND source
    class LOGGER,PINO logger
    class DB,FILES storage
```

---

## Audit Events

### Event Categories

| Category | Examples | Retention |
|----------|----------|-----------|
| **Authentication** | login, logout, password_reset | 90 days |
| **Authorization** | role_change, permission_grant | 90 days |
| **Resource Management** | test_created, monitor_updated, job_deleted | 30 days |
| **Execution** | test_executed, job_triggered, playground_test_executed | 30 days |
| **Configuration** | settings_changed, integration_added | 90 days |
| **Security** | failed_login, unauthorized_access | 365 days |

---

## Audit Log Structure

```mermaid
graph LR
    LOG[Audit Log Entry] --> ID[UUID]
    LOG --> USER[User ID]
    LOG --> ORG[Organization ID]
    LOG --> ACTION[Action Type]
    LOG --> DETAILS[JSON Details<br/>before/after states]
    LOG --> TIMESTAMP[Created At]
    LOG --> IP[IP Address]
    LOG --> AGENT[User Agent]

    classDef field fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    class ID,USER,ORG,ACTION,DETAILS,TIMESTAMP,IP,AGENT field
```

---

## API Endpoint

### GET /api/audit

**Features:**
- Pagination (limit, page)
- Search/filter by action
- Free-text search
- Sort by timestamp (asc/desc)
- Permission check (admin only)

```mermaid
sequenceDiagram
    participant User
    participant API as /api/audit
    participant Auth
    participant DB

    User->>API: GET /api/audit?page=1&limit=50&search=test_created
    API->>Auth: Check admin permission

    alt Admin
        Auth-->>API: Authorized
        API->>DB: Query auditLogs with filters
        DB-->>API: Paginated results
        API-->>User: {logs, total, uniqueActions}
    else Not Admin
        Auth-->>API: Forbidden
        API-->>User: 403 Forbidden
    end
```

---

## Summary

✅ **Comprehensive Tracking** - All user and system actions
✅ **Structured Logging** - JSON format for easy parsing
✅ **RBAC Integration** - Admin-only access
✅ **Forensic Analysis** - Before/after state tracking
✅ **Compliance Ready** - Configurable retention policies

---

**Document Version:** 1.0
**Last Updated:** January 17, 2025
