import {
  getSreAdminQueryKey,
  getSreEvidenceGraphQueryKey,
  getSreIncidentDetailQueryKey,
  getSreIncidentsQueryKey,
  getSreServiceDetailQueryKey,
} from "./query-keys";

describe("SRE query keys", () => {
  it("isolates cached data by project", () => {
    expect(getSreIncidentsQueryKey("project-a")).not.toEqual(
      getSreIncidentsQueryKey("project-b"),
    );
    expect(getSreEvidenceGraphQueryKey("project-a")).not.toEqual(
      getSreEvidenceGraphQueryKey("project-b"),
    );
  });

  it("isolates detail and admin resources", () => {
    expect(getSreIncidentDetailQueryKey("project-a", "incident-a")).not.toEqual(
      getSreIncidentDetailQueryKey("project-a", "incident-b"),
    );
    expect(getSreServiceDetailQueryKey("project-a", "service-a")).not.toEqual(
      getSreServiceDetailQueryKey("project-a", "service-b"),
    );
    expect(getSreAdminQueryKey("project-a", "services")).not.toEqual(
      getSreAdminQueryKey("project-a", "integrations"),
    );
  });
});
