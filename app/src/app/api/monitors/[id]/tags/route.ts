import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import { monitors, monitorTags, tags } from "@/db/schema";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import { isUuid } from "@/lib/uuid";
import { logAuditEvent } from "@/lib/audit-logger";
import { MAX_TAGS_PER_ENTITY, TagLimitError, tagPatchSchema } from "@/lib/tag-patch";

type RouteParams = { params: Promise<{ id: string }> };

const MAX_TAGS_PER_MONITOR = MAX_TAGS_PER_ENTITY;

const notFound = () => NextResponse.json({ error: "Monitor not found" }, { status: 404 });

const authFailure = (error: unknown) =>
  NextResponse.json(
    { error: error instanceof Error ? error.message : "Authentication required" },
    { status: 401 }
  );

async function monitorExists(monitorId: string, organizationId: string, projectId: string) {
  const rows = await db
    .select({ id: monitors.id })
    .from(monitors)
    .where(
      and(
        eq(monitors.id, monitorId),
        eq(monitors.organizationId, organizationId),
        eq(monitors.projectId, projectId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

async function loadTags(monitorId: string, projectId: string) {
  return db
    .select({ id: tags.id, name: tags.name, color: tags.color })
    .from(monitorTags)
    .innerJoin(tags, and(eq(monitorTags.tagId, tags.id), eq(tags.projectId, projectId)))
    .where(eq(monitorTags.monitorId, monitorId))
    .orderBy(tags.name);
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const context = await requireAuthContext();
    const { project, organizationId } = context;

    if (!checkPermissionWithContext("monitor", "view", context)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const { id: monitorId } = await params;
    if (!isUuid(monitorId)) return notFound();
    if (!(await monitorExists(monitorId, organizationId, project.id))) return notFound();

    return NextResponse.json({ tags: await loadTags(monitorId, project.id) });
  } catch (error) {
    if (isAuthError(error)) return authFailure(error);
    console.error("Error fetching monitor tags:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await requireAuthContext();
    const { project, organizationId } = context;

    if (!checkPermissionWithContext("monitor", "update", context)) {
      return NextResponse.json(
        { error: "Insufficient permissions to update monitor tags" },
        { status: 403 }
      );
    }

    const { id: monitorId } = await params;
    if (!isUuid(monitorId)) return notFound();

    let body: { tagIds?: unknown } | null;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const tagIds = body?.tagIds;

    if (!Array.isArray(tagIds)) {
      return NextResponse.json({ error: "Tag IDs must be an array" }, { status: 400 });
    }
    if (!tagIds.every((tagId): tagId is string => typeof tagId === "string" && isUuid(tagId))) {
      return NextResponse.json({ error: "Tag IDs must be valid UUIDs" }, { status: 400 });
    }

    const normalizedTagIds = Array.from(new Set(tagIds));
    if (normalizedTagIds.length !== tagIds.length) {
      return NextResponse.json({ error: "Duplicate tag IDs are not allowed" }, { status: 400 });
    }
    if (normalizedTagIds.length > MAX_TAGS_PER_MONITOR) {
      return NextResponse.json(
        { error: `Maximum of ${MAX_TAGS_PER_MONITOR} tags allowed per monitor` },
        { status: 400 }
      );
    }

    // Monitor must belong to the caller's org/project (IDOR guard)
    if (!(await monitorExists(monitorId, organizationId, project.id))) return notFound();

    // Tags must belong to the same org/project (cross-tenant guard)
    if (normalizedTagIds.length > 0) {
      const validTags = await db
        .select({ id: tags.id })
        .from(tags)
        .where(
          and(
            inArray(tags.id, normalizedTagIds),
            eq(tags.organizationId, organizationId),
            eq(tags.projectId, project.id)
          )
        );
      if (validTags.length !== normalizedTagIds.length) {
        return NextResponse.json(
          { error: "One or more tags are invalid or not accessible in this project" },
          { status: 400 }
        );
      }
    }

    // Replace semantics: remove existing, add the given set. The audit record commits with the change or not at all.
    // Same row lock as PATCH, so a concurrent PATCH cannot push past the cap.
    await db.transaction(async (tx) => {
      await tx
        .select({ id: monitors.id })
        .from(monitors)
        .where(and(eq(monitors.id, monitorId), eq(monitors.organizationId, organizationId), eq(monitors.projectId, project.id)))
        .for("update");
      await tx.delete(monitorTags).where(eq(monitorTags.monitorId, monitorId));
      if (normalizedTagIds.length > 0) {
        await tx
          .insert(monitorTags)
          .values(normalizedTagIds.map((tagId) => ({ monitorId, tagId })));
      }
      await logAuditEvent(
        {
          userId: context.userId,
          organizationId,
          action: "monitor_tags_updated",
          resource: "monitor",
          resourceId: monitorId,
          metadata: { tagIds: normalizedTagIds, projectId: project.id },
          success: true,
        },
        tx,
        { strict: true },
      );
    });

    return NextResponse.json({ tags: await loadTags(monitorId, project.id) });
  } catch (error) {
    if (isAuthError(error)) return authFailure(error);
    console.error("Error updating monitor tags:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await requireAuthContext();
    const { project, organizationId } = context;

    if (!checkPermissionWithContext("monitor", "update", context)) {
      return NextResponse.json(
        { error: "Insufficient permissions to update monitor tags" },
        { status: 403 }
      );
    }

    const { id: monitorId } = await params;
    if (!isUuid(monitorId)) return notFound();

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = tagPatchSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body: add/remove must be arrays of tag UUIDs" }, { status: 400 });
    }
    const { add, remove } = parsed.data;

    if (!(await monitorExists(monitorId, organizationId, project.id))) return notFound();

    if (add.length > 0) {
      const validTags = await db
        .select({ id: tags.id })
        .from(tags)
        .where(and(inArray(tags.id, add), eq(tags.organizationId, organizationId), eq(tags.projectId, project.id)));
      if (validTags.length !== add.length) {
        return NextResponse.json(
          { error: "One or more tags are invalid or not accessible in this project" },
          { status: 400 }
        );
      }
    }

    try {
      await db.transaction(async (tx) => {
        // Row lock serializes concurrent patches of one monitor so the cap check below cannot be raced.
        const locked = await tx
          .select({ id: monitors.id })
          .from(monitors)
          .where(and(eq(monitors.id, monitorId), eq(monitors.organizationId, organizationId), eq(monitors.projectId, project.id)))
          .for("update");
        if (locked.length === 0) throw new TagLimitError("not-found");
        if (remove.length > 0) {
          await tx
            .delete(monitorTags)
            .where(and(eq(monitorTags.monitorId, monitorId), inArray(monitorTags.tagId, remove)));
        }
        if (add.length > 0) {
          await tx
            .insert(monitorTags)
            .values(add.map((tagId) => ({ monitorId, tagId })))
            .onConflictDoNothing();
          const [{ count }] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(monitorTags)
            .where(eq(monitorTags.monitorId, monitorId));
          if (count > MAX_TAGS_PER_MONITOR) throw new TagLimitError("limit");
        }
        await logAuditEvent(
          {
            userId: context.userId,
            organizationId,
            action: "monitor_tags_updated",
            resource: "monitor",
            resourceId: monitorId,
            metadata: { add, remove, projectId: project.id },
            success: true,
          },
          tx,
          { strict: true },
        );
      });
    } catch (error) {
      if (error instanceof TagLimitError) {
        return error.message === "not-found"
          ? notFound()
          : NextResponse.json(
              { error: `Maximum of ${MAX_TAGS_PER_MONITOR} tags allowed per monitor` },
              { status: 400 }
            );
      }
      throw error;
    }

    return NextResponse.json({ tags: await loadTags(monitorId, project.id) });
  } catch (error) {
    if (isAuthError(error)) return authFailure(error);
    console.error("Error patching monitor tags:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await requireAuthContext();
    const { project, organizationId } = context;

    if (!checkPermissionWithContext("monitor", "update", context)) {
      return NextResponse.json(
        { error: "Insufficient permissions to update monitor tags" },
        { status: 403 }
      );
    }

    const { id: monitorId } = await params;
    if (!isUuid(monitorId)) return notFound();

    let body: { tagId?: unknown } | null;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const tagId = body?.tagId;
    if (typeof tagId !== "string" || !isUuid(tagId)) {
      return NextResponse.json({ error: "Tag ID is required" }, { status: 400 });
    }

    if (!(await monitorExists(monitorId, organizationId, project.id))) return notFound();

    await db.transaction(async (tx) => {
      await tx
        .delete(monitorTags)
        .where(and(eq(monitorTags.monitorId, monitorId), eq(monitorTags.tagId, tagId)));
      await logAuditEvent(
        {
          userId: context.userId,
          organizationId,
          action: "monitor_tag_removed",
          resource: "monitor",
          resourceId: monitorId,
          metadata: { tagId, projectId: project.id },
          success: true,
        },
        tx,
        { strict: true },
      );
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isAuthError(error)) return authFailure(error);
    console.error("Error removing monitor tag:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
