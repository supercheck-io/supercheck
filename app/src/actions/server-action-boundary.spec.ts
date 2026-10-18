/** @jest-environment node */
jest.mock("@/lib/server-actions/update-job", () => ({ updateJob: jest.fn() }));
jest.mock("@/lib/server-actions/private-agents", () => ({ getPrivateAgents: jest.fn() }));
jest.mock("@/lib/server-actions/sre-connectors", () => ({ getSreConnectors: jest.fn(), getSreConnectorSetupOptions: jest.fn() }));
jest.mock("@/lib/server-actions/sre-integration-bindings", () => ({ getSreIntegrationBindings: jest.fn(), getSreIntegrationBindingSetupOptions: jest.fn() }));
jest.mock("@/lib/server-actions/sre-diagnostic-queries", () => ({ getSreDiagnosticQueries: jest.fn(), getSreDiagnosticQuerySetupOptions: jest.fn() }));
jest.mock("@/lib/server-actions/sre-onboarding", () => ({ getSreOnboardingStatus: jest.fn() }));
import { updateJob } from "./update-job";
import { getPrivateAgents } from "./private-agents";
import { getSreConnectors, getSreConnectorSetupOptions } from "./sre-connectors";
import { getSreIntegrationBindings, getSreIntegrationBindingSetupOptions } from "./sre-integration-bindings";
import { getSreDiagnosticQueries, getSreDiagnosticQuerySetupOptions } from "./sre-diagnostic-queries";
import { getSreOnboardingStatus } from "./sre-onboarding";
const forged = { userId: "victim", organizationId: "victim-org", project: { id: "victim-project", userRole: "super_admin" } };
it("ignores forged authorization context for updateJob", async () => {
  const data = { jobId: "job", name: "name" };
  await (updateJob as (...args: unknown[]) => Promise<unknown>)(data, forged);
  expect(jest.requireMock("@/lib/server-actions/update-job").updateJob).toHaveBeenCalledWith(data);
});
it("ignores forged authorization context for getPrivateAgents", async () => {
  
  await (getPrivateAgents as (...args: unknown[]) => Promise<unknown>)(forged);
  expect(jest.requireMock("@/lib/server-actions/private-agents").getPrivateAgents).toHaveBeenCalledWith();
});
it("ignores forged authorization context for getSreConnectors", async () => {
  
  await (getSreConnectors as (...args: unknown[]) => Promise<unknown>)(forged);
  expect(jest.requireMock("@/lib/server-actions/sre-connectors").getSreConnectors).toHaveBeenCalledWith();
});
it("ignores forged authorization context for getSreConnectorSetupOptions", async () => {
  
  await (getSreConnectorSetupOptions as (...args: unknown[]) => Promise<unknown>)(forged);
  expect(jest.requireMock("@/lib/server-actions/sre-connectors").getSreConnectorSetupOptions).toHaveBeenCalledWith();
});
it("ignores forged authorization context for getSreIntegrationBindings", async () => {
  
  await (getSreIntegrationBindings as (...args: unknown[]) => Promise<unknown>)(forged);
  expect(jest.requireMock("@/lib/server-actions/sre-integration-bindings").getSreIntegrationBindings).toHaveBeenCalledWith();
});
it("ignores forged authorization context for getSreIntegrationBindingSetupOptions", async () => {
  
  await (getSreIntegrationBindingSetupOptions as (...args: unknown[]) => Promise<unknown>)(forged);
  expect(jest.requireMock("@/lib/server-actions/sre-integration-bindings").getSreIntegrationBindingSetupOptions).toHaveBeenCalledWith();
});
it("ignores forged authorization context for getSreDiagnosticQueries", async () => {
  
  await (getSreDiagnosticQueries as (...args: unknown[]) => Promise<unknown>)(forged);
  expect(jest.requireMock("@/lib/server-actions/sre-diagnostic-queries").getSreDiagnosticQueries).toHaveBeenCalledWith();
});
it("ignores forged authorization context for getSreDiagnosticQuerySetupOptions", async () => {
  
  await (getSreDiagnosticQuerySetupOptions as (...args: unknown[]) => Promise<unknown>)(forged);
  expect(jest.requireMock("@/lib/server-actions/sre-diagnostic-queries").getSreDiagnosticQuerySetupOptions).toHaveBeenCalledWith();
});
it("ignores forged authorization context for getSreOnboardingStatus", async () => {
  
  await (getSreOnboardingStatus as (...args: unknown[]) => Promise<unknown>)(forged);
  expect(jest.requireMock("@/lib/server-actions/sre-onboarding").getSreOnboardingStatus).toHaveBeenCalledWith();
});
