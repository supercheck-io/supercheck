import { authorizationServerMetadata, discoveryPreflight } from "@/lib/mcp/discovery";

export const dynamic = "force-dynamic";

/** RFC 8414 metadata for the issuer https://<host>/api/auth. */
export const GET = authorizationServerMetadata;
export const OPTIONS = discoveryPreflight;
