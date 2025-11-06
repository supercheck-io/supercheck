# Database Schema Design

## Entity Relationship Diagram

This diagram represents the complete database schema for the Supercheck application, based on the main app schema.

> **Updated:** October 2025 - Status page tables added with complete relationships

```mermaid
erDiagram
    USER {
        uuid id PK
        text name
        text email
        boolean emailVerified
        text image
        timestamp createdAt
        timestamp updatedAt
        text role
        boolean banned
        text banReason
        timestamp banExpires
    }

    ORGANIZATION {
        uuid id PK
        text name
        text slug
        text logo
        timestamp createdAt
        text metadata
    }

    MEMBER {
        uuid id PK
        uuid organizationId FK
        uuid userId FK
        text role
        timestamp createdAt
    }

    INVITATION {
        uuid id PK
        uuid organizationId FK
        text email
        text role
        text status
        timestamp expiresAt
        uuid inviterId FK
        text selectedProjects
    }

    PROJECTS {
        uuid id PK
        uuid organizationId FK
        varchar name
        varchar slug
        text description
        boolean isDefault
        varchar status
        timestamp createdAt
        timestamp updatedAt
    }

    project_members {
        uuid id PK
        uuid userId FK
        uuid projectId FK
        varchar role
        timestamp createdAt
    }

    TESTS {
        uuid id PK
        uuid organizationId FK
        uuid projectId FK
        uuid createdByUserId FK
        varchar title
        text description
        text script
        varchar priority
        varchar type
        timestamp createdAt
        timestamp updatedAt
    }

    JOBS {
        uuid id PK
        uuid organizationId FK
        uuid projectId FK
        uuid createdByUserId FK
        varchar name
        text description
        varchar cronSchedule
        varchar status
        jsonb alertConfig
        timestamp lastRunAt
        timestamp nextRunAt
        varchar scheduledJobId
        timestamp createdAt
        timestamp updatedAt
    }

    jobTests {
        uuid jobId FK
        uuid testId FK
        integer orderPosition
    }

    RUNS {
        uuid id PK
        uuid jobId FK
        uuid projectId FK
        varchar status
        varchar duration
        timestamp startedAt
        timestamp completedAt
        jsonb artifactPaths
        text logs
        text errorDetails
        varchar trigger
        timestamp createdAt
        timestamp updatedAt
    }

    MONITORS {
        uuid id PK
        uuid organizationId FK
        uuid projectId FK
        uuid createdByUserId FK
        varchar name
        text description
        varchar type
        varchar target
        integer frequencyMinutes
        boolean enabled
        varchar status
        jsonb config
        jsonb alertConfig
        timestamp lastCheckAt
        timestamp lastStatusChangeAt
        timestamp mutedUntil
        varchar scheduledJobId
        timestamp createdAt
        timestamp updatedAt
    }

    monitor_results {
        uuid id PK
        uuid monitorId FK
        timestamp checkedAt
        varchar status
        integer responseTimeMs
        jsonb details
        boolean isUp
        boolean isStatusChange
        integer consecutiveFailureCount
        integer alertsSentForFailure
    }

    TAGS {
        uuid id PK
        uuid organizationId FK
        uuid projectId FK
        uuid createdByUserId FK
        varchar name
        varchar color
        timestamp createdAt
        timestamp updatedAt
    }

    monitorTags {
        uuid monitorId FK
        uuid tagId FK
        timestamp assignedAt
    }

    testTags {
        uuid testId FK
        uuid tagId FK
        timestamp assignedAt
    }

    notification_providers {
        uuid id PK
        uuid organizationId FK
        uuid projectId FK
        uuid createdByUserId FK
        varchar name
        varchar type
        jsonb config
        boolean isEnabled
        timestamp createdAt
        timestamp updatedAt
    }

    monitor_notification_settings {
        uuid monitorId FK
        uuid notificationProviderId FK
        timestamp createdAt
    }

    job_notification_settings {
        uuid jobId FK
        uuid notificationProviderId FK
        timestamp createdAt
    }

    REPORTS {
        uuid id PK
        uuid organizationId FK
        uuid createdByUserId FK
        varchar entityType
        uuid entityId
        varchar reportPath
        varchar status
        varchar s3Url
        timestamp createdAt
        timestamp updatedAt
    }

    ALERTS {
        uuid id PK
        uuid organizationId FK
        uuid monitorId FK
        boolean enabled
        jsonb notificationProviders
        boolean alertOnFailure
        boolean alertOnRecovery
        boolean alertOnSslExpiration
        boolean alertOnSuccess
        boolean alertOnTimeout
        integer failureThreshold
        integer recoveryThreshold
        text customMessage
        timestamp createdAt
        timestamp updatedAt
    }

    alert_history {
        uuid id PK
        text message
        varchar type
        varchar target
        varchar targetType
        uuid monitorId FK
        uuid jobId FK
        varchar provider
        varchar status
        timestamp sentAt
        text errorMessage
    }

    apikey {
        uuid id PK
        text name
        text start
        text prefix
        text key
        uuid userId FK
        uuid jobId FK
        uuid projectId FK
        text refillInterval
        text refillAmount
        timestamp lastRefillAt
        boolean enabled
        boolean rateLimitEnabled
        text rateLimitTimeWindow
        text rateLimitMax
        text requestCount
        text remaining
        timestamp lastRequest
        timestamp expiresAt
        timestamp createdAt
        timestamp updatedAt
        text permissions
        text metadata
    }

    SESSION {
        uuid id PK
        timestamp expiresAt
        text token
        timestamp createdAt
        timestamp updatedAt
        text ipAddress
        text userAgent
        uuid userId FK
        uuid activeOrganizationId FK
        uuid activeProjectId FK
        text impersonatedBy
    }

    ACCOUNT {
        uuid id PK
        text accountId
        text providerId
        uuid userId FK
        text accessToken
        text refreshToken
        text idToken
        timestamp accessTokenExpiresAt
        timestamp refreshTokenExpiresAt
        text scope
        text password
        timestamp createdAt
        timestamp updatedAt
    }

    VERIFICATION {
        uuid id PK
        text identifier
        text value
        timestamp expiresAt
        timestamp createdAt
        timestamp updatedAt
    }

    auditLogs {
        uuid id PK
        uuid userId FK
        uuid organizationId FK
        varchar action
        jsonb details
        timestamp createdAt
    }

    NOTIFICATIONS {
        uuid id PK
        uuid userId FK
        varchar type
        jsonb content
        varchar status
        timestamp sentAt
        timestamp createdAt
    }

    project_variables {
        uuid id PK
        uuid projectId FK
        varchar key
        text value
        text encryptedValue
        boolean isSecret
        text description
        uuid createdByUserId FK
        timestamp createdAt
        timestamp updatedAt
    }

    %% Status Page Tables
    status_pages {
        uuid id PK
        uuid organizationId FK
        uuid projectId FK
        uuid createdByUserId FK
        varchar name
        varchar subdomain
        varchar status
        varchar headline
        text pageDescription
        varchar supportUrl
        varchar timezone
        boolean allowPageSubscribers
        boolean allowIncidentSubscribers
        boolean allowEmailSubscribers
        boolean allowSmsSubscribers
        boolean allowWebhookSubscribers
        varchar notificationsFromEmail
        text notificationsEmailFooter
        boolean hiddenFromSearch
        varchar cssBodyBackgroundColor
        varchar cssFontColor
        varchar cssLightFontColor
        varchar cssGreens
        varchar cssYellows
        varchar cssOranges
        varchar cssBlues
        varchar cssReds
        varchar cssBorderColor
        varchar cssGraphColor
        varchar cssLinkColor
        varchar cssNoData
        varchar faviconLogo
        varchar transactionalLogo
        varchar heroCover
        varchar emailLogo
        varchar twitterLogo
        varchar customDomain
        boolean customDomainVerified
        jsonb theme
        jsonb brandingSettings
        timestamp createdAt
        timestamp updatedAt
    }

    status_page_component_groups {
        uuid id PK
        uuid statusPageId FK
        varchar name
        text description
        integer position
        timestamp createdAt
        timestamp updatedAt
    }

    status_page_components {
        uuid id PK
        uuid statusPageId FK
        uuid componentGroupId FK
        uuid monitorId FK
        varchar name
        text description
        varchar status
        boolean showcase
        boolean onlyShowIfDegraded
        varchar automationEmail
        timestamp startDate
        integer position
        timestamp createdAt
        timestamp updatedAt
    }

    incidents {
        uuid id PK
        uuid statusPageId FK
        uuid createdByUserId FK
        varchar name
        varchar status
        varchar impact
        varchar impactOverride
        text body
        timestamp scheduledFor
        timestamp scheduledUntil
        boolean scheduledRemindPrior
        boolean autoTransitionToMaintenanceState
        boolean autoTransitionToOperationalState
        boolean scheduledAutoInProgress
        boolean scheduledAutoCompleted
        boolean autoTransitionDeliverNotificationsAtStart
        boolean autoTransitionDeliverNotificationsAtEnd
        varchar reminderIntervals
        jsonb metadata
        boolean deliverNotifications
        timestamp backfillDate
        boolean backfilled
        timestamp monitoringAt
        timestamp resolvedAt
        varchar shortlink
        timestamp createdAt
        timestamp updatedAt
    }

    incident_updates {
        uuid id PK
        uuid incidentId FK
        uuid createdByUserId FK
        text body
        varchar status
        boolean deliverNotifications
        timestamp displayAt
        timestamp createdAt
        timestamp updatedAt
    }

    incident_components {
        uuid id PK
        uuid incidentId FK
        uuid componentId FK
        varchar oldStatus
        varchar newStatus
        timestamp createdAt
    }

    incident_templates {
        uuid id PK
        uuid statusPageId FK
        uuid createdByUserId FK
        varchar name
        varchar title
        text body
        uuid componentGroupId FK
        varchar updateStatus
        boolean shouldSendNotifications
        timestamp createdAt
        timestamp updatedAt
    }

    incident_template_components {
        uuid id PK
        uuid templateId FK
        uuid componentId FK
        timestamp createdAt
    }

    status_page_subscribers {
        uuid id PK
        uuid statusPageId FK
        varchar email
        varchar phoneNumber
        varchar phoneCountry
        varchar endpoint
        varchar mode
        boolean skipConfirmationNotification
        timestamp quarantinedAt
        timestamp purgeAt
        timestamp verifiedAt
        varchar verificationToken
        varchar unsubscribeToken
        timestamp createdAt
        timestamp updatedAt
    }

    status_page_component_subscriptions {
        uuid id PK
        uuid subscriberId FK
        uuid componentId FK
        timestamp createdAt
    }

    status_page_incident_subscriptions {
        uuid id PK
        uuid incidentId FK
        uuid subscriberId FK
        timestamp createdAt
    }

    status_page_metrics {
        uuid id PK
        uuid statusPageId FK
        uuid componentId FK
        timestamp date
        varchar uptimePercentage
        integer totalChecks
        integer successfulChecks
        integer failedChecks
        integer averageResponseTimeMs
        timestamp createdAt
        timestamp updatedAt
    }

    postmortems {
        uuid id PK
        uuid incidentId FK
        uuid createdByUserId FK
        text body
        timestamp bodyLastUpdatedAt
        boolean ignored
        boolean notifiedSubscribers
        timestamp publishedAt
        timestamp createdAt
        timestamp updatedAt
    }

    %% Core Relationships
    USER ||--o{ MEMBER : "belongs to"
    USER ||--o{ INVITATION : "invites"
    USER ||--o{ projectMembers : "member of"
    USER ||--o{ SESSION : "has"
    USER ||--o{ ACCOUNT : "linked to"
    USER ||--o{ apikey : "owns"
    USER ||--o{ NOTIFICATIONS : "receives"
    USER ||--o{ audit_logs : "performs"
    USER ||--o{ project_variables : "creates"
    USER ||--o{ status_pages : "creates"
    USER ||--o{ incidents : "manages"
    USER ||--o{ incident_updates : "adds"
    USER ||--o{ incident_templates : "creates"
    USER ||--o{ postmortems : "writes"

    ORGANIZATION ||--o{ MEMBER : "has members"
    ORGANIZATION ||--o{ INVITATION : "has invitations"
    ORGANIZATION ||--o{ PROJECTS : "contains"
    ORGANIZATION ||--o{ TESTS : "owns"
    ORGANIZATION ||--o{ JOBS : "owns"
    ORGANIZATION ||--o{ MONITORS : "owns"
    ORGANIZATION ||--o{ TAGS : "owns"
    ORGANIZATION ||--o{ notification_providers : "configures"
    ORGANIZATION ||--o{ REPORTS : "generates"
    ORGANIZATION ||--o{ ALERTS : "manages"
    ORGANIZATION ||--o{ audit_logs : "tracks"
    ORGANIZATION ||--o{ status_pages : "manages"

    PROJECTS ||--o{ project_members : "has members"
    PROJECTS ||--o{ TESTS : "contains"
    PROJECTS ||--o{ JOBS : "contains"
    PROJECTS ||--o{ MONITORS : "contains"
    PROJECTS ||--o{ TAGS : "organizes"
    PROJECTS ||--o{ notification_providers : "uses"
    PROJECTS ||--o{ RUNS : "executes"
    PROJECTS ||--o{ apikey : "accesses"
    PROJECTS ||--o{ project_variables : "contains"
    PROJECTS ||--o{ status_pages : "hosts"

    %% Test & Job Relationships
    JOBS ||--o{ jobTests : "includes"
    TESTS ||--o{ jobTests : "used in"
    JOBS ||--o{ RUNS : "executes"
    JOBS ||--o{ alert_history : "triggers"
    JOBS ||--o{ job_notification_settings : "notifies via"
    JOBS ||--o{ apikey : "accessed by"

    %% Monitor Relationships
    MONITORS ||--o{ monitor_results : "produces"
    MONITORS ||--o{ ALERTS : "configured for"
    MONITORS ||--o{ alert_history : "triggers"
    MONITORS ||--o{ monitor_notification_settings : "notifies via"
    MONITORS ||--o{ monitorTags : "tagged with"

    %% Tag Relationships
    TAGS ||--o{ monitorTags : "applied to monitors"
    TAGS ||--o{ testTags : "applied to tests"
    TESTS ||--o{ testTags : "tagged with"

    %% Status Page Relationships
    status_pages ||--o{ status_page_component_groups : "contains"
    status_pages ||--o{ status_page_components : "has"
    status_pages ||--o{ incidents : "tracks"
    status_pages ||--o{ incident_templates : "manages"
    status_pages ||--o{ status_page_subscribers : "notifies"
    status_pages ||--o{ status_page_metrics : "tracks"

    status_page_component_groups ||--o{ status_page_components : "organizes"
    status_page_component_groups ||--o{ incident_templates : "used in"

    status_page_components ||--o{ incident_components : "affected by"
    status_page_components ||--o{ incident_template_components : "used in templates"
    status_page_components ||--o{ status_page_component_subscriptions : "subscribed to"
    status_page_components ||--o{ status_page_metrics : "measured for"
    status_page_components ||--o{ MONITORS : "linked to"

    incidents ||--o{ incident_updates : "has"
    incidents ||--o{ incident_components : "affects"
    incidents ||--o{ status_page_incident_subscriptions : "followed by"
    incidents ||--o{ postmortems : "analyzed by"

    incident_templates ||--o{ incident_template_components : "includes"

    status_page_subscribers ||--o{ status_page_component_subscriptions : "subscribes to"
    status_page_subscribers ||--o{ status_page_incident_subscriptions : "follows"

    %% Notification Relationships
    notification_providers ||--o{ monitor_notification_settings : "used by monitors"
    notification_providers ||--o{ job_notification_settings : "used by jobs"

    %% Session & Auth Relationships
    SESSION ||--o{ ORGANIZATION : "active org"
    SESSION ||--o{ PROJECTS : "active project"
```

## Schema Notes

### Key Features

- **Multi-tenant Architecture**: Organizations contain projects, users are members of organizations
- **Project-based Access Control**: Users can have different roles in different projects
- **Variable Management**: Project-scoped variables and secrets with encryption support
- **Comprehensive Monitoring**: HTTP/website/ping/port/heartbeat monitoring with results tracking
- **Test Automation**: Tests can be grouped into jobs with cron scheduling
- **Flexible Notifications**: Multiple notification providers (email, Slack, webhooks, etc.)
- **Audit Trail**: Complete audit logging of user actions
- **API Access**: Fine-grained API key management with rate limiting
- **Status Pages**: Public-facing status communication with UUID-based subdomains, component tracking, and incident management
- **Incident Management**: Complete incident workflow with templates, updates, and postmortem analysis
- **Subscriber System**: Multi-channel notifications (email, SMS, webhook) for status updates and incidents
- **Component Organization**: Logical grouping of services with monitor linking and status tracking
- **Analytics & Metrics**: Detailed uptime tracking and performance metrics per component

### Role Hierarchy

- **Organization Level**: `org_owner`, `org_admin`, `project_admin`, `project_editor`, `project_viewer`
- **Project Level**: `project_admin`, `project_editor`, `project_viewer`

### Data Types

- All IDs use UUID for better security and distribution
- JSON fields for flexible configuration storage
- Comprehensive timestamp tracking for audit purposes
