import { runErrorMessage } from "./run-error-message";

describe("runErrorMessage", () => {
  it("shows the API's message instead of the raw JSON body, untrimmed", () => {
    const message = "This organization is scheduled for deletion and is read-only. The owner can cancel the deletion from the organization page.";
    expect(runErrorMessage(JSON.stringify({ error: message, code: "ORG_PENDING_DELETION" }))).toBe(message);
  });

  it("trims an unstructured body", () => {
    expect(runErrorMessage("Failed to run job: boom")).toBe("boom");
    expect(runErrorMessage("x".repeat(150))).toBe(`${"x".repeat(100)}...`);
  });
});
