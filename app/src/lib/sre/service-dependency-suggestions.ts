import { and, desc, eq, or, sql } from "drizzle-orm";

import { sreServiceDiscoverySuggestions } from "@/db/schema";
import { db } from "@/utils/db";

/**
 * The latest add-dependency suggestions naming this service as source or target.
 * The service match runs in SQL so other services' suggestions cannot push this one's past the limit.
 */
export function listServiceDependencySuggestions(input: {
  organizationId: string;
  projectId: string;
  serviceId: string;
  limit?: number;
}) {
  const data = sreServiceDiscoverySuggestions.suggestionData;
  return db
    .select()
    .from(sreServiceDiscoverySuggestions)
    .where(
      and(
        eq(sreServiceDiscoverySuggestions.organizationId, input.organizationId),
        eq(sreServiceDiscoverySuggestions.projectId, input.projectId),
        eq(sreServiceDiscoverySuggestions.suggestionType, "add_dependency"),
        or(
          sql`${data}->>'sourceServiceId' = ${input.serviceId}`,
          sql`${data}->>'targetServiceId' = ${input.serviceId}`,
        ),
      ),
    )
    .orderBy(desc(sreServiceDiscoverySuggestions.createdAt))
    .limit(input.limit ?? 100);
}
