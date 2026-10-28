jest.mock("@/utils/db", () => ({ db: {
  query: { statusPageSubscribers: { findFirst: jest.fn() }, statusPages: { findFirst: jest.fn() } },
  update: jest.fn(),
} }));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ requirePermissions: jest.fn() }));
jest.mock("@/lib/email-service", () => ({ EmailService: { getInstance: jest.fn(() => ({ sendEmail: jest.fn(async () => ({ success: true })) })) } }));
jest.mock("@/lib/email-renderer", () => ({ renderStatusPageVerificationEmail: jest.fn() }));
import { db } from "@/utils/db";
import { requireProjectContext } from "@/lib/project-context";
import { resendVerificationEmail } from "./get-status-page-subscribers";

const id = "550e8400-e29b-41d4-a716-446655440000";
const old = new Date(Date.now() - 3_600_000);

beforeEach(() => {
  jest.clearAllMocks();
  (requireProjectContext as jest.Mock).mockResolvedValue({ organizationId: "org", project: { id: "p" } });
  (db.query.statusPages.findFirst as jest.Mock).mockResolvedValue({ id: "page" });
});

it.each([
  ["an unsubscribed (purged) address", { mode: "email", email: "a@example.com", purgeAt: new Date() }],
  ["a webhook subscriber", { mode: "webhook", email: null, purgeAt: null }],
])("does not send a verification email to %s", async (_n, row) => {
  (db.query.statusPageSubscribers.findFirst as jest.Mock).mockResolvedValue({
    id, statusPageId: "page", verifiedAt: null, createdAt: old, updatedAt: old, ...row,
  });
  const result = await resendVerificationEmail(id);
  expect(result.success).toBe(false);
  expect(db.update).not.toHaveBeenCalled();
});
