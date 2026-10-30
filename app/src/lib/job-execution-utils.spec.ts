/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("./variable-resolver", () => ({
  ...jest.requireActual("./variable-resolver"),
  resolveProjectVariables: jest.fn(),
}));
import { applyVariablesToTestScripts } from "./job-execution-utils";
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

  it("ignores errors for variables no script references", async () => {
    resolved(["Failed to resolve variable 'OTHER_KEY': bad"]);
    await expect(applyVariablesToTestScripts(scripts, "p", "[x]")).resolves.toBeDefined();
  });
});
