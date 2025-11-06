# Supercheck Platform Architecture

## 🏗️ **System Architecture Overview**

Supercheck is built with a modern, distributed architecture designed for scalability, reliability, and performance. The system combines multiple specialized services to deliver comprehensive testing, monitoring, and AI-powered test fixing capabilities.

```mermaid
graph TB
    subgraph "🌐 External Layer"
        U1[👥 Users<br/>Web Browsers]
        U2[🔗 External APIs<br/>CI/CD Systems]
        U3[📧 Email Services<br/>SMTP Providers]
        U4[💬 Chat Integrations<br/>Slack, Discord, Teams]
    end

    subgraph "🔒 Security & Load Balancing"
        T1[⚡ Traefik Proxy<br/>• HTTPS Termination<br/>• Let's Encrypt SSL<br/>• Load Balancing<br/>• Service Discovery]
    end

    subgraph "🎨 Frontend Layer"
        F1[🖥️ Next.js Application<br/>• React UI Components<br/>• Server-Side Rendering<br/>• API Routes<br/>• Authentication UI]
        F2[📡 Real-time Updates<br/>• Server-Sent Events<br/>• WebSocket Fallback<br/>• Live Status Streaming]
    end

    subgraph "⚙️ Backend Services"
        B1[📋 API Gateway<br/>• REST Endpoints<br/>• GraphQL Support<br/>• Rate Limiting<br/>• Input Validation]
        B2[🔐 Authentication Service<br/>• Better Auth Integration<br/>• JWT Tokens<br/>• Session Management<br/>• RBAC System]
        B3[⏱️ Job Scheduler<br/>• Cron-based Scheduling<br/>• Job Queue Management<br/>• Capacity Control<br/>• Priority Handling]
        B4[📢 Status Page Service<br/>• Public Status Pages<br/>• Incident Management<br/>• Subscriber Notifications<br/>• Subdomain Routing]
    end

    subgraph "🔄 Message Queue System"
        Q1[📨 Redis Cluster<br/>• Job Queues<br/>• Pub/Sub Messaging<br/>• Session Storage<br/>• Cache Layer]
        Q2[🚀 BullMQ<br/>• Distributed Job Processing<br/>• Retry Logic<br/>• Job Prioritization<br/>• Dead Letter Queue]
    end

    subgraph "⚡ Worker Services (Scalable)"
        W1[⚙️ Test Execution Workers<br/>• Playwright Integration<br/>• Browser Automation<br/>• Parallel Processing<br/>• Resource Management]
        W2[👀 Monitor Workers<br/>• HTTP/HTTPS Checks<br/>• SSL Certificate Monitoring<br/>• Ping Tests<br/>• Port Scanning]
        W3[📢 Notification Workers<br/>• Multi-channel Alerts<br/>• Template Processing<br/>• Delivery Tracking<br/>• Retry Logic]
        W4[🧹 Cleanup Workers<br/>• File System Cleanup<br/>• S3 Object Management<br/>• Database Maintenance<br/>• Resource Optimization]
        W5[📊 Status Page Workers<br/>• Incident Processing<br/>• Subscription Management<br/>• Email Notifications<br/>• Status Calculations]
    end

    subgraph "💾 Data Layer"
        D1[🗄️ PostgreSQL<br/>• Primary Database<br/>• ACID Transactions<br/>• Complex Queries<br/>• Data Integrity<br/>• Status Page Tables]
        D2[📦 MinIO/S3 Storage<br/>• Test Artifacts<br/>• HTML Reports<br/>• Screenshots/Videos<br/>• Trace Files<br/>• Status Page Assets]
        D3[🔍 Redis Cache<br/>• Query Results<br/>• Session Data<br/>• Temporary Storage<br/>• Performance Boost]
    end

    subgraph "🤖 AI Services"
        AI1[🧠 AI Fix Service<br/>• OpenAI GPT-4o-mini<br/>• Error Analysis<br/>• Code Generation<br/>• Intelligent Fixes]
        AI2[🔍 Error Classifier<br/>• Pattern Recognition<br/>• Root Cause Analysis<br/>• Fix Recommendations]
        AI3[🛡️ Security Validator<br/>• Code Safety Checks<br/>• Input Sanitization<br/>• Vulnerability Scan]
    end

    subgraph "📊 Monitoring & Observability"
        M1[📈 System Metrics<br/>• Performance Monitoring<br/>• Resource Usage<br/>• Error Tracking<br/>• Alerting]
        M2[📝 Audit Logs<br/>• User Actions<br/>• System Events<br/>• Security Monitoring<br/>• Compliance]
        M3[🚨 Health Checks<br/>• Service Status<br/>• Database Health<br/>• Queue Status<br/>• Auto-recovery]
    end

    %% External Connections
    U1 -.->|HTTPS| T1
    U2 -.->|API Calls| T1

    %% Traffic Flow
    T1 --> F1
    F1 <--> B1
    F1 <--> F2

    %% Backend Communication
    B1 <--> B2
    B1 <--> B3
    B1 <--> B4
    B2 <--> D1
    B3 <--> Q1
    B4 <--> D1

    %% Queue Processing
    Q1 <--> Q2
    Q2 --> W1
    Q2 --> W2
    Q2 --> W3
    Q2 --> W4
    Q2 --> W5

    %% Data Access
    W1 <--> D1
    W1 <--> D2
    W2 <--> D1
    W3 --> U3
    W3 --> U4
    W4 <--> D2
    W5 <--> D1
    W5 --> U3

    %% Caching
    B1 <--> D3
    F1 <--> D3

    %% AI Services
    B1 <--> AI1
    AI1 <--> AI2
    AI1 <--> AI3
    AI1 <--> D2

    %% Monitoring
    W1 -.-> M1
    W2 -.-> M1
    W3 -.-> M1
    W4 -.-> M1
    B1 -.-> M2
    B2 -.-> M2
    D1 -.-> M3
    Q1 -.-> M3
    AI1 -.-> M1

    %% Styling
    classDef frontend fill:#e3f2fd,stroke:#1976d2,stroke-width:2px,color:#000
    classDef backend fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px,color:#000
    classDef data fill:#e8f5e8,stroke:#388e3c,stroke-width:2px,color:#000
    classDef worker fill:#fff3e0,stroke:#f57c00,stroke-width:2px,color:#000
    classDef external fill:#ffebee,stroke:#d32f2f,stroke-width:2px,color:#000
    classDef security fill:#e0f2f1,stroke:#00796b,stroke-width:2px,color:#000
    classDef ai fill:#f3e5f5,stroke:#9c27b0,stroke-width:2px,color:#000
    classDef monitoring fill:#fce4ec,stroke:#c2185b,stroke-width:2px,color:#000

    class F1,F2 frontend
    class B1,B2,B3,B4 backend
    class D1,D2,D3 data
    class W1,W2,W3,W4,W5 worker
    class U1,U2,U3,U4 external
    class T1,Q1,Q2 security
    class AI1,AI2,AI3 ai
    class M1,M2,M3 monitoring
```

## 🔄 **Data Flow Architecture**

```mermaid
flowchart LR
    subgraph "📥 Input Layer"
        I1[👤 User Actions<br/>• Create Tests<br/>• Run Jobs<br/>• Configure Monitors]
        I2[🤖 API Requests<br/>• CI/CD Triggers<br/>• Webhook Calls<br/>• Scheduled Jobs]
        I3[⏰ Scheduled Events<br/>• Cron Jobs<br/>• Monitor Checks<br/>• Cleanup Tasks]
        I4[📢 Status Page Events<br/>• Public Visitors<br/>• Subscriptions<br/>• Incident Updates]
    end

    subgraph "⚙️ Processing Layer"
        P1[🔍 Validation<br/>• Input Sanitization<br/>• Permission Checks<br/>• Rate Limiting]
        P2[📋 Job Creation<br/>• Queue Assignment<br/>• Priority Setting<br/>• Resource Allocation]
        P3[⚡ Execution<br/>• Parallel Processing<br/>• Real-time Updates<br/>• Error Handling]
        P4[📊 Result Processing<br/>• Report Generation<br/>• Notification Dispatch<br/>• Data Storage]
        P5[📢 Status Page Processing<br/>• Subdomain Routing<br/>• Incident Management<br/>• Subscriber Notifications]
    end

    subgraph "📤 Output Layer"
        O1[📱 User Interface<br/>• Real-time Updates<br/>• Report Viewing<br/>• Status Dashboard]
        O2[📧 Notifications<br/>• Email Alerts<br/>• Slack Messages<br/>• Webhook Calls]
        O3[💾 Data Storage<br/>• Test Results<br/>• Monitoring Data<br/>• Audit Logs]
        O4[📈 Analytics<br/>• Performance Metrics<br/>• Usage Statistics<br/>• Health Monitoring]
        O5[📢 Public Status Pages<br/>• Service Status<br/>• Incident Reports<br/>• Subscription Management]
    end

    %% Flow Connections
    I1 --> P1
    I2 --> P1
    I3 --> P1
    I4 --> P5

    P1 --> P2
    P2 --> P3
    P3 --> P4
    P5 --> P4

    P4 --> O1
    P4 --> O2
    P4 --> O3
    P4 --> O4
    P5 --> O5

    %% Feedback Loops
    O4 -.->|Optimization| P2
    O3 -.->|Historical Data| P1
    O5 -.->|Public Metrics| P5

    %% Styling
    classDef input fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef process fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef output fill:#e8f5e8,stroke:#388e3c,stroke-width:2px

    class I1,I2,I3,I4 input
    class P1,P2,P3,P4,P5 process
    class O1,O2,O3,O4,O5 output
```

## 🎯 **Core Service Interactions**

```mermaid
sequenceDiagram
    participant U as 👤 User
    participant F as 🖥️ Frontend
    participant A as 🔐 Auth Service
    participant Q as 📨 Queue System
    participant W as ⚡ Worker
    participant D as 💾 Database
    participant S as 📦 Storage
    participant N as 📢 Notifications

    Note over U,N: Complete Test Execution Flow

    U->>F: Create & Run Test
    F->>A: Validate Session
    A-->>F: User Authorized

    F->>Q: Add Test Job
    Q-->>F: Job Queued (ID: 123)
    F-->>U: Test Started (Real-time Updates Begin)

    Q->>W: Process Test Job
    activate W
    W->>D: Update Status (Running)
    W->>F: Publish Status Event
    F-->>U: Status: Running ⚡

    W->>W: Execute Playwright Test
    W->>S: Upload Test Artifacts
    W->>D: Save Test Results
    W->>F: Publish Completion Event
    deactivate W

    F-->>U: Status: Complete ✅

    alt Test Failed
        W->>N: Send Failure Notification
        N-->>U: Email/Slack Alert 📧
    end

    U->>F: View Test Report
    F->>S: Fetch Report Files
    S-->>F: Report Content
    F-->>U: Interactive Report 📊
```

## 🏢 **Multi-Tenant Architecture**

```mermaid
graph TB
    subgraph "🌍 Global Layer"
        G1[🔐 Authentication System<br/>• Better Auth<br/>• JWT Tokens<br/>• Session Management]
        G2[👑 Super Admin Panel<br/>• System Overview<br/>• User Management<br/>• Global Settings]
    end

    subgraph "🏢 Organization A"
        OA1[👥 Organization Members<br/>• Owner: alice at company-a.com<br/>• Editor: bob at company-a.com<br/>• Viewer: carol at company-a.com]

        subgraph "📁 Project A1: Frontend"
            PA1A[⚙️ Tests: 25]
            PA1B[⚙️ Jobs: 8]
            PA1C[👀 Monitors: 12]
            PA1D[🔑 Variables: 15]
            PA1E[📢 Status Pages: 3]
        end

        subgraph "📁 Project A2: API"
            PA2A[⚙️ Tests: 18]
            PA2B[⚙️ Jobs: 5]
            PA2C[👀 Monitors: 8]
            PA2D[🔑 Variables: 10]
            PA2E[📢 Status Pages: 2]
        end
    end

    subgraph "🏢 Organization B"
        OB1[👥 Organization Members<br/>• Owner: david at company-b.com<br/>• Editor: eve at company-b.com]

        subgraph "📁 Project B1: E-commerce"
            PB1A[⚙️ Tests: 35]
            PB1B[⚙️ Jobs: 12]
            PB1C[👀 Monitors: 20]
            PB1D[🔑 Variables: 22]
            PB1E[📢 Status Pages: 4]
        end
    end

    subgraph "💾 Shared Infrastructure"
        S1[🗄️ PostgreSQL<br/>• Row-level Security<br/>• Organization Isolation<br/>• Project Scoping]
        S2[📦 S3/MinIO Storage<br/>• Prefix-based Isolation<br/>• Access Control<br/>• Resource Quotas]
        S3[📨 Redis Queues<br/>• Tenant-aware Processing<br/>• Resource Limits<br/>• Priority Queuing]
    end

    %% Connections
    G1 -.-> OA1
    G1 -.-> OB1
    G2 -.-> G1

    OA1 --> PA1A & PA1B & PA1C & PA1D & PA1E
    OA1 --> PA2A & PA2B & PA2C & PA2D & PA2E
    OB1 --> PB1A & PB1B & PB1C & PB1D & PB1E

    PA1A & PA1B & PA1C & PA1D & PA1E --> S1
    PA2A & PA2B & PA2C & PA2D & PA2E --> S1
    PB1A & PB1B & PB1C & PB1D & PB1E --> S1

    PA1A & PA1B & PA1C & PA1E --> S2
    PA2A & PA2B & PA2C & PA2E --> S2
    PB1A & PB1B & PB1C & PB1E --> S2

    PA1B & PA2B & PB1B & PA1E & PA2E & PB1E --> S3

    %% Styling
    classDef global fill:#ffebee,stroke:#d32f2f,stroke-width:2px,color:#000
    classDef orgA fill:#e3f2fd,stroke:#1976d2,stroke-width:2px,color:#000
    classDef orgB fill:#e8f5e8,stroke:#388e3c,stroke-width:2px,color:#000
    classDef shared fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px,color:#000

    class G1,G2 global
    class OA1,PA1A,PA1B,PA1C,PA1D,PA1E,PA2A,PA2B,PA2C,PA2D,PA2E orgA
    class OB1,PB1A,PB1B,PB1C,PB1D,PB1E orgB
    class S1,S2,S3 shared
```

## 📢 **Status Page Architecture**

```mermaid
graph TB
    subgraph "🌐 Public Layer"
        PU1[👥 Public Visitors<br/>• Status Page Viewers<br/>• Subscribers<br/>• Search Engines]
        PU2[🔗 Subdomain Access<br/>• UUID-based Routing<br/>• Wildcard DNS<br/>• SSL Certificates]
    end

    subgraph "📢 Status Page Services"
        SP1[📋 Status Page Manager<br/>• Page Configuration<br/>• Component Management<br/>• Branding Settings]
        SP2[⚠️ Incident Manager<br/>• Incident Creation<br/>• Status Updates<br/>• Timeline Tracking]
        SP3[📧 Subscriber Manager<br/>• Email Subscriptions<br/>• Verification Workflow<br/>• Notification Delivery]
        SP4[📊 Metrics Calculator<br/>• Uptime Tracking<br/>• Status Aggregation<br/>• Historical Data]
    end

    subgraph "🔄 Subdomain Routing"
        SR1[🔍 Middleware Router<br/>• Subdomain Detection<br/>• Status Page Lookup<br/>• URL Rewriting]
        SR2[📋 Published Pages<br/>• Public Access Control<br/>• Page Status Validation<br/>• 404 Handling]
    end

    subgraph "💾 Status Page Data"
        SD1[🗄️ Status Pages<br/>• Page Configuration<br/>• Custom Branding<br/>• Subdomain Mapping]
        SD2[🧩 Components<br/>• Service Status<br/>• Monitor Linking<br/>• Group Organization]
        SD3[⚠️ Incidents<br/>• Incident Records<br/>• Status Updates<br/>• Impact Assessment]
        SD4[📧 Subscribers<br/>• Email Subscriptions<br/>• Verification Tokens<br/>• Preferences]
    end

    subgraph "📤 Notification Delivery"
        ND1[📧 Email Service<br/>• SMTP Integration<br/>• Template Processing<br/>• Delivery Tracking]
        ND2[🔔 Alert Processing<br/>• Incident Notifications<br/>• Status Changes<br/>• Scheduled Updates]
    end

    %% Public Access Flow
    PU1 --> PU2
    PU2 --> SR1
    SR1 --> SR2
    SR2 --> SP1

    %% Status Page Management
    SP1 --> SD1
    SP1 --> SD2
    SP2 --> SD3
    SP3 --> SD4
    SP4 --> SD2

    %% Incident Workflow
    SP2 --> ND2
    ND2 --> ND1

    %% Subscriber Integration
    SP3 --> ND2
    ND1 --> PU1

    %% Metrics Integration
    SP4 --> SP1

    %% Styling
    classDef public fill:#e3f2fd,stroke:#1976d2,stroke-width:2px,color:#000
    classDef service fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px,color:#000
    classDef routing fill:#e8f5e8,stroke:#388e3c,stroke-width:2px,color:#000
    classDef data fill:#fff3e0,stroke:#f57c00,stroke-width:2px,color:#000
    classDef notification fill:#fce4ec,stroke:#c2185b,stroke-width:2px,color:#000

    class PU1,PU2 public
    class SP1,SP2,SP3,SP4 service
    class SR1,SR2 routing
    class SD1,SD2,SD3,SD4 data
    class ND1,ND2 notification
```

## 🔧 **Technology Stack**

### **Frontend Stack**

```mermaid
graph LR
    subgraph "🎨 Frontend Technologies"
        F1[⚛️ React 19.1.1<br/>• Server Components<br/>• Suspense<br/>• Concurrent Features]
        F2[🏗️ Next.js 15.4.6<br/>• App Router<br/>• Turbopack<br/>• Server Actions<br/>• Middleware]
        F3[🎨 TailwindCSS 4<br/>• Utility-first<br/>• Custom Design System<br/>• Dark Mode Support]
        F4[🧩 Shadcn/UI<br/>• Component Library<br/>• Accessible Components<br/>• Consistent Design]
        F5[📋 React Hook Form<br/>• Form Validation<br/>• Performance Optimized<br/>• Zod Integration]
    end

    F1 --> F2
    F2 --> F3
    F3 --> F4
    F2 --> F5

    classDef tech fill:#e3f2fd,stroke:#1976d2,stroke-width:2px,color:#000
    class F1,F2,F3,F4,F5 tech
```

### **Backend Stack**

```mermaid
graph LR
    subgraph "⚙️ Backend Technologies"
        B1[🟢 Node.js 20+<br/>• ES Modules<br/>• TypeScript 5.7.3<br/>• Performance Optimized]
        B2[🏗️ NestJS 11.0.1<br/>• Modular Architecture<br/>• Dependency Injection<br/>• Decorators]
        B3[🗄️ Drizzle ORM 0.43.1<br/>• Type-safe Queries<br/>• Schema Migrations<br/>• Performance Focus]
        B4[🔐 Better Auth 1.2.8<br/>• Session Management<br/>• RBAC System<br/>• Multi-provider Support]
        B5[📨 BullMQ 5.52.2<br/>• Job Processing<br/>• Queue Management<br/>• Redis Integration]
        B6[🤖 AI SDK 5.0.42<br/>• OpenAI Integration<br/>• Streaming Support<br/>• Type Safety]
        B7[📢 Status Page Engine<br/>• Subdomain Routing<br/>• Incident Management<br/>• Subscription System]
    end

    B1 --> B2
    B1 --> B3
    B2 --> B4
    B2 --> B5
    B2 --> B6
    B2 --> B7

    classDef tech fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px,color:#000
    class B1,B2,B3,B4,B5,B6,B7 tech
```

### **Status Page Stack**

```mermaid
graph LR
    subgraph "📢 Status Page Technologies"
        S1[🌐 Subdomain Router<br/>• UUID-based Routing<br/>• Wildcard DNS<br/>• SSL Management]
        S2[📧 Email Service<br/>• SMTP Integration<br/>• Template Engine<br/>• Delivery Tracking]
        S3[📊 Metrics Engine<br/>• Uptime Calculation<br/>• Status Aggregation<br/>• Historical Tracking]
        S4[🔍 Public API<br/>• Status Endpoints<br/>• Incident Timeline<br/>• Subscription Management]
    end

    S1 --> S2
    S2 --> S3
    S3 --> S4

    classDef tech fill:#e8f5e8,stroke:#388e3c,stroke-width:2px,color:#000
    class S1,S2,S3,S4 tech
```

### **Testing & Automation Stack**

```mermaid
graph LR
    subgraph "⚙️ Testing Technologies"
        T1[🎭 Playwright 1.54.1<br/>• Cross-browser Testing<br/>• Visual Comparisons<br/>• Trace Viewer]
        T2[📊 HTML Reports<br/>• Rich Visualizations<br/>• Screenshots<br/>• Video Recording]
        T3[🔍 Debugging Tools<br/>• Step-by-step Traces<br/>• Network Monitoring<br/>• Console Logs]
        T4[⚡ Parallel Execution<br/>• Worker Pools<br/>• Resource Management<br/>• Load Balancing]
        T5[🤖 AI Fix Service<br/>• OpenAI GPT-4o-mini<br/>• Error Classification<br/>• Intelligent Repairs<br/>• Monaco Diff Viewer]
    end

    T1 --> T2
    T1 --> T3
    T1 --> T4
    T1 --> T5

    classDef tech fill:#fff3e0,stroke:#f57c00,stroke-width:2px,color:#000
    class T1,T2,T3,T4,T5 tech
```

### **Infrastructure Stack**

```mermaid
graph LR
    subgraph "🏗️ Infrastructure Technologies"
        I1[🐳 Docker<br/>• Containerization<br/>• Multi-arch Support<br/>• Development Parity]
        I2[🔄 Docker Compose<br/>• Service Orchestration<br/>• Development Setup<br/>• Production Ready]
        I3[⚡ Traefik<br/>• Reverse Proxy<br/>• SSL Termination<br/>• Service Discovery]
        I4[🗄️ PostgreSQL 15+<br/>• ACID Compliance<br/>• Advanced Features<br/>• High Performance]
        I5[⚡ Redis 7+<br/>• In-memory Storage<br/>• Pub/Sub Messaging<br/>• Clustering Support]
        I6[📦 MinIO/S3<br/>• Object Storage<br/>• S3 Compatible<br/>• Distributed Storage]
    end

    I1 --> I2
    I2 --> I3
    I4 --> I1
    I5 --> I1
    I6 --> I1

    classDef tech fill:#e8f5e8,stroke:#388e3c,stroke-width:2px,color:#000
    class I1,I2,I3,I4,I5,I6 tech
```

## 🚀 **Deployment Architecture**

```mermaid
graph TB
    subgraph "🌍 Production Environment"
        subgraph "🔒 Security Layer"
            SEC1[🛡️ Cloudflare<br/>• DDoS Protection<br/>• CDN<br/>• WAF]
            SEC2[🔐 Let's Encrypt<br/>• SSL Certificates<br/>• Auto Renewal<br/>• HTTPS Everywhere]
        end

        subgraph "☁️ Hetzner Cloud Infrastructure"
            SERV1[🖥️ Application Server<br/>• 4 vCPU, 16GB RAM<br/>• 160GB SSD<br/>• Ubuntu 22.04 LTS]
            SERV2[🖥️ Database Server<br/>• 2 vCPU, 8GB RAM<br/>• 80GB SSD<br/>• Automated Backups]
            SERV3[🖥️ Storage Server<br/>• 2 vCPU, 4GB RAM<br/>• 500GB Storage<br/>• Object Storage]
        end

        subgraph "🐳 Container Services"
            CONT1[⚡ Traefik Proxy<br/>• Load Balancer<br/>• SSL Termination<br/>• Service Discovery]
            CONT2[🖥️ Next.js App<br/>• 2 Replicas<br/>• Auto Scaling<br/>• Health Checks]
            CONT3[⚙️ NestJS Workers<br/>• 3 Replicas<br/>• Job Processing<br/>• Resource Limits]
        end

        subgraph "💾 Data Services"
            DATA1[🗄️ PostgreSQL<br/>• Master/Replica<br/>• Daily Backups<br/>• Connection Pooling]
            DATA2[⚡ Redis Cluster<br/>• 3 Node Cluster<br/>• High Availability<br/>• Persistence]
            DATA3[📦 MinIO Cluster<br/>• Distributed Storage<br/>• Replication<br/>• Erasure Coding]
        end
    end

    subgraph "📊 Monitoring Stack"
        MON1[📈 Prometheus<br/>• Metrics Collection<br/>• Time Series DB<br/>• Alerting Rules]
        MON2[📊 Grafana<br/>• Visualization<br/>• Dashboards<br/>• Real-time Monitoring]
        MON3[🔍 Loki<br/>• Log Aggregation<br/>• Full-text Search<br/>• Correlation]
        MON4[🚨 AlertManager<br/>• Alert Routing<br/>• Notification Rules<br/>• Escalation]
    end

    %% Connections
    SEC1 --> CONT1
    SEC2 --> CONT1
    CONT1 --> CONT2
    CONT1 --> CONT3

    CONT2 --> DATA1
    CONT2 --> DATA2
    CONT3 --> DATA1
    CONT3 --> DATA2
    CONT3 --> DATA3

    SERV1 -.-> CONT1 & CONT2 & CONT3
    SERV2 -.-> DATA1 & DATA2
    SERV3 -.-> DATA3

    CONT2 -.-> MON1
    CONT3 -.-> MON1
    DATA1 -.-> MON1
    DATA2 -.-> MON1
    DATA3 -.-> MON1

    MON1 --> MON2
    MON1 --> MON4
    CONT2 -.-> MON3
    CONT3 -.-> MON3

    %% Styling
    classDef security fill:#ffebee,stroke:#d32f2f,stroke-width:2px,color:#000
    classDef server fill:#e3f2fd,stroke:#1976d2,stroke-width:2px,color:#000
    classDef container fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px,color:#000
    classDef data fill:#e8f5e8,stroke:#388e3c,stroke-width:2px,color:#000
    classDef monitoring fill:#fff3e0,stroke:#f57c00,stroke-width:2px,color:#000

    class SEC1,SEC2 security
    class SERV1,SERV2,SERV3 server
    class CONT1,CONT2,CONT3 container
    class DATA1,DATA2,DATA3 data
    class MON1,MON2,MON3,MON4 monitoring
```

## 📈 **Scalability & Performance**

```mermaid
graph TB
    subgraph "📊 Performance Metrics"
        P1[⚡ Response Time<br/>• API: <100ms<br/>• UI: <200ms<br/>• Tests: <2min]
        P2[🎯 Throughput<br/>• 1000+ Tests/hour<br/>• 500+ Monitors/min<br/>• 100+ Concurrent Users]
        P3[📈 Scalability<br/>• Horizontal Scaling<br/>• Auto-scaling Workers<br/>• Load Distribution]
    end

    subgraph "🔧 Optimization Strategies"
        O1[💾 Caching<br/>• Redis Query Cache<br/>• CDN Assets<br/>• Browser Caching]
        O2[⚡ Database<br/>• Connection Pooling<br/>• Query Optimization<br/>• Indexing Strategy]
        O3[🚀 Queue Management<br/>• Priority Queuing<br/>• Batch Processing<br/>• Resource Limits]
        O4[📦 Asset Optimization<br/>• Code Splitting<br/>• Image Optimization<br/>• Bundle Analysis]
    end

    subgraph "📊 Monitoring & Alerts"
        M1[🔍 Real-time Monitoring<br/>• System Metrics<br/>• Application Performance<br/>• User Experience]
        M2[🚨 Alert Thresholds<br/>• Response Time<br/>• Error Rates<br/>• Resource Usage]
        M3[📈 Capacity Planning<br/>• Growth Projections<br/>• Resource Forecasting<br/>• Scaling Decisions]
    end

    P1 --> O1
    P2 --> O2
    P3 --> O3
    O1 --> M1
    O2 --> M2
    O3 --> M3
    O4 --> M1

    classDef performance fill:#e3f2fd,stroke:#1976d2,stroke-width:2px,color:#000
    classDef optimization fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px,color:#000
    classDef monitoring fill:#e8f5e8,stroke:#388e3c,stroke-width:2px,color:#000

    class P1,P2,P3 performance
    class O1,O2,O3,O4 optimization
    class M1,M2,M3 monitoring
```

## 🔐 **Security Architecture**

```mermaid
graph TB
    subgraph "🛡️ Security Layers"
        subgraph "🌐 Network Security"
            N1[🔒 HTTPS Everywhere<br/>• TLS 1.3<br/>• HSTS Headers<br/>• Certificate Pinning]
            N2[🛡️ WAF Protection<br/>• DDoS Mitigation<br/>• Bot Detection<br/>• Rate Limiting]
            N3[🔐 VPN Access<br/>• Admin Operations<br/>• Database Access<br/>• Secure Tunneling]
        end

        subgraph "🔐 Authentication & Authorization"
            A1[👤 User Authentication<br/>• Better Auth<br/>• MFA Support<br/>• Session Management]
            A2[🔑 API Key Management<br/>• Scoped Permissions<br/>• Rate Limiting<br/>• Usage Tracking]
            A3[👑 RBAC System<br/>• Multi-level Permissions<br/>• Resource Isolation<br/>• Audit Logging]
        end

        subgraph "💾 Data Protection"
            D1[🔒 Encryption at Rest<br/>• Database Encryption<br/>• File System Encryption<br/>• Key Management]
            D2[🔐 Encryption in Transit<br/>• TLS Everywhere<br/>• Internal Service Mesh<br/>• Certificate Rotation]
            D3[🗄️ Data Privacy<br/>• GDPR Compliance<br/>• Data Anonymization<br/>• Retention Policies]
        end

        subgraph "🔍 Monitoring & Compliance"
            M1[📋 Audit Logging<br/>• User Actions<br/>• System Events<br/>• Security Events]
            M2[🚨 Security Monitoring<br/>• Intrusion Detection<br/>• Anomaly Detection<br/>• Incident Response]
            M3[✅ Compliance<br/>• SOC 2 Ready<br/>• GDPR Compliant<br/>• Security Standards]
        end
    end

    %% Security Flow
    N1 --> A1
    N2 --> A1
    A1 --> A2
    A2 --> A3
    A3 --> D1
    D1 --> D2
    D2 --> D3
    D3 --> M1
    M1 --> M2
    M2 --> M3

    %% Feedback Loops
    M2 -.->|Threats| N2
    M1 -.->|Audit| A3

    classDef network fill:#ffebee,stroke:#d32f2f,stroke-width:2px,color:#000
    classDef auth fill:#e3f2fd,stroke:#1976d2,stroke-width:2px,color:#000
    classDef data fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px,color:#000
    classDef monitoring fill:#e8f5e8,stroke:#388e3c,stroke-width:2px,color:#000

    class N1,N2,N3 network
    class A1,A2,A3 auth
    class D1,D2,D3 data
    class M1,M2,M3 monitoring
```

## 🎯 **Key Architectural Principles**

### **🏗️ Design Principles**

- **🔄 Microservices Architecture**: Loosely coupled, independently deployable services
- **📈 Horizontal Scalability**: Scale out rather than up for better performance
- **🛡️ Security by Design**: Security considerations built into every layer
- **🔧 DevOps Integration**: Infrastructure as code, automated deployments
- **📊 Observability First**: Comprehensive monitoring, logging, and metrics

### **⚡ Performance Principles**

- **⚡ Async Processing**: Non-blocking operations for better responsiveness
- **💾 Intelligent Caching**: Multi-layer caching strategy for optimal performance
- **🔄 Queue-based Processing**: Decoupled, reliable job processing
- **📦 Resource Optimization**: Efficient resource utilization and cleanup

### **🔐 Security Principles**

- **🔒 Zero Trust**: Never trust, always verify
- **🛡️ Defense in Depth**: Multiple security layers
- **📋 Audit Everything**: Comprehensive logging and monitoring
- **🔐 Least Privilege**: Minimal required permissions

### **🚀 Operational Principles**

- **📊 Monitoring & Alerting**: Proactive system monitoring
- **🔄 Automated Recovery**: Self-healing systems where possible
- **📈 Capacity Planning**: Predictive scaling and resource management
- **⚙️ Testing Strategy**: Comprehensive testing at all levels

This architecture ensures Supercheck is robust, scalable, and maintainable while providing excellent performance and security for enterprise-grade testing and monitoring operations.
