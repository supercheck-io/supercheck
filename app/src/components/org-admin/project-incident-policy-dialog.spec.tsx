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
