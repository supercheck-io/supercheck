/** @jest-environment node */

import http from "node:http";
import type { AddressInfo } from "node:net";
import { createPinnedLookup } from "./pinned-lookup";

describe("createPinnedLookup", () => {
  it("returns every vetted address for options.all and the first otherwise", () => {
    const lookup = createPinnedLookup([
      { address: "::1", family: 6 },
      { address: "127.0.0.1", family: 4 },
    ]);
    const all = jest.fn();
    lookup("localhost", { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, [
      { address: "::1", family: 6 },
      { address: "127.0.0.1", family: 4 },
    ]);
    const one = jest.fn();
    lookup("localhost", {}, one);
    expect(one).toHaveBeenCalledWith(null, "::1", 6);
  });

  it("lets Node fall back to the IPv4 address when ::1 refuses", async () => {
    const server = http.createServer((_req, res) => res.end("ok"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const body = await new Promise<string>((resolve, reject) => {
        http
          .get(
            {
              host: "localhost",
              port,
              autoSelectFamily: true,
              // autoSelectFamily is missing from older @types/node request options.
              lookup: createPinnedLookup([
                { address: "::1", family: 6 },
                { address: "127.0.0.1", family: 4 },
              ]),
            } as http.RequestOptions,
            (res) => {
              let data = "";
              res.on("data", (chunk) => (data += chunk));
              res.on("end", () => resolve(data));
            },
          )
          .on("error", reject);
      });
      expect(body).toBe("ok");
    } finally {
      server.close();
    }
  });
});
