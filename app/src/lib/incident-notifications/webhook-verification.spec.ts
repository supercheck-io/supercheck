/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: { update: jest.fn(), query: { statusPages: { findFirst: jest.fn() } } } }));
jest.mock("@/lib/middleware/plan-enforcement", () => ({ checkSubscriberLimit: jest.fn() }));
jest.mock("@/lib/middleware/plan-limit-lock", () => ({ insertWithinPlanLimit: jest.fn() }));
jest.mock("@/lib/webhook-delivery.service", () => ({ sendWebhookVerificationChallenge: jest.fn() }));

import { db } from "@/utils/db";
import { insertWithinPlanLimit } from "@/lib/middleware/plan-limit-lock";
import { sendWebhookVerificationChallenge } from "@/lib/webhook-delivery.service";
import { sendWebhookChallenge } from "./webhook-verification";

const params = { subscriberId: "subscriber", endpoint: "https://hooks.example.com", statusPageId: "page" };
let returned: jest.Mock;
beforeEach(() => {
  jest.resetAllMocks();
  returned = jest.fn().mockResolvedValue([{ id: "subscriber" }]);
  jest.mocked(db.update).mockReturnValue({ set: () => ({ where: () => ({ returning: returned }) }) } as never);
  jest.mocked(db.query.statusPages.findFirst).mockResolvedValue({ organizationId: "org" } as never);
  jest.mocked(sendWebhookVerificationChallenge).mockResolvedValue({ success: true });
  jest.mocked(insertWithinPlanLimit).mockImplementation(async (options) => ({ ok: true, row: await options.insert(db) }) as never);
});

it("enforces the per-page plan limit when activating a proven endpoint", async () => {
  jest.mocked(insertWithinPlanLimit).mockResolvedValue({ ok: false, check: { allowed: false, error: "Subscriber limit reached" } } as never);
  await expect(sendWebhookChallenge(params)).resolves.toEqual({ verified: false, error: "Subscriber limit reached" });
  expect(insertWithinPlanLimit).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org", resource: "subscribers", lockKey: "page" }));
  expect(db.update).toHaveBeenCalledTimes(1);
});
it("leaves the subscriber pending if the plan lock is busy", async () => {
  jest.mocked(insertWithinPlanLimit).mockResolvedValue({ ok: false, busy: true });
  await expect(sendWebhookChallenge(params)).resolves.toMatchObject({ verified: false, error: expect.stringMatching(/retry/i) });
});
it("does not send a challenge to a deleted, purged or already verified subscriber", async () => {
  returned.mockResolvedValue([]);
  await expect(sendWebhookChallenge(params)).resolves.toMatchObject({ verified: false });
  expect(sendWebhookVerificationChallenge).not.toHaveBeenCalled();
});
it("does not report activation when the challenge was superseded or the subscriber removed", async () => {
  returned.mockResolvedValueOnce([{ id: "subscriber" }]).mockResolvedValueOnce([]);
  await expect(sendWebhookChallenge(params)).resolves.toMatchObject({ verified: false, error: expect.stringMatching(/superseded/) });
});
it("activates the current successful challenge", async () => {
  await expect(sendWebhookChallenge(params)).resolves.toEqual({ verified: true });
  expect(db.update).toHaveBeenCalledTimes(2);
});
it("does not activate on an unsuccessful ownership check", async () => {
  jest.mocked(sendWebhookVerificationChallenge).mockResolvedValue({ success: false, error: "No echo" });
  await expect(sendWebhookChallenge(params)).resolves.toEqual({ verified: false, error: "No echo" });
  expect(insertWithinPlanLimit).not.toHaveBeenCalled();
});
