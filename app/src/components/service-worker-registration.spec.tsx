import { render, waitFor } from "@testing-library/react";
import { ServiceWorkerRegistration } from "./service-worker-registration";

function registration(scriptURL: string | null, slot: "active" | "waiting" = "active") {
  return {
    active: slot === "active" && scriptURL ? { scriptURL } : null,
    waiting: slot === "waiting" && scriptURL ? { scriptURL } : null,
    installing: null,
    unregister: jest.fn().mockResolvedValue(true),
  };
}

describe("ServiceWorkerRegistration", () => {
  const original = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");

  afterEach(() => {
    if (original) Object.defineProperty(navigator, "serviceWorker", original);
    else delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  });

  function mockServiceWorker(registrations: ReturnType<typeof registration>[]) {
    const container = {
      register: jest.fn(),
      getRegistrations: jest.fn().mockResolvedValue(registrations),
    };
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: container });
    return container;
  }

  it("unregisters only the retired app worker and never registers one", async () => {
    const retired = registration("https://app.example.com/supercheck-sw.js");
    const retiredWaiting = registration("https://app.example.com/supercheck-sw.js", "waiting");
    const traceViewer = registration(
      "https://app.example.com/api/test-results/abc/report/trace/sw.bundle.js"
    );
    const empty = registration(null);
    const container = mockServiceWorker([retired, retiredWaiting, traceViewer, empty]);

    render(<ServiceWorkerRegistration />);

    await waitFor(() => expect(retired.unregister).toHaveBeenCalled());
    expect(retiredWaiting.unregister).toHaveBeenCalled();
    expect(traceViewer.unregister).not.toHaveBeenCalled();
    expect(empty.unregister).not.toHaveBeenCalled();
    expect(container.register).not.toHaveBeenCalled();
  });

  it("deletes only the retired worker's caches", async () => {
    mockServiceWorker([]);
    const cacheApi = {
      keys: jest.fn().mockResolvedValue(["supercheck-static-cache-v1", "other"]),
      delete: jest.fn().mockResolvedValue(true),
    };
    Object.defineProperty(globalThis, "caches", { configurable: true, value: cacheApi });
    try {
      render(<ServiceWorkerRegistration />);
      await waitFor(() => expect(cacheApi.delete).toHaveBeenCalledWith("supercheck-static-cache-v1"));
      expect(cacheApi.delete).toHaveBeenCalledTimes(1);
    } finally {
      delete (globalThis as { caches?: unknown }).caches;
    }
  });

  it("ignores lookup failures", async () => {
    const container = mockServiceWorker([]);
    container.getRegistrations.mockRejectedValue(new Error("denied"));

    expect(() => render(<ServiceWorkerRegistration />)).not.toThrow();
    await waitFor(() => expect(container.getRegistrations).toHaveBeenCalled());
  });

  it("does nothing without service worker support", () => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    expect(() => render(<ServiceWorkerRegistration />)).not.toThrow();
  });
});
