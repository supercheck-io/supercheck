import { NextResponse } from "next/server";
import { db } from "@/utils/db";
import { user, member, organization } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";

// Batch size for fetching users - keeps memory usage low
const BATCH_SIZE = 100;

// Sanitize fields to prevent CSV Injection (Excel formulas)
function sanitizeCSVField(value: string): string {
  // If value starts with =, +, -, or @, prepend a single quote to prevent formula execution
  if (/^[=\+\-@]/.test(value)) {
    return "'" + value;
  }
  return value;
}

// Helper to escape CSV values
function escapeCSV(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  let str = String(value);
  
  // Sanitize against CSV injection
  str = sanitizeCSVField(str);

  // Escape quotes and wrap in quotes if contains comma, quote, or newline
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Format date for CSV
function formatDate(date: Date | null | undefined): string {
  if (!date) return "";
  return new Date(date).toISOString();
}

// Helper to determine highest role from role array
function getHighestRoleFromList(roles: string[]): string {
  if (!roles.length) return "project_viewer";
  
  const roleHierarchy = [
    "super_admin",
    "org_owner",
    "org_admin",
    "project_admin",
    "project_editor",
    "project_viewer",
  ];

  for (const hierarchyRole of roleHierarchy) {
    if (roles.includes(hierarchyRole)) {
      return hierarchyRole;
    }
  }
  return "project_viewer";
}

export async function GET() {
  try {
    await requireAdmin();

    // Create a readable stream for the CSV
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        // Write CSV header
        const header = [
          "User ID",
          "Name",
          "Email",
          "Role",
          "Status",
          "Ban Reason",
          "Organizations",
          "Created At",
        ].join(",");
        controller.enqueue(encoder.encode(header + "\n"));

        let offset = 0;
        let hasMore = true;

        // Fetch and stream users in batches
        while (hasMore) {
          const users = await db
            .select({
              id: user.id,
              name: user.name,
              email: user.email,
              banned: user.banned,
              banReason: user.banReason,
              createdAt: user.createdAt,
            })
            .from(user)
            .orderBy(desc(user.id))
            .limit(BATCH_SIZE)
            .offset(offset);

          if (users.length === 0) {
            break;
          }

          // Optimization: Fetch all memberships for this batch in one query
          const userIds = users.map((u) => u.id);
          
          let membersData: { userId: string; role: string; orgName: string }[] = [];
          
          if (userIds.length > 0) {
            membersData = await db
              .select({
                userId: member.userId,
                role: member.role,
                orgName: organization.name,
              })
              .from(member)
              .innerJoin(organization, eq(member.organizationId, organization.id))
              .where(inArray(member.userId, userIds));
          }

          // Process users using in-memory data
          for (const u of users) {
            try {
              const userMemberships = membersData.filter(m => m.userId === u.id);
             
              // Calculate highest role from memberships
              const roles = userMemberships.map(m => m.role);
              const highestRole = getHighestRoleFromList(roles);
             
              // Format organizations string
              const orgsStr = userMemberships
                .map(m => `${m.orgName} (${m.role})`)
                .join("; ");

              const row = [
                 escapeCSV(u.id),
                 escapeCSV(u.name),
                 escapeCSV(u.email),
                 escapeCSV(highestRole),
                 u.banned ? "Banned" : "Active",
                 escapeCSV(u.banReason),
                 escapeCSV(orgsStr),
                 formatDate(u.createdAt),
               ].join(",");

               controller.enqueue(encoder.encode(row + "\n"));
            } catch (error) {
              console.error(`Error processing user ${u.id}:`, error);
            }
          }

          offset += BATCH_SIZE;
          hasMore = users.length === BATCH_SIZE;
        }

        controller.close();
      },
    });

    // Generate filename with current date
    const date = new Date().toISOString().split("T")[0];
    const filename = `users-export-${date}.csv`;

    return new Response(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Admin users export error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to export users" },
      {
        status:
          error instanceof Error && error.message === "Admin privileges required"
            ? 403
            : 500,
      }
    );
  }
}
