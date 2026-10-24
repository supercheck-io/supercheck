/** @jest-environment node */
import { GET } from "./route";
import { requireAuthContext } from "@/lib/auth-context";
import { checkCapacityLimits } from "@/lib/middleware/plan-enforcement";
import { ExecutionWorkloadError } from "@/lib/execution/execution-policy";

jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(),
  isAuthError: () => false,
}));
jest.mock("@/lib/middleware/plan-enforcement", () => ({
  checkCapacityLimits: jest.fn(),
}));
jest.mock("@/lib/execution/execution-policy", () => ({
  ExecutionWorkloadError: class extends Error {},
}));
jest.mock("@/lib/services/subscription-service", () => ({
  SubscriptionAccessDeniedError: class extends Error {},
}));
jest.mock("@/utils/db", () => {
  const builder: Record<string, unknown> = {};
  for (const method of ["from", "innerJoin", "where"])
    builder[method] = jest.fn(() => builder);
  builder.then = (resolve: (value: unknown[]) => unknown) =>
    Promise.resolve([]).then(resolve);
  return { db: { select: jest.fn(() => builder) } };
});

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(requireAuthContext)
    .mockResolvedValue({ userId: "user", organizationId: "org" } as never);
});

it("reports the organization's capacity alongside its runs", async () => {
  jest
    .mocked(checkCapacityLimits)
    .mockResolvedValue({ runningCapacity: 3, queuedCapacity: 30 });
  const response = await GET();
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    running: [],
    queued: [],
    runningCapacity: 3,
    queuedCapacity: 30,
  });
});

it("still answers with zero capacity when the organization has no active entitlement", async () => {
  jest
    .mocked(checkCapacityLimits)
    .mockRejectedValue(
      new ExecutionWorkloadError(
        "Execution entitlement required or trial expired",
      ),
    );
  const response = await GET();
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    runningCapacity: 0,
    queuedCapacity: 0,
  });
});

it("does not hide an unexpected capacity failure", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest
    .mocked(checkCapacityLimits)
    .mockRejectedValue(new Error("database unavailable"));
  const response = await GET();
  expect(response.status).toBeGreaterThanOrEqual(500);
  log.mockRestore();
});

it("requires an organization", async () => {
  jest
    .mocked(requireAuthContext)
    .mockResolvedValue({ userId: "user", organizationId: null } as never);
  expect((await GET()).status).toBe(404);
});
