import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReportViewer } from "./report-viewer";

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
