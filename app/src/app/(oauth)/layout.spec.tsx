import { render, screen } from "@testing-library/react";
import OAuthLayout from "./layout";
import DeviceLayout from "@/app/(device)/layout";

describe("OAuth consent layout", () => {
  it("is the same static, branded shell as the device approval pages (no dashboard chrome, no session lookup)", () => {
    expect(OAuthLayout).toBe(DeviceLayout);
  });

  it("wraps the page in the shared auth frame (the logo sits in each card)", () => {
    render(<OAuthLayout><p>consent content</p></OAuthLayout>);
    expect(screen.getByRole("main")).toContainElement(screen.getByText("consent content"));
  });
});
