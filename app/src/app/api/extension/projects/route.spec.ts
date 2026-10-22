/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), update: jest.fn() } }));
jest.mock("@/lib/session", () => ({ getUserProjects: jest.fn() }));
jest.mock("@better-auth/api-key", () => ({ defaultKeyHasher: jest.fn(async () => "hash") }));
import { NextRequest } from "next/server";
import { db } from "@/utils/db";
import { getUserProjects } from "@/lib/session";
import { GET } from "./route";
const rows = (result: unknown[]) => ({ from: jest.fn().mockReturnThis(), innerJoin: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue(result) });
beforeEach(() => jest.clearAllMocks());
it.each([null, new Date(Date.now() + 60_000)])("denies project discovery during an effective owner ban (%s)", async (banExpires) => {
  jest.mocked(db.select).mockReturnValueOnce(rows([{ id: "key", userId: "owner", banned: true, banExpires }]) as never);
  const response = await GET(new NextRequest("https://example.com/api/extension/projects", { headers: { "x-api-key": "ext-test" } }));
  expect(response.status).toBe(401);
  expect(getUserProjects).not.toHaveBeenCalled();
  expect(db.update).not.toHaveBeenCalled();
});
it("allows project discovery after a temporary owner ban expires", async () => {
  jest.mocked(db.select).mockReturnValueOnce(rows([{ id: "key", userId: "owner", banned: true, banExpires: new Date(0) }]) as never)
    .mockReturnValueOnce({ from: jest.fn().mockReturnThis(), where: jest.fn().mockResolvedValue([]) } as never);
  jest.mocked(db.update).mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }) } as never);
  expect((await GET(new NextRequest("https://example.com/api/extension/projects", { headers: { "x-api-key": "ext-test" } }))).status).toBe(200);
});
