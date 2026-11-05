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
    policy: { channelIds: [], emailServiceOwnersOnSev12: false, renotifyUnackedMinutes: null, autoInvestigateOnOpen: false },
    channels: [{ id: "c1", name: "Ops Slack", type: "slack" }],
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
  fireEvent.click(screen.getByLabelText("Remind once if nobody acknowledges"));
  fireEvent.change(screen.getByLabelText("After"), { target: { value: "20" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(savePolicy).toHaveBeenCalledWith("p1", {
      channelIds: ["c1"],
      emailServiceOwnersOnSev12: false,
      renotifyUnackedMinutes: 20,
      autoInvestigateOnOpen: false,
    }),
  );
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
});

it("keeps Save disabled for an out-of-range re-notify time", async () => {
  render(<ProjectIncidentPolicyDialog open onOpenChange={jest.fn()} projectId="p1" projectName="Prod" />);
  await screen.findByText("Ops Slack");
  fireEvent.click(screen.getByLabelText("Remind once if nobody acknowledges"));
  fireEvent.change(screen.getByLabelText("After"), { target: { value: "2" } });
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
