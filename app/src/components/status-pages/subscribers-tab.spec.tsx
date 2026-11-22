import { fireEvent, render, screen } from "@testing-library/react";
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

it("keeps the clamped page after deleting the last row of the last page", async () => {
  const { deleteSubscriber } = jest.requireMock("@/actions/get-status-page-subscribers") as { deleteSubscriber: jest.Mock };
  const many = (n: number) => ({
    success: true,
    subscribers: Array.from({ length: n }, (_, i) => ({ ...subscriber, id: `s${i}`, endpoint: `https://example.test/${i}` })),
    stats: { total: n, verified: 0, pending: n },
  });
  deleteSubscriber.mockResolvedValue({ success: true });
  // jsdom has no layout, so the page size stays at its default of 10.
  getSubscribers.mockResolvedValueOnce(many(11)).mockResolvedValueOnce(many(10)).mockResolvedValueOnce(many(25));
  render(<SubscribersTab statusPageId="p1" canUpdate />);
  fireEvent.click(await screen.findByRole("button", { name: "Go to next page" }));
  expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();

  const deleteLast = async () => {
    fireEvent.click(screen.getAllByRole("menuitem", { name: "Delete" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
  };
  await deleteLast();
  expect(await screen.findByText("Page 1 of 1")).toBeInTheDocument();
  // More rows later must not bring back the old page 2.
  await deleteLast();
  expect(await screen.findByText("Page 1 of 3")).toBeInTheDocument();
});
