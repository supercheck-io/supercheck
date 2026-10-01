import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ResolveSreIncidentDialog } from "./resolve-sre-incident-dialog";

const invalidateQueries = jest.fn().mockResolvedValue(undefined);
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));
jest.mock("@/hooks/use-project-context", () => ({
  useProjectContext: () => ({ projectId: "project-1" }),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn() } }));

describe("ResolveSreIncidentDialog", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("requires an explicit recovery note, scopes the request, and refreshes all affected views", async () => {
    jest
      .mocked(fetch)
      .mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);
    render(<ResolveSreIncidentDialog incidentId="incident-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Resolve incident" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: "Resolve incident" }),
    ).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("What confirmed recovery?"), {
      target: { value: "  Monitor recovered after rollback.  " },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Resolve incident" }),
    );
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(4));
    expect(fetch).toHaveBeenCalledWith(
      "/api/sre/incidents/incident-1/resolve",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-project-id": "project-1" }),
        body: JSON.stringify({ comment: "Monitor recovered after rollback." }),
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each(["denied", "disconnected"])(
    "retains the note and dialog when resolution is %s",
    async (failure) => {
      if (failure === "denied")
        jest
          .mocked(fetch)
          .mockResolvedValue({
            ok: false,
            json: async () => ({ error: "Access denied" }),
          } as Response);
      else
        jest.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
      render(<ResolveSreIncidentDialog incidentId="incident-1" />);
      fireEvent.click(screen.getByRole("button", { name: "Resolve incident" }));
      fireEvent.change(screen.getByLabelText("What confirmed recovery?"), {
        target: { value: "Monitor recovered." },
      });
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Resolve incident",
        }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        failure === "denied" ? "Access denied" : "Refresh the incident",
      );
      expect(screen.getByLabelText("What confirmed recovery?")).toHaveValue(
        "Monitor recovered.",
      );
      expect(invalidateQueries).not.toHaveBeenCalled();
    },
  );
});
