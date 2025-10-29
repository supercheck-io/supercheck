# OSS and Enterprise Strategy for Supercheck

## Objectives

- Open-source the Supercheck core while retaining proprietary SaaS/enterprise features.
- Keep schema and runtime differences manageable across the Next.js app, NestJS worker, and shared infrastructure.
- Provide a sustainable release workflow that supports both public contributors and a private commercial roadmap.

## Project Structure Highlights

- `app/`: Next.js dashboard with Drizzle ORM migrations, BullMQ integration, and scheduling logic.
- `worker/`: NestJS job runner executing Playwright tests and accessing shared storage/queues.
- `specs/`, `guides/`, `docs/`: Extensive product documentation and operational playbooks.
- Shared tooling via Docker Compose, scripts, and environment conventions.

This split already encourages a layered architecture where most enterprise features can be implemented as additive modules rather than core rewrites.

## Separation Principles

- **Feature Modularity**: Wrap enterprise-only logic (billing, quotas, AI provider integrations) behind TypeScript interfaces or feature flags so the core code paths remain usable without private modules.
- **Infrastructure Overrides**: Use `.env` templates and config loaders that default to OSS-friendly services; load enterprise secrets only when present.
- **Migration Segmentation**: Keep open-source schema in the public repo; store enterprise migrations in a private directory that runs after the core migrations.
- **Shared Contracts**: Version shared TypeScript types (`@superset/shared` style package) to avoid schema drift between app and worker.
- **Security Posture**: Ensure no secrets or proprietary endpoints leak into the public repo; treat enterprise-only credentials or Stripe keys as private configuration artifacts.

## Repository Strategy Options

### Option A — Single Repo with Private Modules
- **Approach**: Public repo contains full code. Enterprise features live in private packages pulled via Git submodule or private npm registry.
- **Pros**: One source of truth; simpler merges; contributors see the entire code path.
- **Cons**: Harder to guard schema changes; risk of leaking private modules; CI/CD becomes complex due to mixed visibility.
- **Use When**: Enterprise layer is lightweight (e.g., UI toggles) and the team can tightly control private dependency management.

### Option B — Public Core + Private Overlay Fork (Recommended)
- **Approach**: Maintain `supercheck-core` as the authoritative OSS repo. Create a private enterprise fork (`supercheck-enterprise`) that tracks `main` while adding private directories (`enterprise/`, `billing/`, extra migrations).
- **Pros**: Core remains clean and fully open; enterprise schema lives privately; familiar Git workflow (rebase/merge); easy to publish tagged releases from the core.
- **Cons**: Requires disciplined upstream sync; merge conflicts must be resolved in private fork.
- **Use When**: Enterprise features include significant schema, queue, or billing changes that you do not want exposed publicly.

### Option C — Split Repos with Shared Package Distribution
- **Approach**: Extract reusable logic into published packages (e.g., `@supercheck/core`, `@supercheck/worker-shared`). Public repo consumes published core; enterprise repo pulls the same packages plus closed-source ones.
- **Pros**: Clean dependency boundaries; enables customers to self-host by installing packages; enterprise code is fully isolated.
- **Cons**: Higher upfront cost to modularize; complex versioning across packages; requires maintaining package registry.
- **Use When**: Long-term goal is broad ecosystem adoption with plugin-like extensions.

## Recommended Hybrid Workflow

1. **Primary Repos**
   - Keep `supercheck-core` as the open repo containing the app, worker, base migrations, and documentation.
   - Maintain `supercheck-enterprise` as a private fork that adds an `enterprise/` directory with:
     - Additional Next.js routes/components for billing, admin controls, AI provider toggles.
     - Enterprise-specific Drizzle migrations (e.g., Stripe tables) stored under `app/src/db/migrations/enterprise`.
     - Worker modules for advanced orchestration or SLA enforcement.

2. **Feature Flags & Interfaces**
   - Implement `lib/features.ts` (or similar) exporting capability flags.
   - Load flag defaults from environment variables. Public builds default to `false`; enterprise repo sets them to `true` via private config files.
   - Encapsulate enterprise-only logic behind interfaces so mocks or OSS-friendly fallbacks ship in the core.

3. **Migration Strategy**
   - Core repo: continue storing standard migrations under `app/src/db/migrations`.
   - Enterprise repo: add a secondary migration runner that executes `enterprise` migrations after the core set (e.g., `npm run db:migrate && npm run db:migrate:enterprise`).
   - Use Drizzle migration tables with prefixes (e.g., `enterprise__drizzle_migrations`) to avoid collisions.

4. **Release Management**
   - Tag OSS releases (e.g., `v1.0.0`) in `supercheck-core`.
   - Synchronize the private fork to the tagged commit, apply enterprise overlays, and tag as `v1.0.0-enterprise`.
   - Run CI in both repos: public CI ensures community contributions stay green; private CI validates enterprise features and migrations.

5. **Licensing & Governance**
   - Adopt a permissive license (MIT/Apache) for `supercheck-core` to encourage adoption.
   - Publish a commercial license or EULA for `supercheck-enterprise`; reference it in enterprise-only directories.
   - Document contribution guidelines clarifying which features belong in the core vs. the enterprise fork.

6. **Security & Compliance**
   - Keep Stripe keys, AI provider secrets, and SLA rules in private `.env.enterprise` templates.
   - Audit public repo for accidental references to private endpoints or pricing logic before each release.
   - Provide a hardened deployment guide in the enterprise repo (e.g., secure Redis/password policies, rate limiting).

## Next Steps

1. Formalize the fork-based workflow with a short maintainer guide.
2. Introduce feature-flag scaffolding in the core repo to ease future toggles.
3. Identify migration slices that need to move to the enterprise repo and document the execution order.
4. Update CI pipelines to mirror core tags into the enterprise release process.
