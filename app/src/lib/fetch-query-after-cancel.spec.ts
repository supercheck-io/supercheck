import { QueryClient } from "@tanstack/react-query";

import { fetchQueryAfterCancel } from "./fetch-query-after-cancel";

describe("fetchQueryAfterCancel", () => {
  it("refetches when the cache is cleared mid-flight", async () => {
    const client = new QueryClient();
    let calls = 0;
    const queryFn = () => new Promise<number>((resolve) => setTimeout(() => resolve(++calls), 5));
    const result = fetchQueryAfterCancel(client, { queryKey: ["probe"], queryFn });
    client.clear();
    await expect(result).resolves.toBe(2);
  });

  it("still rejects real fetch errors", async () => {
    const client = new QueryClient();
    const queryFn = jest.fn(() => Promise.reject(new Error("boom")));
    await expect(fetchQueryAfterCancel(client, { queryKey: ["fail"], queryFn, retry: false })).rejects.toThrow("boom");
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});
