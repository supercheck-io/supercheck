import { GET } from "./route";
import { isConsumerHealthy } from "@/lib/consumer-watchdog";

jest.mock("@/lib/consumer-watchdog", () => ({ isConsumerHealthy: jest.fn() }));

describe("GET /api/health/live", () => {
  it("is alive while consumers are healthy", async () => {
    (isConsumerHealthy as jest.Mock).mockReturnValue(true);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "alive" });
  });

  it("fails once a queue consumer is stuck for good, so Kubernetes restarts the pod", async () => {
    (isConsumerHealthy as jest.Mock).mockReturnValue(false);
    const res = await GET();
    expect(res.status).toBe(503);
  });
});
