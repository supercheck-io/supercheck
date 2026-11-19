import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: () => ({ currentProject: { userRole: "project_admin" } }) }));
jest.mock("./notification-channels-data-table", () => ({
  NotificationChannelsDataTable: ({ data, meta }: { data: unknown[]; meta: { onTest: (c: unknown) => void } }) => (
    <button type="button" onClick={() => meta.onTest(data[0])}>send-test</button>
  ),
}));
jest.mock("./channel-test-dialog", () => ({
  ChannelTestDialog: ({ channel, onOpenChange }: { channel: unknown; onOpenChange: (open: boolean) => void }) =>
    channel ? <button type="button" onClick={() => onOpenChange(false)}>close-test</button> : null,
}));

import { NotificationChannelsComponent } from "./notification-channels-component";

it("refetches the channel list after a test, so Last test shows the new result", async () => {
  const client = new QueryClient();
  const invalidate = jest.spyOn(client, "invalidateQueries");
  const channel = { id: "c1", name: "PD", type: "webhook", config: {}, isEnabled: true, createdAt: "2026-11-18T00:00:00Z" } as const;
  render(
    <QueryClientProvider client={client}>
      <NotificationChannelsComponent providersData={[channel]} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "send-test" }));
  fireEvent.click(screen.getByRole("button", { name: "close-test" }));
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["notification-providers"] }));
});
