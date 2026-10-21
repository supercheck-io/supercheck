import { render, screen } from "@testing-library/react";
import OAuthLayout from "./layout";
import DeviceLayout from "@/app/(device)/layout";

describe("OAuth consent layout", () => {
  it("is the same static, branded shell as the device approval pages (no dashboard chrome, no session lookup)", () => {
    expect(OAuthLayout).toBe(DeviceLayout);
  });

  it("wraps the page in the Supercheck shell", () => {
    render(<OAuthLayout><p>consent content</p></OAuthLayout>);
    expect(screen.getByText("Supercheck")).toBeInTheDocument();
    expect(screen.getByText("consent content")).toBeInTheDocument();
  });
});
