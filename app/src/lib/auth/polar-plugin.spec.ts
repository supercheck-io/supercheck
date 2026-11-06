import { acknowledgeUnrecoverable } from "./polar-plugin";
import { UnrecoverableWebhookError } from "@/lib/webhooks/polar-webhooks";

jest.mock("@/lib/webhooks/polar-webhooks", () => {
  class UnrecoverableWebhookError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "UnrecoverableWebhookError";
    }
  }
  return { UnrecoverableWebhookError };
});

const recordUnrecoverableWebhook = jest.fn(async () => undefined);
jest.mock("@/lib/webhooks/polar-unrecoverable", () => ({ recordUnrecoverableWebhook }));

describe("acknowledgeUnrecoverable", () => {
  it("logs the event id and persists the failure outside the rolled-back transaction", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = Object.assign(new UnrecoverableWebhookError("Unknown product ID: p"), { context: { eventType: "subscription.active", eventId: "sub_9" } });
    const { onSubscriptionActive } = acknowledgeUnrecoverable({ onSubscriptionActive: async () => { throw failure; } });
    await expect(onSubscriptionActive!({} as never)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("event sub_9"));
    expect(recordUnrecoverableWebhook).toHaveBeenCalledWith(failure);
    log.mockRestore();
  });

  it("acknowledges an event that can never be applied", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const { onSubscriptionUpdated } = acknowledgeUnrecoverable({
      onSubscriptionUpdated: async () => { throw new UnrecoverableWebhookError("Unknown product ID: p"); },
    });
    await expect(onSubscriptionUpdated!({} as never)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Unknown product ID: p"));
    log.mockRestore();
  });

  it("still fails retryable errors so Polar redelivers", async () => {
    const { onOrderPaid } = acknowledgeUnrecoverable({
      onOrderPaid: async () => { throw new Error("Waiting for subscription lifecycle event"); },
    });
    await expect(onOrderPaid!({} as never)).rejects.toThrow("Waiting for subscription lifecycle event");
  });
});
