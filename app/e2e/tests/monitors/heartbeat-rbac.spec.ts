import { expect, type APIRequestContext } from "@playwright/test";
import { test } from "../../fixtures";
import { createMonitor, deleteMonitor } from "../../utils/test-data";
import { waitForHydration } from "../../utils/hydration";

const currentProjectId = async (request: APIRequestContext) => {
  const response = await request.get("/api/projects");
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { currentProject: { id: string } }).currentProject.id;
};

test.describe("Heartbeat ping URL RBAC @monitors @heartbeat @rbac", () => {
  test("a viewer sees the masked URL but no Reveal, Copy or Rotate, and the API denies the reveal (B23) @critical @negative", async ({
    orgOwnerPage,
    viewerPage,
    cleanup,
  }) => {
    const ownerRequest = orgOwnerPage.request;
    const projectId = await currentProjectId(ownerRequest);
    const monitor = await createMonitor(ownerRequest, {
      name: `E2E heartbeat rbac ${Date.now()}`,
      type: "heartbeat",
      target: "",
      frequencyMinutes: 60,
    });
    cleanup.add(`monitor ${monitor.id}`, () => deleteMonitor(ownerRequest, monitor.id));

    // The viewer looks at the owner's project and is switched back afterwards.
    const viewerOriginalProjectId = await currentProjectId(viewerPage.request);
    const switched = await viewerPage.request.post("/api/projects/switch", { data: { projectId } });
    expect(switched.status(), await switched.text()).toBe(200);
    cleanup.add("viewer project", async () => {
      await viewerPage.request.post("/api/projects/switch", { data: { projectId: viewerOriginalProjectId } });
    });

    await viewerPage.goto(`/monitors/${monitor.id}`, { waitUntil: "domcontentloaded" });
    await waitForHydration(viewerPage);
    await expect(viewerPage.getByRole("heading", { name: monitor.name, exact: true })).toBeVisible();
    const panel = viewerPage.getByTestId("heartbeat-ping-url-panel");
    await expect(panel).toBeVisible();
    await expect(viewerPage.getByTestId("heartbeat-ping-url")).toHaveAttribute("data-revealed", "false");
    await expect(viewerPage.getByTestId("heartbeat-ping-url")).toContainText("/api/heartbeat/hb_•");
    for (const name of ["Reveal", "Copy", "Rotate URL"]) {
      await expect(panel.getByRole("button", { name, exact: true })).toHaveCount(0);
    }

    // The routes deny viewers too, and the monitor read never carries a token.
    const reveal = await viewerPage.request.get(`/api/monitors/${monitor.id}/heartbeat-url`);
    expect(reveal.status()).toBe(403);
    const rotate = await viewerPage.request.post(`/api/monitors/${monitor.id}/heartbeat-url/rotate`);
    expect(rotate.status()).toBe(403);
    const read = await viewerPage.request.get(`/api/monitors/${monitor.id}`);
    expect(read.status()).toBe(200);
    expect(await read.text()).not.toMatch(/hb_[0-9a-f]{32}/);

    // An editor-level owner does get the controls.
    await orgOwnerPage.goto(`/monitors/${monitor.id}`, { waitUntil: "domcontentloaded" });
    await waitForHydration(orgOwnerPage);
    for (const name of ["Reveal", "Copy", "Rotate URL"]) {
      await expect(orgOwnerPage.getByTestId("heartbeat-ping-url-panel").getByRole("button", { name, exact: true })).toBeVisible();
    }
  });
});
