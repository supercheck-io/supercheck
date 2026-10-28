/** @jest-environment node */
jest.mock("@/components/status-pages/public-status-page", () => ({ PublicStatusPage: () => null }));
jest.mock("@/actions/get-public-status-page", () => ({ getPublicStatusPage: jest.fn(async () => ({ success: true, statusPage: { id: "p", name: "n" } })) }));
jest.mock("@/actions/get-public-status-page-by-subdomain", () => ({ getPublicStatusPageBySubdomain: jest.fn() }));
jest.mock("@/actions/get-public-components", () => ({ getPublicComponents: jest.fn() }));
jest.mock("@/actions/get-public-incidents", () => ({ getPublicIncidents: jest.fn() }));
jest.mock("@/lib/feature-flags", () => ({ isStatusPageBrandingHidden: () => false }));
jest.mock("next/navigation", () => ({ notFound: jest.fn() }));
import { getPublicComponents } from "@/actions/get-public-components";
import { getPublicIncidents } from "@/actions/get-public-incidents";
import PublicStatusPagePage from "./page";

const params = Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" });

it.each([
  ["components", { success: false, components: [] }, { success: true, incidents: [] }],
  ["incidents", { success: true, components: [] }, { success: false, incidents: [] }],
])("does not render an all-clear page when the %s fetch failed", async (_n, comps, incs) => {
  (getPublicComponents as jest.Mock).mockResolvedValue(comps);
  (getPublicIncidents as jest.Mock).mockResolvedValue(incs);
  await expect(PublicStatusPagePage({ params })).rejects.toThrow(/temporarily unavailable/i);
});
