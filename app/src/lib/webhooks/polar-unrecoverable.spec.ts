const values = jest.fn();
jest.mock("@/utils/db", () => ({ db: { insert: () => ({ values }) } }));
import { UnrecoverableWebhookError } from "./polar-event-transaction";
import { WEBHOOK_UNRECOVERABLE_ACTION, recordUnrecoverableWebhook } from "./polar-unrecoverable";

const ORG = "0198a1c2-0000-7000-8000-000000000001";

function failure(context?: UnrecoverableWebhookError["context"]) {
  return Object.assign(new UnrecoverableWebhookError("Unknown product ID: p"), { context });
}

beforeEach(() => values.mockReset().mockResolvedValue(undefined));

it("stores the event type, id and tenant references with the reason", async () => {
  await recordUnrecoverableWebhook(failure({ eventType: "subscription.active", eventId: "sub_1", organizationId: ORG, customerId: "cus_1" }));
  expect(values).toHaveBeenCalledWith({
    organizationId: ORG,
    action: WEBHOOK_UNRECOVERABLE_ACTION,
    details: { resource: "polar_webhook", resourceId: "sub_1", metadata: { eventType: "subscription.active", eventId: "sub_1", customerId: "cus_1", reason: "Unknown product ID: p" } },
  });
});

it("does not store an organization reference that is not a UUID", async () => {
  await recordUnrecoverableWebhook(failure({ eventType: "order.paid", organizationId: "not-a-uuid" }));
  expect(values).toHaveBeenCalledWith(expect.objectContaining({ organizationId: null }));
});

it("never throws, so a storage failure cannot turn the acknowledgement into a retry", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  values.mockRejectedValue(new Error("db down"));
  await expect(recordUnrecoverableWebhook(failure())).resolves.toBeUndefined();
  log.mockRestore();
});
