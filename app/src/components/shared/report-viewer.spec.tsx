import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReportViewer, REPORT_URL_REFRESH_MS } from "./report-viewer";

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

  it("fetches the report document once per mint, using the default cache mode", async () => {
    const { container } = render(<ReportViewer reportUrl="/api/test-results/run-1/report/index.html" />);
    await waitFor(() => expect(container.querySelector("iframe")).toHaveAttribute("src", SIGNED));
    const docFetches = fetchMock.mock.calls.filter(([u]) => u === SIGNED);
    expect(docFetches).toHaveLength(1);
    expect(docFetches[0][1]).toBeUndefined();
  });

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
});
