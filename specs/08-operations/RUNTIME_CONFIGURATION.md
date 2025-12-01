# Runtime Configuration System

## Overview

Supercheck uses a unified runtime configuration system that allows changing application settings without rebuilding the Docker container. This is achieved through a central API endpoint that exposes server-side environment variables to the client.

## API Endpoint

### GET `/api/config/app`

Returns all runtime configuration settings:

```json
{
  "hosting": {
    "selfHosted": true,
    "cloudHosted": false
  },
  "authProviders": {
    "github": { "enabled": true },
    "google": { "enabled": false }
  },
  "demoMode": false,
  "limits": {
    "maxJobNotificationChannels": 10,
    "maxMonitorNotificationChannels": 10,
    "recentMonitorResultsLimit": null
  }
}
```

## Environment Variables

### Hosting Mode

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `SELF_HOSTED` | boolean | `false` | Enable self-hosted mode (disables Polar billing) |

### Authentication Providers

Social auth buttons are automatically shown when credentials are configured:

| Variable | Type | Description |
|----------|------|-------------|
| `GITHUB_CLIENT_ID` | string | GitHub OAuth App Client ID |
| `GITHUB_CLIENT_SECRET` | string | GitHub OAuth App Client Secret |
| `GOOGLE_CLIENT_ID` | string | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | string | Google OAuth Client Secret |

### Demo Mode

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DEMO_MODE` | boolean | `false` | Show demo badge in UI header |

### Notification Limits

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `MAX_JOB_NOTIFICATION_CHANNELS` | number | `10` | Maximum notification channels per job |
| `MAX_MONITOR_NOTIFICATION_CHANNELS` | number | `10` | Maximum notification channels per monitor |
| `RECENT_MONITOR_RESULTS_LIMIT` | number | - | Limit for recent monitor results display |

## React Hooks

### `useAppConfig()`

Main hook for accessing runtime configuration:

```typescript
import { useAppConfig } from "@/hooks/use-app-config";

function MyComponent() {
  const {
    config,
    isLoading,
    error,
    // Convenience accessors
    isSelfHosted,
    isCloudHosted,
    isDemoMode,
    isGithubEnabled,
    isGoogleEnabled,
    maxJobNotificationChannels,
    maxMonitorNotificationChannels,
    recentMonitorResultsLimit,
  } = useAppConfig();

  if (isLoading) return <Loading />;
  
  return <div>{isDemoMode && <DemoBadge />}</div>;
}
```

### `useHostingMode()`

Convenience hook for hosting mode checks:

```typescript
import { useHostingMode } from "@/hooks/use-hosting-mode";

function BillingComponent() {
  const { isSelfHosted, isCloudHosted } = useHostingMode();
  
  if (isSelfHosted) return null; // Hide billing in self-hosted
  return <BillingUI />;
}
```

### `useAuthProviders()`

Convenience hook for auth provider checks:

```typescript
import { useAuthProviders } from "@/hooks/use-auth-providers";

function SocialAuthButtons() {
  const { isGithubEnabled, isGoogleEnabled } = useAuthProviders();
  
  return (
    <>
      {isGithubEnabled && <GitHubButton />}
      {isGoogleEnabled && <GoogleButton />}
    </>
  );
}
```

## Migration from NEXT_PUBLIC_* Variables

### Deprecated Variables

The following `NEXT_PUBLIC_*` variables have been replaced:

| Old Variable | New Variable | Notes |
|--------------|--------------|-------|
| `NEXT_PUBLIC_GITHUB_ENABLED` | *Removed* | Auto-detected from `GITHUB_CLIENT_ID` |
| `NEXT_PUBLIC_GOOGLE_ENABLED` | *Removed* | Auto-detected from `GOOGLE_CLIENT_ID` |
| `NEXT_PUBLIC_DEMO_MODE` | `DEMO_MODE` | Server-side only |
| `NEXT_PUBLIC_MAX_JOB_NOTIFICATION_CHANNELS` | `MAX_JOB_NOTIFICATION_CHANNELS` | Server-side only |
| `NEXT_PUBLIC_MAX_MONITOR_NOTIFICATION_CHANNELS` | `MAX_MONITOR_NOTIFICATION_CHANNELS` | Server-side only |

### Variables Still Using NEXT_PUBLIC_*

Some variables must remain as `NEXT_PUBLIC_*` because they're needed at build time:

| Variable | Reason |
|----------|--------|
| `NEXT_PUBLIC_APP_URL` | Required by Better Auth client at build time |

## Server-Side Usage

Server components and API routes should use environment variables directly:

```typescript
// In API routes or server components
const maxChannels = parseInt(
  process.env.MAX_JOB_NOTIFICATION_CHANNELS || "10",
  10
);
```

## Caching

The `/api/config/app` endpoint has no caching to ensure configuration changes are immediately reflected. Client hooks fetch fresh data on component mount.

## Security

- No sensitive information (secrets, API keys) is exposed through the config endpoint
- Only boolean flags and numeric limits are returned
- Authentication provider credentials are never exposed, only their enabled/disabled status
