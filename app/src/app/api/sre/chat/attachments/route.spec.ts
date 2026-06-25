/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(),
}));

jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: jest.fn(),
}));

jest.mock("@/lib/s3-proxy", () => ({
  getS3Client: jest.fn(),
}));

jest.mock("@/lib/sre/sre-rate-limiter", () => ({
  checkSreAttachmentUploadRateLimit: jest.fn(),
}));

jest.mock("@/lib/audit-logger", () => ({
  logAuditEvent: jest.fn(),
}));

jest.mock("@/utils/db", () => ({
  db: {
    query: {
      sreIncidents: { findFirst: jest.fn() },
    },
  },
}));

import { POST } from "./route";

const { requireProjectContext: mockRequireProjectContext } = jest.requireMock("@/lib/project-context") as {
  requireProjectContext: jest.Mock;
};
const { checkPermissionWithContext: mockCheckPermissionWithContext } = jest.requireMock("@/lib/rbac/middleware") as {
  checkPermissionWithContext: jest.Mock;
};
const { getS3Client: mockGetS3Client } = jest.requireMock("@/lib/s3-proxy") as {
  getS3Client: jest.Mock;
};
const { checkSreAttachmentUploadRateLimit: mockCheckSreAttachmentUploadRateLimit } = jest.requireMock("@/lib/sre/sre-rate-limiter") as {
  checkSreAttachmentUploadRateLimit: jest.Mock;
};
const { db: mockDb } = jest.requireMock("@/utils/db") as {
  db: { query: { sreIncidents: { findFirst: jest.Mock } } };
};

function uploadRequest(file: File, incidentId = "018f0000-0000-7000-8000-000000000004") {
  const formData = new FormData();
  formData.append("incidentId", incidentId);
  formData.append("file", file);

  return new NextRequest("http://localhost/api/sre/chat/attachments", {
    method: "POST",
    body: formData,
  });
}

describe("SRE chat attachment upload API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireProjectContext.mockResolvedValue({
      userId: "018f0000-0000-7000-8000-000000000001",
      organizationId: "018f0000-0000-7000-8000-000000000002",
      project: { id: "018f0000-0000-7000-8000-000000000003", name: "Prod" },
    });
    mockCheckPermissionWithContext.mockReturnValue(true);
    mockCheckSreAttachmentUploadRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });
    mockDb.query.sreIncidents.findFirst.mockResolvedValue({ id: "018f0000-0000-7000-8000-000000000004" });
    mockGetS3Client.mockReturnValue({ send: jest.fn().mockResolvedValue({}) });
  });

  it("uploads a bounded allowed file and returns metadata only", async () => {
    const response = await POST(uploadRequest(new File(["hello"], "notes token=secret.txt", { type: "text/plain" })));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.attachment).toMatchObject({
      type: "file",
      fileName: "notes_token_secret.txt",
      mimeType: "text/plain",
      size: 5,
      storageBucket: "sre-chat-attachments",
      incidentId: "018f0000-0000-7000-8000-000000000004",
    });
    expect(body.attachment.storagePath).toContain("projects/018f0000-0000-7000-8000-000000000003/sre-chat/018f0000-0000-7000-8000-000000000004/");
    expect(body.attachment).not.toHaveProperty("content");
  });

  it("rejects unsupported file types", async () => {
    const response = await POST(uploadRequest(new File(["bad"], "bad.exe", { type: "application/x-msdownload" })));

    expect(response.status).toBe(400);
    expect(mockGetS3Client().send).not.toHaveBeenCalled();
  });

  it("rejects rate-limited uploads", async () => {
    mockCheckSreAttachmentUploadRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetTime: Date.now() + 30_000 });

    const response = await POST(uploadRequest(new File(["hello"], "notes.txt", { type: "text/plain" })));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(body.error).toContain("rate limit");
    expect(mockDb.query.sreIncidents.findFirst).toHaveBeenCalledTimes(1);
    expect(mockGetS3Client().send).not.toHaveBeenCalled();
  });

  it.each([
    ["image/png", "image.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])],
    ["image/jpeg", "image.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0x00])],
    ["image/webp", "image.webp", new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])],
  ])("accepts %s uploads with matching image signatures", async (mimeType, fileName, bytes) => {
    const response = await POST(uploadRequest(new File([bytes], fileName, { type: mimeType })));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.attachment).toMatchObject({ mimeType, fileName });
    expect(mockGetS3Client().send).toHaveBeenCalledTimes(1);
  });

  it("rejects image uploads whose bytes do not match the declared MIME type", async () => {
    const response = await POST(uploadRequest(new File(["not-a-png"], "fake.png", { type: "image/png" })));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("does not match");
    expect(mockGetS3Client().send).not.toHaveBeenCalled();
  });

  it("rejects uploads without investigation permission", async () => {
    mockCheckPermissionWithContext.mockReturnValue(false);

    const response = await POST(uploadRequest(new File(["hello"], "notes.txt", { type: "text/plain" })));

    expect(response.status).toBe(403);
    expect(mockDb.query.sreIncidents.findFirst).not.toHaveBeenCalled();
  });
});
