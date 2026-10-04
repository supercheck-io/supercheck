/** @jest-environment node */
import { NextRequest } from "next/server";
import { POST } from "./route";
import { switchProject } from "@/lib/project-context";
jest.mock("@/lib/project-context", () => ({ switchProject: jest.fn() }));
const projectId = "11111111-1111-4111-8111-111111111111";
function request(body: string, origin = "https://app.supercheck.io") {
  return new NextRequest("https://app.supercheck.io/api/projects/switch", { method: "POST", headers: { origin, "content-type": "application/json" }, body });
}
beforeEach(() => jest.clearAllMocks());
it("rejects a cross-origin switch before changing the session", async () => {
  expect((await POST(request(JSON.stringify({ projectId }), "https://attacker.example"))).status).toBe(403);
  expect(switchProject).not.toHaveBeenCalled();
});
it.each(["{", "null", '{}', '{"projectId":true}', '{"projectId":"invalid"}'])("rejects malformed project selection: %s", async body => {
  expect((await POST(request(body))).status).toBe(400); expect(switchProject).not.toHaveBeenCalled();
});
it("selects an authorized invited project", async () => {
  (switchProject as jest.Mock).mockResolvedValue({ success: true, project: { id: projectId, organizationId: "invited-team" } });
  const response = await POST(request(JSON.stringify({ projectId })));
  expect(response.status).toBe(200); expect(switchProject).toHaveBeenCalledWith(projectId);
});
it("does not claim success for an inaccessible project", async () => {
  (switchProject as jest.Mock).mockResolvedValue({ success: false, message: "Access denied" });
  expect((await POST(request(JSON.stringify({ projectId })))).status).toBe(400);
});
