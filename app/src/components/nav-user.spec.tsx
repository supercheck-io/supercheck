import { render, screen } from "@testing-library/react";

let mockMcpEnabled = false;
jest.mock("@/hooks/use-app-config", () => ({ useAppConfig: () => ({ isMcpEnabled: mockMcpEnabled }) }));
jest.mock("@/utils/auth-client", () => ({
  useSession: () => ({ data: { user: { name: "Ada", email: "ada@example.com", image: null } }, isPending: false }),
  signOut: jest.fn(),
}));
jest.mock("next-themes", () => ({ useTheme: () => ({ theme: "system", setTheme: jest.fn() }) }));
jest.mock("@/hooks/use-project-context", () => ({ useProjectContextSafe: () => null, clearProjectsCache: jest.fn() }));
jest.mock("@/components/support/chatwoot-widget", () => ({ resetChatwootSession: jest.fn() }));
jest.mock("@/components/leave-organization-dialog", () => ({ LeaveOrganizationDialog: () => null }));
jest.mock("@/lib/query-provider", () => ({ clearQueryCache: jest.fn() }));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
// The menu content only mounts when opened; render it inline so the items can be inspected.
jest.mock("@/components/ui/dropdown-menu", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    DropdownMenu: Pass, DropdownMenuContent: Pass, DropdownMenuLabel: Pass, DropdownMenuSeparator: () => <hr />,
    DropdownMenuTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    DropdownMenuItem: ({ children, asChild, onClick, ...rest }: { children?: React.ReactNode; asChild?: boolean; onClick?: () => void; "data-testid"?: string }) =>
      asChild ? <>{children}</> : <div role="menuitem" onClick={onClick} {...rest}>{children}</div>,
  };
});

import { NavUser } from "./nav-user";

describe("NavUser: Connected apps", () => {
  beforeEach(() => { mockMcpEnabled = false; });

  it("links to Connected apps where the MCP server is enabled", () => {
    mockMcpEnabled = true;
    render(<NavUser />);
    const link = screen.getByTestId("connected-apps-link");
    expect(link).toHaveAttribute("href", "/connected-apps");
    expect(link).toHaveTextContent("Connected apps");
  });

  it("does not offer a page that says 'not enabled' when the MCP server is off", () => {
    render(<NavUser />);
    expect(screen.queryByTestId("connected-apps-link")).not.toBeInTheDocument();
  });

  it("keeps the rest of the menu unchanged", () => {
    render(<NavUser />);
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByTestId("sign-out-button")).toBeInTheDocument();
    expect(screen.getByText("Theme")).toBeInTheDocument();
  });
});
