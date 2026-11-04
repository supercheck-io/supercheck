import ServicesPage from "./page";

const status = { services: 0, connectors: 0, diagnosticRecipes: 0, privateAgents: 0, completedRequiredSteps: 0, requiredSteps: 2, complete: false };
const mockOnboarding = jest.fn();
jest.mock("@/actions/sre-services", () => ({ getSreServices: jest.fn(async () => ({ success: true, services: [] })) }));
jest.mock("@/lib/server-actions/sre-onboarding", () => ({ getSreOnboardingStatus: (...a: unknown[]) => mockOnboarding(...a) }));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn(async () => ({ project: { id: "p1" } })) }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => true) }));
jest.mock("@/components/page-breadcrumbs", () => ({ PageBreadcrumbs: () => null }));
jest.mock("@/components/sre/services/service-catalog", () => ({ ServiceCatalog: () => null }));

const catalogProps = async () => {
  const tree = (await ServicesPage()) as { props: { children: unknown } };
  // Card > CardContent > ServiceCatalog
  const card = (tree.props.children as unknown[])[1] as { props: { children: { props: { children: { props: Record<string, unknown> } } } } };
  return card.props.children.props.children.props;
};

it("passes the setup status so the setup guide is reachable from /services", async () => {
  mockOnboarding.mockResolvedValue({ success: true, status });
  expect(await catalogProps()).toMatchObject({ setupStatus: status });
});

it("omits the setup guide when the status cannot be read", async () => {
  mockOnboarding.mockResolvedValue({ success: false, error: "denied", status: null });
  expect(await catalogProps()).toMatchObject({ setupStatus: null });
});
