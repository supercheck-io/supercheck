# Database Seeding Guide

## Overview

Database seeding in Supercheck is handled separately from migrations to prevent accidental deletion of seed data during migration cleanup. Seed files contain initial data that should be populated after the database schema is created.

## Seed File Organization

### Location
- **Seed Directory**: `src/db/seeds/`
- **Seed Script**: `scripts/seed.js`

### Naming Convention
Seed files should follow the pattern: `{name}.seed.sql`
- Example: `plan-limits.seed.sql`

### Available Seed Files

#### plan-limits.seed.sql
Populates the `plan_limits` table with default subscription plan configurations:
- **Plus Plan**: Basic limits for small teams
- **Pro Plan**: Enhanced limits for growing organizations  
- **Unlimited Plan**: No restrictions (for self-hosted deployments)

## Running Seeds

### Development
```bash
# Run seeds manually
npm run db:seed
```

### Production
```bash
# Seeds run automatically after migrations
npm run db:migrate:prod
```

### After Migration
```bash
# Complete setup (migrations + seeds)
npm run db:migrate
npm run db:seed
```

## Seed Script Features

- **Idempotent**: Can be run multiple times safely
- **Error Handling**: Continues even if individual statements fail
- **Logging**: Clear output showing which seeds are applied
- **Auto-discovery**: Automatically finds all `.seed.sql` files

## Integration with Migrations

The production migration script (`scripts/db-migrate.js`) automatically runs seeds after successful migrations. This ensures:
1. Database schema is up to date
2. Seed data is populated
3. Deployment is atomic (fails if either migrations or seeds fail)

## Best Practices

1. **Keep seeds separate from migrations** - Prevents accidental data loss
2. **Use descriptive names** - Makes it clear what each seed does
3. **Make seeds idempotent** - Use `INSERT ... ON CONFLICT` or check existence
4. **Document dependencies** - Note if seeds depend on specific migrations
5. **Version control seeds** - Track changes to seed data over time

## Adding New Seeds

1. Create a new `.seed.sql` file in `src/db/seeds/`
2. Write SQL statements using semicolons as separators
3. Test with `npm run db:seed`
4. Commit changes

Example seed file:
```sql
-- Insert default categories
INSERT INTO categories (id, name, created_at) VALUES
  (uuidv7(), 'General', NOW()),
  (uuidv7(), 'Critical', NOW())
ON CONFLICT (name) DO NOTHING;
```
