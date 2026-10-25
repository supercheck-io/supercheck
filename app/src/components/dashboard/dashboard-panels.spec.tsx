import { render, screen } from "@testing-library/react";
import { NeedsAttentionCard, pickDefaultAttentionTab } from "./dashboard-panels";

describe("pickDefaultAttentionTab", () => {
  it("prefers the first non-empty tab", () => {
    expect(pickDefaultAttentionTab({ failures: 2, incidents: 1, alerts: 1 })).toBe("failures");
    expect(pickDefaultAttentionTab({ failures: 0, incidents: 3, alerts: 1 })).toBe("incidents");
    expect(pickDefaultAttentionTab({ failures: 0, incidents: null, alerts: 4 })).toBe("alerts");
    expect(pickDefaultAttentionTab({ failures: 0, incidents: 0, alerts: 0 })).toBe("failures");
  });
});

describe("NeedsAttentionCard", () => {
  it("omits the incidents tab when the incidents API is unavailable", () => {
    render(
      <NeedsAttentionCard failures={[]} failureCount={0} alerts={[]} incidentsResult={{ available: false }} incidentsLoading={false} />
    );
    expect(screen.getByRole("tab", { name: /Failures/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Alerts/ })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /Incidents/ })).toBeNull();
  });

  it("shows the incidents tab with a count when available", () => {
    render(
      <NeedsAttentionCard
        failures={[]}
        failureCount={0}
        alerts={[]}
        incidentsResult={{
          available: true,
          incidents: [
            { id: "i1", incidentNumber: 1, title: "DB down", severity: "sev1", status: "investigating", primaryServiceName: null, updatedAt: "2026-01-01T00:00:00Z" },
          ],
        }}
        incidentsLoading={false}
      />
    );
    const tab = screen.getByRole("tab", { name: /Incidents/ });
    expect(tab.textContent).toContain("1");
    expect(tab.getAttribute("data-state")).toBe("active");
    expect(screen.getByText("DB down")).toBeTruthy();
  });

  it("keeps the first computed default tab when data refetches", () => {
    const run = { id: "r1", jobId: "j", jobName: "Nightly", status: "failed", startedAt: new Date().toISOString(), trigger: "manual" };
    const props = { alerts: [], incidentsResult: { available: false } as const, incidentsLoading: false };
    const { rerender } = render(<NeedsAttentionCard failures={[]} failureCount={0} {...props} />);
    expect(screen.getByRole("tab", { name: /Failures/ }).getAttribute("data-state")).toBe("active");
    rerender(
      <NeedsAttentionCard
        failures={[run]}
        failureCount={1}
        alerts={[{ id: "a", status: "sent", targetName: "x", targetType: "job", type: "job_failed", timestamp: new Date().toISOString() } as never]}
        incidentsResult={{ available: false }}
        incidentsLoading={false}
      />
    );
    expect(screen.getByRole("tab", { name: /Failures/ }).getAttribute("data-state")).toBe("active");
  });

  it("caps badge text at 99+ with the real count in the title", () => {
    const failures = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, jobId: "j", jobName: "J", status: "failed", startedAt: new Date().toISOString(), trigger: "manual" }));
    render(<NeedsAttentionCard failures={failures} failureCount={120} alerts={[]} incidentsResult={{ available: false }} incidentsLoading={false} />);
    const tab = screen.getByRole("tab", { name: /Failures/ });
    expect(tab.textContent).toContain("99+");
    expect(tab.querySelector("[title='120']")).not.toBeNull();
  });
});
