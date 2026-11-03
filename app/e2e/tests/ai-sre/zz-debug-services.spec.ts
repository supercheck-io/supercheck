// Temporary diagnostics for an intermittent empty services list. Never merged.
import { expect, test } from "../../fixtures/roles.fixture";
import { requireRbacUser } from "../../utils/env";
import { waitForHydration } from "../../utils/hydration";

for (const attempt of [1, 2, 3, 4]) {
  test(`svcdebug attempt ${attempt} @svcdebug`, async ({ orgOwnerPage: page }) => {
    requireRbacUser("orgOwner");
    const log = (...a: unknown[]) => console.log(`[svcdebug ${attempt} +${Date.now() % 100000}]`, ...a);
    page.on("console", (m) => log("console", m.type(), m.text().slice(0, 300)));
    page.on("pageerror", (e) => log("pageerror", e.message.slice(0, 300)));
    page.on("request", (r) => {
      const h = r.headers();
      if (r.url().includes("/services") || h["next-action"] || h["rsc"]) log("req", r.method(), r.url().replace(/^https?:\/\/[^/]+/, ""), h["next-action"] ? "action" : "", h["rsc"] ? "rsc" : "");
    });
    page.on("response", (r) => { if (r.request().headers()["next-action"]) log("action-res", r.status()); });
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) log("nav", f.url().replace(/^https?:\/\/[^/]+/, "")); });

    const original = ((await (await page.request.get("/api/projects")).json()) as { currentProject: { id: string } }).currentProject.id;
    const created = (await (await page.request.post("/api/projects", { data: { name: `E2E svcdebug ${Date.now()}` } })).json()) as { data: { id: string } };
    try {
      expect((await page.request.post("/api/projects/switch", { data: { projectId: created.data.id } })).status()).toBe(200);
      log("page url before goto", page.url());
      await page.goto("/services", { waitUntil: "load" });
      await waitForHydration(page);
      log("hydrated");
      await page.addInitScript(() => {});
      await page.evaluate(() => {
        const w = window as unknown as { __mut: number };
        w.__mut = 0;
        new MutationObserver((ms) => { for (const m of ms) for (const n of Array.from(m.removedNodes)) if ((n as HTMLElement).querySelector?.("table, [data-testid=add-service-btn]")) w.__mut++; }).observe(document.body, { subtree: true, childList: true });
      });
      const dialog = page.getByRole("dialog", { name: "Add service" });
      await expect(async () => {
        if (!(await dialog.isVisible())) await page.getByTestId("add-service-btn").first().click();
        await expect(dialog).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 15_000 });
      log("dialog open");
      await dialog.getByLabel("Service name *").fill(`svcdebug ${attempt} ${Date.now()}`);
      await dialog.getByTestId("submit-service-btn").click();
      await expect(dialog).toBeHidden();
      log("dialog hidden");
      for (let i = 0; i < 12; i++) {
        const state = await page.evaluate(() => ({
          headers: document.querySelectorAll("[role=columnheader], th").length,
          empty: document.body.innerText.includes("No services registered"),
          removedContainers: (window as unknown as { __mut: number }).__mut,
          project: document.querySelector("button[aria-haspopup]")?.textContent?.slice(0, 60),
        }));
        log("state", i, JSON.stringify(state));
        await page.waitForTimeout(500);
      }
    } finally {
      await page.request.post("/api/projects/switch", { data: { projectId: original } });
      await page.request.delete(`/api/projects/${created.data.id}`);
    }
  });
}
