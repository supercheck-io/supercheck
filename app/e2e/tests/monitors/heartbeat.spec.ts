import { expect, type Page } from "@playwright/test";
import { test } from "../../fixtures";
import { createMonitor, deleteMonitor } from "../../utils/test-data";
import { waitForHydration } from "../../utils/hydration";
import { NO_WORKER, NO_WORKER_REASON } from "../../fixtures/checkpoint.fixture";

// Only rendered matches: strict mode fails when a second, hidden copy is in the DOM.
const byTestId = (page: Page, id: string) => page.getByTestId(id).filter({ visible: true });
// The state badge in the page header, not any other badge on the page.
const stateBadge = (page: Page) =>
  byTestId(page, "monitor-detail-header").getByTestId("heartbeat-state-badge").filter({ visible: true });

// Pings are evaluated by the worker's heartbeat sweep (every 30 s), so state changes need a running worker.
const SWEEP_TIMEOUT = 120_000;

async function expectHeartbeatState(page: Page, monitorId: string, state: string) {
  await expect
    .poll(
      async () => {
        await page.goto(`/monitors/${monitorId}`, { waitUntil: "domcontentloaded" });
        return stateBadge(page).getAttribute("data-state");
      },
      { timeout: SWEEP_TIMEOUT, intervals: [5_000] },
    )
    .toBe(state);
}

test.describe("Heartbeat monitor @monitors @heartbeat", () => {
  test("creates from Quick Create, copies the URL, a ping turns it Up and /fail turns it Down @critical @execution", async ({
    projectAdminPage: page,
    cleanup,
  }) => {
    // Up/Down need the worker's heartbeat sweep.
    test.skip(NO_WORKER, NO_WORKER_REASON);
    test.setTimeout(6 * 60_000);
    const request = page.request;
    const name = `E2E heartbeat ${Date.now()}`;

    await page.goto("/create");
    await waitForHydration(page);
    await page.getByRole("button", { name: /Heartbeat Monitor/ }).click();
    await expect(page).toHaveURL(/\/monitors\/create\?type=heartbeat/);
    await waitForHydration(page);

    // No target, method or location fields for a heartbeat (spec 4.6).
    await expect(byTestId(page, "heartbeat-fields")).toBeVisible();
    await expect(page.getByLabel("Target")).toHaveCount(0);
    await page.getByLabel("Title").fill(name);
    await page.getByLabel("Expect a ping every", { exact: true }).fill("1");
    await page.getByLabel("Grace period", { exact: true }).fill("10");
    await page.getByRole("button", { name: "Next: Alert Settings" }).click();

    // Alert step: thresholds are hidden; the Warnings group shows once alerts are on.
    await page.getByLabel("Enable Alerts").click();
    await expect(page.getByText("Failure Threshold")).toHaveCount(0);
    await expect(byTestId(page, "alert-warnings-group")).toContainText(
      "Warnings notify your channels. They never open an incident.",
    );
    await page.getByLabel("Enable Alerts").click();

    const createResponse = page.waitForResponse(
      (response) => response.url().endsWith("/api/monitors") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Create Monitor" }).click();
    const created = await createResponse;
    expect(created.status(), await created.text()).toBe(201);
    const body = (await created.json()) as { id: string; heartbeat?: { pingUrl?: string } };
    cleanup.add(`monitor ${body.id}`, () => deleteMonitor(request, body.id));
    expect(body.heartbeat?.pingUrl).toMatch(/\/api\/heartbeat\/hb_[0-9a-f]{32}$/);

    // The URL is shown in full once, right after create, and Copy puts it on the clipboard.
    await expect(page).toHaveURL(new RegExp(`/monitors/${body.id}`));
    await waitForHydration(page);
    const urlBox = byTestId(page, "heartbeat-ping-url");
    await expect(urlBox).toHaveAttribute("data-revealed", "true");
    const pingUrl = (await urlBox.textContent())?.trim() ?? "";
    expect(pingUrl).toBe(body.heartbeat?.pingUrl);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await byTestId(page, "heartbeat-copy").click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(pingUrl);

    await expect(stateBadge(page)).toHaveAttribute("data-state", "pending");
    await expect(byTestId(page, "heartbeat-waiting")).toBeVisible();

    // The monitor GET never carries the URL or token.
    const read = await request.get(`/api/monitors/${body.id}`);
    expect(read.status()).toBe(200);
    expect(await read.text()).not.toContain(pingUrl.split("/").pop()!);

    // A ping answers 200 OK and the sweep turns the monitor Up.
    const ping = await request.get(pingUrl);
    expect(ping.status()).toBe(200);
    expect(await ping.text()).toBe("OK");
    await expectHeartbeatState(page, body.id, "up");
    await expect(page.getByTestId("heartbeat-ping-row").first()).toHaveAttribute("data-kind", "ping");
    await expect(byTestId(page, "heartbeat-stat-last-ping")).toHaveText(/^(just now|\d+[mhd] ago)$/);

    // /fail turns it Down at once (no grace) and opens an incident.
    const fail = await request.post(`${pingUrl}/fail`);
    expect(fail.status()).toBe(200);
    await expectHeartbeatState(page, body.id, "down");
    await expect(page.getByTestId("heartbeat-ping-row").first()).toHaveAttribute("data-kind", "fail");

    let incidentId: string | undefined;
    await expect
      .poll(
        async () => {
          const response = await request.get("/api/sre/incidents?status=open");
          const { incidents = [] } = (await response.json()) as { incidents?: Array<{ id: string; title: string; severity: string }> };
          const incident = incidents.find((item) => item.title.startsWith(name));
          incidentId = incident?.id;
          return incident?.severity;
        },
        { timeout: SWEEP_TIMEOUT, intervals: [5_000] },
      )
      .toBe("sev2");
    cleanup.add(`incident ${incidentId}`, async () => {
      await request.post(`/api/sre/incidents/${incidentId}/resolve`, { data: { resolutionSummary: "E2E cleanup" } });
    });
  });

  test("lists the heartbeat with its type and schedule @high", async ({ projectAdminPage: page, cleanup }) => {
    const request = page.request;
    const name = `E2E heartbeat list ${Date.now()}`;
    const { id } = await createMonitor(request, {
      name,
      type: "heartbeat",
      target: "",
      frequencyMinutes: 60,
      config: { heartbeat: { graceMinutes: 10 } },
    });
    cleanup.add(`monitor ${id}`, () => deleteMonitor(request, id));

    await page.goto("/monitors");
    await waitForHydration(page);
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toContainText("Every 1 h, grace 10 min");
    await expect(row).toContainText("Heartbeat Monitor");
  });

  test("saves the late-ping warning toggle from the edit page (B24) @high", async ({ projectAdminPage: page, cleanup }) => {
    const request = page.request;
    const name = `E2E heartbeat warning ${Date.now()}`;
    // Incident-only alerts need no channel, so the alert settings save without one.
    const { id } = await createMonitor(request, {
      name,
      type: "heartbeat",
      target: "",
      frequencyMinutes: 60,
      alertConfig: {
        enabled: true,
        notificationProviders: [],
        alertOnFailure: true,
        alertOnRecovery: true,
        failureThreshold: 1,
        recoveryThreshold: 1,
        incidentEnabled: true,
        warnings: { heartbeat_late: true },
      },
    });
    cleanup.add(`monitor ${id}`, () => deleteMonitor(request, id));

    await page.goto(`/monitors/${id}/edit`);
    await waitForHydration(page);
    await page.getByRole("button", { name: "Configure Alerts" }).click();
    const lateToggle = page.getByLabel("Ping is late");
    await expect(lateToggle).toBeChecked();
    await lateToggle.click();
    await page.getByRole("button", { name: "Update Monitor" }).click();
    await expect(page).toHaveURL(new RegExp(`/monitors/${id}$`));

    const read = await request.get(`/api/monitors/${id}`);
    expect(read.status()).toBe(200);
    expect(((await read.json()) as { alertConfig?: { warnings?: Record<string, boolean> } }).alertConfig?.warnings).toEqual({
      heartbeat_late: false,
    });
  });
});
