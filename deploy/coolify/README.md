# Supercheck on Coolify

Deploy Supercheck on [Coolify](https://coolify.io) using Docker Compose.

---

## Quick Start

### 1. Create Service

1. Open Coolify dashboard
2. Go to **Projects** → Select your project → **+ New** → **Docker Compose**
3. Select **Empty Compose**

![IMAGE](image1.png)
 

### 2. Add Configuration

1. Click **Edit Compose File**
2. Paste the contents of [`supercheck.yaml`](./supercheck.yaml)
3. Click **Save**

### 3. Deploy

1. Click **Deploy**
2. Wait for all services to show **Running (healthy)**
3. Click the generated URL next to the **App** service to access your instance

![IMAGE](image4.png)

---

## OAuth Setup (Required)

You need OAuth to create your first account.

### GitHub OAuth

1. Go to [github.com/settings/developers](https://github.com/settings/developers) → **New OAuth App**

2. Fill in:
   - **Application name:** `Supercheck`
   - **Homepage URL:** Your Coolify-generated URL (e.g., `http://app-xxx.sslip.io`)
   - **Callback URL:** Same URL + `/api/auth/callback/github`

   > ⚠️ **Note:** Copy the exact URL shown in Coolify (HTTP or HTTPS).

3. Copy **Client ID** and generate **Client Secret**

4. In Coolify → **Environment Variables** → Add:
   ```
   GITHUB_CLIENT_ID=your_client_id
   GITHUB_CLIENT_SECRET=your_client_secret
   ```

5. Click **Save** → **Restart** the App service

![IMAGE](image2.png)

![IMAGE](image3.png)

![IMAGE](image5.png)

---

## Advanced Configuration

### Custom Domain

To use your own domain instead of the auto-generated sslip.io URL:

1. **Add DNS records:**
   - `app.yourdomain.com` → A record → Server IP
   - `*.yourdomain.com` → A record → Server IP (for status pages)

2. **In Coolify:** Click on **App** service → Scroll to bottom → Add domain

3. **Update OAuth callback URL** to match new domain

4. **Redeploy**

### Status Pages (Requires Custom Domain)

Status pages use subdomains (e.g., `status.yourdomain.com`) which require **wildcard DNS**.

> ❌ **Note:** Status pages do **NOT** work with the default `sslip.io` URL because Coolify doesn't automatically configure wildcard routing for it. You **must** use a custom domain.

1. **Add Wildcard DNS:** `*.yourdomain.com` → A record → Server IP
2. **In Coolify:** Add `https://*.yourdomain.com:3000` to App domains
3. **Set Env Var:** `STATUS_PAGE_DOMAIN=yourdomain.com`

Status pages will then be accessible at `https://{slug}.yourdomain.com`

### Optional Environment Variables

| Variable | Description |
|----------|-------------|
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL` | Email notifications |
| `OPENAI_API_KEY` | AI features |
| `RUNNING_CAPACITY` | Max concurrent tests (default: 2) |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Connection timeout | Ensure ports 80/443 are open on firewall |
| OAuth error | Verify callback URL matches exactly |
| Status pages redirect to login | Set `STATUS_PAGE_DOMAIN` |
