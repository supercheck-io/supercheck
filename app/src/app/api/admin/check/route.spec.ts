/** @jest-environment node */
const mockIsAdmin = jest.fn();
const mockIsOrgAdmin = jest.fn();
jest.mock("@/lib/admin", () => ({
  isAdmin: () => mockIsAdmin(),
  isOrgAdmin: () => mockIsOrgAdmin(),
}));
import { GET } from "./route";

beforeEach(() => jest.clearAllMocks());

it("returns the super admin and org admin flags together", async () => {
  mockIsAdmin.mockResolvedValue(false);
  mockIsOrgAdmin.mockResolvedValue(true);
  const res = await GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ success: true, isAdmin: false, isOrgAdmin: true });
});

it("reports a plain member as neither", async () => {
  mockIsAdmin.mockResolvedValue(false);
  mockIsOrgAdmin.mockResolvedValue(false);
  expect(await (await GET()).json()).toEqual({ success: true, isAdmin: false, isOrgAdmin: false });
});

it("denies both when a lookup throws", async () => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  mockIsAdmin.mockRejectedValue(new Error("db down"));
  mockIsOrgAdmin.mockResolvedValue(true);
  const res = await GET();
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ success: false, isAdmin: false, isOrgAdmin: false });
});
