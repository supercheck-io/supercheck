import { readFileSync } from "fs";
import path from "path";

// Runs public/supercheck-sw.js against a fake worker global.
function loadWorker(cacheNames: string[], deleteFails = false) {
  const handlers: Record<string, (event: { waitUntil: (p: Promise<unknown>) => void }) => void> = {};
  const order: string[] = [];
  const self = {
    addEventListener: (type: string, fn: (typeof handlers)[string]) => (handlers[type] = fn),
    skipWaiting: jest.fn(),
    registration: { unregister: jest.fn(async () => order.push("unregister")) },
  };
  const caches = {
    keys: jest.fn(async () => cacheNames),
    delete: jest.fn(async (name: string) => {
      if (deleteFails) throw new Error("storage error");
      order.push(`delete:${name}`);
      return true;
    }),
  };
  const source = readFileSync(path.join(__dirname, "../../public/supercheck-sw.js"), "utf8");
  new Function("self", "caches", source)(self, caches);
  return { handlers, self, caches, order };
}

async function activate(worker: ReturnType<typeof loadWorker>) {
  let pending: Promise<unknown> = Promise.resolve();
  worker.handlers.activate({ waitUntil: (p) => (pending = p) });
  await pending;
}

describe("retired supercheck-sw.js", () => {
  it("has no fetch handler and activates immediately", () => {
    const worker = loadWorker([]);
    expect(worker.handlers.fetch).toBeUndefined();
    worker.handlers.install({ waitUntil: () => {} });
    expect(worker.self.skipWaiting).toHaveBeenCalled();
  });

  it("deletes only supercheck caches, then unregisters", async () => {
    const worker = loadWorker(["supercheck-static-cache-v1", "other-cache"]);
    await activate(worker);
    expect(worker.order).toEqual(["delete:supercheck-static-cache-v1", "unregister"]);
  });

  it("still unregisters when cache cleanup fails", async () => {
    const worker = loadWorker(["supercheck-static-cache-v1"], true);
    await activate(worker);
    expect(worker.self.registration.unregister).toHaveBeenCalled();
  });
});
