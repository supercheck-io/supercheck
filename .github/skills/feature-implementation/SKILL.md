---
name: feature-implementation
description: "Use when: implementing new features, adding CRUD functionality, creating new pages/routes/components, adding database tables, building new API endpoints, adding worker processors, extending the platform with new capabilities, or when asked to 'add a feature', 'create a new module', or 'build X'. Covers end-to-end implementation across Next.js App Router, NestJS worker, Drizzle ORM, BullMQ queues, React components, RBAC permissions, and all SuperCheck architectural conventions."
---

# SuperCheck Feature Implementation

## Implementation Workflow

### Step 0: Understand the Feature Scope

Before writing any code, classify the feature:

| Scope | Description | Layers Involved |
|-------|-------------|-----------------|
| **UI-only** | New component, page, or visual change | Components, Pages |
| **App CRUD** | New entity with create/read/update/delete | Schema, Migration, API Routes, Server Actions, Components, Pages, Hooks, RBAC, Tests |
| **App + Worker** | Feature that triggers background processing | All of App CRUD + Worker Module, Processor, Service, Queue Constants |
| **API-only** | New endpoint for CLI/external consumption | Schema, API Route, Validation, Auth, Tests |
| **Worker-only** | New background processor or execution type | Worker Module, Processor, Service, Constants, Tests |

### Step 1: Database Schema

**File**: `app/src/db/schema/{feature}.ts`

```typescript
import { pgTable, uuid, varchar, text, timestamp, boolean, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { organization, projects } from "./organization";
import { user } from "./auth";

// ── Table Definition ──────────────────────────────────────────────
export const features = pgTable("features", {
  // Primary key — always UUIDv7 for time-ordered IDs
  id: uuid("id").primaryKey().$defaultFn(() => sql`uuidv7()`),

  // Multi-tenant scoping — MANDATORY on every entity
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),

  // Ownership tracking
  createdByUserId: uuid("created_by_user_id")
    .references(() => user.id, { onDelete: "no action" }),

  // Feature-specific fields
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 50 }).$type<FeatureStatus>().notNull().default("active"),
  config: jsonb("config").$type<FeatureConfig>(),
  enabled: boolean("enabled").notNull().default(true),

  // Timestamps — always include both
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at"),
}, (table) => ({
  // Index on tenant columns — always add this
  projectOrgIdx: index("features_project_org_idx").on(table.projectId, table.organizationId),
  // Unique constraint — add if business logic requires uniqueness
  uniqueNameIdx: uniqueIndex("features_project_name_idx").on(table.projectId, table.name),
  // Additional indexes on frequently filtered/sorted columns
  statusIdx: index("features_status_idx").on(table.projectId, table.organizationId, table.status),
}));

// ── Related table (if needed) ────────────────────────────────────
export const featureResults = pgTable("feature_results", {
  id: uuid("id").primaryKey().$defaultFn(() => sql`uuidv7()`),
  featureId: uuid("feature_id")
    .notNull()
    .references(() => features.id, { onDelete: "cascade" }),
  // ... result-specific fields
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  featureIdx: index("feature_results_feature_idx").on(table.featureId),
}));

// ── Zod Schemas ──────────────────────────────────────────────────
export const insertFeatureSchema = createInsertSchema(features);
export const selectFeatureSchema = createSelectSchema(features);

// ── TypeScript Types ─────────────────────────────────────────────
export type Feature = typeof features.$inferSelect;
export type NewFeature = typeof features.$inferInsert;
```

**Checklist:**
- [ ] UUIDs use `$defaultFn(() => sql\`uuidv7()\`)`
- [ ] `organizationId` + `projectId` with `onDelete: "cascade"` on both
- [ ] Foreign keys have proper `references()` and `onDelete` behavior
- [ ] Indexes on `(projectId, organizationId)` at minimum
- [ ] Unique constraints where business logic requires it
- [ ] `createdAt` with `defaultNow()`, `updatedAt` nullable
- [ ] Zod schemas generated with `createInsertSchema()` / `createSelectSchema()`
- [ ] Types exported: `Feature` (select) and `NewFeature` (insert)
- [ ] Schema exported from `app/src/db/schema/index.ts`

**Export from index:**
```typescript
// app/src/db/schema/index.ts
export * from "./feature";
```

### Step 2: Generate Migration

```bash
cd app
npm run db:generate    # Creates migration file in src/server/db/migrations/
npm run db:migrate     # Applies migration to database
```

**Migration checklist:**
- [ ] Migration file generated and present in `src/server/db/migrations/`
- [ ] New NOT NULL columns on existing tables have DEFAULT values
- [ ] No accidental `DROP TABLE` or `DROP COLUMN`
- [ ] Migration tested locally with `npm run db:migrate`

### Step 3: Input Validation Schemas

**File**: `app/src/lib/validations/{feature}.ts`

```typescript
import { z } from "zod";

// ── Create Schema ────────────────────────────────────────────────
export const createFeatureSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(255, "Name must be 255 characters or less")
    .trim(),
  description: z.string().max(2000).optional(),
  config: z.object({
    timeout: z.number().min(1).max(300).default(30),
    retries: z.number().min(0).max(5).default(0),
  }).optional(),
  enabled: z.boolean().default(true),
});

// ── Update Schema (partial, with id) ─────────────────────────────
export const updateFeatureSchema = createFeatureSchema.partial().extend({
  id: z.string().uuid("Invalid feature ID"),
});

// ── Type Inference ───────────────────────────────────────────────
export type CreateFeatureData = z.infer<typeof createFeatureSchema>;
export type UpdateFeatureData = z.infer<typeof updateFeatureSchema>;
```

**Conventions:**
- Centralize in `app/src/lib/validations/`
- Include human-readable error messages
- Use `.trim()` on string fields
- Export inferred types
- Create partial schema for updates
- Use `.uuid()` for ID validation

### Step 4: RBAC Permissions

**File**: `app/src/lib/rbac/permissions-client.ts` (add resource)

```typescript
// Add new resource to the statements object
export const statements = {
  // ... existing resources
  feature: ["create", "update", "delete", "view"] as const,
} as const;
```

**File**: `app/src/lib/rbac/permissions.ts` (add role mappings)

```typescript
// Add permissions for each role
const rolePermissions = {
  [Role.ORG_OWNER]: {
    feature: ["create", "update", "delete", "view"],
  },
  [Role.ORG_ADMIN]: {
    feature: ["create", "update", "delete", "view"],
  },
  [Role.PROJECT_ADMIN]: {
    feature: ["create", "update", "delete", "view"],
  },
  [Role.PROJECT_EDITOR]: {
    feature: ["create", "update", "view"],
  },
  [Role.PROJECT_VIEWER]: {
    feature: ["view"],
  },
};
```

**Checklist:**
- [ ] Resource added to `statements` in `permissions-client.ts`
- [ ] Role mappings added in `permissions.ts`
- [ ] Client-safe code imports from `permissions-client.ts`
- [ ] Server code imports from `permissions.ts`

### Step 5: Server Actions

**File**: `app/src/actions/create-{feature}.ts`

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/utils/db";
import { features } from "@/db/schema";
import { requireProjectContext } from "@/lib/project-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { createFeatureSchema, type CreateFeatureData } from "@/lib/validations/feature";

type CreateFeatureResult = {
  success: boolean;
  data?: { id: string };
  message?: string;
  error?: string;
};

export async function createFeature(input: CreateFeatureData): Promise<CreateFeatureResult> {
  console.log(`[CREATE_FEATURE] Starting...`);

  try {
    // 1. Auth + project context
    const { userId, project, organizationId } = await requireProjectContext();

    // 2. Permission check (inside try/catch, return error — never throw)
    const canCreate = checkPermissionWithContext("feature", "create", {
      userId, organizationId, project,
    });
    if (!canCreate) {
      console.warn(`[CREATE_FEATURE] Permission denied for user ${userId}`);
      return { success: false, error: "Insufficient permissions" };
    }

    // 3. Validate input
    const validated = createFeatureSchema.parse(input);

    // 4. Database operation — scoped by projectId + organizationId
    const [feature] = await db
      .insert(features)
      .values({
        organizationId,
        projectId: project.id,
        createdByUserId: userId,
        name: validated.name,
        description: validated.description,
        config: validated.config,
        enabled: validated.enabled,
      })
      .returning({ id: features.id });

    // 5. Audit logging
    await logAuditEvent({
      userId,
      action: "feature_created",
      resource: "feature",
      resourceId: feature.id,
      metadata: { organizationId, projectId: project.id, name: validated.name },
      success: true,
    });

    // 6. Revalidate cached pages
    revalidatePath("/features");

    console.log(`[CREATE_FEATURE] Created feature ${feature.id}`);
    return { success: true, data: { id: feature.id }, message: "Feature created" };
  } catch (error) {
    console.error("[CREATE_FEATURE] Failed:", error);
    return { success: false, error: "Failed to create feature" };
  }
}
```

**File**: `app/src/actions/update-{feature}.ts`

```typescript
"use server";

import { eq, and } from "drizzle-orm";

export async function updateFeature(input: UpdateFeatureData): Promise<UpdateFeatureResult> {
  try {
    const { userId, project, organizationId } = await requireProjectContext();

    const canUpdate = checkPermissionWithContext("feature", "update", {
      userId, organizationId, project,
    });
    if (!canUpdate) {
      return { success: false, error: "Insufficient permissions" };
    }

    const validated = updateFeatureSchema.parse(input);

    // Verify ownership before update
    const [existing] = await db
      .select({ id: features.id })
      .from(features)
      .where(
        and(
          eq(features.id, validated.id),
          eq(features.projectId, project.id),
          eq(features.organizationId, organizationId)
        )
      )
      .limit(1);

    if (!existing) {
      return { success: false, error: "Feature not found" };
    }

    await db
      .update(features)
      .set({
        name: validated.name,
        description: validated.description,
        config: validated.config,
        updatedAt: new Date(),
      })
      .where(eq(features.id, validated.id));

    await logAuditEvent({
      userId,
      action: "feature_updated",
      resource: "feature",
      resourceId: validated.id,
      metadata: { organizationId },
      success: true,
    });

    revalidatePath("/features");
    revalidatePath(`/features/${validated.id}`);

    return { success: true, message: "Feature updated" };
  } catch (error) {
    console.error("[UPDATE_FEATURE] Failed:", error);
    return { success: false, error: "Failed to update feature" };
  }
}
```

**File**: `app/src/actions/delete-{feature}.ts`

```typescript
"use server";

const uuidSchema = z.string().uuid("Invalid feature ID");

export async function deleteFeature(id: string): Promise<DeleteFeatureResult> {
  try {
    const parseResult = uuidSchema.safeParse(id);
    if (!parseResult.success) {
      return { success: false, error: "Invalid feature ID" };
    }

    const { userId, project, organizationId } = await requireProjectContext();

    const canDelete = checkPermissionWithContext("feature", "delete", {
      userId, organizationId, project,
    });
    if (!canDelete) {
      return { success: false, error: "Insufficient permissions" };
    }

    // Verify ownership before delete
    const [existing] = await db
      .select({ id: features.id, name: features.name })
      .from(features)
      .where(
        and(
          eq(features.id, id),
          eq(features.projectId, project.id),
          eq(features.organizationId, organizationId)
        )
      )
      .limit(1);

    if (!existing) {
      return { success: false, error: "Feature not found" };
    }

    // Use transaction for cascading deletes beyond FK cascades
    await db.transaction(async (tx) => {
      // Clean up related resources (S3 artifacts, scheduled jobs, etc.)
      // await cleanupFeatureResources(tx, id);

      await tx.delete(features).where(eq(features.id, id));
    });

    await logAuditEvent({
      userId,
      action: "feature_deleted",
      resource: "feature",
      resourceId: id,
      metadata: { organizationId, name: existing.name },
      success: true,
    });

    revalidatePath("/features");

    return { success: true, message: "Feature deleted" };
  } catch (error) {
    console.error("[DELETE_FEATURE] Failed:", error);
    return { success: false, error: "Failed to delete feature" };
  }
}
```

**Server Action Conventions:**
- [ ] `"use server"` directive at top of file
- [ ] One action per file: `app/src/actions/{verb}-{feature}.ts`
- [ ] Explicit typed return: `{ success: boolean, data?, message?, error? }`
- [ ] Never throws to client — always returns error object
- [ ] `requireProjectContext()` for auth + scoping
- [ ] `checkPermissionWithContext()` for RBAC (preferred over `hasPermissionForUser`)
- [ ] `.parse()` input validation
- [ ] Queries scoped by `projectId` AND `organizationId`
- [ ] `logAuditEvent()` for all mutations
- [ ] `revalidatePath()` after mutations
- [ ] Console logging with `[OPERATION_NAME]` prefix
- [ ] Transaction for multi-step mutations: `db.transaction(async (tx) => {...})`

### Step 6: API Routes (for CLI / external access)

**File**: `app/src/app/api/{feature}/route.ts` (list + create)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { db } from "@/utils/db";
import { features } from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { createFeatureSchema } from "@/lib/validations/feature";

// ── LIST ──────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext();
    const canView = checkPermissionWithContext("feature", "view", context);
    if (!canView) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);

    const whereCondition = and(
      eq(features.projectId, context.project.id),
      eq(features.organizationId, context.organizationId)
    );

    const [countResult, data] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(features).where(whereCondition),
      db.select().from(features).where(whereCondition)
        .orderBy(desc(features.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
    ]);

    const total = Number(countResult[0]?.count || 0);

    return NextResponse.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[API_FEATURES_LIST] Error:", error);
    return NextResponse.json({ error: "Failed to fetch features" }, { status: 500 });
  }
}

// ── CREATE ────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const context = await requireAuthContext();
    const canCreate = checkPermissionWithContext("feature", "create", context);
    if (!canCreate) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const body = createFeatureSchema.parse(await request.json());

    const [feature] = await db
      .insert(features)
      .values({
        organizationId: context.organizationId,
        projectId: context.project.id,
        createdByUserId: context.userId,
        ...body,
      })
      .returning();

    return NextResponse.json({ success: true, data: feature }, { status: 201 });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[API_FEATURES_CREATE] Error:", error);
    return NextResponse.json({ error: "Failed to create feature" }, { status: 500 });
  }
}
```

**File**: `app/src/app/api/{feature}/[id]/route.ts` (get, update, delete)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const idSchema = z.string().uuid();

// ── GET BY ID ─────────────────────────────────────────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await requireAuthContext();
    const { id } = await params; // Next.js App Router: params is a Promise

    const parseResult = idSchema.safeParse(id);
    if (!parseResult.success) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    const canView = checkPermissionWithContext("feature", "view", context);
    if (!canView) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const [feature] = await db
      .select()
      .from(features)
      .where(
        and(
          eq(features.id, id),
          eq(features.projectId, context.project.id),
          eq(features.organizationId, context.organizationId)
        )
      )
      .limit(1);

    if (!feature) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: feature });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to fetch feature" }, { status: 500 });
  }
}

// ── UPDATE ────────────────────────────────────────────────────────
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await requireAuthContext();
    const { id } = await params;

    const canUpdate = checkPermissionWithContext("feature", "update", context);
    if (!canUpdate) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const body = updateFeatureSchema.parse(await request.json());

    // Verify ownership
    const [existing] = await db
      .select({ id: features.id })
      .from(features)
      .where(
        and(
          eq(features.id, id),
          eq(features.projectId, context.project.id),
          eq(features.organizationId, context.organizationId)
        )
      )
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [updated] = await db
      .update(features)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(features.id, id))
      .returning();

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to update feature" }, { status: 500 });
  }
}

// ── DELETE ─────────────────────────────────────────────────────────
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await requireAuthContext();
    const { id } = await params;

    const canDelete = checkPermissionWithContext("feature", "delete", context);
    if (!canDelete) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const [existing] = await db
      .select({ id: features.id })
      .from(features)
      .where(
        and(
          eq(features.id, id),
          eq(features.projectId, context.project.id),
          eq(features.organizationId, context.organizationId)
        )
      )
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db.delete(features).where(eq(features.id, id));

    return NextResponse.json({ success: true, message: "Deleted" });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to delete feature" }, { status: 500 });
  }
}
```

**API Route Conventions:**
- [ ] `requireAuthContext()` or `requireProjectContext()` for auth
- [ ] `params` awaited (Next.js App Router: `const { id } = await params`)
- [ ] ID parameters validated with Zod
- [ ] `checkPermissionWithContext()` before any data access
- [ ] All queries scoped by `projectId` AND `organizationId`
- [ ] `isAuthError()` → 401, validation error → 400, not found → 404, internal → 500
- [ ] Response format: `{ success, data, error, pagination? }`
- [ ] Pagination with page/limit clamped: `Math.min(limit, 100)`
- [ ] Count + data queries run in parallel with `Promise.all`
- [ ] Error messages don't expose internals

### Step 7: React Query Hook

**File**: `app/src/hooks/use-{feature}s.ts`

```typescript
import { createDataHook } from "./lib/create-data-hook";
import type { Feature } from "@/db/schema";
import type { CreateFeatureData, UpdateFeatureData } from "@/lib/validations/feature";

export const FEATURES_QUERY_KEY = ["features"] as const;

const featuresHook = createDataHook<Feature, CreateFeatureData, UpdateFeatureData>({
  queryKey: FEATURES_QUERY_KEY,
  endpoint: "/api/features",
  staleTime: 30 * 1000, // 30 seconds
});

export function useFeatures() {
  const { data, isLoading, isRestoring, invalidate, error } = featuresHook.useQuery({});

  return {
    features: data?.data || [],
    pagination: data?.pagination,
    isLoading,
    isRestoring,
    invalidate,
    error,
  };
}

export function useFeature(id: string) {
  const { data, isLoading, error } = featuresHook.useQueryById(id);

  return {
    feature: data?.data || null,
    isLoading,
    error,
  };
}
```

**Hook Conventions:**
- [ ] Query key exported as const array
- [ ] Use `createDataHook` factory pattern
- [ ] Expose `invalidate` for cache refresh after mutations
- [ ] Default empty array for list data: `data?.data || []`
- [ ] `staleTime` set (30s is standard)

### Step 8: React Components

#### Component Directory Structure
```
app/src/components/{feature}/
├── index.tsx              # Main list/manager component
├── {feature}-dialog.tsx   # Create/edit dialog
├── data-table.tsx         # Data table wrapper
├── columns.tsx            # Table column definitions
├── schema.ts              # Client-side Zod schema (for table filtering)
└── {feature}-detail.tsx   # Detail view (if needed)
```

#### Columns Definition

**File**: `app/src/components/{feature}/columns.tsx`

```typescript
"use client";

import { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { Feature } from "@/db/schema";

export const columns: ColumnDef<Feature>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
    cell: ({ row }) => (
      <span className="font-medium">{row.getValue("name")}</span>
    ),
  },
  {
    accessorKey: "status",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => {
      const status = row.getValue("status") as string;
      return (
        <Badge variant={status === "active" ? "default" : "secondary"}>
          {status}
        </Badge>
      );
    },
    filterFn: (row, id, value) => value.includes(row.getValue(id)),
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
    cell: ({ row }) => {
      const date = new Date(row.getValue("createdAt"));
      return <span>{date.toLocaleDateString()}</span>;
    },
  },
  // Actions column — see data-table for meta.onDelete pattern
];
```

#### Data Table

**File**: `app/src/components/{feature}/data-table.tsx`

```typescript
"use client";

import { useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  type ColumnFiltersState,
} from "@tanstack/react-table";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  isLoading?: boolean;
  onRowClick?: (row: Row<TData>) => void;
  meta?: { onDelete?: (id: string) => void };
}

export function DataTable<TData, TValue>({
  columns, data, isLoading, onRowClick, meta,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 12 });

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting, columnFilters, pagination },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: setPagination,
    meta,
  });

  if (isLoading) return <DataTableSkeleton columns={columns.length} rows={5} />;

  return (
    <>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map(/* render headers */)}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map(/* render rows */)}
        </TableBody>
      </Table>
      <DataTablePagination table={table} />
    </>
  );
}
```

#### Create/Edit Dialog

**File**: `app/src/components/{feature}/{feature}-dialog.tsx`

```typescript
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { createFeatureSchema, type CreateFeatureData } from "@/lib/validations/feature";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface FeatureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feature?: Feature | null;     // null = create mode, object = edit mode
  onSuccess: () => void;        // Trigger parent refresh
}

export function FeatureDialog({ open, onOpenChange, feature, onSuccess }: FeatureDialogProps) {
  const [loading, setLoading] = useState(false);
  const isEditing = !!feature;

  const form = useForm<CreateFeatureData>({
    resolver: zodResolver(createFeatureSchema),
    defaultValues: {
      name: feature?.name || "",
      description: feature?.description || "",
      enabled: feature?.enabled ?? true,
    },
  });

  const handleSubmit = async (data: CreateFeatureData) => {
    setLoading(true);
    try {
      // Use server action for form submissions
      const result = isEditing
        ? await updateFeature({ id: feature.id, ...data })
        : await createFeature(data);

      if (result.success) {
        toast.success(isEditing ? "Feature updated" : "Feature created");
        onSuccess();
        onOpenChange(false);
        form.reset();
      } else {
        toast.error(result.error || "Operation failed");
      }
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit" : "Create"} Feature</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Feature name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {/* Add more FormField blocks for each field */}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Saving..." : isEditing ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

#### Main List Component

**File**: `app/src/components/{feature}/index.tsx`

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useFeatures } from "@/hooks/use-features";
import { deleteFeature } from "@/actions/delete-feature";
import { DataTable } from "./data-table";
import { columns } from "./columns";
import { FeatureDialog } from "./feature-dialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function FeaturesList() {
  const router = useRouter();
  const { features, isLoading, isRestoring, invalidate } = useFeatures();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingFeature, setEditingFeature] = useState<Feature | null>(null);

  const handleRowClick = (row: Row<Feature>) => {
    router.push(`/features/${row.original.id}`);
  };

  const handleDelete = async (id: string) => {
    const result = await deleteFeature(id);
    if (result.success) {
      toast.success("Feature deleted");
      invalidate();
    } else {
      toast.error(result.error || "Failed to delete");
    }
  };

  const handleSuccess = () => {
    invalidate(); // Refresh the query cache
  };

  if (!isRestoring) return <DataTableSkeleton columns={4} rows={5} />;

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Features</h2>
        <Button onClick={() => { setEditingFeature(null); setDialogOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" /> Create Feature
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={features}
        isLoading={isLoading}
        onRowClick={handleRowClick}
        meta={{ onDelete: handleDelete }}
      />

      <FeatureDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        feature={editingFeature}
        onSuccess={handleSuccess}
      />
    </>
  );
}
```

**Component Conventions:**
- [ ] `"use client"` only on interactive components
- [ ] Forms use React Hook Form + `zodResolver`
- [ ] Toast via `sonner`: `toast.success()`, `toast.error()`
- [ ] Loading: `<DataTableSkeleton>` or `<Loader2 className="animate-spin" />`
- [ ] Dialogs: controlled via `open`/`onOpenChange` props
- [ ] Create + Edit in same dialog (driven by `feature` prop being null or object)
- [ ] `invalidate()` from hook after mutations to refresh cache
- [ ] `useRouter().push()` for navigation
- [ ] Icons from `lucide-react`
- [ ] UI components from `@/components/ui/` (shadcn/ui)

### Step 9: Pages

#### List Page

**File**: `app/src/app/(main)/{feature}/page.tsx`

```typescript
import FeaturesList from "@/components/features";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";

export default function FeaturesPage() {
  return (
    <div>
      <PageBreadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Features", isCurrentPage: true },
        ]}
      />
      <Card>
        <CardContent>
          <FeaturesList />
        </CardContent>
      </Card>
    </div>
  );
}
```

#### Detail Page (Server Component with data fetching)

**File**: `app/src/app/(main)/{feature}/[id]/page.tsx`

```typescript
import { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/utils/db";
import { features } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireProjectContext } from "@/lib/project-context";
import { FeatureDetailClient } from "@/components/features/feature-detail-client";

// Server-side data fetching with tenant scoping
async function getFeature(id: string) {
  const { project, organizationId } = await requireProjectContext();

  const [feature] = await db
    .select()
    .from(features)
    .where(
      and(
        eq(features.id, id),
        eq(features.projectId, project.id),
        eq(features.organizationId, organizationId)
      )
    )
    .limit(1);

  return feature || null;
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  const { id } = await params;
  const feature = await getFeature(id);
  return { title: feature?.name || "Feature" };
}

export default async function FeatureDetailPage(
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const feature = await getFeature(id);

  if (!feature) notFound();

  return <FeatureDetailClient feature={feature} />;
}
```

#### Loading Page

**File**: `app/src/app/(main)/{feature}/loading.tsx`

```typescript
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";

export default function Loading() {
  return <DataTableSkeleton columns={4} rows={5} />;
}
```

### Step 10: Navigation

**File**: `app/src/components/nav-main.tsx` (add nav item)

Add the new feature to the navigation items array:

```typescript
{
  title: "Features",
  url: "/features",
  icon: IconComponent, // from lucide-react
}
```

### Step 11: Self-Hosted / Cloud Feature Gating

**File**: `app/src/lib/feature-flags.ts`

```typescript
// If the feature needs different behavior in self-hosted vs cloud:
export function isFeatureEnabled(): boolean {
  return isSelfHosted() || hasActiveSubscription();
}

// For plan-limited features:
export function getFeatureLimit(plan: string): number {
  if (isSelfHosted()) return Infinity;
  switch (plan) {
    case "plus": return 10;
    case "pro": return 50;
    default: return 3;
  }
}
```

**Self-hosted conventions:**
- `SELF_HOSTED` is `"true"` or `"1"` (string comparison)
- Self-hosted mode: no billing, no email verification, no CAPTCHA, unlimited limits
- New features should work in both modes unless explicitly scoped

### Step 12: Plan Limit Enforcement (Cloud)

If the feature has plan-based limits:

**File**: `app/src/lib/middleware/plan-enforcement.ts` (add check function)

```typescript
export async function checkFeatureLimit(
  organizationId: string,
  currentCount: number
): Promise<{ allowed: boolean; error?: string }> {
  if (isSelfHosted()) return { allowed: true };

  const plan = await getOrganizationPlan(organizationId);
  const limit = getFeatureLimit(plan);

  if (currentCount >= limit) {
    return {
      allowed: false,
      error: `Feature limit reached (${limit}). Upgrade your plan.`,
    };
  }

  return { allowed: true };
}
```

Call this in both server actions and API routes before creating new resources.

---

## Worker Integration (for features that need background processing)

### Step W1: Queue Constants

**File**: `app/src/lib/queue.ts` (add queue name)

```typescript
// Fixed queue name (for global queues)
export const FEATURE_QUEUE = "feature-global";

// OR: location-based queue name builder
export function featureQueueName(locationCode: string): string {
  return `feature-${locationCode}`;
}
```

**Synchronize** the same constants in:
- `worker/src/{feature}/{feature}.constants.ts`

```typescript
export const FEATURE_QUEUE = "feature-global";
// Must match app/src/lib/queue.ts exactly
```

### Step W2: Job DTO

**File**: `worker/src/{feature}/dto/{feature}-job.dto.ts`

```typescript
export class FeatureJobDto {
  featureId: string;
  projectId: string;
  organizationId: string;
  config: FeatureConfig;
  variables?: Record<string, string>;
  secrets?: Record<string, string>;
}
```

### Step W3: Worker Module

**File**: `worker/src/{feature}/{feature}.module.ts`

```typescript
import { Module, DynamicModule, Logger } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { DbModule } from "../db/db.module";
import { FEATURE_QUEUE } from "./{feature}.constants";
import { FeatureService } from "./{feature}.service";
import { FeatureProcessor } from "./processors/{feature}.processor";

@Module({})
export class FeatureModule {
  private static readonly logger = new Logger("FeatureModule");

  static forRoot(): DynamicModule {
    const workerLocation = (process.env.WORKER_LOCATION || "local").toLowerCase();
    const queueNames = FeatureModule.getQueueNames(workerLocation);

    FeatureModule.logger.log(`Registering queues: ${queueNames.join(", ")}`);

    return {
      module: FeatureModule,
      imports: [
        BullModule.registerQueue(
          ...queueNames.map((name) => ({ name })),
        ),
        DbModule,
      ],
      providers: [FeatureService, FeatureProcessor],
      exports: [FeatureService],
    };
  }

  private static getQueueNames(location: string): string[] {
    // Global queue — same for all locations
    return [FEATURE_QUEUE];
    // OR: location-based
    // return [`feature-${location}`];
  }
}
```

### Step W4: Worker Processor

**File**: `worker/src/{feature}/processors/{feature}.processor.ts`

```typescript
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { FEATURE_QUEUE } from "../{feature}.constants";
import { FeatureService } from "../{feature}.service";
import { FeatureJobDto } from "../dto/{feature}-job.dto";

@Processor(FEATURE_QUEUE, { concurrency: 1 }) // Concurrency stays at 1, scale via replicas
export class FeatureProcessor extends WorkerHost {
  private readonly logger = new Logger(FeatureProcessor.name);

  constructor(private readonly featureService: FeatureService) {
    super();
  }

  async process(job: Job<FeatureJobDto>): Promise<void> {
    const { featureId, projectId } = job.data;
    this.logger.log(`[${featureId}] Processing feature job ${job.id}`);

    try {
      await this.featureService.execute(job.data);
      this.logger.log(`[${featureId}] Feature job completed`);
    } catch (error) {
      this.logger.error(`[${featureId}] Feature job failed: ${error.message}`);
      throw error; // Let BullMQ handle retries
    }
  }
}
```

### Step W5: Worker Service

**File**: `worker/src/{feature}/{feature}.service.ts`

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { DbService } from "../db/db.service";
import { FeatureJobDto } from "./dto/{feature}-job.dto";

@Injectable()
export class FeatureService {
  private readonly logger = new Logger(FeatureService.name);

  constructor(private readonly dbService: DbService) {}

  async execute(jobData: FeatureJobDto): Promise<void> {
    const { featureId, projectId } = jobData;
    this.logger.log(`[${featureId}] Starting execution`);

    try {
      // 1. Fetch additional data from DB if needed
      // 2. Execute the feature logic
      // 3. Store results
      // 4. Update status in DB

      this.logger.log(`[${featureId}] Execution complete`);
    } catch (error) {
      this.logger.error(`[${featureId}] Execution failed: ${error.message}`);
      // Update status to failed in DB
      throw error;
    }
  }
}
```

### Step W6: Register Module

**File**: `worker/src/app.module.ts`

```typescript
@Module({
  imports: [
    // ... existing modules
    FeatureModule.forRoot(),
  ],
})
export class AppModule {}
```

**Worker Conventions:**
- [ ] `@Processor(QUEUE_NAME, { concurrency: 1 })` — concurrency stays at 1
- [ ] Structured logging: `this.logger.log()`, `.warn()`, `.error()` — not `console.log`
- [ ] Logger instance: `new Logger(ClassName.name)`
- [ ] Error handling: catch, log, then re-throw for BullMQ retry
- [ ] Use `resolveWorkerDir()` / `resolveBrowsersPath()` for paths — not hardcoded
- [ ] Dependencies injected via constructor
- [ ] Services decorated with `@Injectable()`
- [ ] Module registered in `app.module.ts`

---

## Enqueuing Jobs from the App

**File**: `app/src/lib/services/{feature}-service.ts` or inline in server action

```typescript
import { getQueue } from "@/lib/queue-manager";
import { FEATURE_QUEUE } from "@/lib/queue";

export async function enqueueFeatureJob(data: FeatureJobData) {
  const queue = await getQueue(FEATURE_QUEUE);

  await queue.add("feature-execute", {
    featureId: data.featureId,
    projectId: data.projectId,
    organizationId: data.organizationId,
    config: data.config,
  }, {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 },
  });
}
```

---

## Testing

### Unit Tests (Server Actions / Utils)

**File**: `app/src/actions/create-{feature}.spec.ts`

```typescript
import { createFeature } from "./create-feature";

// Mock dependencies BEFORE imports
jest.mock("@/utils/db", () => ({
  db: { insert: jest.fn(), select: jest.fn() },
}));
jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(),
}));
jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: jest.fn(),
}));
jest.mock("@/lib/audit-logger", () => ({
  logAuditEvent: jest.fn(),
}));
jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
}));

describe("createFeature", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should create feature when user has permission", async () => {
    // Arrange
    (requireProjectContext as jest.Mock).mockResolvedValue({
      userId: "user-1",
      project: { id: "proj-1" },
      organizationId: "org-1",
    });
    (checkPermissionWithContext as jest.Mock).mockReturnValue(true);
    // ... mock db

    // Act
    const result = await createFeature({ name: "Test Feature" });

    // Assert
    expect(result.success).toBe(true);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "feature_created" })
    );
  });

  it("should return error when permission denied", async () => {
    (requireProjectContext as jest.Mock).mockResolvedValue({
      userId: "user-1", project: { id: "proj-1" }, organizationId: "org-1",
    });
    (checkPermissionWithContext as jest.Mock).mockReturnValue(false);

    const result = await createFeature({ name: "Test" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("permissions");
  });

  it("should return error for invalid input", async () => {
    const result = await createFeature({ name: "" }); // fails Zod validation
    expect(result.success).toBe(false);
  });
});
```

### Worker Tests

**File**: `worker/src/{feature}/{feature}.service.spec.ts`

```typescript
describe("FeatureService", () => {
  let service: FeatureService;
  let dbService: jest.Mocked<DbService>;

  beforeEach(() => {
    jest.clearAllMocks();
    dbService = { /* mocked methods */ } as jest.Mocked<DbService>;
    service = new FeatureService(dbService);
  });

  it("should execute feature job successfully", async () => {
    // Arrange, Act, Assert
  });

  it("should throw on execution failure", async () => {
    await expect(service.execute(invalidJobData)).rejects.toThrow();
  });
});
```

### E2E Tests

**File**: `app/e2e/tests/{feature}/{feature}.spec.ts`

```typescript
import { test, expect } from "@playwright/test";
import { loginIfNeeded } from "../helpers";

test.describe("Features", () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test("creates a feature", async ({ page }) => {
    await page.goto("/features");
    await page.click("text=Create Feature");
    await page.fill('[name="name"]', "Test Feature");
    await page.click("text=Create");
    await expect(page.locator("text=Feature created")).toBeVisible();
  });

  test("deletes a feature", async ({ page }) => {
    // ...
  });
});
```

**Testing Conventions:**
- [ ] Mocks set up BEFORE imports (`jest.mock()` hoisting)
- [ ] `jest.clearAllMocks()` in `beforeEach()`
- [ ] Test both happy path and error cases
- [ ] Descriptive names: `should [behavior] when [condition]`
- [ ] E2E: `loginIfNeeded()` in `beforeEach`, no shared auth state
- [ ] Worker tests mock DB and external services

---

## Implementation Checklist

Use this checklist when implementing any new feature:

### Database Layer
- [ ] Schema file created: `app/src/db/schema/{feature}.ts`
- [ ] Multi-tenant columns: `organizationId` + `projectId` with cascading deletes
- [ ] UUIDv7 primary keys
- [ ] Indexes on `(projectId, organizationId)` and filtered columns
- [ ] Zod schemas: `createInsertSchema()`, `createSelectSchema()`
- [ ] Types exported: `Feature`, `NewFeature`
- [ ] Re-exported from `app/src/db/schema/index.ts`
- [ ] Migration generated: `npm run db:generate`
- [ ] Migration applied: `npm run db:migrate`

### Validation Layer
- [ ] Validation schemas: `app/src/lib/validations/{feature}.ts`
- [ ] Create + Update schemas with error messages
- [ ] Types exported via `z.infer<>`

### Auth / RBAC Layer
- [ ] Resource added to `permissions-client.ts` statements
- [ ] Role mappings added to `permissions.ts`
- [ ] CRUD actions: create, update, delete, view (add `view_secrets` if applicable)

### Server Actions
- [ ] `create-{feature}.ts` — with validation, scoping, audit, revalidation
- [ ] `update-{feature}.ts` — with ownership verification
- [ ] `delete-{feature}.ts` — with ownership verification, cascading cleanup

### API Routes
- [ ] `api/{feature}/route.ts` — GET (list with pagination) + POST (create)
- [ ] `api/{feature}/[id]/route.ts` — GET + PUT + DELETE with scoping
- [ ] Auth: `requireAuthContext()` + `checkPermissionWithContext()`
- [ ] All queries scoped by `projectId` AND `organizationId`

### UI Layer
- [ ] Components directory: `components/{feature}/`
- [ ] Column definitions, data table, create/edit dialog
- [ ] Main list component using React Query hook
- [ ] React Query hook: `hooks/use-{feature}s.ts`
- [ ] List page: `app/(main)/{feature}/page.tsx`
- [ ] Detail page: `app/(main)/{feature}/[id]/page.tsx`
- [ ] Loading skeleton: `app/(main)/{feature}/loading.tsx`
- [ ] Navigation entry in `nav-main.tsx`

### Worker (if applicable)
- [ ] Queue constants synchronized: `app/src/lib/queue.ts` + `worker/src/{feature}/{feature}.constants.ts`
- [ ] Job DTO: `worker/src/{feature}/dto/{feature}-job.dto.ts`
- [ ] Module: `worker/src/{feature}/{feature}.module.ts`
- [ ] Processor: `worker/src/{feature}/processors/{feature}.processor.ts` (concurrency: 1)
- [ ] Service: `worker/src/{feature}/{feature}.service.ts`
- [ ] Module registered in `worker/src/app.module.ts`

### Testing
- [ ] Unit tests for server actions
- [ ] Unit tests for worker service (if applicable)
- [ ] E2E tests for critical flows

### Cross-Cutting
- [ ] Works in both self-hosted and cloud modes
- [ ] Plan limits enforced (cloud only)
- [ ] Audit logging for all mutations
- [ ] No `any` types, no hardcoded secrets
- [ ] Lint passes: `npm run lint`
- [ ] Build passes: `npm run build`
- [ ] Tests pass: `npm test`

---

## Quick Commands Reference

```bash
# App
npm run db:generate             # Generate migration from schema changes
npm run db:migrate              # Apply pending migrations
npm run db:studio               # Visual DB explorer
npm run lint                    # ESLint
npm run build                   # Type check + build
npm test                        # Jest unit tests
npm run e2e                     # Playwright E2E

# Worker
npm run lint
npm run build
npm test

# Single test file
npm test -- src/actions/create-feature.spec.ts           # App
npm test -- src/feature/feature.service.spec.ts           # Worker
```
