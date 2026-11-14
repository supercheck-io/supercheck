/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server";
import { OrganizationDeletionEmail, organizationDeletionSubject } from "./organization-deletion";

describe("deletion change emails", () => {
  it("tells owners a deletion was cancelled", () => {
    expect(organizationDeletionSubject("cancelled", "Acme")).toBe("[Supercheck] Organization deletion cancelled: Acme");
    expect(renderToStaticMarkup(OrganizationDeletionEmail({ organizationName: "Acme", kind: "cancelled", settingsUrl: "https://app.test/org-admin" }))).toContain("active again");
  });

  it("names the deleted project and its restore deadline", () => {
    expect(organizationDeletionSubject("projectDeleted", "Acme", 0, "Checkout")).toBe("[Supercheck] Project deleted: Checkout");
    const html = renderToStaticMarkup(OrganizationDeletionEmail({ organizationName: "Acme", kind: "projectDeleted", projectName: "Checkout", purgeDate: "Fri, 21 Nov 2026 06:15:00 GMT", settingsUrl: "https://app.test/org-admin" }));
    expect(html).toContain("Checkout");
    expect(html).toContain("Fri, 21 Nov 2026 06:15:00 GMT");
    expect(html).toContain("https://app.test/org-admin");
  });
});
