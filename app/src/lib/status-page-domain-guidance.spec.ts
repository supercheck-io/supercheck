import {
  STATUS_PAGE_CUSTOM_DOMAIN_RECORD_TYPE_GUIDANCE,
  STATUS_PAGE_CUSTOM_DOMAIN_TARGET_RECORD_GUIDANCE,
  getStatusPageCustomDomainTargetResolutionError,
  getStatusPageCustomDomainTargetResolutionHint,
} from "./status-page-domain-guidance";

describe("status page domain guidance", () => {
  it("describes the target hostname requirement", () => {
    expect(
      getStatusPageCustomDomainTargetResolutionHint("cname.example.com")
    ).toBe(
      "The target hostname cname.example.com must already point to your app before verification can succeed, usually via an A/AAAA record or a wildcard record that already covers it."
    );
  });

  it("uses singular wording for one target hostname", () => {
    expect(
      getStatusPageCustomDomainTargetResolutionError(["cname.example.com"])
    ).toBe(
      `CNAME points to cname.example.com, but that target hostname is not publicly resolvable yet. ${STATUS_PAGE_CUSTOM_DOMAIN_RECORD_TYPE_GUIDANCE} ${STATUS_PAGE_CUSTOM_DOMAIN_TARGET_RECORD_GUIDANCE} Wait for DNS propagation and verify again.`
    );
  });

  it("uses plural wording for multiple target hostnames", () => {
    expect(
      getStatusPageCustomDomainTargetResolutionError([
        "cname.example.com",
        "ingress.example.com",
      ])
    ).toBe(
      `CNAME points to cname.example.com, ingress.example.com, but those target hostnames are not publicly resolvable yet. ${STATUS_PAGE_CUSTOM_DOMAIN_RECORD_TYPE_GUIDANCE} ${STATUS_PAGE_CUSTOM_DOMAIN_TARGET_RECORD_GUIDANCE} Wait for DNS propagation and verify again.`
    );
  });
});
