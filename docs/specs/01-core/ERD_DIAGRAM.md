# Database Schema Design

## Entity Relationship Diagram

This diagram represents the complete database schema for the Supercheck application, based on the actual Drizzle schema definitions.

> This schema includes 60+ strategic indexes for optimal query performance, foreign key indexes on all relationship columns, and composite indexes for common query patterns.

```mermaid
erDiagram
    user {
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

    organization {
        uuid id PK
        text name
        text slug
        text logo
        timestamp createdAt
        jsonb metadata
        text polarCustomerId
        text subscriptionPlan
        text subscriptionStatus
        text subscriptionId
        timestamp subscriptionStartedAt
        timestamp subscriptionEndsAt
        integer playwrightMinutesUsed
        integer k6VuMinutesUsed
        integer aiCreditsUsed
        timestamp usagePeriodStart
        timestamp usagePeriodEnd
    }

    member {
        uuid id PK
        uuid organizationId FK
        uuid userId FK
        text role
        timestamp createdAt
    }

    invitation {
        uuid id PK
        uuid organizationId FK
        text email
        text role
        text status
        timestamp expiresAt
        uuid inviterId FK
        jsonb selectedProjects
    }

    projects {
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

    tests {
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

    jobs {
        uuid id PK
        uuid organizationId FK
        uuid projectId FK
        uuid createdByUserId FK
        varchar name
        text description
        varchar jobType
        varchar cronSchedule
        varchar status
        jsonb alertConfig
        timestamp lastRunAt
        timestamp nextRunAt
        varchar scheduledJobId
        timestamp createdAt
        timestamp updatedAt
    }

    job_tests {
        uuid jobId FK
        uuid testId FK
        integer orderPosition
    }

    runs {
        uuid id PK
        uuid jobId FK
        uuid projectId FK
        varchar status
        varchar duration
        integer durationMs
        timestamp startedAt
        timestamp completedAt
        text reportS3Url
        text logsS3Url
        text videoS3Url
        text screenshotsS3Path
        jsonb artifactPaths
        text logs
        varchar location
        jsonb metadata
        text errorDetails
        varchar trigger
        timestamp createdAt
        timestamp updatedAt
    }

    k6_performance_runs {
        uuid id PK
        uuid testId FK
        uuid jobId FK
        uuid runId FK
        uuid organizationId FK
        uuid projectId FK
        varchar location
        varchar status
        timestamp startedAt
        timestamp completedAt
        integer durationMs
        jsonb summaryJson
        boolean thresholdsPassed
        integer totalRequests
        integer failedRequests
        integer requestRate
        integer avgResponseTimeMs
        integer p95ResponseTimeMs
        integer p99ResponseTimeMs
        text reportS3Url
        text summaryS3Url
        text consoleS3Url
        text errorDetails
        text consoleOutput
        timestamp createdAt
        timestamp updatedAt
    }

    monitors {
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
        varchar location
        varchar status
        integer responseTimeMs
        jsonb details
        boolean isUp
        boolean isStatusChange
        integer consecutiveFailureCount
        integer consecutiveSuccessCount
        integer alertsSentForFailure
        integer alertsSentForRecovery
        text testExecutionId
        text testReportS3Url
    }

    monitor_aggregates {
        uuid id PK
        uuid monitorId FK
        text periodType
        timestamp periodStart
        text location
        integer totalChecks
        integer successfulChecks
        integer failedChecks
        numeric uptimePercentage
        integer avgResponseMs
        integer minResponseMs
        integer maxResponseMs
        integer p50ResponseMs
        integer p95ResponseMs
        integer p99ResponseMs
        integer totalResponseMs
        integer statusChangeCount
        timestamp createdAt
        timestamp updatedAt
    }

    tags {
        uuid id PK
        uuid organizationId FK
        uuid projectId FK
        uuid createdByUserId FK
        varchar name
        varchar color
        timestamp createdAt
        timestamp updatedAt
    }

    monitor_tags {
        uuid monitorId FK
        uuid tagId FK
        timestamp assignedAt
    }

    test_tags {
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

    alerts {
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

    notifications {
        uuid id PK
        uuid userId FK
        varchar type
        jsonb content
        varchar status
        timestamp sentAt
        timestamp createdAt
    }

    reports {
        uuid id PK
        uuid organizationId FK
        uuid createdByUserId FK
        varchar entityType
        text entityId
        varchar reportPath
        varchar status
        varchar s3Url
        timestamp createdAt
        timestamp updatedAt
    }

    session {
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

    account {
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

    verification {
        uuid id PK
        text identifier
        text value
        timestamp expiresAt
        timestamp createdAt
        timestamp updatedAt
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
        jsonb permissions
        jsonb metadata
    }

    audit_logs {
        uuid id PK
        uuid userId FK
        uuid organizationId FK
        varchar action
        jsonb details
        timestamp createdAt
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

    status_page_components {
        uuid id PK
        uuid statusPageId FK
        varchar name
        text description
        varchar status
        boolean showcase
        boolean onlyShowIfDegraded
        varchar automationEmail
        timestamp startDate
        integer position
        varchar aggregationMethod
        integer failureThreshold
        timestamp createdAt
        timestamp updatedAt
    }

    status_page_component_monitors {
        uuid componentId FK
        uuid monitorId FK
        integer weight
        timestamp createdAt
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

    %% Billing & Usage Tables
    plan_limits {
        uuid id PK
        text plan
        integer maxMonitors
        integer minCheckIntervalMinutes
        integer playwrightMinutesIncluded
        integer k6VuMinutesIncluded
        integer aiCreditsIncluded
        integer runningCapacity
        integer queuedCapacity
        integer maxTeamMembers
        integer maxOrganizations
        integer maxProjects
        integer maxStatusPages
        boolean customDomains
        boolean ssoEnabled
        integer dataRetentionDays
        integer aggregatedDataRetentionDays
        integer jobDataRetentionDays
        timestamp createdAt
        timestamp updatedAt
    }

    billing_settings {
        uuid id PK
        uuid organizationId FK
        integer monthlySpendingLimitCents
        boolean enableSpendingLimit
        boolean hardStopOnLimit
        boolean notifyAt50Percent
        boolean notifyAt80Percent
        boolean notifyAt90Percent
        boolean notifyAt100Percent
        jsonb notificationEmails
        timestamp lastNotificationSentAt
        jsonb notificationsSentThisPeriod
        timestamp createdAt
        timestamp updatedAt
    }

    usage_events {
        uuid id PK
        uuid organizationId FK
        text eventType
        text eventName
        numeric units
        text unitType
        jsonb metadata
        boolean syncedToPolar
        text polarEventId
        text syncError
        integer syncAttempts
        timestamp lastSyncAttempt
        timestamp billingPeriodStart
        timestamp billingPeriodEnd
        timestamp createdAt
    }

    usage_notifications {
        uuid id PK
        uuid organizationId FK
        text notificationType
        text resourceType
        numeric usageAmount
        numeric usageLimit
        integer usagePercentage
        integer currentSpendingCents
        integer spendingLimitCents
        jsonb sentTo
        text deliveryStatus
        text deliveryError
        timestamp billingPeriodStart
        timestamp billingPeriodEnd
        timestamp createdAt
        timestamp sentAt
    }

    overage_pricing {
        uuid id PK
        text plan
        integer playwrightMinutePriceCents
        integer k6VuMinutePriceCents
        integer aiCreditPriceCents
        timestamp createdAt
        timestamp updatedAt
    }

    webhook_idempotency {
        uuid id PK
        text webhookId
        text eventType
        timestamp processedAt
        text resultStatus
        text resultMessage
        timestamp expiresAt
    }

    %% Core Relationships
    user ||--o{ member : "belongs to"
    user ||--o{ invitation : "invites"
    user ||--o{ project_members : "member of"
    user ||--o{ session : "has"
    user ||--o{ account : "linked to"
    user ||--o{ apikey : "owns"
    user ||--o{ notifications : "receives"
    user ||--o{ audit_logs : "performs"
    user ||--o{ project_variables : "creates"
    user ||--o{ status_pages : "creates"
    user ||--o{ incidents : "manages"
    user ||--o{ incident_updates : "adds"
    user ||--o{ incident_templates : "creates"
    user ||--o{ postmortems : "writes"

    organization ||--o{ member : "has members"
    organization ||--o{ invitation : "has invitations"
    organization ||--o{ projects : "contains"
    organization ||--o{ tests : "owns"
    organization ||--o{ jobs : "owns"
    organization ||--o{ monitors : "owns"
    organization ||--o{ tags : "owns"
    organization ||--o{ notification_providers : "configures"
    organization ||--o{ reports : "generates"
    organization ||--o{ alerts : "manages"
    organization ||--o{ audit_logs : "tracks"
    organization ||--o{ status_pages : "manages"
    organization ||--o{ billing_settings : "configures"
    organization ||--o{ usage_events : "generates"
    organization ||--o{ usage_notifications : "receives"

    projects ||--o{ project_members : "has members"
    projects ||--o{ tests : "contains"
    projects ||--o{ jobs : "contains"
    projects ||--o{ monitors : "contains"
    projects ||--o{ tags : "organizes"
    projects ||--o{ notification_providers : "uses"
    projects ||--o{ runs : "executes"
    projects ||--o{ apikey : "accesses"
    projects ||--o{ project_variables : "contains"
    projects ||--o{ status_pages : "hosts"

    %% Test & Job Relationships
    jobs ||--o{ job_tests : "includes"
    tests ||--o{ job_tests : "used in"
    jobs ||--o{ runs : "executes"
    jobs ||--o{ alert_history : "triggers"
    jobs ||--o{ job_notification_settings : "notifies via"
    jobs ||--o{ apikey : "accessed by"
    runs ||--o{ k6_performance_runs : "has metrics"

    %% Monitor Relationships
    monitors ||--o{ monitor_results : "produces"
    monitors ||--o{ alerts : "configured for"
    monitors ||--o{ alert_history : "triggers"
    monitors ||--o{ monitor_notification_settings : "notifies via"
    monitors ||--o{ monitor_tags : "tagged with"
    monitors ||--o{ monitor_aggregates : "aggregated into"

    %% Tag Relationships
    tags ||--o{ monitor_tags : "applied to monitors"
    tags ||--o{ test_tags : "applied to tests"
    tests ||--o{ test_tags : "tagged with"

    %% Status Page Relationships
    status_pages ||--o{ status_page_components : "has"
    status_pages ||--o{ incidents : "tracks"
    status_pages ||--o{ incident_templates : "manages"
    status_pages ||--o{ status_page_subscribers : "notifies"
    status_pages ||--o{ status_page_metrics : "tracks"

    status_page_components ||--o{ status_page_component_monitors : "linked through"
    status_page_components ||--o{ incident_components : "affected by"
    status_page_components ||--o{ incident_template_components : "used in templates"
    status_page_components ||--o{ status_page_component_subscriptions : "subscribed to"
    status_page_components ||--o{ status_page_metrics : "measured for"
    monitors ||--o{ status_page_component_monitors : "monitored by"

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
    session ||--o{ organization : "active org"
    session ||--o{ projects : "active project"
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
- **Polar Billing Integration**: Subscription-based billing with Plus, Pro, and Unlimited plans
- **Usage Tracking**: Monitor Playwright minutes and K6 VU hours with automatic overage calculation
- **Plan Enforcement**: Resource limits enforced based on subscription plan (monitors, projects, capacity limits, etc.)
- **Self-Hosted Mode**: Unlimited plan automatically assigned to self-hosted deployments

### Role Hierarchy

- **Organization Level**: `org_owner`, `org_admin`, `project_admin`, `project_editor`, `project_viewer`
- **Project Level**: `project_admin`, `project_editor`, `project_viewer`

### Data Types

- All IDs use UUID for better security and distribution
- JSON fields for flexible configuration storage
- Comprehensive timestamp tracking for audit purposes
