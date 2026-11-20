/** @jest-environment node */
const mockStatus = jest.fn();
jest.mock("@/lib/impersonation-status", () => ({ getImpersonationStatus: () => mockStatus() }));
import { GET } from "./route";

it("answers with the status", async () => {
  mockStatus.mockResolvedValue({ isImpersonating: false });
  const res = await GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ isImpersonating: false });
});

it("reports a failed lookup as unavailable, not as not impersonating", async () => {
  mockStatus.mockResolvedValue(null);
  const res = await GET();
  expect(res.status).toBe(503);
  expect(await res.json()).not.toHaveProperty("isImpersonating");
});
