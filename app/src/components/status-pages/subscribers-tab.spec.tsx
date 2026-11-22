import { render, screen } from "@testing-library/react";
import { SubscribersTab } from "./subscribers-tab";

jest.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => null,
  DropdownMenuItem: ({ children, onSelect }: { children: React.ReactNode; onSelect?: () => void }) => (
    <button role="menuitem" onClick={onSelect}>{children}</button>
  ),
}));

const getSubscribers = jest.fn();
jest.mock("@/actions/get-status-page-subscribers", () => ({
  getStatusPageSubscribers: (...a: unknown[]) => getSubscribers(...a),
  deleteSubscriber: jest.fn(),
  resendVerificationEmail: jest.fn(),
  resendWebhookVerification: jest.fn(),
  rotateSubscriberWebhookSecret: jest.fn(),
}));

const subscriber = {
  id: "s1",
  mode: "webhook",
  endpoint: "https://example.test/hook",
  email: null,
  verifiedAt: null,
  createdAt: new Date("2024-01-01"),
};

beforeEach(() => {
  getSubscribers.mockResolvedValue({
    success: true,
    subscribers: [subscriber],
    stats: { total: 1, verified: 0, pending: 1 },
  });
});

it("shows delete, resend and rotate actions to users who can update", async () => {
  render(<SubscribersTab statusPageId="p1" canUpdate />);
  expect(await screen.findByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Rotate signing secret" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Resend challenge" })).toBeInTheDocument();
});

it("hides mutating actions from viewers", async () => {
  render(<SubscribersTab statusPageId="p1" canUpdate={false} />);
  await screen.findByText("https://example.test/hook");
  expect(screen.queryByRole("button", { name: /^Actions for/ })).toBeNull();
});
