import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { RecordButton } from "./RecordButton";

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

type RecorderApi = {
  version: string;
  isConnected: jest.Mock;
  storeRecordingContext: jest.Mock;
};

function installRecorderApi(api: RecorderApi) {
  (window as unknown as { __SUPERCHECK_RECORDER__?: RecorderApi }).__SUPERCHECK_RECORDER__ = api;
}

function removeRecorderApi() {
  delete (window as unknown as { __SUPERCHECK_RECORDER__?: RecorderApi }).__SUPERCHECK_RECORDER__;
}

describe("RecordButton", () => {
  beforeAll(() => {
    Object.defineProperty(window.navigator, "userAgent", {
      value: "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140.0 Safari/537.36",
      configurable: true,
    });
  });

  afterEach(() => removeRecorderApi());

  it("points at the extension install and explains the self-hosted path when the API is absent", async () => {
    render(<RecordButton projectId="project-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Record Browser Test" }));

    const dialog = await screen.findByRole("dialog", { name: "Install Supercheck Recorder" });
    expect(dialog).toBeVisible();
    expect(within(dialog).getByRole("link", { name: "Install for Chrome" })).toHaveAttribute(
      "href",
      "https://chromewebstore.google.com/detail/supercheck-recorder/gfmbcelfhhfmifdkccnbgdadibdfhioe",
    );
    expect(within(dialog).getByText(/demo \/ self-hosted/i)).toBeInTheDocument();
    expect(within(dialog).getByText(window.location.origin)).toBeInTheDocument();
  });

  it("stores the recording context and asks the user to click the extension", async () => {
    const api: RecorderApi = {
      version: "1.0.2",
      isConnected: jest.fn().mockResolvedValue(true),
      storeRecordingContext: jest.fn().mockResolvedValue(undefined),
    };
    installRecorderApi(api);

    render(<RecordButton projectId="project-1" testName="Checkout" />);
    fireEvent.click(screen.getByRole("button", { name: "Record Browser Test" }));

    await waitFor(() => expect(api.storeRecordingContext).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1", testName: "Checkout" }),
    ));
    expect(await screen.findByRole("dialog", { name: "Start Recording" })).toBeVisible();
  });

  it("reports a failed hand-off instead of claiming the extension is missing", async () => {
    const api: RecorderApi = {
      version: "1.0.2",
      isConnected: jest.fn().mockResolvedValue(true),
      storeRecordingContext: jest.fn().mockRejectedValue(new Error("Invalid recording context")),
    };
    installRecorderApi(api);

    render(<RecordButton projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Record Browser Test" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Invalid recording context"));
    expect(screen.queryByRole("dialog", { name: "Install Supercheck Recorder" })).toBeNull();
  });

  it("does not start a recording before the project is known", async () => {
    const api: RecorderApi = {
      version: "1.0.2",
      isConnected: jest.fn().mockResolvedValue(true),
      storeRecordingContext: jest.fn(),
    };
    installRecorderApi(api);

    render(<RecordButton projectId="" />);

    expect(screen.getByRole("button", { name: "Record Browser Test" })).toBeDisabled();
  });

  it("shows the refresh dialog when the content script reports an updated extension", async () => {
    render(<RecordButton projectId="project-1" />);

    window.dispatchEvent(new MessageEvent("message", {
      data: {
        source: "supercheck-recorder",
        type: "SUPERCHECK_REFRESH_REQUIRED",
        payload: { reason: "Extension was updated. Please refresh the page." },
      },
      origin: window.location.origin,
      source: window,
    }));

    expect(await screen.findByRole("dialog", { name: "Page Refresh Required" })).toBeVisible();
  });
});
