import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

import { NotificationProviderForm } from "./notification-provider-form";
import { ChannelTypeIcon } from "./channel-icon";
import { WEBHOOK_PRESETS } from "@/lib/notification-providers/webhook-presets";

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
});

const openAdvanced = () => fireEvent.click(screen.getByTestId("webhook-advanced-toggle"));

const pickType = async (name: string | RegExp) => {
  await openTypeSelect();
  fireEvent.click(await screen.findByRole("option", { name }));
};

const openTypeSelect = () => {
  fireEvent.keyDown(screen.getByTestId("channel-type-select"), { key: "Enter" });
  return screen.findByRole("listbox");
};

describe("ChannelTypeIcon", () => {
  it.each(["email", "slack", "telegram", "discord", "teams", "webhook"])("renders a decorative svg for %s", (type) => {
    const { container } = render(<ChannelTypeIcon type={type} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it.each(WEBHOOK_PRESETS.map((p) => p.id))("renders a logo for preset %s", (id) => {
    const { container } = render(<ChannelTypeIcon type="webhook" presetId={id} />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("NotificationProviderForm channel type picker", () => {
  it("groups options with headings, shows a logo on every option and never lists Opsgenie", async () => {
    render(<NotificationProviderForm />);
    const list = await openTypeSelect();
    for (const heading of ["Chat and email", "Paging and on-call", "Webhooks"]) {
      expect(within(list).getByText(heading)).toBeInTheDocument();
    }
    const options = within(list).getAllByRole("option");
    expect(options.length).toBeGreaterThanOrEqual(11);
    for (const option of options) expect(option.querySelector("svg")).not.toBeNull();
    expect(within(list).queryByText(/opsgenie/i)).toBeNull();
    expect(list.querySelectorAll('[role="separator"], [data-slot="select-separator"]').length).toBeGreaterThanOrEqual(2);
  });

  it("uses sentence-case labels and required markers", () => {
    render(<NotificationProviderForm />);
    expect(screen.getByText("Channel type")).toBeInTheDocument();
    expect(screen.queryByText("Channel Type")).toBeNull();
    expect(screen.getByRole("button", { name: "Test connection" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create channel" })).toBeInTheDocument();
    expect(screen.getByText("Title").querySelector('[aria-hidden="true"]')?.textContent).toBe("*");
  });
});

describe("NotificationProviderForm fields", () => {
  const cases: Array<[string, string, string[]]> = [
    ["email", "Email configuration", ["Email addresses"]],
    ["slack", "Slack configuration", ["Webhook URL", "Channel"]],
    ["telegram", "Telegram configuration", ["Bot token", "Chat ID"]],
    ["discord", "Discord configuration", ["Webhook URL"]],
    ["teams", "Microsoft Teams configuration", ["Incoming webhook URL"]],
    ["webhook", "Webhook configuration", ["URL", "Advanced"]],
  ];
  it.each(cases)("%s shows its fields and a trigger logo", (type, heading, labels) => {
    render(<NotificationProviderForm defaultType={type as never} />);
    expect(screen.getByText(heading)).toBeInTheDocument();
    for (const label of labels) expect(screen.getAllByText(label, { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByTestId("channel-type-select").querySelector("svg")).not.toBeNull();
  });

  it("shows inline validation and does not submit on Enter", async () => {
    const onSuccess = jest.fn();
    render(<NotificationProviderForm onSuccess={onSuccess} />);
    expect(fireEvent.keyDown(screen.getByPlaceholderText(/On-call alerts/), { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(screen.getByPlaceholderText(/oncall@example/), { key: "Enter" })).toBe(true);
    expect(onSuccess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Create channel" }));
    expect(await screen.findByText("At least one email address is required")).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("edit mode keeps secrets hidden and pre-fills non-secret values", () => {
    render(
      <NotificationProviderForm
        initialData={{ name: "Pager", type: "slack", config: { name: "Pager", channel: "#ops" } as never, maskedFields: ["webhookUrl"] }}
      />,
    );
    expect(screen.getByDisplayValue("#ops")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Unchanged/)).toHaveValue("");
    expect(screen.getByRole("button", { name: "Update channel" })).toBeInTheDocument();
    const label = screen.getByText("Webhook URL").closest("label")!;
    expect(label.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(screen.getByText("Leave blank to keep the current value.")).toBeInTheDocument();
  });

  it("marks secrets required on create", () => {
    render(<NotificationProviderForm defaultType="slack" />);
    expect(screen.getByText("Webhook URL").closest("label")!.querySelector('[aria-hidden="true"]')?.textContent).toBe("*");
  });

  it("exposes required state, except for stored secrets on edit", () => {
    const { unmount } = render(<NotificationProviderForm defaultType="slack" />);
    expect(screen.getByPlaceholderText(/hooks\.slack\.com/)).toHaveAttribute("aria-required", "true");
    unmount();
    render(
      <NotificationProviderForm
        initialData={{ name: "P", type: "slack", config: { name: "P" } as never, maskedFields: ["webhookUrl"] }}
      />,
    );
    expect(screen.getByPlaceholderText(/Unchanged/)).toHaveAttribute("aria-required", "false");
  });

  it("does not cancel Enter while an IME composition is active", () => {
    render(<NotificationProviderForm />);
    expect(fireEvent.keyDown(screen.getByPlaceholderText(/On-call alerts/), { key: "Enter", isComposing: true })).toBe(true);
  });

  it("lets textareas take Enter for new lines", () => {
    render(<NotificationProviderForm defaultType="webhook" />);
    openAdvanced();
    expect(fireEvent.keyDown(screen.getByLabelText(/Headers JSON/), { key: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(screen.getByLabelText(/Body template/), { key: "Enter" })).toBe(true);
  });
});

describe("Test connection result", () => {
  it("renders the result inline, not only as a toast", async () => {
    global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ success: false, error: "boom" }) }) as never;
    render(<NotificationProviderForm defaultType="slack" />);
    fireEvent.change(screen.getByPlaceholderText(/hooks\.slack\.com/), { target: { value: "https://hooks.slack.com/services/T0/B0/X" } });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    const result = await screen.findByTestId("test-connection-result");
    expect(result).toHaveAttribute("role", "alert");
    expect(result.textContent?.length).toBeGreaterThan(0);
    fireEvent.change(screen.getByPlaceholderText(/hooks\.slack\.com/), { target: { value: "https://hooks.slack.com/services/T0/B0/Y" } });
    await waitFor(() => expect(screen.queryByTestId("test-connection-result")).toBeNull());
  });

  it("shows success inline", async () => {
    global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ success: true, message: "Sent" }) }) as never;
    render(<NotificationProviderForm defaultType="slack" />);
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    const ok = await screen.findByTestId("test-connection-result");
    expect(ok).toHaveAttribute("role", "status");
    expect(ok.textContent).toContain("Sent");
  });
});

describe("dialog layout contract", () => {
  it("keeps one scroll region between a fixed header and footer", () => {
    const { container } = render(<NotificationProviderForm />);
    const form = container.querySelector("form")!;
    expect(form.className).toMatch(/flex-col/);
    const [body, footer] = Array.from(form.children) as HTMLElement[];
    expect(body.className).toMatch(/overflow-y-auto/);
    expect(body.className).toMatch(/min-h-0/);
    expect(footer.className).toMatch(/shrink-0/);
    expect(container.querySelectorAll(".overflow-y-auto").length).toBe(1);
  });
});

describe("NotificationProviderForm editing a saved vendor webhook", () => {
  it("sends empty headers when the preset is switched to Custom so the stored vendor token is not restored", async () => {
    const onSuccess = jest.fn().mockResolvedValue(undefined);
    render(
      <NotificationProviderForm
        onSuccess={onSuccess}
        initialData={{
          name: "Incident",
          type: "webhook",
          config: { name: "Incident", preset: "incident_io", method: "POST", url: "[REDACTED]", headers: {} } as never,
          maskedFields: ["url", "headers"],
        }}
      />,
    );
    await openTypeSelect();
    fireEvent.click(await screen.findByRole("option", { name: /custom webhook/i }));
    fireEvent.click(screen.getByRole("button", { name: "Update channel" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const config = onSuccess.mock.calls[0][0].config;
    expect(config.preset).toBe("custom");
    expect(config.headers).toEqual({});
  });

  it("sends empty headers when the user types {} to clear stored ones, and omits headers left blank", async () => {
    const renderEdit = () => {
      const onSuccess = jest.fn().mockResolvedValue(undefined);
      const view = render(
        <NotificationProviderForm
          onSuccess={onSuccess}
          initialData={{
            name: "Hook",
            type: "webhook",
            config: { name: "Hook", preset: "custom", method: "POST", url: "[REDACTED]", headers: {} } as never,
            maskedFields: ["url", "headers"],
          }}
        />,
      );
      return { onSuccess, view };
    };
    const first = renderEdit();
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/headers/i), { target: { value: "{}" } });
    fireEvent.click(screen.getByRole("button", { name: "Update channel" }));
    await waitFor(() => expect(first.onSuccess).toHaveBeenCalled());
    expect(first.onSuccess.mock.calls[0][0].config.headers).toEqual({});
    first.view.unmount();

    const second = renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "Update channel" }));
    await waitFor(() => expect(second.onSuccess).toHaveBeenCalled());
    expect(second.onSuccess.mock.calls[0][0].config).not.toHaveProperty("headers");
  });
});

describe("paging presets: typed credentials and Advanced", () => {
  const pdDefault = WEBHOOK_PRESETS.find((p) => p.id === "pagerduty")!.config.bodyTemplate!;

  it("hides URL, method, headers and body under a closed Advanced section, and drops the preset select", async () => {
    render(<NotificationProviderForm />);
    await pickType("PagerDuty");
    expect(screen.getByLabelText(/Routing key/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Headers JSON/)).toBeNull();
    expect(screen.queryByLabelText(/^URL/)).toBeNull();
    expect(screen.queryByRole("combobox", { name: /integration preset/i })).toBeNull();
    openAdvanced();
    expect(screen.getByLabelText(/Headers JSON/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^URL/)).toHaveValue("https://events.pagerduty.com/v2/enqueue");
  });

  it("does not show required errors before the first submit when a preset fills the form", async () => {
    render(<NotificationProviderForm />);
    await pickType(/custom webhook/i);
    await pickType("PagerDuty");
    await pickType(/custom webhook/i);
    expect(screen.queryByText("Webhook URL is required")).toBeNull();
  });

  it("writes the routing key into the body template and nowhere else", async () => {
    const onSuccess = jest.fn().mockResolvedValue(undefined);
    render(<NotificationProviderForm onSuccess={onSuccess} />);
    await pickType("PagerDuty");
    fireEvent.change(screen.getByPlaceholderText(/On-call alerts/), { target: { value: "PD" } });
    fireEvent.change(screen.getByLabelText(/Routing key/), { target: { value: "R0UTE" } });
    fireEvent.click(screen.getByRole("button", { name: "Create channel" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const config = onSuccess.mock.calls[0][0].config;
    expect(config.bodyTemplate).toContain('"routing_key": "R0UTE"');
    expect(config.bodyTemplate).not.toContain("REPLACE_WITH_");
    expect(config.headers).toBeUndefined();
  });

  it("asks for the routing key next to the field instead of saving the placeholder", async () => {
    const onSuccess = jest.fn();
    render(<NotificationProviderForm onSuccess={onSuccess} />);
    await pickType("PagerDuty");
    fireEvent.change(screen.getByPlaceholderText(/On-call alerts/), { target: { value: "PD" } });
    fireEvent.click(screen.getByRole("button", { name: "Create channel" }));
    expect(await screen.findByText("Routing key is required")).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("keeps a hidden saved template when the routing key is left blank, and replaces it when one is typed", async () => {
    const renderEdit = () => {
      const onSuccess = jest.fn().mockResolvedValue(undefined);
      const view = render(
        <NotificationProviderForm
          onSuccess={onSuccess}
          initialData={{
            name: "PD",
            type: "webhook",
            // Viewers and masked reads get no bodyTemplate at all.
            config: { name: "PD", preset: "pagerduty", method: "POST", url: "https://events.pagerduty.com/v2/enqueue", headers: {} } as never,
            maskedFields: ["headers", "bodyTemplate"],
          }}
        />,
      );
      return { onSuccess, view };
    };
    const first = renderEdit();
    const key = screen.getByLabelText(/Routing key/);
    expect(key).toHaveAttribute("aria-required", "false");
    expect(key).toHaveAttribute("placeholder", expect.stringMatching(/Unchanged/));
    fireEvent.click(screen.getByRole("button", { name: "Update channel" }));
    await waitFor(() => expect(first.onSuccess).toHaveBeenCalled());
    expect(first.onSuccess.mock.calls[0][0].config).not.toHaveProperty("bodyTemplate");
    first.view.unmount();

    const second = renderEdit();
    fireEvent.change(screen.getByLabelText(/Routing key/), { target: { value: "NEWKEY" } });
    fireEvent.click(screen.getByRole("button", { name: "Update channel" }));
    await waitFor(() => expect(second.onSuccess).toHaveBeenCalled());
    expect(second.onSuccess.mock.calls[0][0].config.bodyTemplate).toBe(pdDefault.replace("REPLACE_WITH_PAGERDUTY_ROUTING_KEY", "NEWKEY"));
  });

  it("shows the saved routing key to editors and keeps template edits in sync", async () => {
    render(
      <NotificationProviderForm
        initialData={{
          name: "PD",
          type: "webhook",
          config: { name: "PD", preset: "pagerduty", method: "POST", url: "https://events.pagerduty.com/v2/enqueue", headers: {}, bodyTemplate: '{"routing_key":"SAVED","x":1}' } as never,
          maskedFields: ["headers"],
        }}
      />,
    );
    expect(screen.getByLabelText(/Routing key/)).toHaveValue("SAVED");
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/Body template/), { target: { value: '{"x":1}' } });
    expect(screen.getByLabelText(/Routing key/)).toBeDisabled();
    expect(screen.getByText(/has no routing_key/)).toBeInTheDocument();
  });

  it("writes the JSM API key as a GenieKey Authorization header", async () => {
    const onSuccess = jest.fn().mockResolvedValue(undefined);
    render(<NotificationProviderForm onSuccess={onSuccess} />);
    await pickType("Jira Service Management");
    fireEvent.change(screen.getByPlaceholderText(/On-call alerts/), { target: { value: "JSM" } });
    expect(screen.getByLabelText(/API key/)).toHaveValue("");
    fireEvent.change(screen.getByLabelText(/API key/), { target: { value: "k-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Create channel" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onSuccess.mock.calls[0][0].config.headers).toEqual({ Authorization: "GenieKey k-123" });
  });

  it("writes the incident.io token as a Bearer header and shows the URL up front", async () => {
    const onSuccess = jest.fn().mockResolvedValue(undefined);
    render(<NotificationProviderForm onSuccess={onSuccess} />);
    await pickType("incident.io");
    fireEvent.change(screen.getByPlaceholderText(/On-call alerts/), { target: { value: "IO" } });
    fireEvent.change(screen.getByLabelText(/^URL/), { target: { value: "https://api.incident.io/v2/alert_events/http/abc" } });
    fireEvent.change(screen.getByLabelText(/API token/), { target: { value: "tok" } });
    fireEvent.click(screen.getByRole("button", { name: "Create channel" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onSuccess.mock.calls[0][0].config.headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("on a saved JSM channel, says the key must be entered again after a URL change and otherwise omits headers", async () => {
    const onSuccess = jest.fn().mockResolvedValue(undefined);
    render(
      <NotificationProviderForm
        onSuccess={onSuccess}
        initialData={{
          name: "JSM",
          type: "webhook",
          config: { name: "JSM", preset: "jsm_ops", method: "POST", url: "[REDACTED]", headers: {} } as never,
          maskedFields: ["url", "headers"],
        }}
      />,
    );
    expect(screen.getByText(/Saved headers are only kept while the URL and preset stay the same/)).toBeInTheDocument();
    expect(screen.getByLabelText(/API key/)).toHaveAttribute("aria-required", "false");
    openAdvanced();
    fireEvent.change(screen.getByLabelText(/^URL/), { target: { value: "https://api.eu.atlassian.com/jsm/ops/integration/v2/alerts" } });
    expect(screen.getByText(/enter the api key again/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Update channel" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    // Blank key: headers omitted, so the server refuses the URL change instead of silently dropping the key.
    expect(onSuccess.mock.calls[0][0].config).not.toHaveProperty("headers");
  });
});
