# Core System Documentation

This section covers the fundamental architecture, database schema, and API routes for SuperCheck.

## Files

- **[SUPERCHECK_ARCHITECTURE.md](SUPERCHECK_ARCHITECTURE.md)** - Platform architecture overview, monorepo structure, tech stack, and system components
- **[ERD_DIAGRAM.md](ERD_DIAGRAM.md)** - Entity Relationship Diagram and complete database schema
- **[API_ROUTES_ANALYSIS.md](API_ROUTES_ANALYSIS.md)** - Comprehensive API routes documentation

## Key Information

- **Monorepo Structure**: App (Next.js frontend) + Worker (job execution)
- **Frontend**: Next.js 15.4.6, React 19.1.1, TypeScript, TailwindCSS
- **Backend**: Node.js, PostgreSQL, Redis, BullMQ
- **Database**: Drizzle ORM with PostgreSQL

## Quick Links

- [Back to Specs](../README.md)
- [Authentication & Security](../02-authentication)
- [Testing & Execution](../03-execution)
