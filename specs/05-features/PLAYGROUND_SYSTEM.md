# Playground System

## Overview

The Playground System provides an **interactive sandbox environment** for rapid Playwright test development and debugging with **Monaco code editor**, **AI-powered fixes**, **template library**, and **multi-location execution**.

---

## Architecture

```mermaid
graph TB
    subgraph "🎨 Frontend Components"
        EDITOR[Monaco Code Editor<br/>Syntax highlighting]
        FORM[Test Configuration<br/>Browser, location, timeout]
        TEMPLATES[Template Library<br/>Pre-built examples]
        AI[AI Fix Integration<br/>Error analysis]
        LOCATION[Location Selector<br/>Multi-region support]
    end

    subgraph "⚡ Execution"
        EXEC[Playground Executor]
        CONTAINER[Docker Container<br/>Isolated execution]
    end

    subgraph "💾 Storage & Tracking"
        S3[S3 Artifacts<br/>Temporary storage]
        AUDIT[Audit Logs<br/>playground_test_executed]
        CLEANUP[Cleanup Worker<br/>24-hour retention]
    end

    EDITOR --> EXEC
    FORM --> EXEC
    TEMPLATES --> EDITOR
    AI --> EDITOR

    EXEC --> CONTAINER
    CONTAINER --> S3
    EXEC --> AUDIT
    S3 --> CLEANUP

    classDef frontend fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef execution fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef storage fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class EDITOR,FORM,TEMPLATES,AI,LOCATION frontend
    class EXEC,CONTAINER execution
    class S3,AUDIT,CLEANUP storage
```

---

## Key Features

### 1. Monaco Code Editor
- TypeScript/JavaScript syntax highlighting
- Auto-completion for Playwright APIs
- Real-time error detection
- Code formatting support

### 2. Template Library
- Login flows
- Form submissions
- API testing patterns
- Visual regression examples
- Performance testing

### 3. AI-Powered Fixes
- Automatic error analysis
- Intelligent code suggestions
- One-click fix application
- Diff viewer for changes

### 4. Multi-Location Execution
- US East, US West, EU, APAC
- Geographic performance testing
- Latency comparison

---

## Execution Flow

```mermaid
sequenceDiagram
    participant User
    participant Editor as Monaco Editor
    participant API
    participant Executor
    participant Container
    participant S3
    participant Audit

    User->>Editor: Write test code
    User->>API: Click "Run Test"
    API->>Executor: Execute in playground mode
    Executor->>Container: Spawn isolated container
    Container->>Container: Run Playwright test
    Container->>S3: Upload artifacts (24h TTL)
    Container-->>Executor: Results
    Executor->>Audit: Log playground_test_executed
    Executor-->>API: Execution results
    API-->>Editor: Display results + artifacts
    Editor-->>User: Live feedback
```

---

## Data Lifecycle

### Cleanup Strategy
- **Retention:** 24 hours
- **Schedule:** Every 12 hours
- **Target:** S3 playground artifacts
- **Tracking:** Via audit logs

```mermaid
graph LR
    A[Playground Execution] -->|Creates| B[S3 Artifacts]
    B -->|After 24h| C[Cleanup Worker]
    C -->|Deletes| D[Old Artifacts]

    classDef active fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef cleanup fill:#ffebee,stroke:#d32f2f,stroke-width:2px

    class A,B active
    class C,D cleanup
```

---

## Summary

✅ **Interactive Development** - Real-time code editing and execution
✅ **Template Library** - Jumpstart with pre-built patterns
✅ **AI Integration** - Intelligent error fixing
✅ **Multi-Location** - Test from multiple regions
✅ **Automatic Cleanup** - 24-hour artifact retention
