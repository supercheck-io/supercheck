/** @jest-environment node */
import fs from "node:fs";
import path from "node:path";

// The marker is compared by both packages, so a wording change in one silently disables admission,
// recovery and finalization in the other. Read the sources as text: importing the app module would
// pull the queue into this spec, and a static import of the worker would pull in its separate build.
const root = path.join(__dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const declaration = /export const RUN_CANCELLATION_MARKER = (["'])(.+?)\1;/;

describe("run cancellation marker", () => {
  const appSource = read("app/src/lib/cancellation-service.ts");
  const workerSource = read("worker/src/common/services/cancellation.service.ts");

  it("is declared with the same value in the app and the worker", () => {
    const app = declaration.exec(appSource);
    const worker = declaration.exec(workerSource);
    expect(app).not.toBeNull();
    expect(worker).not.toBeNull();
    expect(app?.[2]).toBe(worker?.[2]);
  });

  it("is the only place the worker spells out the marker in non-test code", () => {
    const literal = declaration.exec(workerSource)?.[2] as string;
    const files = [
      "worker/src/k6/processors/k6-execution.processor.ts",
      "worker/src/execution/processors/playwright-execution.processor.ts",
      "worker/src/execution/services/execution.service.ts",
      "worker/src/execution/services/db.service.ts",
      "worker/src/execution/services/stalled-job-handler.service.ts",
      "app/src/app/api/runs/[runId]/cancel/route.ts",
    ];
    for (const file of files) {
      const source = read(file);
      expect({ file, literal: source.includes(literal) }).toEqual({ file, literal: false });
      expect({ file, imported: source.includes("RUN_CANCELLATION_MARKER") }).toEqual({ file, imported: true });
    }
  });
});
