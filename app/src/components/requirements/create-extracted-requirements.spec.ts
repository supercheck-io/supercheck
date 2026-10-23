import { createExtractedRequirements, withoutCreated } from "./create-extracted-requirements";

const requirement = (title: string) => ({ title, description: null, priority: null, tags: ["ai", "auth"] });

describe("createExtractedRequirements", () => {
  it("creates every requirement and reports progress", async () => {
    const create = jest.fn().mockResolvedValue({ id: "r", success: true });
    const onProgress = jest.fn();

    const result = await createExtractedRequirements([requirement("A"), requirement("B")], "doc-1", create, onProgress);

    expect(result).toEqual({ created: 2 });
    expect(onProgress.mock.calls).toEqual([[1], [2]]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "A", sourceDocumentId: "doc-1", createdBy: "ai", priority: "medium", tags: "ai, auth" }),
    );
  });

  it("stops at the first {success:false} result instead of reporting success", async () => {
    const create = jest
      .fn()
      .mockResolvedValueOnce({ id: "r", success: true })
      .mockResolvedValueOnce({ id: "", success: false, error: "Source document not found in this project" });

    const result = await createExtractedRequirements([requirement("A"), requirement("B"), requirement("C")], "doc-1", create);

    expect(result.created).toBe(1);
    expect(result.failure).toEqual(new Error("Source document not found in this project"));
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("reports a thrown error with the count written so far", async () => {
    const boom = new Error("network");
    const create = jest.fn().mockRejectedValue(boom);

    expect(await createExtractedRequirements([requirement("A")], "doc-1", create)).toEqual({ created: 0, failure: boom });
  });
});

describe("withoutCreated", () => {
  const rows = ["a", "b", "c", "d"].map((id) => ({ id }));
  it("drops only the rows that were written, keeping the unselected and the unwritten", () => {
    const selected = [rows[0], rows[2], rows[3]];
    expect(withoutCreated(rows, selected, 2).map((r) => r.id)).toEqual(["b", "d"]);
    expect(withoutCreated(rows, selected, 0)).toHaveLength(4);
  });
});
