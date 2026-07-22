import { expect, test } from "../../fixtures/roles.fixture";
import { requireRbacUser } from "../../utils/env";

type SreService = {
  id: string;
  name: string;
  environment: string | null;
  description: string | null;
  status: string;
};

test.describe("AI SRE service catalog @aisre @critical", () => {
  test.beforeAll(() => requireRbacUser("orgOwner"));

  test("creates, edits, opens, and archives a service through the UI", async ({
    orgOwnerPage: page,
  }) => {
    const projectsResponse = await page.request.get("/api/projects");
    expect(projectsResponse.status()).toBe(200);
    const projectsBody = (await projectsResponse.json()) as {
      currentProject: { id: string };
    };
    const originalProjectId = projectsBody.currentProject.id;
    const createProject = await page.request.post("/api/projects", {
      data: { name: `E2E AI SRE ${Date.now()}` },
    });
    expect(createProject.status(), await createProject.text()).toBe(201);
    const isolatedProject = (await createProject.json()) as {
      data: { id: string };
    };
    const switchResponse = await page.request.post("/api/projects/switch", {
      data: { projectId: isolatedProject.data.id },
    });
    expect(switchResponse.status(), await switchResponse.text()).toBe(200);

    try {
      const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const name = `E2E Service ${suffix}`;
      const updatedDescription = `Updated service ${suffix}`;

      await page.goto("/services", { waitUntil: "load" });
      await page.getByTestId("add-service-btn").click();
      const dialog = page.getByRole("dialog", { name: "Add service" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Service name *").fill(name);
      await dialog.getByLabel("Environment").fill("staging");
      await dialog.getByLabel("Description").fill(`Created service ${suffix}`);
      await dialog.getByTestId("submit-service-btn").click();
      await expect(dialog).toBeHidden();

      const created = await findService(page.request, name);
      expect(created).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          name,
          environment: "staging",
          status: "active",
        }),
      );
      if (!created) throw new Error(`SRE service ${name} was not persisted`);

      const row = page.getByRole("row").filter({ hasText: name });
      await expect(page.getByRole("columnheader")).toHaveText([
        "Service",
        "Env",
        "Description",
        "Tier",
        "Owner",
        "Repo",
        "Status",
        "",
      ]);
      await expect(row).toBeVisible();
      await row
        .getByRole("button", { name: `Open actions for ${name}` })
        .click();
      await page.getByRole("menuitem", { name: "Edit service" }).click();
      const editDialog = page.getByRole("dialog", { name: "Edit service" });
      await editDialog.getByLabel("Description").fill(updatedDescription);
      await editDialog.getByTestId("submit-service-btn").click();
      await expect
        .poll(async () => findService(page.request, name))
        .toEqual(
          expect.objectContaining({
            id: created.id,
            description: updatedDescription,
          }),
        );

      await row
        .getByRole("button", { name: `Open actions for ${name}` })
        .click();
      await page.getByRole("menuitem", { name: "View details" }).click();
      await expect(page).toHaveURL(new RegExp(`/services/${created.id}$`));
      await expect(page.getByRole("heading", { name })).toBeVisible();

      await page.goto("/services", { waitUntil: "load" });
      const persistedRow = page.getByRole("row").filter({ hasText: name });
      await persistedRow
        .getByRole("button", { name: `Open actions for ${name}` })
        .click();
      await page.getByRole("menuitem", { name: "Archive service" }).click();
      const archiveDialog = page.getByRole("alertdialog", {
        name: "Archive service?",
      });
      await archiveDialog
        .getByRole("button", { name: "Archive service" })
        .click();
      await expect
        .poll(async () => findService(page.request, name))
        .toEqual(
          expect.objectContaining({ id: created.id, status: "deprecated" }),
        );
    } finally {
      const restore = await page.request.post("/api/projects/switch", {
        data: { projectId: originalProjectId },
      });
      expect(restore.status(), await restore.text()).toBe(200);
      const remove = await page.request.delete(
        `/api/projects/${isolatedProject.data.id}`,
      );
      expect([200, 404]).toContain(remove.status());
    }
  });
});

test.describe("AI SRE investigation surfaces @aisre @critical", () => {
  test("loads the evidence graph as an authenticated project user", async ({
    page,
  }) => {
    await page.goto("/copilot/evidence-graph", { waitUntil: "load" });
    await expect(page).toHaveURL(/\/copilot\/evidence-graph$/);
    await expect(
      page.getByRole("navigation", { name: "breadcrumb" }),
    ).toContainText("Investigation Map");
    await expect(page.getByLabel("Investigation Map canvas")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("0 visible", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "No nodes match the current filters",
      }),
    ).toBeVisible();
  });

  test("sends a Copilot prompt and renders the saved response", async ({
    page,
  }) => {
    const prompt = `Give a read-only service health checklist ${Date.now()}`;
    await page.goto("/copilot", { waitUntil: "load" });
    await page.getByRole("button", { name: "New", exact: true }).click();

    const composer = page.getByPlaceholder(
      "Ask Copilot about an incident, service, or verification plan...",
    );
    await expect(composer).toBeEnabled({ timeout: 30_000 });
    await composer.fill(prompt);
    await page.getByRole("button", { name: "Send", exact: true }).click();

    const userMessage = page
      .getByLabel("User message")
      .filter({ hasText: prompt });
    await expect(userMessage).toBeVisible();
    const assistantMessage = page.getByLabel("Copilot message").last();
    await expect(assistantMessage).toBeVisible({ timeout: 60_000 });
    await expect(assistantMessage).not.toBeEmpty();

    await page.getByRole("button", { name: "New", exact: true }).click();
    await expect(page.getByLabel("User message")).toHaveCount(0);
    const savedSession = page
      .locator("aside button")
      .filter({ hasText: prompt });
    await expect(savedSession).toBeVisible();
    await savedSession.click();
    await expect(
      page.getByLabel("User message").filter({ hasText: prompt }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(
      page.getByText("Copilot session archived", { exact: true }),
    ).toBeVisible();
    await expect(savedSession).toHaveCount(0);
  });

  test("stops an in-flight Copilot stream and restores the composer", async ({
    page,
  }) => {
    let releaseChatRequest!: () => void;
    const chatRequestStarted = new Promise<void>((resolveStarted) => {
      void page.route("**/api/sre/chat/assistant-ui", async (route) => {
        resolveStarted();
        await new Promise<void>((resolveRelease) => {
          releaseChatRequest = resolveRelease;
        });
        await route.abort("aborted").catch(() => undefined);
      });
    });
    const prompt = `List a detailed read-only verification plan ${Date.now()}`;
    await page.goto("/copilot", { waitUntil: "load" });
    await page.getByRole("button", { name: "New", exact: true }).click();
    const composer = page.getByPlaceholder(
      "Ask Copilot about an incident, service, or verification plan...",
    );
    await expect(composer).toBeEnabled({ timeout: 30_000 });
    await composer.fill(prompt);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await chatRequestStarted;

    const stop = page.getByRole("button", { name: "Stop", exact: true });
    await expect(stop).toBeVisible({ timeout: 15_000 });
    await stop.click();
    releaseChatRequest();
    await expect(stop).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Send", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByLabel("User message").filter({ hasText: prompt }),
    ).toHaveCount(0);
  });

  test("supports context mentions and enforces read-only attachment constraints", async ({
    page,
  }) => {
    await page.goto("/copilot", { waitUntil: "load" });
    const composer = page.getByPlaceholder(
      "Ask Copilot about an incident, service, or verification plan...",
    );
    await expect(composer).toBeEnabled({ timeout: 30_000 });

    await composer.fill("@");
    const references = page.getByRole("listbox", {
      name: "Context references",
    });
    await expect(references.getByRole("option")).toHaveText([
      /@incidentReference the selected incident context/,
      /@serviceReference an affected service/,
      /@recent-deployAsk Copilot to consider recent deploy context/,
    ]);
    await references.getByRole("option", { name: /@service/ }).click();
    await expect(composer).toHaveValue("@service ");

    await dispatchAttachmentDrop(
      composer,
      "payload.png",
      "image/png",
      "not-an-image",
    );
    await expect(
      page.getByText(
        "Attach text, log, JSON, CSV, or Markdown files only for Copilot context.",
      ),
    ).toBeVisible();

    await dispatchAttachmentDrop(
      composer,
      "bounded-evidence.log",
      "text/plain",
      "level=error service=checkout correlation=e2e-only",
    );
    await expect(
      page.getByText("bounded-evidence.log", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Read-only", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Remove bounded-evidence.log" })
      .click();
    await expect(
      page.getByText("bounded-evidence.log", { exact: true }),
    ).toHaveCount(0);
  });

  test("opens the floating Copilot as a mobile full-screen dialog and hands off to the console", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/tests", { waitUntil: "load" });
    const launcher = page.getByRole("button", { name: "Open Copilot" });
    await expect(launcher).toHaveAttribute("aria-expanded", "false");
    await launcher.click();

    const dialog = page.getByRole("dialog", { name: "Copilot" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS("width", "390px");
    await expect(
      dialog.getByPlaceholder(
        "Ask Copilot about an incident, service, or verification plan...",
      ),
    ).toBeEnabled();
    await expect(dialog.getByText("Read-only", { exact: true })).toBeVisible();
    await dialog.getByRole("link", { name: "Open", exact: true }).click();
    await expect(page).toHaveURL(/\/copilot$/);
    await expect(
      page.getByRole("heading", { name: "Copilot", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open Copilot" }),
    ).toHaveCount(0);
  });
});

test.describe("AI SRE connector catalog @aisre @connectors @critical", () => {
  test.beforeAll(() => requireRbacUser("orgOwner"));

  test("offers every implemented live-search connector and omits setup-only adapters", async ({
    orgOwnerPage: page,
  }) => {
    await page.goto("/org-admin?tab=integrations");
    await expect(
      page.getByRole("tab", { name: "Integrations", exact: true }),
    ).toHaveAttribute("data-state", "active");
    await page
      .getByRole("button", { name: "Add connector", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Add connector" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Connector type").click();

    const implemented = [
      "GitHub",
      "GitLab",
      "Kubernetes",
      "Prometheus",
      "Grafana",
      "Sentry",
      "Datadog",
      "Loki",
      "Elasticsearch / OpenSearch",
      "Grafana Tempo",
      "AWS CloudWatch",
      "PagerDuty",
      "Opsgenie",
    ];
    for (const connector of implemented) {
      await expect(
        page.getByRole("option", { name: connector, exact: true }),
      ).toBeVisible();
    }
    for (const unsupported of [
      "Jira",
      "Confluence",
      "Notion",
      "Slack",
      "Microsoft Teams",
    ]) {
      await expect(
        page.getByRole("option", { name: unsupported, exact: true }),
      ).toHaveCount(0);
    }
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});

async function findService(
  request: import("@playwright/test").APIRequestContext,
  name: string,
): Promise<SreService | undefined> {
  const response = await request.get("/api/sre/services");
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    success: boolean;
    services: SreService[];
  };
  expect(body.success).toBe(true);
  return body.services.find((service) => service.name === name);
}

async function dispatchAttachmentDrop(
  composer: import("@playwright/test").Locator,
  fileName: string,
  mimeType: string,
  content: string,
): Promise<void> {
  await composer.evaluate(
    (element, file) => {
      const form = element.closest("form");
      if (!form) throw new Error("Copilot composer form was not found");
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([file.content], file.fileName, { type: file.mimeType }),
      );
      form.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
    },
    { fileName, mimeType, content },
  );
}
