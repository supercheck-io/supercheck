/** @jest-environment node */
jest.mock("@/components/status-pages/public-status-page", () => ({ PublicStatusPage: () => null }));
jest.mock("@/actions/get-public-status-page-by-custom-domain", () => ({
  getPublicStatusPageByCustomDomain: jest.fn(async () => ({ success: true, statusPage: { id: "p", name: "n" } })),
}));
jest.mock("@/actions/get-public-components", () => ({ getPublicComponents: jest.fn() }));
jest.mock("@/actions/get-public-incidents", () => ({ getPublicIncidents: jest.fn() }));
jest.mock("@/lib/feature-flags", () => ({ isStatusPageBrandingHidden: () => false }));
jest.mock("next/headers", () => ({ headers: jest.fn(async () => new Headers({ host: "status.acme.com" })) }));
jest.mock("next/navigation", () => ({ notFound: jest.fn() }));
import { getPublicComponents } from "@/actions/get-public-components";
import { getPublicIncidents } from "@/actions/get-public-incidents";
import CustomDomainStatusPage from "./page";

it("does not render an all-clear page when a data fetch failed", async () => {
  (getPublicComponents as jest.Mock).mockResolvedValue({ success: false, components: [] });
  (getPublicIncidents as jest.Mock).mockResolvedValue({ success: true, incidents: [] });
  await expect(
    CustomDomainStatusPage({ params: Promise.resolve({ hostname: "status.acme.com" }) }),
  ).rejects.toThrow(/temporarily unavailable/i);
});
