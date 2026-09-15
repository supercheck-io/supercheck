import { TextDecoder, TextEncoder } from "util";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GenerateEvidenceBriefButton } from "./generate-evidence-brief-button";

const mockInvalidate = jest.fn().mockResolvedValue(undefined);
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }));
jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: () => ({ projectId: "project-a" }) }));
jest.mock("@/actions/sre-evidence", () => ({ generateSreEvidenceBrief: jest.fn() }));

describe("brief stream completion", () => {
  const originalFetch = global.fetch;
  const originalDecoder = global.TextDecoder;
  afterEach(() => { global.fetch = originalFetch; global.TextDecoder = originalDecoder; });

  it.each([false, true])("requires a completion event (received: %s)", async (complete) => {
    Object.defineProperty(global, "TextDecoder", { value: TextDecoder, writable: true, configurable: true });
    const events = 'data: {"type":"content","content":"Partial brief"}\n\n' + (complete ? 'data: {"type":"done","message":"Saved"}\n\n' : "");
    const read = jest.fn().mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(events) }).mockResolvedValue({ done: true });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, body: { getReader: () => ({ read }) } });
    const onStreamDone = jest.fn();
    const onStreamError = jest.fn();
    render(<GenerateEvidenceBriefButton incidentId="incident-a" hasBrief={false} onStreamStart={jest.fn()} onStreamContent={jest.fn()} onStreamDone={onStreamDone} onStreamError={onStreamError} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate brief" }));
    await waitFor(() => expect(complete ? onStreamDone : onStreamError).toHaveBeenCalled());
    expect(complete ? onStreamError : onStreamDone).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Generate brief" })).not.toBeDisabled();
    expect(global.fetch).toHaveBeenCalledWith("/api/sre/evidence-brief/stream", expect.objectContaining({ headers: expect.objectContaining({ "x-project-id": "project-a" }) }));
  });
});
