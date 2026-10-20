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
import {
  DOMAIN_UNVERIFY_FAILURE_LIMIT,
  checkStatusPageDomain,
  nextDomainVerificationState,
} from "./status-page-domain-check";

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

it("treats a CNAME pointing elsewhere as a definitive mismatch", async () => {
  (resolveCname as jest.Mock).mockResolvedValue(["other.example.com."]);
  expect(await checkStatusPageDomain("status.example.net", "page")).toBe(
    "invalid",
  );
});

it.each(["ENOTFOUND", "ENODATA", "EAI_AGAIN", "ETIMEOUT"])(
  "classifies a transient resolver failure (%s) as unavailable",
  async (code) => {
    (resolveCname as jest.Mock).mockRejectedValue({ code });
    expect(await checkStatusPageDomain("status.example.net", "page")).toBe(
      "unavailable",
    );
  },
);

it("classifies an empty address answer as unavailable", async () => {
  (resolve4 as jest.Mock).mockResolvedValue([]);
  (resolve6 as jest.Mock).mockResolvedValue([]);
  expect(await checkStatusPageDomain("status.example.net", "page")).toBe(
    "unavailable",
  );
});

it("unverifies only after three consecutive definitive mismatches", () => {
  let state = { verified: true, failureCount: 0 };
  state = nextDomainVerificationState("invalid", state);
  expect(state).toEqual({ verified: true, failureCount: 1 });
  state = nextDomainVerificationState("invalid", state);
  expect(state).toEqual({ verified: true, failureCount: 2 });
  state = nextDomainVerificationState("invalid", state);
  expect(state).toEqual({ verified: false, failureCount: 3 });
  expect(DOMAIN_UNVERIFY_FAILURE_LIMIT).toBe(3);
});

it("resets the strike count on a valid or unavailable check", () => {
  const afterTwo = { verified: true, failureCount: 2 };
  expect(nextDomainVerificationState("unavailable", afterTwo)).toEqual({
    verified: true,
    failureCount: 0,
  });
  expect(nextDomainVerificationState("valid", afterTwo)).toEqual({
    verified: true,
    failureCount: 0,
  });
});

it("keeps a domain unverified after the threshold has already passed", () => {
  expect(
    nextDomainVerificationState("invalid", {
      verified: false,
      failureCount: 3,
    }),
  ).toEqual({ verified: false, failureCount: 3 });
});
