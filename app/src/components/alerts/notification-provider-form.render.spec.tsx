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
    ["webhook", "Webhook configuration", ["URL", "Headers JSON", "Body template"]],
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
