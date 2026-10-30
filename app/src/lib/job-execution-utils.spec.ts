/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("./variable-resolver", () => ({
  ...jest.requireActual("./variable-resolver"),
  resolveProjectVariables: jest.fn(),
}));
import { applyVariablesToTestScripts } from "./job-execution-utils";
import { VariableResolutionError } from "./variable-resolution-error";
import { buildExecutionQueueErrorResponse, getSafeExecutionQueueErrorDetails } from "./execution-api-responses";
import { resolveProjectVariables } from "./variable-resolver";

const scripts = [{ id: "t1", name: "t", script: "getSecret('USED_KEY')" }];
const resolved = (errors?: string[]) =>
  jest.mocked(resolveProjectVariables).mockResolvedValue({ variables: {}, secrets: {}, files: {}, errors });

describe("applyVariablesToTestScripts", () => {
  beforeEach(() => jest.spyOn(console, "warn").mockImplementation(() => undefined));

  it("fails with a safe message when a used variable cannot be resolved", async () => {
    resolved(["Failed to resolve variable 'USED_KEY': secret internals"]);
    await expect(applyVariablesToTestScripts(scripts, "p", "[x]")).rejects.toThrow(
      "Project variables could not be resolved: USED_KEY",
    );
    await expect(applyVariablesToTestScripts(scripts, "p", "[x]")).rejects.not.toThrow(/internals/);
  });

  it("fails on project-wide resolution errors", async () => {
    resolved(["Failed to resolve variables: db down"]);
    await expect(applyVariablesToTestScripts(scripts, "p", "[x]")).rejects.toThrow(
      "Project variables could not be resolved",
    );
  });

  it("ignores a commented-out helper call and surfaces the key names as a typed error", async () => {
    resolved(["Failed to resolve variable 'OLD': bad"]);
    const commented = [{ id: "t", name: "t", script: "// getSecret('OLD')\n/* getSecret('OLD') */ const u = 'http://x'; getSecret('USED_KEY')" }];
    await expect(applyVariablesToTestScripts(commented, "p", "[x]")).resolves.toBeDefined();
    resolved(["Failed to resolve variable 'USED_KEY': bad"]);
    const error = await applyVariablesToTestScripts(commented, "p", "[x]").catch((e) => e);
    expect(error).toBeInstanceOf(VariableResolutionError);
    expect(buildExecutionQueueErrorResponse(error)?.status).toBe(422);
    expect(getSafeExecutionQueueErrorDetails(error)).toContain("USED_KEY");
  });

  it("ignores errors for variables no script references", async () => {
    resolved(["Failed to resolve variable 'OTHER_KEY': bad"]);
    await expect(applyVariablesToTestScripts(scripts, "p", "[x]")).resolves.toBeDefined();
  });
});
