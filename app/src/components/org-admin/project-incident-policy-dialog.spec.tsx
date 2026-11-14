import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const getPolicy = jest.fn();
const savePolicy = jest.fn();
jest.mock("@/actions/notification-policy", () => ({
  getProjectNotificationPolicy: (...a: unknown[]) => getPolicy(...a),
  saveProjectNotificationPolicy: (...a: unknown[]) => savePolicy(...a),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

import { ProjectIncidentPolicyDialog } from "./project-incident-policy-dialog";

const loaded = {
  success: true,
  data: {
    policy: {
      channelIds: [],
      emailServiceOwnersOnSev12: false,
      renotifyUnackedMinutes: null,
      renotifyRepeatMinutes: null,
      renotifyMax: 3,
      escalateAfterMinutes: null,
      escalateChannelId: null,
      escalateUserId: null,
      autoInvestigateOnOpen: false,
    },
    channels: [
      { id: "c1", name: "Ops Slack", type: "slack", paging: false },
      { id: "c2", name: "PagerDuty", type: "webhook", paging: true },
    ],
    members: [{ id: "u1", name: "Grace" }],
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  getPolicy.mockResolvedValue(loaded);
  savePolicy.mockResolvedValue({ success: true });
});

it("saves the chosen channels and a re-notify time", async () => {
  const onOpenChange = jest.fn();
  render(<ProjectIncidentPolicyDialog open onOpenChange={onOpenChange} projectId="p1" projectName="Prod" />);
  fireEvent.click(await screen.findByText("Ops Slack"));
  fireEvent.click(screen.getByLabelText("Remind if nobody acknowledges"));
  fireEvent.change(screen.getByLabelText("First after"), { target: { value: "20" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(savePolicy).toHaveBeenCalledWith("p1", {
      channelIds: ["c1"],
      emailServiceOwnersOnSev12: false,
      renotifyUnackedMinutes: 20,
      renotifyRepeatMinutes: null,
      renotifyMax: 1,
      escalateAfterMinutes: null,
      escalateChannelId: null,
      escalateUserId: null,
      autoInvestigateOnOpen: false,
    }),
  );
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
});

it("keeps Save disabled for an out-of-range re-notify time", async () => {
  render(<ProjectIncidentPolicyDialog open onOpenChange={jest.fn()} projectId="p1" projectName="Prod" />);
  await screen.findByText("Ops Slack");
  fireEvent.click(screen.getByLabelText("Remind if nobody acknowledges"));
  fireEvent.change(screen.getByLabelText("First after"), { target: { value: "2" } });
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

it("drops a saved channel that no longer exists so Save is not refused", async () => {
  getPolicy.mockResolvedValue({ ...loaded, data: { ...loaded.data, policy: { ...loaded.data.policy, channelIds: ["gone", "c1"] } } });
  render(<ProjectIncidentPolicyDialog open onOpenChange={jest.fn()} projectId="p1" projectName="Prod" />);
  await screen.findByText("Ops Slack");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(savePolicy).toHaveBeenCalledWith("p1", expect.objectContaining({ channelIds: ["c1"] })));
});

it("shows an error instead of an endless spinner when the policy cannot be loaded", async () => {
  getPolicy.mockRejectedValue(new Error("network"));
  render(<ProjectIncidentPolicyDialog open onOpenChange={jest.fn()} projectId="p1" projectName="Prod" />);
  expect(await screen.findByText(/Failed to load the policy/)).toBeInTheDocument();
});

it("keeps the dialog open and reports a failed save", async () => {
  const onOpenChange = jest.fn();
  savePolicy.mockRejectedValue(new Error("network"));
  render(<ProjectIncidentPolicyDialog open onOpenChange={onOpenChange} projectId="p1" projectName="Prod" />);
  await screen.findByText("Ops Slack");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(require("sonner").toast.error).toHaveBeenCalledWith("Failed to save"));
  expect(onOpenChange).not.toHaveBeenCalledWith(false);
});

it("stops offering channels once ten are selected, matching the server limit", async () => {
  const channels = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, name: `Channel ${i}`, type: "slack" }));
  getPolicy.mockResolvedValue({ success: true, data: { policy: { ...loaded.data.policy, channelIds: channels.slice(0, 10).map((c) => c.id) }, channels } });
  render(<ProjectIncidentPolicyDialog open onOpenChange={jest.fn()} projectId="p1" projectName="Prod" />);
  await screen.findByText("Channel 11");
  const boxes = screen.getAllByRole("checkbox").slice(0, 12);
  expect(boxes[10]).toBeDisabled();
  expect(boxes[11]).toBeDisabled();
  expect(boxes[0]).not.toBeDisabled();
});

it("saves a repeat schedule, and blocks one longer than 2 days", async () => {
  render(<ProjectIncidentPolicyDialog open onOpenChange={jest.fn()} projectId="p1" projectName="Prod" />);
  await screen.findByText("Ops Slack");
  fireEvent.click(screen.getByLabelText("Remind if nobody acknowledges"));
  fireEvent.change(screen.getByLabelText("First after"), { target: { value: "15" } });
  fireEvent.click(screen.getByLabelText("Repeat the reminder"));
  fireEvent.change(screen.getByLabelText("Then every"), { target: { value: "1440" } });
  fireEvent.change(screen.getByLabelText("at most"), { target: { value: "4" } });
  expect(screen.getByRole("alert")).toHaveTextContent("Reminders must finish within 2 days");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Then every"), { target: { value: "60" } });
  fireEvent.change(screen.getByLabelText("at most"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(savePolicy).toHaveBeenCalledWith("p1", expect.objectContaining({ renotifyUnackedMinutes: 15, renotifyRepeatMinutes: 60, renotifyMax: 3 })),
  );
});

it("requires an escalation target before Save", async () => {
  render(<ProjectIncidentPolicyDialog open onOpenChange={jest.fn()} projectId="p1" projectName="Prod" />);
  await screen.findByText("Ops Slack");
  fireEvent.click(screen.getByLabelText("Escalate if still unacknowledged"));
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

it("loads a saved member escalation and keeps it on save", async () => {
  getPolicy.mockResolvedValue({ ...loaded, data: { ...loaded.data, policy: { ...loaded.data.policy, escalateAfterMinutes: 45, escalateUserId: "u1" } } });
  render(<ProjectIncidentPolicyDialog open onOpenChange={jest.fn()} projectId="p1" projectName="Prod" />);
  await screen.findByText("Ops Slack");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(savePolicy).toHaveBeenCalledWith("p1", expect.objectContaining({ escalateAfterMinutes: 45, escalateUserId: "u1", escalateChannelId: null })),
  );
});

it("says when the escalation target was removed and blocks Save until a new one is chosen", async () => {
  getPolicy.mockResolvedValue({ ...loaded, data: { ...loaded.data, policy: { ...loaded.data.policy, escalateAfterMinutes: 30 } } });
  render(<ProjectIncidentPolicyDialog open onOpenChange={jest.fn()} projectId="p1" projectName="Prod" />);
  expect(await screen.findByText(/Escalation target was removed/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

it("shows paging channels as not selectable for incident messages", async () => {
  render(<ProjectIncidentPolicyDialog open onOpenChange={jest.fn()} projectId="p1" projectName="Prod" />);
  await screen.findByText("Ops Slack");
  expect(screen.getByText("Paged by monitor and job alerts")).toBeInTheDocument();
  const row = screen.getByText("PagerDuty").closest("label") as HTMLElement;
  expect(row.querySelector("button[role=checkbox]")).toBeDisabled();
  expect(screen.getByText("Reminders stop when someone acknowledges, resolves or lowers the severity.")).toBeInTheDocument();
});
