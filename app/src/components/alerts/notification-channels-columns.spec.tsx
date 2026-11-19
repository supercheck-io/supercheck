import { fireEvent, render, screen } from "@testing-library/react";
import type { CellContext } from "@tanstack/react-table";

// Radix menus need pointer and layout APIs jsdom lacks; render the items inline.
jest.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick, ...props }: { children: React.ReactNode; onClick?: (e: React.MouseEvent) => void }) => (
    <button type="button" onClick={onClick} {...props}>{children}</button>
  ),
}));

import { ChannelHealthBadge, channelProviderKey, channelUsageText, notificationChannelColumns } from "./notification-channels-columns";
import type { NotificationChannel } from "./notification-channels-schema";

const channel = (over: Partial<NotificationChannel> = {}): NotificationChannel => ({
  id: "c1",
  name: "PD",
  type: "webhook",
  config: { preset: "pagerduty" },
  isEnabled: true,
  createdAt: "2026-11-14T00:00:00Z",
  ...over,
});

const cellOf = (key: string) => {
  const column = notificationChannelColumns.find((c) => (c as { accessorKey?: string }).accessorKey === key || c.id === key)!;
  return column.cell as (ctx: CellContext<NotificationChannel, unknown>) => React.ReactNode;
};
const ctx = (original: NotificationChannel, meta: Record<string, unknown> = {}) =>
  ({ row: { original, getValue: (k: string) => (original as Record<string, unknown>)[k] }, table: { options: { meta } } }) as unknown as CellContext<NotificationChannel, unknown>;

describe("ChannelHealthBadge", () => {
  it("names an auth failure and other failures; nothing when healthy or unused", () => {
    const { rerender } = render(<ChannelHealthBadge health={{ state: "auth_failed", at: null }} />);
    expect(screen.getByText("Check the integration key")).toBeInTheDocument();
    rerender(<ChannelHealthBadge health={{ state: "failing", at: null }} />);
    expect(screen.getByText("Last delivery failed")).toBeInTheDocument();
    rerender(<ChannelHealthBadge health={{ state: "ok", at: null }} />);
    expect(screen.queryByTestId("channel-health-badge")).toBeNull();
    rerender(<ChannelHealthBadge />);
    expect(screen.queryByTestId("channel-health-badge")).toBeNull();
  });
});

describe("channel columns", () => {
  it("shows the paging vendor as the provider", () => {
    render(<>{cellOf("type")(ctx(channel()))}</>);
    expect(screen.getByText("PagerDuty")).toBeInTheDocument();
  });

  it("offers Send test page to editors and hides it otherwise", () => {
    const onTest = jest.fn();
    const { unmount } = render(<>{cellOf("actions")(ctx(channel(), { canEdit: true, onTest }))}</>);
    expect(screen.getByTestId("channel-send-test")).toHaveTextContent("Send test page");
    fireEvent.click(screen.getByTestId("channel-send-test"));
    expect(onTest).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }));
    unmount();
    render(<>{cellOf("actions")(ctx(channel({ type: "slack", config: {} }), { canEdit: false, onTest }))}</>);
    expect(screen.queryByTestId("channel-send-test")).toBeNull();
  });
});

it("labels the test for chat channels as a message", () => {
  render(<>{cellOf("actions")(ctx(channel({ type: "slack", config: {} }), { canEdit: true, onTest: jest.fn() }))}</>);
  expect(screen.getByTestId("channel-send-test")).toHaveTextContent("Send test message");
});

describe("Used by and Last test", () => {
  it("names what sends to the channel, or says it is unused", () => {
    expect(channelUsageText({ monitors: 2, jobs: 1, policy: true })).toBe("2 monitors, 1 job, incident policy");
    expect(channelUsageText({ monitors: 0, jobs: 0, policy: true })).toBe("Incident policy");
    expect(channelUsageText({ monitors: 1, jobs: 0, policy: false })).toBe("1 monitor");
    expect(channelUsageText({ monitors: 0, jobs: 0, policy: false })).toBeUndefined();
    render(<>{cellOf("usage")(ctx(channel({ usage: { monitors: 0, jobs: 3, policy: false } })))}</>);
    expect(screen.getByText("3 jobs")).toBeInTheDocument();
  });

  it("shows Not used when nothing references the channel", () => {
    render(<>{cellOf("usage")(ctx(channel({ usage: { monitors: 0, jobs: 0, policy: false } })))}</>);
    expect(screen.getByText("Not used")).toBeInTheDocument();
  });

  it("shows the newest test result, or Not tested", () => {
    const { rerender } = render(<>{cellOf("lastTest")(ctx(channel({ lastTest: { state: "ok", at: "2026-11-18T00:00:00Z" } })))}</>);
    expect(screen.getByTestId("channel-last-test")).toHaveTextContent("Passed");
    rerender(<>{cellOf("lastTest")(ctx(channel({ lastTest: { state: "auth_failed", at: "2026-11-18T00:00:00Z" } })))}</>);
    expect(screen.getByTestId("channel-last-test")).toHaveTextContent("Failed");
    rerender(<>{cellOf("lastTest")(ctx(channel({ lastTest: null })))}</>);
    expect(screen.getByText("Not tested")).toBeInTheDocument();
  });

  it("keys the provider filter by paging preset, else by type", () => {
    expect(channelProviderKey(channel())).toBe("pagerduty");
    expect(channelProviderKey(channel({ config: { preset: "custom" } }))).toBe("webhook");
    expect(channelProviderKey(channel({ type: "slack", config: {} }))).toBe("slack");
  });
});
