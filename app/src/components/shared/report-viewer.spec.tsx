import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReportViewer, REPORT_URL_REFRESH_MS, REPORT_URL_REFRESH_RETRY_MS } from "./report-viewer";

const appConfig = { config: { reports: { separateOrigin: true } }, isFetched: true };
jest.mock("@/hooks/use-app-config", () => ({ useAppConfig: () => appConfig }));
jest.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));

const SIGNED = "https://reports.example.test/api/test-results/~token/run-1/report/index.html";
const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockImplementation(async (url: string) =>
    url === "/api/report-urls"
      ? { ok: true, json: async () => ({ url: SIGNED }) }
      : { ok: true, headers: new Headers({ "content-type": "text/html" }), text: async () => "<html></html>" },
  );
});

it("offers the signed report as a new tab when reports are served from a separate origin", async () => {
  const { container } = render(<ReportViewer reportUrl="/api/test-results/run-1/report/index.html" />);
  await waitFor(() => expect(container.querySelector("iframe")).toHaveAttribute("src", SIGNED));
  fireEvent.load(container.querySelector("iframe")!);
  const link = await screen.findByRole("link", { name: "Open report in a new tab" });
  expect(link).toHaveAttribute("href", SIGNED);
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
});

it("does not offer it when reports share the app origin", async () => {
  appConfig.config.reports.separateOrigin = false;
  const { container } = render(<ReportViewer reportUrl="/api/test-results/run-1/report/index.html" />);
  await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
  expect(screen.queryByRole("link", { name: "Open report in a new tab" })).toBeNull();
  appConfig.config.reports.separateOrigin = true;
});

describe("signed URL lifecycle", () => {
  afterEach(() => jest.useRealTimers());

  it("re-mints before the 1h token expires", async () => {
    jest.useFakeTimers();
    const { container } = render(<ReportViewer reportUrl="/api/test-results/run-1/report/index.html" />);
    await waitFor(() => expect(container.querySelector("iframe")).toHaveAttribute("src", SIGNED));
    fireEvent.load(container.querySelector("iframe")!); // loaded, so the 30s load-safety retry stays out of the way
    const mints = () => fetchMock.mock.calls.filter(([u]) => u === "/api/report-urls").length;
    expect(mints()).toBe(1);
    await act(async () => {
      jest.advanceTimersByTime(REPORT_URL_REFRESH_MS - 1000);
    });
    expect(mints()).toBe(1);
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    await waitFor(() => expect(mints()).toBe(2));
    expect(REPORT_URL_REFRESH_MS).toBeLessThan(60 * 60 * 1000);
  });

  const setVisibility = (state: "visible" | "hidden") => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  const mintCount = () => fetchMock.mock.calls.filter(([u]) => u === "/api/report-urls").length;
  const NEW = "https://reports.example.test/api/test-results/~token2/run-1/report/index.html";

  it("keeps the working iframe when a refresh mint fails, and retries later", async () => {
    jest.useFakeTimers();
    setVisibility("visible");
    const { container } = render(<ReportViewer reportUrl="/api/test-results/run-1/report/index.html" />);
    await waitFor(() => expect(container.querySelector("iframe")).toHaveAttribute("src", SIGNED));
    fireEvent.load(container.querySelector("iframe")!);
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/report-urls" ? { ok: false, json: async () => ({ error: "boom" }) } : { ok: true, headers: new Headers(), text: async () => "" },
    );
    await act(async () => {
      jest.advanceTimersByTime(REPORT_URL_REFRESH_MS + 10);
    });
    expect(mintCount()).toBe(2);
    expect(container.querySelector("iframe")).toHaveAttribute("src", SIGNED);
    expect(screen.queryByText(/could not be found/i)).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(REPORT_URL_REFRESH_RETRY_MS + 10);
    });
    expect(mintCount()).toBe(3);
    expect(container.querySelector("iframe")).toHaveAttribute("src", SIGNED);
  });

  it("defers the swap to the refreshed URL while the page is visible", async () => {
    jest.useFakeTimers();
    setVisibility("visible");
    const { container } = render(<ReportViewer reportUrl="/api/test-results/run-1/report/index.html" />);
    await waitFor(() => expect(container.querySelector("iframe")).toHaveAttribute("src", SIGNED));
    fireEvent.load(container.querySelector("iframe")!);
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/report-urls"
        ? { ok: true, json: async () => ({ url: NEW }) }
        : { ok: true, headers: new Headers({ "content-type": "text/html" }), text: async () => "<html></html>" },
    );
    await act(async () => {
      jest.advanceTimersByTime(REPORT_URL_REFRESH_MS + 10);
    });
    expect(fetchMock.mock.calls.some(([u]) => u === NEW)).toBe(true);
    expect(container.querySelector("iframe")).toHaveAttribute("src", SIGNED);
    act(() => setVisibility("hidden"));
    await waitFor(() => expect(container.querySelector("iframe")).toHaveAttribute("src", NEW));
    setVisibility("visible");
  });

  const mockMints = (urls: string[]) => {
    let n = 0;
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/report-urls"
        ? { ok: true, json: async () => ({ url: urls[Math.min(n++, urls.length - 1)] }) }
        : { ok: true, headers: new Headers({ "content-type": "text/html" }), text: async () => "<html></html>" },
    );
  };

  it("points the new-tab link at the pending URL while the iframe keeps the old one", async () => {
    jest.useFakeTimers();
    setVisibility("visible");
    const { container } = render(<ReportViewer reportUrl="/api/test-results/run-1/report/index.html" />);
    await waitFor(() => expect(container.querySelector("iframe")).toHaveAttribute("src", SIGNED));
    fireEvent.load(container.querySelector("iframe")!);
    mockMints([NEW]);
    await act(async () => {
      jest.advanceTimersByTime(REPORT_URL_REFRESH_MS + 10);
    });
    expect(container.querySelector("iframe")).toHaveAttribute("src", SIGNED);
    expect(screen.getByRole("link", { name: "Open report in a new tab" })).toHaveAttribute("href", NEW);
  });

  it("re-mints instead of applying a pending URL that aged past the freshness window", async () => {
    jest.useFakeTimers();
    setVisibility("visible");
    const NEW2 = "https://reports.example.test/api/test-results/~token4/run-1/report/index.html";
    const { container } = render(<ReportViewer reportUrl="/api/test-results/run-1/report/index.html" />);
    await waitFor(() => expect(container.querySelector("iframe")).toHaveAttribute("src", SIGNED));
    fireEvent.load(container.querySelector("iframe")!);
    mockMints([NEW, NEW2]);
    await act(async () => {
      jest.advanceTimersByTime(REPORT_URL_REFRESH_MS + 10);
    });
    expect(mintCount()).toBe(2);
    await act(async () => {
      jest.advanceTimersByTime(REPORT_URL_REFRESH_MS); // pending sits visible until it is stale
    });
    expect(container.querySelector("iframe")).toHaveAttribute("src", SIGNED);
    await act(async () => setVisibility("hidden"));
    await waitFor(() => expect(container.querySelector("iframe")).toHaveAttribute("src", NEW2));
    expect(mintCount()).toBe(3);
    setVisibility("visible");
  });

  it("drops a refreshed URL minted for a previous report when the viewer switched reports", async () => {
    jest.useFakeTimers();
    setVisibility("visible");
    const { container, rerender } = render(<ReportViewer reportUrl="/api/test-results/run-1/report/index.html" />);
    await waitFor(() => expect(container.querySelector("iframe")).toHaveAttribute("src", SIGNED));
    fireEvent.load(container.querySelector("iframe")!);
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/report-urls"
        ? { ok: true, json: async () => ({ url: NEW }) }
        : { ok: true, headers: new Headers({ "content-type": "text/html" }), text: async () => "<html></html>" },
    );
    await act(async () => {
      jest.advanceTimersByTime(REPORT_URL_REFRESH_MS + 10);
    });
    expect(fetchMock.mock.calls.some(([u]) => u === NEW)).toBe(true); // pending URL for run-1 exists
    const OTHER = "https://reports.example.test/api/test-results/~token3/run-2/report/index.html";
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/report-urls"
        ? { ok: true, json: async () => ({ url: OTHER }) }
        : { ok: true, headers: new Headers({ "content-type": "text/html" }), text: async () => "<html></html>" },
    );
    rerender(<ReportViewer reportUrl="/api/test-results/run-2/report/index.html" />);
    await act(async () => {
      jest.advanceTimersByTime(10);
    });
    await waitFor(() => expect(container.querySelector("iframe")).toHaveAttribute("src", OTHER));
    act(() => setVisibility("hidden"));
    expect(container.querySelector("iframe")).toHaveAttribute("src", OTHER);
    setVisibility("visible");
  });
});
