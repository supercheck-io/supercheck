import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { toast } from "sonner";
import { ResolveSreIncidentDialog } from "./resolve-sre-incident-dialog";

const invalidateQueries = jest.fn().mockResolvedValue(undefined);
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));
jest.mock("@/hooks/use-project-context", () => ({
  useProjectContext: () => ({ projectId: "project-1" }),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), warning: jest.fn() } }));

describe("ResolveSreIncidentDialog", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("starts each open from the current default, not a stale one from an earlier render", () => {
    const { rerender } = render(<ResolveSreIncidentDialog incidentId="incident-1" defaultSummary="Checks are passing again." open onOpenChange={jest.fn()} />);
    expect(screen.getByRole("textbox")).toHaveValue("Checks are passing again.");
    rerender(<ResolveSreIncidentDialog incidentId="incident-1" defaultSummary="Checks are passing again." open={false} onOpenChange={jest.fn()} />);
    rerender(<ResolveSreIncidentDialog incidentId="incident-1" defaultSummary="Root cause only." open onOpenChange={jest.fn()} />);
    expect(screen.getByRole("textbox")).toHaveValue("Root cause only.");
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
    expect(toast.success).toHaveBeenCalledWith(
      "Incident resolved",
      expect.objectContaining({
        description: "You can generate a post-mortem draft in the Post-mortem tab.",
      }),
    );
  });

  it("publishes the resolution to the linked status pages by default, and can opt out", async () => {
    jest.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, message: "Incident #3 resolved", statusPageMessage: "Resolution posted to Public status", warning: "The resolution could not be posted to Enterprise status. Post it from the status page." }),
    } as Response);
    const { unmount } = render(<ResolveSreIncidentDialog incidentId="incident-1" defaultSummary="Rolled back." open onOpenChange={jest.fn()} statusPages={["Public status", "Enterprise status"]} />);
    const publish = screen.getByLabelText("Publish resolution to 2 status pages");
    expect(publish).toBeChecked();
    expect(screen.getByText(/Public status, Enterprise status/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Resolve incident" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(JSON.parse(jest.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ comment: "Rolled back.", publishToStatusPages: true });
    expect(toast.warning).toHaveBeenCalledWith("The resolution could not be posted to Enterprise status. Post it from the status page.");
    expect(toast.success).toHaveBeenCalledWith("Incident #3 resolved", expect.objectContaining({ description: expect.stringContaining("Resolution posted to Public status") }));
    unmount();

    jest.mocked(fetch).mockClear();
    render(<ResolveSreIncidentDialog incidentId="incident-1" defaultSummary="Rolled back." open onOpenChange={jest.fn()} statusPages={["Public status"]} />);
    fireEvent.click(screen.getByLabelText("Publish resolution to the status page"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Resolve incident" }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(JSON.parse(jest.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ comment: "Rolled back." });
  });

  it("offers no publish option without open linked status pages", () => {
    render(<ResolveSreIncidentDialog incidentId="incident-1" open onOpenChange={jest.fn()} />);
    expect(screen.queryByLabelText(/Publish resolution/)).not.toBeInTheDocument();
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

  it("ties the note field to its error text", async () => {
    jest
      .mocked(fetch)
      .mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Access denied" }),
      } as Response);
    render(<ResolveSreIncidentDialog incidentId="incident-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Resolve incident" }));
    const note = screen.getByLabelText("What confirmed recovery?");
    expect(note).not.toHaveAttribute("aria-invalid", "true");
    fireEvent.change(note, { target: { value: "Monitor recovered." } });
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Resolve incident",
      }),
    );
    const alert = await screen.findByRole("alert");
    expect(note).toHaveAttribute("aria-invalid", "true");
    expect(note).toHaveAttribute("aria-describedby", alert.id);
  });
});
