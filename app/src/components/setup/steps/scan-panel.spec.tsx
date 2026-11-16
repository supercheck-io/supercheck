import { act, fireEvent, render, screen } from "@testing-library/react";

import type { ScanSummary } from "@/lib/setup/scan";
import { ScanFindings, ScanPanel, SCAN_MAX_MS, SCAN_POLL_MS, scanFindings } from "./scan-panel";

const PID = "11111111-1111-4111-8111-111111111111";
const result = (over: Partial<ScanSummary> = {}): ScanSummary => ({
  finalUrl: "https://app.example.com/",
  reachable: true,
  status: 200,
  redirects: 1,
  responseMs: 182,
  ssl: { validTo: "2027-01-01", daysRemaining: 60, issuer: "R3" },
  pages: [{ path: "/pricing", status: 200, ms: 100, title: "Pricing" }],
  ...over,
});

const fetchMock = jest.fn();
const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const flush = async (ms: number) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};
const setup = (props: Partial<React.ComponentProps<typeof ScanPanel>> = {}) => {
  const onResult = jest.fn();
  const view = render(<ScanPanel projectId={PID} url="https://app.example.com/" disabled={false} onResult={onResult} initial={null} {...props} />);
  return { onResult, ...view };
};
const click = async () => {
  fireEvent.click(screen.getByRole("button", { name: /^Scan/ }));
  await flush(0);
};

beforeEach(() => {
  jest.useFakeTimers();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => jest.useRealTimers());

describe("scan polling", () => {
  it("posts the URL, polls every 2 s and shows the findings table with words and badges", async () => {
    let polls = 0;
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (init?.method === "POST") return json({ scanId: `setup-scan:${PID}:1` }, 202);
      return json(++polls < 3 ? { status: polls === 1 ? "queued" : "running" } : { status: "done", result: result() });
    });
    const { onResult } = setup();
    await click();
    expect(screen.getByText("Scanning...")).toBeTruthy();
    await flush(SCAN_POLL_MS);
    await flush(SCAN_POLL_MS);
    expect(polls).toBe(2);
    await flush(SCAN_POLL_MS);
    expect(polls).toBe(3);
    expect(onResult).toHaveBeenCalledWith(result(), "https://app.example.com/");
    const table = screen.getByTestId("setup-scan-findings");
    expect(table.textContent).toContain("Reachable");
    expect(table.textContent).toContain("200 in 182 ms");
    expect(table.textContent).toContain("1 hop to https://app.example.com/");
    expect(table.textContent).toContain("60 days left");
    expect(table.textContent).toContain("Pages found");
    expect(screen.getByRole("button", { name: "Scan again" })).toBeTruthy();
    // No more polling after done.
    await flush(SCAN_POLL_MS * 3);
    expect(polls).toBe(3);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/projects/${PID}/setup/scan`);
  });

  it("stops after the 5 min cap with a timeout message", async () => {
    fetchMock.mockImplementation((_u: string, init?: { method?: string }) => (init?.method === "POST" ? json({ scanId: "s" }, 202) : json({ status: "running" })));
    setup();
    await click();
    await flush(SCAN_MAX_MS + SCAN_POLL_MS);
    expect(screen.getByText(/took too long/)).toBeTruthy();
    const before = fetchMock.mock.calls.length;
    await flush(SCAN_POLL_MS * 5);
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("enforces the cap while a request hangs, and aborts it", async () => {
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation((_u: string, init?: { signal?: AbortSignal }) => {
      signal = init?.signal;
      return new Promise(() => {});
    });
    setup();
    await click();
    await flush(SCAN_MAX_MS - 1);
    expect(screen.getByText("Scanning...")).toBeTruthy();
    await flush(1);
    expect(screen.getByText(/took too long/)).toBeTruthy();
    expect(signal?.aborted).toBe(true);
  });

  it("keeps a finished scan visible when the site redirects to another domain", async () => {
    fetchMock.mockImplementation((_u: string, init?: { method?: string }) =>
      init?.method === "POST" ? json({ scanId: "s" }, 202) : json({ status: "done", result: result({ finalUrl: "https://other.example.net/" }) }),
    );
    setup();
    await click();
    await flush(SCAN_POLL_MS);
    screen.getByTestId("setup-scan-findings");
  });

  it("stops polling on unmount", async () => {
    fetchMock.mockImplementation((_u: string, init?: { method?: string }) => (init?.method === "POST" ? json({ scanId: "s" }, 202) : json({ status: "running" })));
    const { unmount } = setup();
    await click();
    await flush(SCAN_POLL_MS);
    const before = fetchMock.mock.calls.length;
    unmount();
    await flush(SCAN_POLL_MS * 5);
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it.each([
    ["failed status", { status: "failed" }, /scan failed/i],
    ["unavailable status", { status: "unavailable" }, /Scan unavailable, continue without it/],
  ])("%s ends the scan with its message", async (_n, body, text) => {
    fetchMock.mockImplementation((_u: string, init?: { method?: string }) => (init?.method === "POST" ? json({ scanId: "s" }, 202) : json(body)));
    setup();
    await click();
    await flush(SCAN_POLL_MS);
    expect(screen.getByText(text)).toBeTruthy();
  });

  it("shows unavailable when a poll answers an error or throws", async () => {
    fetchMock.mockImplementation((_u: string, init?: { method?: string }) => (init?.method === "POST" ? json({ scanId: "s" }, 202) : json({ error: "Scan not found" }, 404)));
    setup();
    await click();
    await flush(SCAN_POLL_MS);
    expect(screen.getByText(/Scan unavailable/)).toBeTruthy();
    fetchMock.mockImplementation((_u: string, init?: { method?: string }) => (init?.method === "POST" ? json({ scanId: "s" }, 202) : Promise.reject(new Error("net"))));
    await click();
    await flush(SCAN_POLL_MS);
    expect(screen.getByText(/Scan unavailable/)).toBeTruthy();
  });

  it("maps start failures: private address (400 with details), 503, 402 text, thrown", async () => {
    setup();
    fetchMock.mockImplementationOnce(() => json({ error: "Blocked", details: "private" }, 400));
    await click();
    expect(screen.getByText(/This address is private/)).toBeTruthy();
    fetchMock.mockImplementationOnce(() => json({ error: "x" }, 503));
    await click();
    expect(screen.getByText(/Scan unavailable/)).toBeTruthy();
    fetchMock.mockImplementationOnce(() => json({ error: "A valid http(s) URL is required" }, 400));
    await click();
    expect(screen.getByText("A valid http(s) URL is required")).toBeTruthy();
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error("net")));
    await click();
    expect(screen.getByText(/Scan unavailable/)).toBeTruthy();
  });

  it("a newer scan replaces an older one in flight", async () => {
    let polls = 0;
    fetchMock.mockImplementation((_u: string, init?: { method?: string }) => {
      if (init?.method === "POST") return json({ scanId: "s" }, 202);
      polls++;
      return json({ status: "done", result: result() });
    });
    setup();
    await click();
    await click();
    await flush(SCAN_POLL_MS * 2);
    expect(polls).toBe(1);
  });

  it("is disabled without a URL, read-only, or while scanning; shows a stored result", async () => {
    const { rerender } = setup({ url: null });
    expect(screen.getByRole("button", { name: "Scan" })).toBeDisabled();
    rerender(<ScanPanel projectId={PID} url="https://app.example.com" disabled onResult={jest.fn()} initial={result()} />);
    expect(screen.getByRole("button", { name: "Scan again" })).toBeDisabled();
    expect(screen.getByTestId("setup-scan-findings")).toBeTruthy();
  });
});

describe("scan tied to the URL", () => {
  it("hides a stored scan once the URL points at another host", () => {
    const { rerender } = render(<ScanPanel projectId={PID} url="https://app.example.com" disabled={false} onResult={jest.fn()} initial={result()} />);
    expect(screen.getByTestId("setup-scan-findings")).toBeTruthy();
    rerender(<ScanPanel projectId={PID} url="https://other.example" disabled={false} onResult={jest.fn()} initial={result()} />);
    expect(screen.queryByTestId("setup-scan-findings")).toBeNull();
    expect(screen.getByRole("button", { name: "Scan" })).toBeTruthy();
  });
});

describe("scan error results", () => {
  it.each([
    ["blocked_private", /This address is private/],
    ["bot_protection", /bot-protection/],
    ["unreachable", /could not reach/],
    ["timeout", /took too long/],
    ["too_many_redirects", /redirected too many times/],
  ] as const)("%s", (error, text) => {
    render(<ScanFindings result={result({ error, reachable: false, status: null })} />);
    expect(screen.getByText(text)).toBeTruthy();
  });
});

describe("scanFindings", () => {
  const row = (over: Partial<ScanSummary>, label: string) => scanFindings(result(over)).find((r) => r.label === label)!;
  it("grades certificates, response time, redirects and reachability", () => {
    expect(row({ ssl: null }, "SSL certificate")).toMatchObject({ tone: "neutral", word: "None found" });
    expect(row({ ssl: { validTo: "x", daysRemaining: 20, issuer: "x" } }, "SSL certificate")).toMatchObject({ tone: "warning", word: "Soon" });
    expect(row({ ssl: { validTo: "x", daysRemaining: 3, issuer: "x" } }, "SSL certificate")).toMatchObject({ tone: "danger", word: "Expiring" });
    expect(row({ ssl: { validTo: "x", daysRemaining: -1, issuer: "x" } }, "SSL certificate")).toMatchObject({ tone: "danger", word: "Expired" });
    expect(row({ responseMs: 1500 }, "Response time")).toMatchObject({ tone: "warning", word: "Slow" });
    expect(row({ responseMs: 5000 }, "Response time")).toMatchObject({ tone: "danger", word: "Very slow" });
    expect(row({ responseMs: null }, "Response time")).toMatchObject({ tone: "neutral", word: "Unknown" });
    expect(row({ redirects: 0 }, "Redirects")).toMatchObject({ word: "None", detail: "No redirects" });
    expect(row({ redirects: 4 }, "Redirects")).toMatchObject({ tone: "warning", word: "Many" });
    expect(row({ reachable: false, status: null, responseMs: null }, "Reachable")).toMatchObject({ tone: "danger", detail: "No response" });
    expect(row({ status: 302 }, "Reachable")).toMatchObject({ tone: "success", word: "Reachable" });
    expect(row({ status: 404 }, "Reachable")).toMatchObject({ tone: "warning", word: "Error response", detail: expect.stringContaining("404") });
    expect(row({ status: 503 }, "Reachable")).toMatchObject({ tone: "danger", word: "Server error" });
    expect(row({ pages: [] }, "Pages found")).toMatchObject({ tone: "neutral", word: "0" });
  });
});

describe("invalid certificate", () => {
  it("names the certificate expiry date", () => {
    render(<ScanFindings result={result({ reachable: false, status: null, pages: [], error: "ssl_invalid", ssl: { validTo: "2026-03-04T00:00:00.000Z", daysRemaining: -257, issuer: "R3" } })} />);
    expect(screen.getByText("The SSL certificate is invalid or expired (2026-03-04).")).toBeTruthy();
  });

  it("falls back to the plain message without certificate details", () => {
    render(<ScanFindings result={result({ reachable: false, status: null, pages: [], error: "ssl_invalid", ssl: null })} />);
    expect(screen.getByText("The SSL certificate is invalid or expired.")).toBeTruthy();
  });
});
