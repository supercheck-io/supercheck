import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const setSreIncidentWatching = jest.fn();
jest.mock("@/actions/sre-incident-lifecycle", () => ({ setSreIncidentWatching: (...a: unknown[]) => setSreIncidentWatching(...a) }));
jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: () => ({ projectId: "p1" }) }));
const invalidateQueries = jest.fn();
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries }) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

import { WatchSreIncidentButton } from "./watch-sre-incident-button";

beforeEach(() => jest.clearAllMocks());

it("watches an incident the user is not following", async () => {
  setSreIncidentWatching.mockResolvedValue({ success: true, message: "ok" });
  render(<WatchSreIncidentButton incidentId="i1" watching={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Watch" }));
  await waitFor(() => expect(setSreIncidentWatching).toHaveBeenCalledWith({ incidentId: "i1", watching: true }));
  await waitFor(() => expect(invalidateQueries).toHaveBeenCalled());
});

it("unwatches when already watching", async () => {
  setSreIncidentWatching.mockResolvedValue({ success: true, message: "ok" });
  render(<WatchSreIncidentButton incidentId="i1" watching />);
  fireEvent.click(screen.getByRole("button", { name: "Unwatch" }));
  await waitFor(() => expect(setSreIncidentWatching).toHaveBeenCalledWith({ incidentId: "i1", watching: false }));
});
