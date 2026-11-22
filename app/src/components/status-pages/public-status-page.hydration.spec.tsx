import { execFileSync } from "node:child_process";
import { act } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { PublicStatusPage } from "./public-status-page";

jest.mock("./subscribe-dialog", () => ({ SubscribeDialog: () => null }));
jest.mock("./use-status-page-favicon", () => ({ useStatusPageFavicon: jest.fn() }));

// 20:00 UTC on 22 November is already 23 November in Kolkata: server and viewer are on different dates.
const readAt = "2026-11-22T20:00:00.000Z";
const page = { id: "page", name: "Status", subdomain: "subdomain", status: "published", pageDescription: null, headline: null, supportUrl: null, createdAt: new Date("2026-11-20T08:00:00Z"), updatedAt: new Date(), cssGreens: null, cssYellows: null, cssOranges: null, cssBlues: null, cssReds: null, faviconLogo: null, transactionalLogo: null, language: "en" };
const component = { id: "public", name: "Public API", description: null, status: "operational" as const, showcase: true, onlyShowIfDegraded: false };
const resolved = { id: "i1", name: "Login failures", status: "resolved" as const, impact: "major" as const, createdAt: new Date("2026-11-22T19:00:00Z"), resolvedAt: new Date("2026-11-22T19:30:00Z"), latestUpdate: null };
const ui = <PublicStatusPage statusPage={page} components={[component]} incidents={[resolved]} idOrSubdomain="page" readAt={readAt} />;

beforeEach(() => jest.useFakeTimers({ now: new Date(readAt), advanceTimers: true }));
afterEach(() => {
  jest.useRealTimers();
});

// A process reads its time zone once at start (setting process.env.TZ inside Jest changes nothing), and CI runs in UTC,
// where this check cannot fail. So the test below also runs in a child Jest started in a zone ahead of UTC.
const VIEWER_ZONE = "Asia/Kolkata";
const IN_CHILD = process.env.HYDRATION_ZONE_CHILD === "1";

it("passes in a viewer zone that is already on the next day", () => {
  if (IN_CHILD) return;
  const run = () =>
    execFileSync(process.execPath, [require.resolve("jest/bin/jest"), __filename, "--runInBand", "--coverage=false", "-t", "renders UTC days"], {
      cwd: process.cwd(),
      env: { ...process.env, TZ: VIEWER_ZONE, HYDRATION_ZONE_CHILD: "1" },
      stdio: "pipe",
    });
  expect(run).not.toThrow();
}, 120_000);

it("renders UTC days from the read time in the server HTML and hydrates them without a mismatch", async () => {
  // In the child the process zone must really be ahead of UTC, or the check below proves nothing.
  if (IN_CHILD) expect(new Date(readAt).getDate()).toBe(23);
  const html = renderToString(ui);
  // UTC days whatever zone the server runs in, and the incident links stay in the HTML for crawlers and no-JS readers.
  expect(html).toContain("Login failures");
  expect(html).toContain("Sunday, Nov 22, 2026");
  // 23 November exists only in zones ahead of UTC; the server HTML must not depend on the runner's zone.
  expect(html).not.toContain("Nov 23, 2026");

  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  // Server render and hydration share this process zone, so this only catches other mismatches;
  // the zone split itself is covered by the server-HTML assertions above, run in the child.
  const onRecoverableError = jest.fn();
  await act(async () => {
    hydrateRoot(container, ui, { onRecoverableError });
  });
  expect(onRecoverableError).not.toHaveBeenCalled();
  // After hydration the list follows the viewer's zone.
  expect(container.textContent).toContain(new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" }).format(new Date(readAt)));
  container.remove();
});
