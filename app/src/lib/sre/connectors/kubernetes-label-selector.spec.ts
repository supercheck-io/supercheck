import { isValidKubernetesLabelSelector } from "./kubernetes-label-selector";

describe("isValidKubernetesLabelSelector", () => {
  it.each([
    "*",
    "app=checkout-api",
    "app.kubernetes.io/name=checkout-api",
    "environment!=production,tier in (frontend,api)",
    "release",
    "!deprecated",
  ])("accepts Kubernetes label selector %s", (selector) => {
    expect(isValidKubernetesLabelSelector(selector)).toBe(true);
  });

  it.each([
    "",
    "{metadata.name=checkout-api status.phase=Running}",
    'app="checkout-api"',
    "metadata.name=checkout-api",
    "app=checkout-api && tier=api",
    "tier in ()",
    "app=checkout-api,",
  ])("rejects non-label-selector query %s", (selector) => {
    expect(isValidKubernetesLabelSelector(selector)).toBe(false);
  });
});
