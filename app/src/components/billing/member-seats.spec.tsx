import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemberSeats, seatChangePreview } from "./member-seats";

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const proSeats = { current: 22, limit: 25, included: 25, purchasedSeats: 25, extraMemberPriceCents: 800 };

describe("seatChangePreview", () => {
  const seats = { limit: 25, included: 25, extraMemberPriceCents: 800 };
  it.each([
    [28, "Add 3 members: +$24/month. The prorated charge for the rest of this billing period is invoiced now."],
    [26, "Add 1 member: +$8/month."],
    [25, "No change."],
  ])("previews %s seats", (next, text) => {
    expect(seatChangePreview(seats, next)).toContain(text);
  });

  it("previews a decrease as a credit", () => {
    expect(seatChangePreview({ ...seats, limit: 30 }, 27)).toBe(
      "Remove 3 seats: -$24/month. The unused time is credited on your next invoice.",
    );
  });
});

describe("MemberSeats", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it("tells Plus organizations what Pro offers", () => {
    render(<MemberSeats plan="plus" seats={{ current: 5, limit: 5 }} canManage onSaved={jest.fn()} />);
    expect(screen.getByText(/Need more than 5 members\? Pro includes 25, and extra members are \$8 per member per month, up to 100 members/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows seats without a change button to members who cannot manage billing", () => {
    render(<MemberSeats plan="pro" seats={{ ...proSeats, limit: 30, purchasedSeats: 30 }} canManage={false} onSaved={jest.fn()} />);
    expect(screen.getByText(/Members: 22 \/ 30 \(25 included \+ 5 extra at \$8\/month each\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change member seats" })).not.toBeInTheDocument();
    expect(screen.getByText("Ask the organization owner to change member seats.")).toBeInTheDocument();
  });

  it("previews the cost and buys seats for the organization", async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({}) }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const onSaved = jest.fn();
    render(<MemberSeats organizationId="org_1" plan="pro" seats={proSeats} canManage onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "Change member seats" }));
    const input = screen.getByLabelText("Total members");
    fireEvent.change(input, { target: { value: "28" } });
    expect(screen.getByText(/Add 3 members: \+\$24\/month/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/billing/members", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ organizationId: "org_1", totalMembers: 28 }),
    }));
  });

  it("keeps the dialog open and shows the error when the change fails", async () => {
    const { toast } = jest.requireMock("sonner");
    global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({ error: "A subscription change is already pending." }) })) as unknown as typeof fetch;
    const onSaved = jest.fn();
    render(<MemberSeats organizationId="org_1" plan="pro" seats={proSeats} canManage onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "Change member seats" }));
    fireEvent.change(screen.getByLabelText("Total members"), { target: { value: "27" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not change member seats", { description: "A subscription change is already pending." }));
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Total members")).toBeInTheDocument();
  });

  it.each([
    ["unlimited", proSeats],
    ["pro", { current: 3, limit: 25 }],
  ] as const)("renders nothing for %s without seat details", (plan, seats) => {
    const { container } = render(<MemberSeats plan={plan} seats={seats} canManage onSaved={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("points to sales above the member maximum", () => {
    render(<MemberSeats organizationId="org_1" plan="pro" seats={proSeats} canManage onSaved={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Change member seats" }));
    fireEvent.change(screen.getByLabelText("Total members"), { target: { value: "101" } });
    expect(screen.getByText(/Need more than 100 members\? Contact us/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  });

  it("will not go below the members in use", () => {
    render(<MemberSeats organizationId="org_1" plan="pro" seats={{ ...proSeats, current: 31, limit: 32 }} canManage onSaved={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Change member seats" }));
    fireEvent.change(screen.getByLabelText("Total members"), { target: { value: "30" } });
    expect(screen.getByText(/Choose a whole number from 31/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  });
});
