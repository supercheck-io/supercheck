import { discoveryPreflight, protectedResourceMetadata } from "@/lib/mcp/discovery";

export const dynamic = "force-dynamic";

/** RFC 9728 metadata for the MCP resource https://<host>/api/mcp. */
export const GET = protectedResourceMetadata;
export const OPTIONS = discoveryPreflight;
