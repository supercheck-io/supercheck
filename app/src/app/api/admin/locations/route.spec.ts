/** @jest-environment node */

const returning = jest.fn();
const values = jest.fn(() => ({ returning }));
const insert = jest.fn(() => ({ values }));
const limit = jest.fn().mockResolvedValue([]);

jest.mock("@/lib/admin", () => ({ requireAdmin: jest.fn().mockResolvedValue({}) }));
jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(() => ({ from: () => ({ where: () => ({ limit }) }) })),
    transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
      fn({ update: jest.fn(() => ({ set: jest.fn() })), insert })
    ),
  },
}));
jest.mock("@/lib/location-registry", () => ({
  invalidateLocationCache: jest.fn(),
  getAllLocations: jest.fn(),
}));
jest.mock("@/lib/queue", () => ({
  invalidateQueueMaps: jest.fn(),
  queueLogger: { warn: jest.fn() },
}));
jest.mock("@/lib/queue-event-hub", () => ({ invalidateQueueEventHub: jest.fn() }));
jest.mock("@/lib/worker-registry", () => ({
  getWorkerCountByLocation: jest.fn(),
  getUnregisteredWorkerLocations: jest.fn(),
}));
jest.mock("@/lib/bull-board/state", () => ({ invalidateBullBoard: jest.fn() }));

import { NextRequest } from "next/server";
import { POST } from "./route";

const post = (body: object) =>
  POST(
    new NextRequest("http://localhost/api/admin/locations", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );

describe("POST /api/admin/locations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    returning.mockResolvedValue([{ id: "1" }]);
  });

  it("creates an enabled location with both capabilities on by default (unchanged API behaviour)", async () => {
    const response = await post({ code: "eu-central", name: "EU" });
    expect(response.status).toBe(201);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ isEnabled: true, supportsBrowser: true, supportsK6: true })
    );
  });

  it("stages a probe-only region disabled", async () => {
    const response = await post({
      code: "sa-east",
      name: "Brazil",
      isEnabled: false,
      supportsBrowser: false,
      supportsK6: false,
    });
    expect(response.status).toBe(201);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ isEnabled: false, supportsBrowser: false, supportsK6: false })
    );
  });

  it("refuses a disabled default location", async () => {
    const response = await post({ code: "sa-east", name: "Brazil", isEnabled: false, isDefault: true });
    expect(response.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });
});
