# Social Authentication Setup Guide

This guide explains how to set up GitHub and Google OAuth authentication for Supercheck.

## Table of Contents

1. [Overview](#overview)
2. [GitHub OAuth Setup](#github-oauth-setup)
3. [Google OAuth Setup](#google-oauth-setup)
4. [Configuration](#configuration)
5. [Testing](#testing)
6. [Troubleshooting](#troubleshooting)
7. [Security Best Practices](#security-best-practices)

---

## Overview

Supercheck supports social authentication via GitHub and Google using Better Auth. Social authentication provides:

- **Easier Onboarding**: Users can sign up without creating new passwords
- **Better Security**: Leverages OAuth 2.0 security
- **User Convenience**: One-click sign-in for returning users
- **Polar Integration**: Automatically creates Polar customers for cloud deployments
- **Organization Setup**: Automatically creates default organization and project

### How It Works

1. User clicks "Sign in with GitHub" or "Sign in with Google"
2. User is redirected to the provider for authentication
3. After successful auth, user is redirected back to Supercheck
4. Better Auth creates/updates the user account
5. **Cloud Mode Only**: Polar customer is automatically created (via Better Auth plugin)
6. Default organization and project are created automatically
7. User is redirected to the dashboard

---

## GitHub OAuth Setup

### Step 1: Create a GitHub OAuth App

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **"New OAuth App"** or **"New GitHub App"**
3. Fill in the application details:

   **For OAuth Apps:**
   - **Application name**: `Supercheck` (or your app name)
   - **Homepage URL**: `http://localhost:3000` (development) or `https://your-domain.com` (production)
   - **Authorization callback URL**: `http://localhost:3000/api/auth/callback/github` (development)
     - For production: `https://your-domain.com/api/auth/callback/github`

   **For GitHub Apps (Additional Step Required):**
   - Follow OAuth App steps above, then:
   - Go to **Permissions and Events** > **Account Permissions** > **Email Addresses**
   - Select **"Read-Only"** access
   - Save changes

   > **Important**: GitHub Apps require email permission to be explicitly enabled!

4. Click **"Register application"**
5. Copy the **Client ID**
6. Click **"Generate a new client secret"** and copy it immediately

### Step 2: Add Credentials to Environment

Add the following to your `.env` file:

```bash
# GitHub OAuth
# Social auth buttons are automatically shown when credentials are configured
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
```

### Common GitHub Issues

**Problem**: `email_not_found` error

**Solution**: If using a GitHub App (not OAuth App), ensure you've enabled email permissions:
- Go to app settings → Permissions and Events → Account Permissions → Email Addresses → Read-Only

**Problem**: No refresh token

**Solution**: This is normal! GitHub doesn't issue refresh tokens for OAuth apps. Access tokens remain valid indefinitely unless:
- User revokes access
- App revokes the token
- Token goes unused for 1 year

---

## Google OAuth Setup

### Step 1: Create Google OAuth Credentials

1. Open [Google Cloud Console](https://console.cloud.google.com/apis/dashboard)
2. Create a new project or select an existing one
3. Navigate to **APIs & Services** → **Credentials**
4. Click **"Create Credentials"** → **"OAuth client ID"**

   > If prompted, configure the OAuth consent screen first:
   > - Choose **External** for public apps or **Internal** for workspace apps
   > - Fill in app name, user support email, and developer contact
   > - Add scopes: `email`, `profile`, `openid` (automatically added)
   > - Add test users if in development

5. For Application type, choose **"Web application"**
6. Add authorized redirect URIs:
   - Development: `http://localhost:3000/api/auth/callback/google`
   - Production: `https://your-domain.com/api/auth/callback/google`

   > **Critical**: The redirect URI must match exactly (including http/https and trailing slashes)

7. Click **"Create"**
8. Copy the **Client ID** and **Client Secret**

### Step 2: Add Credentials to Environment

Add the following to your `.env` file:

```bash
# Google OAuth
# Social auth buttons are automatically shown when credentials are configured
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

### Google OAuth Configuration

Our implementation includes these optimizations:

- **Always Get Refresh Token**: `accessType: "offline"`
- **Force Account Selection**: `prompt: "select_account consent"`

This ensures:
- Users can always select which Google account to use
- We always receive a refresh token for long-term access
- Users re-consent when needed

### Common Google Issues

**Problem**: `redirect_uri_mismatch` error

**Solution**:
1. Check that the redirect URI in Google Console exactly matches your app URL
2. Ensure protocol (http/https) matches
3. No trailing slashes unless your app uses them
4. Update both development and production URLs

**Problem**: No refresh token received

**Solution**: Already handled! Our config uses `accessType: "offline"` and `prompt: "select_account consent"` to always get refresh tokens.

**To manually revoke and re-authorize**:
1. User goes to [Google Account Permissions](https://myaccount.google.com/permissions)
2. Find your app and click "Remove access"
3. Sign in again to get a new refresh token

---

## Configuration

### Environment Variables

Your `.env` file should include:

```bash
# Better Auth (Required)
BETTER_AUTH_SECRET=your-super-secret-key-change-this-in-production
BETTER_AUTH_URL=http://localhost:3000

# GitHub OAuth (Optional - buttons shown automatically when configured)
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# Google OAuth (Optional - buttons shown automatically when configured)
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

> **Note:** Social auth buttons are automatically shown in the UI when the corresponding client ID and secret are configured. No additional `NEXT_PUBLIC_*` variables are needed.

### Production Configuration

For production deployments:

1. **Update callback URLs** in GitHub/Google consoles to use your production domain
2. **Use HTTPS** - OAuth providers require secure connections in production
3. **Rotate secrets regularly** - Keep your client secrets secure
4. **Set appropriate scopes** - Only request necessary permissions
5. **Monitor usage** - Check OAuth provider dashboards for suspicious activity

### Self-Hosted Mode

Social auth works in both cloud and self-hosted modes:

- **Cloud Mode** (`SELF_HOSTED=false`):
  - Polar customer created automatically
  - Subscription limits enforced
  - Usage tracking enabled

- **Self-Hosted Mode** (`SELF_HOSTED=true`):
  - No Polar integration
  - Unlimited plan assigned
  - No usage tracking

---

## Testing

### Local Testing Steps

1. Start your development server:
   ```bash
   npm run dev
   ```

2. Navigate to the sign-in page: `http://localhost:3000/sign-in`

3. Click "Sign in with GitHub" or "Sign in with Google"

4. Verify the flow:
   - You're redirected to the provider
   - You authenticate/authorize the app
   - You're redirected back to Supercheck
   - You're signed in and redirected to dashboard
   - A default organization and project are created

### Test Cases

**New User Signup via GitHub:**
1. Click "Sign up" → "Sign up with GitHub"
2. Authorize the app
3. Should create:
   - User account
   - Default organization ("{name}'s Organization")
   - Default project
   - Polar customer (cloud mode only)
4. Should redirect to dashboard

**Existing User Sign-In via Google:**
1. Previously signed up with email/password
2. Click "Sign in with Google" using same email
3. Should link accounts and sign in successfully

**Organization Invite Flow:**
1. Receive organization invite email
2. Click invite link
3. Click "Sign up with GitHub"
4. Should join the invited organization (not create new one)

---

## Troubleshooting

### Button Not Showing

**Check:**
1. Both `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set (for GitHub)
2. Both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set (for Google)
3. Restart the server after changing environment variables
4. Clear browser cache and reload
5. Check browser console for errors
6. Verify `/api/config/auth-providers` returns the expected enabled status

### Authentication Fails

**GitHub:**
- Verify callback URL matches exactly: `http://localhost:3000/api/auth/callback/github`
- Check client ID and secret are correct
- Ensure GitHub App has email permissions (if using GitHub App)

**Google:**
- Check redirect URI in Google Console matches exactly
- Ensure OAuth consent screen is configured
- Add your email as a test user if app is in testing mode
- Verify client ID and secret are correct

### User Created But No Organization

**Check:**
1. Better Auth hooks are properly configured
2. `/api/auth/setup-defaults` endpoint is accessible
3. Check server logs for errors in the hook execution
4. Verify database connectivity

### Polar Customer Not Created

**In Cloud Mode:**
1. Verify Polar plugin is enabled in `auth.ts`
2. Check Polar credentials are valid
3. Check server logs for Polar API errors
4. Ensure `createCustomerOnSignUp: true` is set

**In Self-Hosted Mode:**
- This is expected! Polar integration is disabled when `SELF_HOSTED=true`

---

## Security Best Practices

### 1. Protect Client Secrets

- **Never commit** client secrets to version control
- Use environment variables only
- Rotate secrets regularly
- Use different secrets for development/production

### 2. Validate Redirect URIs

- Only add necessary redirect URIs
- Use exact matches (avoid wildcards if possible)
- Keep development and production URIs separate

### 3. Monitor OAuth Activity

- Check GitHub/Google console for unusual activity
- Review authorized users regularly
- Set up alerts for failed authentication attempts

### 4. Handle Account Linking

Our implementation automatically links accounts with the same email:
- User signs up with email/password
- Later signs in with GitHub using same email
- Accounts are linked automatically
- User can use either method to sign in

### 5. HTTPS in Production

- OAuth providers require HTTPS in production
- Use valid SSL certificates
- Configure `BETTER_AUTH_URL` with https://

### 6. Rate Limiting

Better Auth includes built-in rate limiting for OAuth endpoints to prevent abuse.

---

## Additional Resources

- [Better Auth Documentation](https://www.better-auth.com/docs)
- [GitHub OAuth Documentation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps)
- [Google OAuth Documentation](https://developers.google.com/identity/protocols/oauth2)
- [OAuth 2.0 Specification](https://oauth.net/2/)

---

## Need Help?

If you encounter issues not covered in this guide:

1. Check the [Better Auth GitHub Issues](https://github.com/better-auth/better-auth/issues)
2. Review server logs for detailed error messages
3. Enable debug logging: `LOG_LEVEL=debug` in your `.env`
4. Check the [Supercheck GitHub Issues](https://github.com/supercheck-io/supercheck/issues)
