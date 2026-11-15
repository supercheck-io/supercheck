import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

import { toast as sonnerToast } from "sonner";
import { HeartbeatPingUrlPanel, pingSnippets, rememberCreatedPingUrl } from "./heartbeat-ping-url-panel";

const toast = sonnerToast as unknown as { success: jest.Mock; error: jest.Mock };

const URL = "https://app.example.com/api/heartbeat/hb_0123456789abcdef0123456789abcdef";
const ROTATED = "https://app.example.com/api/heartbeat/hb_ffffffffffffffffffffffffffffffff";

const ok = (pingUrl: string) => ({ ok: true, status: 200, json: async () => ({ pingUrl }) });
let fetchMock: jest.Mock;
const writeText = jest.fn();

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as never;
  writeText.mockReset().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  toast.success.mockReset();
  toast.error.mockReset();
});

const urlText = () => screen.getByTestId("heartbeat-ping-url");

describe("HeartbeatPingUrlPanel", () => {
  it("shows viewers a masked URL with no Reveal, Copy or Rotate (B23)", () => {
    render(<HeartbeatPingUrlPanel monitorId="m1" canManage={false} />);
    expect(urlText()).toHaveAttribute("data-revealed", "false");
    expect(urlText().textContent).toMatch(/\/api\/heartbeat\/hb_•+$/);
    for (const name of ["Reveal", "Copy", "Rotate URL"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reveals the URL for editors and fills the snippets", async () => {
    fetchMock.mockResolvedValue(ok(URL));
    render(<HeartbeatPingUrlPanel monitorId="m1" canManage />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    await waitFor(() => expect(urlText()).toHaveTextContent(URL));
    expect(fetchMock).toHaveBeenCalledWith("/api/monitors/m1/heartbeat-url", { method: "GET", cache: "no-store" });
    expect(screen.getByTestId("heartbeat-snippet-curl")).toHaveTextContent(`curl -fsS -m 10 --retry 5 ${URL}`);
    // Once revealed, Reveal goes away and Copy does not call the audited route again.
    expect(screen.queryByRole("button", { name: "Reveal" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Ping URL copied");
  });

  it("copy fetches the URL first when it is not revealed yet", async () => {
    fetchMock.mockResolvedValue(ok(URL));
    render(<HeartbeatPingUrlPanel monitorId="m1" canManage />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL));
  });

  it("tells the user when the clipboard is blocked", async () => {
    fetchMock.mockResolvedValue(ok(URL));
    writeText.mockRejectedValue(new Error("denied"));
    render(<HeartbeatPingUrlPanel monitorId="m1" canManage />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not copy. Reveal the URL and copy it by hand."));
  });

  it("rotates only after the confirm dialog and shows the new URL", async () => {
    fetchMock.mockResolvedValue(ok(ROTATED));
    render(<HeartbeatPingUrlPanel monitorId="m1" canManage />);
    fireEvent.click(screen.getByRole("button", { name: "Rotate URL" }));
    expect(await screen.findByText("The old URL stops working at once. Update your job before you rotate.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("heartbeat-rotate-confirm"));
    await waitFor(() => expect(urlText()).toHaveTextContent(ROTATED));
    expect(fetchMock).toHaveBeenCalledWith("/api/monitors/m1/heartbeat-url/rotate", { method: "POST", cache: "no-store" });
    expect(toast.success).toHaveBeenCalledWith("Ping URL rotated. Update your job with the new URL.");
  });

  it("cancelling the rotate dialog changes nothing", async () => {
    render(<HeartbeatPingUrlPanel monitorId="m1" canManage />);
    fireEvent.click(screen.getByRole("button", { name: "Rotate URL" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the rate-limit error with a retry that works", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) }).mockResolvedValueOnce(ok(URL));
    render(<HeartbeatPingUrlPanel monitorId="m1" canManage />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    expect(await screen.findByTestId("heartbeat-ping-url-error")).toHaveTextContent("Too many requests. Try again in a few minutes.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(urlText()).toHaveTextContent(URL));
    expect(screen.queryByTestId("heartbeat-ping-url-error")).toBeNull();
  });

  it("shows the server error message, or a generic one", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: "Insufficient permissions" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    render(<HeartbeatPingUrlPanel monitorId="m1" canManage />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    expect(await screen.findByTestId("heartbeat-ping-url-error")).toHaveTextContent("Insufficient permissions");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByTestId("heartbeat-ping-url-error")).toHaveTextContent("Could not load the ping URL."));
  });

  it("shows the URL returned by create once, without a reveal call", async () => {
    rememberCreatedPingUrl("m2", URL);
    const { unmount } = render(<HeartbeatPingUrlPanel monitorId="m2" canManage />);
    await waitFor(() => expect(urlText()).toHaveTextContent(URL));
    expect(fetchMock).not.toHaveBeenCalled();
    unmount();
    render(<HeartbeatPingUrlPanel monitorId="m2" canManage />);
    await act(async () => {});
    expect(urlText()).toHaveAttribute("data-revealed", "false");
  });

  it("ignores a create response without a ping URL", async () => {
    rememberCreatedPingUrl("m3", undefined);
    render(<HeartbeatPingUrlPanel monitorId="m3" canManage />);
    await act(async () => {});
    expect(urlText()).toHaveAttribute("data-revealed", "false");
  });

  it("shows the waiting state while pending and explains /start and /fail", () => {
    render(<HeartbeatPingUrlPanel monitorId="m1" canManage={false} pending />);
    expect(screen.getByTestId("heartbeat-waiting")).toHaveTextContent("Waiting for the first ping");
    expect(screen.getByText(/to record how long it ran/)).toBeInTheDocument();
    expect(screen.getByText(/to report a failure straight away/)).toBeInTheDocument();
  });

  it("builds curl, cron and CLI snippets", () => {
    expect(pingSnippets(URL)).toEqual({
      curl: `curl -fsS -m 10 --retry 5 ${URL}`,
      cron: `# Ping only when the job succeeds\n0 2 * * * /usr/local/bin/backup.sh && curl -fsS -m 10 --retry 5 ${URL}`,
      cli: `supercheck heartbeat ping ${URL}\n# Add --start when the job begins, --fail to report a failure`,
    });
  });
});

it("links to the heartbeat docs", () => {
  render(<HeartbeatPingUrlPanel monitorId="m1" canManage={false} />);
  expect(screen.getByRole("link", { name: "Heartbeat docs" })).toHaveAttribute("href", "https://supercheck.io/docs/app/heartbeat");
});

it("asks again before retrying a failed rotate", async () => {
  fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
  render(<HeartbeatPingUrlPanel monitorId="m1" canManage />);
  fireEvent.click(screen.getByRole("button", { name: "Rotate URL" }));
  fireEvent.click(await screen.findByTestId("heartbeat-rotate-confirm"));
  await screen.findByTestId("heartbeat-ping-url-error");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("The old URL stops working at once. Update your job before you rotate.")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
