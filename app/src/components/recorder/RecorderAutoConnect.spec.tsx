import { render, waitFor } from "@testing-library/react";
import { RecorderAutoConnect } from "./RecorderAutoConnect";

jest.mock("@/utils/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "user-1", email: "user@example.com" } } }),
}));

function extensionSays(type: string, payload?: unknown) {
  window.dispatchEvent(new MessageEvent("message", {
    data: { source: "supercheck-recorder", type, payload },
    origin: window.location.origin,
    source: window,
  }));
}

const keyResponse = (data: Record<string, unknown>) =>
  ({ ok: true, json: async () => ({ success: true, data }) }) as Response;

describe("RecorderAutoConnect", () => {
  let fetchMock: jest.Mock;
  let posted: { type: string; payload?: Record<string, unknown> }[];

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    posted = [];
    jest.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
      posted.push(message as { type: string });
    });
  });

  afterEach(() => jest.restoreAllMocks());

  const requestBody = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body);

  it("tells the server which key the extension holds, and hands over a newly minted one", async () => {
    fetchMock.mockResolvedValue(keyResponse({ apiKey: "ext-new", keyId: "key-2" }));
    render(<RecorderAutoConnect />);

    extensionSays("SUPERCHECK_RECORDER_READY", { version: "1.0.3", hasKey: false });

    await waitFor(() => expect(posted.some((m) => m.type === "SUPERCHECK_AUTO_CONNECT")).toBe(true));
    expect(requestBody().clientKeyId).toBeNull();
    expect(posted.find((m) => m.type === "SUPERCHECK_AUTO_CONNECT")?.payload).toMatchObject({
      apiKey: "ext-new",
      keyId: "key-2",
    });
  });

  it("does not claim a key for an older extension that cannot report one", async () => {
    fetchMock.mockResolvedValue(keyResponse({ message: "Extension already connected", keyId: "key-1" }));
    render(<RecorderAutoConnect />);

    extensionSays("SUPERCHECK_RECORDER_READY", { version: "1.0.2" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(requestBody()).not.toHaveProperty("clientKeyId");
  });

  it("retries after the extension reports it could not store the key", async () => {
    fetchMock.mockResolvedValue(keyResponse({ apiKey: "ext-new", keyId: "key-2" }));
    render(<RecorderAutoConnect />);

    extensionSays("SUPERCHECK_RECORDER_READY", { version: "1.0.3", hasKey: false });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    extensionSays("SUPERCHECK_EXTENSION_CONNECTED", { success: false, error: "boom" });
    extensionSays("SUPERCHECK_RECORDER_READY", { version: "1.0.3", hasKey: false });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("does not mint a key for an extension that is set to another instance", async () => {
    render(<RecorderAutoConnect />);

    extensionSays("SUPERCHECK_RECORDER_READY", { version: "1.0.3", hasKey: false, connectable: false });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
