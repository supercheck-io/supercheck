/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(),
  isAuthError: jest.fn((error: unknown) => error instanceof Error && error.message === "Authentication required"),
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn() }));
jest.mock("@/lib/sre/sre-rate-limiter", () => ({
  checkSreEvidenceBriefRateLimit: jest.fn(),
}));
jest.mock("@/lib/sre/evidence-brief-orchestrator", () => ({
  runSreEvidenceBriefGeneration: jest.fn(),
}));
jest.mock("@/lib/sre/evidence-brief-generator", () => ({
  streamEvidenceBrief: jest.fn(),
}));

import { requireAuthContext } from "@/lib/auth-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { checkSreEvidenceBriefRateLimit } from "@/lib/sre/sre-rate-limiter";
import { POST } from "./route";

const mockRequireProjectContext = requireAuthContext as jest.Mock;
const mockCheckPermissionWithContext = checkPermissionWithContext as jest.Mock;
const mockRateLimit = checkSreEvidenceBriefRateLimit as jest.Mock;

const incidentId = "018f0000-0000-7000-8000-000000000005";
const context = {
  userId: "018f0000-0000-7000-8000-000000000001",
  organizationId: "018f0000-0000-7000-8000-000000000002",
  project: { id: "018f0000-0000-7000-8000-000000000003" },
};

function request(origin = "https://app.supercheck.example") {
  return new NextRequest("https://app.supercheck.example/api/sre/evidence-brief/stream", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ incidentId }),
  });
}

describe("SRE evidence brief stream API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireProjectContext.mockResolvedValue(context);
    mockCheckPermissionWithContext.mockReturnValue(true);
    mockRateLimit.mockResolvedValue({ allowed: true });
  });

  it("rejects an explicit cross-origin request before auth or generation", async () => {
    const response = await POST(request("https://attacker.example"));

    expect(response.status).toBe(403);
    expect(mockRequireProjectContext).not.toHaveBeenCalled();
  });

  it("requires both incident and investigation permissions", async () => {
    mockCheckPermissionWithContext
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockCheckPermissionWithContext).toHaveBeenNthCalledWith(
      2,
      "sre_investigation",
      "investigate",
      expect.objectContaining({ userId: context.userId }),
    );
  });
});
