/** @jest-environment node */
jest.mock("./queue", () => ({ getRedisConnection: jest.fn() }));
import { getRedisConnection } from "./queue";
import { allowStatusPageSubscription } from "./status-page-subscription-rate-limit";
it("uses both client/page and whole-page limits without storing the client IP", async () => {
  const evalMock = jest.fn(async () => 1);
  (getRedisConnection as jest.Mock).mockResolvedValue({ eval: evalMock });
  expect(await allowStatusPageSubscription("203.0.113.5", "page")).toBe(true);
  expect(evalMock.mock.calls[0].join(" ")).not.toContain("203.0.113.5");
});
it("fails closed when Redis is unavailable or the limit is reached", async () => {
  (getRedisConnection as jest.Mock).mockRejectedValue(new Error("offline"));
  expect(await allowStatusPageSubscription("203.0.113.5", "page")).toBe(false);
  (getRedisConnection as jest.Mock).mockResolvedValue({ eval: async () => 0 });
  expect(await allowStatusPageSubscription("203.0.113.5", "page")).toBe(false);
});
