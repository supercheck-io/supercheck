import { render, screen } from "@testing-library/react";
import { CommunityLinks } from "./community-links";

let mockIsSelfHosted = false;
jest.mock("@/hooks/use-app-config", () => ({
  useAppConfig: () => ({ isSelfHosted: mockIsSelfHosted }),
}));

describe("CommunityLinks", () => {
  const originalSourceUrl = process.env.NEXT_PUBLIC_SOURCE_URL;
  beforeEach(() => { delete process.env.NEXT_PUBLIC_SOURCE_URL; });
  afterEach(() => {
    mockIsSelfHosted = false;
    if (originalSourceUrl === undefined) delete process.env.NEXT_PUBLIC_SOURCE_URL;
    else process.env.NEXT_PUBLIC_SOURCE_URL = originalSourceUrl;
  });

  it("hides the header source action in Cloud and while configuration is unavailable", () => {
    render(<CommunityLinks />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("keeps the header source action for self-hosted deployments", () => {
    mockIsSelfHosted = true;
    render(<CommunityLinks />);
    expect(screen.getByRole("link", { name: "View corresponding source code" }))
      .toHaveAttribute("href", "https://github.com/supercheck-io/supercheck");
  });

  it("preserves the configured corresponding-source URL", () => {
    mockIsSelfHosted = true;
    process.env.NEXT_PUBLIC_SOURCE_URL = "https://example.com/source";
    render(<CommunityLinks />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://example.com/source");
  });
});
