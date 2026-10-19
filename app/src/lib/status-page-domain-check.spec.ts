/** @jest-environment node */
jest.mock("node:dns/promises", () => ({
  resolveCname: jest.fn(),
  resolveTxt: jest.fn(),
  resolve4: jest.fn(),
  resolve6: jest.fn(),
}));
jest.mock("./status-page-domain", () => ({
  getStatusPageDomainVerificationTargets: () => ["cname.example.com"],
}));
import {
  resolveCname,
  resolveTxt,
  resolve4,
  resolve6,
} from "node:dns/promises";
import { checkStatusPageDomain } from "./status-page-domain-check";

beforeEach(() => {
  jest.clearAllMocks();
  (resolveCname as jest.Mock).mockResolvedValue(["CNAME.EXAMPLE.COM."]);
  (resolveTxt as jest.Mock).mockResolvedValue([
    ["supercheck-domain-verification=page"],
  ]);
  (resolve4 as jest.Mock).mockResolvedValue(["203.0.113.1"]);
  (resolve6 as jest.Mock).mockResolvedValue([]);
});
it("retains verified domains only with matching CNAME and ownership TXT", async () => {
  expect(await checkStatusPageDomain("status.example.net", "page")).toBe(
    "valid",
  );
  (resolveTxt as jest.Mock).mockResolvedValue([["unrelated"]]);
  expect(await checkStatusPageDomain("status.example.net", "page")).toBe(
    "invalid",
  );
});
it("distinguishes transient DNS failures from authoritative missing records", async () => {
  (resolveCname as jest.Mock).mockRejectedValue({ code: "ETIMEOUT" });
  expect(await checkStatusPageDomain("status.example.net", "page")).toBe(
    "unavailable",
  );
  (resolveCname as jest.Mock).mockRejectedValue({ code: "ENODATA" });
  expect(await checkStatusPageDomain("status.example.net", "page")).toBe(
    "invalid",
  );
});
