import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { privateAgentCredentials, privateAgents } from "@/db/schema";
import { hashApiKey } from "@/lib/security/api-key-hash";
import { db } from "@/utils/db";

export type AuthenticatedPrivateAgent = {
  agent: typeof privateAgents.$inferSelect;
  credential: typeof privateAgentCredentials.$inferSelect;
};

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export async function authenticatePrivateAgent(request: NextRequest): Promise<AuthenticatedPrivateAgent | null> {
  const token = getBearerToken(request);
  if (!token) {
    return null;
  }

  const secretHash = hashApiKey(token);
  const credential = await db.query.privateAgentCredentials.findFirst({
    where: and(
      eq(privateAgentCredentials.secretHash, secretHash),
      isNull(privateAgentCredentials.revokedAt)
    ),
  });

  if (!credential || (credential.expiresAt && credential.expiresAt <= new Date())) {
    return null;
  }

  const agent = await db.query.privateAgents.findFirst({
    where: and(
      eq(privateAgents.id, credential.privateAgentId),
      eq(privateAgents.organizationId, credential.organizationId)
    ),
  });

  if (!agent || agent.status === "disabled") {
    return null;
  }

  return { agent, credential };
}
