# Tag Management System

## Overview

The Tag Management System provides **organizational capabilities** for tests and monitors through customizable, color-coded tags. Tags enable efficient categorization, filtering, and bulk operations across testing and monitoring resources.

**🏷️ Project-Scoped Tags:** All tags are scoped to projects with RBAC enforcement for secure multi-tenant operations.

---

## System Architecture

```mermaid
graph TB
    subgraph "🎨 Frontend Layer"
        UI[Tag Management UI]
        FILTER[Tag Filter Components]
        PICKER[Tag Color Picker]
    end

    subgraph "🔐 API Layer"
        API1[/api/tags<br/>CRUD Operations]
        API2[/api/tags/[id]<br/>Individual Tag]
        API3[/api/tests/[id]/tags<br/>Test Associations]
        API4[/api/monitors/[id]/tags<br/>Monitor Associations]
    end

    subgraph "💾 Database Layer"
        TAGS[(tags table)]
        TEST_TAGS[(testTags join table)]
        MONITOR_TAGS[(monitorTags join table)]
    end

    UI --> API1 & API2
    FILTER --> API1
    PICKER --> API1

    API1 & API2 --> TAGS
    API3 --> TEST_TAGS
    API4 --> MONITOR_TAGS

    TAGS --> TEST_TAGS & MONITOR_TAGS

    classDef frontend fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef api fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef data fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class UI,FILTER,PICKER frontend
    class API1,API2,API3,API4 api
    class TAGS,TEST_TAGS,MONITOR_TAGS data
```

---

## Tag Structure

### Tag Properties

```mermaid
graph LR
    TAG[Tag Entity] --> ID[UUID ID]
    TAG --> NAME[Name<br/>3-20 chars<br/>alphanumeric + _ -]
    TAG --> COLOR[Color Code<br/>Hex format]
    TAG --> ORG[Organization ID]
    TAG --> PROJ[Project ID]
    TAG --> USER[Created By User ID]
    TAG --> CREATED[Created At]
    TAG --> UPDATED[Updated At]

    classDef property fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    class ID,NAME,COLOR,ORG,PROJ,USER,CREATED,UPDATED property
```

### Default Color Palette

| Color | Hex Code | Use Case |
|-------|----------|----------|
| Blue | `#3b82f6` | General purpose |
| Green | `#10b981` | Success/passing tests |
| Red | `#ef4444` | Critical/failing tests |
| Yellow | `#f59e0b` | Warning/staging |
| Purple | `#8b5cf6` | Integration tests |
| Pink | `#ec4899` | UI/E2E tests |
| Indigo | `#6366f1` | API tests |
| Orange | `#f97316` | Performance tests |

---

## Tag Operations

### Create Tag Flow

```mermaid
sequenceDiagram
    participant User
    participant API as /api/tags
    participant Validator
    participant DB as Database

    User->>API: POST /api/tags<br/>{name, color}
    API->>Validator: Validate tag name

    alt Invalid Name
        Validator-->>API: Error: Invalid format
        API-->>User: 400 Bad Request
    else Valid Name
        Validator-->>API: Valid
        API->>DB: Check tag limit (50/project)

        alt Limit Exceeded
            DB-->>API: Limit reached
            API-->>User: 400 Tag limit exceeded
        else Within Limit
            DB-->>API: OK
            API->>DB: Insert tag
            DB-->>API: Tag created
            API-->>User: 201 Created + tag data
        end
    end
```

### Tag Association Flow

```mermaid
sequenceDiagram
    participant User
    participant API as /api/tests/[id]/tags
    participant Auth as Authorization
    participant DB as Database

    User->>API: POST /api/tests/[testId]/tags<br/>{tagId}
    API->>Auth: hasPermission("test", "edit", projectId)

    alt Unauthorized
        Auth-->>API: Forbidden
        API-->>User: 403 Forbidden
    else Authorized
        Auth-->>API: Authorized
        API->>DB: Check tag belongs to project

        alt Tag Not in Project
            DB-->>API: Tag not found
            API-->>User: 404 Not Found
        else Tag Valid
            DB-->>API: Tag exists
            API->>DB: Insert testTags association
            DB-->>API: Association created
            API-->>User: 200 OK
        end
    end
```

---

## Tag Filtering & Search

### Filter Architecture

```mermaid
graph TB
    subgraph "Filter Operations"
        F1[Filter Tests by Tags<br/>AND/OR logic]
        F2[Filter Monitors by Tags<br/>AND/OR logic]
        F3[Search Tags by Name<br/>Partial match]
        F4[Filter by Color<br/>Group by color]
    end

    subgraph "Query Optimization"
        Q1[Index on tagId + testId]
        Q2[Index on tagId + monitorId]
        Q3[Index on projectId]
        Q4[Index on name]
    end

    F1 --> Q1
    F2 --> Q2
    F3 --> Q4
    F4 --> Q3

    classDef filter fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef query fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class F1,F2,F3,F4 filter
    class Q1,Q2,Q3,Q4 query
```

### Filter Query Examples

**AND Logic (Test has ALL tags):**
```mermaid
graph LR
    A[Test 1] -->|has| T1[Tag: E2E]
    A -->|has| T2[Tag: Critical]
    A -->|has| T3[Tag: Production]

    B[Filter: E2E AND Critical] -->|matches| A
    C[Filter: E2E AND Staging] -->|no match| A

    classDef test fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef tag fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class A test
    class T1,T2,T3 tag
```

**OR Logic (Test has ANY tag):**
```mermaid
graph LR
    A[Test 1] -->|has| T1[Tag: E2E]
    B[Test 2] -->|has| T2[Tag: API]
    C[Test 3] -->|has| T3[Tag: Unit]

    D[Filter: E2E OR API] -->|matches| A
    D -->|matches| B
    D -->|no match| C

    classDef test fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef tag fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class A,B,C test
    class T1,T2,T3 tag
```

---

## Tag Limits & Validation

### Validation Rules

```mermaid
graph TB
    INPUT[Tag Input] --> V1{Name Length?}
    V1 -->|< 3 chars| E1[Error: Too Short]
    V1 -->|> 20 chars| E2[Error: Too Long]
    V1 -->|3-20 chars| V2{Name Format?}

    V2 -->|Invalid chars| E3[Error: Invalid Format<br/>Use a-z, 0-9, _, -]
    V2 -->|Valid format| V3{Project Limit?}

    V3 -->|>= 50 tags| E4[Error: Limit Exceeded]
    V3 -->|< 50 tags| V4{Tag Exists?}

    V4 -->|Duplicate name| E5[Error: Tag Exists]
    V4 -->|Unique name| SUCCESS[Create Tag]

    classDef error fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef success fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class E1,E2,E3,E4,E5 error
    class SUCCESS success
```

### Tag Limits

| Limit Type | Value | Reason |
|------------|-------|--------|
| Max Tags per Project | 50 | Prevent tag sprawl |
| Name Length Min | 3 chars | Meaningful names |
| Name Length Max | 20 chars | UI display constraints |
| Color Format | Hex (#rrggbb) | Standard color representation |

---

## Bulk Operations

### Bulk Tag Assignment

```mermaid
sequenceDiagram
    participant User
    participant UI
    participant API
    participant DB

    User->>UI: Select multiple tests (10)
    User->>UI: Select tags to apply (3)
    UI->>API: POST /api/tests/bulk-tag<br/>{testIds: [10], tagIds: [3]}

    loop For each test
        API->>DB: Check test permissions
        DB-->>API: Authorized
        loop For each tag
            API->>DB: INSERT testTags
        end
    end

    API-->>UI: Success (30 associations created)
    UI-->>User: Tags applied successfully
```

### Bulk Tag Removal

```mermaid
sequenceDiagram
    participant User
    participant API
    participant DB

    User->>API: DELETE /api/tags/[tagId]
    API->>DB: Check tag ownership
    DB-->>API: Authorized

    API->>DB: DELETE from testTags WHERE tagId
    API->>DB: DELETE from monitorTags WHERE tagId
    API->>DB: DELETE from tags WHERE id

    DB-->>API: Cascading deletion complete
    API-->>User: Tag removed + X associations deleted
```

---

## Tag Usage Analytics

### Tag Statistics

```mermaid
graph TB
    TAG[Tag: E2E] --> STATS[Tag Statistics]

    STATS --> COUNT1[Tests Tagged: 25]
    STATS --> COUNT2[Monitors Tagged: 10]
    STATS --> USAGE[Total Usage: 35]
    STATS --> TREND[Usage Trend: ↑ 15%]

    classDef tag fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef stat fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class TAG tag
    class STATS,COUNT1,COUNT2,USAGE,TREND stat
```

---

## RBAC Integration

### Permission Matrix

| Action | Required Permission | Notes |
|--------|-------------------|-------|
| View Tags | `test:view` or `monitor:view` | Read-only access |
| Create Tag | `test:edit` | Project editor role |
| Update Tag | `test:edit` | Tag creator or project admin |
| Delete Tag | `test:delete` | Tag creator or project admin |
| Assign Tag | `test:edit` | Can assign to owned resources |

### Permission Check Flow

```mermaid
sequenceDiagram
    participant User
    participant API
    participant Auth as RBAC Service
    participant DB

    User->>API: Request tag operation
    API->>DB: Fetch tag + projectId
    DB-->>API: Tag data
    API->>Auth: hasPermission("test", action, projectId)

    alt Has Permission
        Auth-->>API: Authorized
        API->>DB: Execute operation
        DB-->>API: Success
        API-->>User: 200 OK
    else No Permission
        Auth-->>API: Unauthorized
        API-->>User: 403 Forbidden
    end
```

---

## Best Practices

### Tagging Strategy

```mermaid
graph TB
    subgraph "Recommended Tag Categories"
        C1[Environment<br/>dev, staging, prod]
        C2[Type<br/>e2e, api, unit, integration]
        C3[Priority<br/>critical, high, medium, low]
        C4[Team<br/>frontend, backend, qa]
        C5[Status<br/>stable, flaky, deprecated]
    end

    TEST[Test Suite] --> C1 & C2 & C3 & C4 & C5

    classDef category fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    class C1,C2,C3,C4,C5 category
```

### Tag Naming Conventions

✅ **Good Examples:**
- `e2e-checkout`
- `critical-path`
- `api-v2`
- `frontend-team`

❌ **Bad Examples:**
- `test` (too generic)
- `important!!!` (special chars)
- `e` (too short)
- `very-long-tag-name-that-exceeds-limit` (too long)

---

## Summary

The Tag Management System provides:

✅ **Flexible Organization** - Categorize tests and monitors
✅ **Color Coding** - Visual identification with 8 default colors
✅ **Project Scoping** - Isolated tags per project
✅ **RBAC Integration** - Permission-based tag operations
✅ **Bulk Operations** - Efficient tag assignment/removal
✅ **Smart Filtering** - AND/OR logic for advanced queries
✅ **Usage Analytics** - Track tag adoption and trends
✅ **Validation Rules** - Prevent tag sprawl and naming conflicts

---

**Document Version:** 1.0
**Last Updated:** January 17, 2025
**Status:** Production Ready
