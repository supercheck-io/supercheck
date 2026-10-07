/** @jest-environment node */
import { NextRequest } from "next/server";
import { PUT } from "./route";
import { encryptNotificationProviderConfig } from "@/lib/notification-providers/crypto";
const id = "019a0000-0000-7000-8000-000000000001";
const mockSet = jest.fn();
const mockSelect = jest.fn();
const mockUpdate = jest.fn();
jest.mock("@/utils/db", () => ({ db: { select: (...args: unknown[]) => mockSelect(...args), update: (...args: unknown[]) => mockUpdate(...args) } }));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: async () => ({ userId: id, organizationId: id, project: { id } }), isAuthError: () => false,
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: () => true }));
jest.mock("@/lib/notification-providers/crypto", () => ({
  decryptNotificationProviderConfig: (config: unknown) => config,
  encryptNotificationProviderConfig: jest.fn((config: unknown) => config),
  mergeNotificationProviderConfig: jest.fn(),
  sanitizeConfigForClient: (configType: unknown, config: unknown) => ({ sanitizedConfig: config, maskedFields: [] }),
}));

it("synchronizes config.name on a name-only update without replacing credentials", async () => {
  const config = { name: "Old name", webhookUrl: "https://example.com/private-secret" };
  mockSelect.mockReturnValue({ from: jest.fn().mockReturnThis(), where: jest.fn().mockResolvedValue([{ id, name: "Old name", type: "discord", createdByUserId: id, config }]) });
  mockUpdate.mockReturnValue({ set: mockSet.mockReturnThis(), where: jest.fn().mockReturnThis(), returning: jest.fn(async () => [{ id, name: "New name", type: "discord", config: { ...config, name: "New name" } }]) });
  const response = await PUT(new NextRequest(`https://example.com/api/notification-providers/${id}`, { method: "PUT", body: JSON.stringify({ name: "New name" }) }), { params: Promise.resolve({ id }) });
  expect(response.status).toBe(200);
  expect(encryptNotificationProviderConfig).toHaveBeenCalledWith({ ...config, name: "New name" }, id);
  expect(mockSet.mock.calls[0][0].name).toBe("New name");
});
