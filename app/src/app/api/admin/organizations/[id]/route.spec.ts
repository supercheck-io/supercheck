/** @jest-environment node */
import { NextRequest } from "next/server";
import { DELETE } from "./route";
import { db } from "@/utils/db";

jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), delete: jest.fn() } }));
jest.mock("@/lib/admin", () => ({ requireAdmin: jest.fn() }));

const ORG_ID = "11111111-1111-4111-8111-111111111111";

function selectRows(...results: unknown[][]) {
  const mock = jest.mocked(db.select);
  for (const rows of results) {
    const chain = { from: () => chain, where: () => chain, limit: () => Promise.resolve(rows), then: (r: (v: unknown[]) => unknown) => Promise.resolve(rows).then(r) };
    mock.mockReturnValueOnce(chain as never);
  }
}

describe("admin organization DELETE", () => {
  beforeEach(() => jest.clearAllMocks());

  it("refuses with 409 while the org still has projects (would orphan S3 artifacts)", async () => {
    selectRows([{ id: ORG_ID }], [{ count: 0 }], [{ id: "project-1" }]);
    const response = await DELETE(new NextRequest("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ id: ORG_ID }) });
    expect(response.status).toBe(409);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("deletes an empty organization", async () => {
    selectRows([{ id: ORG_ID }], [{ count: 0 }], []);
    jest.mocked(db.delete).mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) } as never);
    const response = await DELETE(new NextRequest("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ id: ORG_ID }) });
    expect(response.status).toBe(200);
    expect(db.delete).toHaveBeenCalledTimes(1);
  });
});
