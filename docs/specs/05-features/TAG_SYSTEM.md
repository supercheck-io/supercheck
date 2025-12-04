# Tag Management System

## Overview

The Tag Management System provides **organizational capabilities** for tests and monitors through customizable, color-coded tags. Tags enable efficient categorization, filtering, and bulk operations across testing and monitoring resources.

**🏷️ Project-Scoped Tags:** All tags are scoped to projects with RBAC enforcement for secure multi-tenant operations.

**🎨 User-Defined Colors:** Tag colors are completely customizable - users can assign colors based on their own organizational preferences and workflows.

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
        API1[/api/tags - CRUD Operations]
        API2[/api/tags/id - Individual Tag]
        API3[/api/tests/id/tags - Test Associations]
        API4[/api/monitors/id/tags - Monitor Associations]
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
    TAG --> NAME[Name: 3-20 chars alphanumeric + underscore + hyphen]
    TAG --> COLOR[Color Code: Hex format]
    TAG --> ORG[Organization ID]
    TAG --> PROJ[Project ID]
    TAG --> USER[Created By User ID]
    TAG --> CREATED[Created At]
    TAG --> UPDATED[Updated At]

    classDef property fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    class ID,NAME,COLOR,ORG,PROJ,USER,CREATED,UPDATED property
```

### Available Color Palette

8 default colors are available, but **users can use any color for any purpose**:

| Color | Hex Code |
|-------|----------|
| Blue | `#3b82f6` |
| Green | `#10b981` |
| Red | `#ef4444` |
| Yellow | `#f59e0b` |
| Purple | `#8b5cf6` |
| Pink | `#ec4899` |
| Indigo | `#6366f1` |
| Orange | `#f97316` |

> 💡 **Flexible Usage:** Tag colors are entirely up to the user. Assign colors based on your team's workflow, priorities, test types, or any other organizational system that works for you.

---

## Tag Operations

### Create Tag Flow

```mermaid
sequenceDiagram
    participant User
    participant API as API Tags Endpoint
    participant Validator
    participant DB as Database

    User->>API: POST /api/tags with name and color
    API->>Validator: Validate tag name format

    alt Invalid Name Format
        Validator-->>API: Error: Invalid format
        API-->>User: 400 Bad Request
    else Valid Name
        Validator-->>API: Valid
        API->>DB: Check tag limit (max 50 per project)

        alt Limit Exceeded
            DB-->>API: Limit reached
            API-->>User: 400 Tag limit exceeded
        else Within Limit
            DB-->>API: OK
            API->>DB: Insert tag record
            DB-->>API: Tag created
            API-->>User: 201 Created with tag data
        end
    end
```

### Tag Association Flow

```mermaid
sequenceDiagram
    participant User
    participant API as API Tests Endpoint
    participant Auth as Authorization
    participant DB as Database

    User->>API: POST /api/tests/testId/tags with tagId
    API->>Auth: Check permission for test edit

    alt Unauthorized
        Auth-->>API: Forbidden
        API-->>User: 403 Forbidden
    else Authorized
        Auth-->>API: Authorized
        API->>DB: Verify tag belongs to same project

        alt Tag Not in Project
            DB-->>API: Tag not found
            API-->>User: 404 Not Found
        else Tag Valid
            DB-->>API: Tag exists in project
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
        F1[Filter Tests by Tags - AND/OR logic]
        F2[Filter Monitors by Tags - AND/OR logic]
        F3[Search Tags by Name - Partial match]
        F4[Filter by Color - Group by color]
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

### Filter Query Logic

**AND Logic (Test has ALL specified tags):**
```mermaid
graph LR
    A[Test has Tag A] --> B[Test has Tag B]
    B --> C[Test has Tag C]
    C --> MATCH[Match: Has ALL tags]

    D[Test has Tag A] --> E[Test missing Tag B]
    E --> NOMATCH[No Match: Missing required tag]

    classDef match fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef nomatch fill:#ffebee,stroke:#d32f2f,stroke-width:2px

    class MATCH match
    class NOMATCH nomatch
```

**OR Logic (Test has ANY specified tag):**
```mermaid
graph LR
    A[Test has Tag A] --> MATCH1[Match: Has Tag A]
    B[Test has Tag B] --> MATCH2[Match: Has Tag B]
    C[Test has Tag C] --> MATCH3[Match: Has Tag C]
    D[Test has no specified tags] --> NOMATCH[No Match]

    classDef match fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef nomatch fill:#ffebee,stroke:#d32f2f,stroke-width:2px

    class MATCH1,MATCH2,MATCH3 match
    class NOMATCH nomatch
```

---

## Tag Limits & Validation

### Validation Rules

```mermaid
graph TB
    INPUT[Tag Input] --> V1{Name Length?}
    V1 -->|Less than 3 chars| E1[Error: Too Short]
    V1 -->|More than 20 chars| E2[Error: Too Long]
    V1 -->|3-20 chars| V2{Name Format?}

    V2 -->|Invalid chars| E3[Error: Invalid Format - Use a-z 0-9 underscore hyphen]
    V2 -->|Valid format| V3{Project Limit?}

    V3 -->|50 or more tags| E4[Error: Limit Exceeded]
    V3 -->|Less than 50 tags| V4{Tag Name Exists?}

    V4 -->|Duplicate name| E5[Error: Tag Already Exists]
    V4 -->|Unique name| SUCCESS[Create Tag]

    classDef error fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    classDef success fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class E1,E2,E3,E4,E5 error
    class SUCCESS success
```

### Tag Limits

| Limit Type | Value | Reason |
|------------|-------|--------|
| Max Tags per Project | 50 | Prevent tag sprawl and maintain organization |
| Name Length Min | 3 chars | Ensure meaningful tag names |
| Name Length Max | 20 chars | UI display constraints |
| Name Format | a-z, 0-9, _, - | Alphanumeric, underscore, hyphen only |
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
    UI->>API: POST /api/tests/bulk-tag with testIds and tagIds

    loop For each test
        API->>DB: Check test permissions
        DB-->>API: Authorized
        loop For each tag
            API->>DB: INSERT testTags association
        end
    end

    API-->>UI: Success - 30 associations created
    UI-->>User: Tags applied successfully
```

### Bulk Tag Removal

```mermaid
sequenceDiagram
    participant User
    participant API
    participant DB

    User->>API: DELETE /api/tags/tagId
    API->>DB: Check tag ownership and permissions
    DB-->>API: Authorized

    API->>DB: DELETE from testTags WHERE tagId
    API->>DB: DELETE from monitorTags WHERE tagId
    API->>DB: DELETE from tags WHERE id

    DB-->>API: Cascading deletion complete
    API-->>User: Tag removed - X associations deleted
```

---

## Tag Usage Analytics

### Tag Statistics

```mermaid
graph TB
    TAG[Selected Tag] --> STATS[Tag Statistics]

    STATS --> COUNT1[Tests Tagged: X]
    STATS --> COUNT2[Monitors Tagged: Y]
    STATS --> USAGE[Total Usage: X + Y]
    STATS --> TREND[Usage Trend Over Time]

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
| View Tags | `test:view` or `monitor:view` | Read-only access to tags |
| Create Tag | `test:edit` | Project editor role or higher |
| Update Tag | `test:edit` | Tag creator or project admin |
| Delete Tag | `test:delete` | Tag creator or project admin |
| Assign Tag to Resource | `test:edit` | Can assign to owned resources |

### Permission Check Flow

```mermaid
sequenceDiagram
    participant User
    participant API
    participant Auth as RBAC Service
    participant DB

    User->>API: Request tag operation
    API->>DB: Fetch tag and projectId
    DB-->>API: Tag data with project
    API->>Auth: Check permission for action and project

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

### Recommended Tagging Strategies

Users can organize tags however they prefer. Here are some common patterns teams use:

**By Environment:**
- `dev`, `staging`, `production`

**By Test Type:**
- `e2e`, `api`, `unit`, `integration`, `smoke`

**By Priority:**
- `critical`, `high`, `medium`, `low`, `p0`, `p1`

**By Team:**
- `frontend`, `backend`, `qa`, `devops`

**By Feature:**
- `checkout`, `auth`, `payments`, `dashboard`

**By Status:**
- `stable`, `flaky`, `deprecated`, `wip`

> 💡 **Your Choice:** The above are just examples. Design a tagging system that fits your team's workflow and organizational needs.

### Tag Naming Conventions

✅ **Good Examples:**
- `e2e-checkout`
- `critical-path`
- `api-v2`
- `frontend-team`
- `smoke-test`

❌ **Bad Examples:**
- `test` (too generic)
- `important!!!` (special characters not allowed)
- `e` (too short - minimum 3 characters)
- `very-long-tag-name-exceeds-twenty-chars` (too long - maximum 20 characters)

---

## Summary

The Tag Management System provides:

✅ **Flexible Organization** - Categorize tests and monitors your way
✅ **User-Defined Colors** - 8 colors available, use them however you prefer
✅ **Project Scoping** - Tags isolated per project for multi-tenancy
✅ **RBAC Integration** - Permission-based tag operations
✅ **Bulk Operations** - Efficient tag assignment and removal across multiple resources
✅ **Smart Filtering** - AND/OR logic for advanced query capabilities
✅ **Usage Analytics** - Track tag adoption and usage patterns
✅ **Validation Rules** - Prevent tag sprawl with 50-tag limit per project
✅ **Name Validation** - Ensure consistent, meaningful tag names
