import { omitExecutionSecrets } from "./execution-payload";

describe("omitExecutionSecrets", () => {
  it("removes decrypted secrets without mutating the source task", () => {
    const task = {
      runId: "run-1",
      projectId: "project-1",
      variables: { BASE_URL: "https://example.com" },
      secrets: { API_TOKEN: "tenant-secret" },
    };

    const safeTask = omitExecutionSecrets(task);

    expect(safeTask).toEqual({
      runId: "run-1",
      projectId: "project-1",
      variables: { BASE_URL: "https://example.com" },
    });
    expect(safeTask).not.toHaveProperty("secrets");
    expect(task.secrets).toEqual({ API_TOKEN: "tenant-secret" });
  });
});
