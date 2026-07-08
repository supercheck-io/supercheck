import { fireEvent, render, screen } from "@testing-library/react";

import {
  CreatePageContent,
  type QuickCreateCapabilities,
} from "./create-page-content";

const push = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

jest.mock("@/components/logo/k6-logo", () => ({
  K6Logo: () => <span>K6</span>,
}));

jest.mock("@/components/logo/playwright-logo", () => ({
  PlaywrightLogo: () => <span>PW</span>,
}));

const allCapabilities: QuickCreateCapabilities = {
  canCreateProjects: true,
  canInviteMembers: true,
  canCreateCliTokens: true,
  canInvestigateSre: true,
  canCreateSreServices: true,
  canConfigureSreConnectors: true,
};

describe("CreatePageContent", () => {
  beforeEach(() => {
    push.mockClear();
  });

  it("shows AI SRE and admin setup shortcuts for permitted users", () => {
    render(<CreatePageContent capabilities={allCapabilities} />);

    expect(screen.getByText("Investigate with AI SRE")).toBeInTheDocument();
    expect(screen.getByText("Configure AI SRE")).toBeInTheDocument();
    expect(screen.getByText("Admin Setup")).toBeInTheDocument();
    expect(screen.getByText("Automate browser flows")).toBeInTheDocument();
    expect(screen.getByText("Schedule browser suites")).toBeInTheDocument();
    expect(screen.getByText("Check HTTP endpoints")).toBeInTheDocument();
    expect(screen.getByText("Send Telegram alerts")).toBeInTheDocument();
    expect(screen.getByText("Start read-only triage")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Private Agent"));
    expect(push).toHaveBeenCalledWith("/org-admin?tab=private-agents");
  });

  it("hides privileged setup shortcuts when capabilities are missing", () => {
    render(
      <CreatePageContent
        capabilities={{
          ...allCapabilities,
          canCreateProjects: false,
          canInviteMembers: false,
          canCreateCliTokens: false,
          canCreateSreServices: false,
          canConfigureSreConnectors: false,
        }}
      />,
    );

    expect(screen.getByText("Investigate with AI SRE")).toBeInTheDocument();
    expect(screen.queryByText("Configure AI SRE")).not.toBeInTheDocument();
    expect(screen.queryByText("Admin Setup")).not.toBeInTheDocument();
    expect(screen.queryByText("Private Agent")).not.toBeInTheDocument();
    expect(screen.queryByText("CLI Token")).not.toBeInTheDocument();
  });
});
