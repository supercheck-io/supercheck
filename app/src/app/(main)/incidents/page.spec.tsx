import IncidentsPage from "./page";

const redirect = jest.fn(() => {
  throw new Error("NEXT_REDIRECT");
});
jest.mock("next/navigation", () => ({ redirect: (...args: unknown[]) => redirect(...(args as [])) }));
jest.mock("@/components/sre/incidents/sre-incidents-page-client", () => ({ SreIncidentsPageClient: () => null }));
jest.mock("@/components/page-breadcrumbs", () => ({ PageBreadcrumbs: () => null }));

beforeEach(() => redirect.mockClear());

it("sends old ?tab=alerts links to Notifications delivery history", async () => {
  await expect(IncidentsPage({ searchParams: Promise.resolve({ tab: "alerts" }) })).rejects.toThrow("NEXT_REDIRECT");
  expect(redirect).toHaveBeenCalledWith("/notifications?tab=history");
});

it("renders the incidents page otherwise", async () => {
  await expect(IncidentsPage({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy();
  expect(redirect).not.toHaveBeenCalled();
});
