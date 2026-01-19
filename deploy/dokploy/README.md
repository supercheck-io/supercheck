# Supercheck on Dokploy

> [!WARNING]
> **🚧 Work in Progress**
> 
> Dokploy deployment is currently under development and not fully supported yet.
> 
> **Recommended:** Use [Coolify](../coolify/README.md) for self-hosting instead.

---

## Status

- ❌ OAuth with traefik.me domains (HTTP limitation)
- ✅ Custom domain with HTTPS
- ✅ All core features working

## When Complete

Once development is finalized, this will support:
- One-click deployment via Dokploy Cloud
- Automatic SSL with Let's Encrypt
- Full OAuth support with custom domains

---

## Current Workaround

If you want to test Dokploy now:

1. Use a **custom domain** with HTTPS (not traefik.me)
2. Follow the [Coolify guide](../coolify/README.md) as reference
3. Use [`dokploy.yml`](./dokploy.yml) as your compose file
