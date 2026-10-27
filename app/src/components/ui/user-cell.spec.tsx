import { fireEvent, render, screen } from "@testing-library/react";

import { UserAvatar, UserCell, initials } from "./user-cell";

describe("initials", () => {
  it("uses the first letter of up to two words", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("ada byron lovelace")).toBe("AB");
    expect(initials("  ")).toBe("?");
  });
});

describe("UserAvatar", () => {
  it("shows initials for a person", () => {
    render(<UserAvatar name="Ada Lovelace" />);
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("shows a person icon when nobody is set", () => {
    const { container } = render(<UserAvatar name={null} image="/api/users/u1/avatar" />);
    expect(container.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(container.textContent).toBe("");
  });

  it("passes extra props to the avatar root", () => {
    render(<UserAvatar name="Ada" data-testid="account-avatar" />);
    expect(screen.getByTestId("account-avatar")).toBeInTheDocument();
  });
});

describe("UserCell", () => {
  it("shows the name, never the email inline, and the email in a tooltip", async () => {
    render(<UserCell name="Ada Lovelace" email="ada@example.com" />);
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.queryByText(/ada@example\.com/)).toBeNull();
    fireEvent.focus(screen.getByText("Ada Lovelace").parentElement!);
    expect((await screen.findAllByText("ada@example.com")).length).toBeGreaterThan(0);
  });

  it("falls back to the email when there is no name", () => {
    render(<UserCell name={null} email="ada@example.com" />);
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
  });

  it("shows the empty label when there is no person", () => {
    render(<UserCell name={null} emptyLabel="System" />);
    expect(screen.getByText("System")).toBeInTheDocument();
  });

  it("defaults the empty label to Unassigned", () => {
    render(<UserCell name={undefined} />);
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });
});
