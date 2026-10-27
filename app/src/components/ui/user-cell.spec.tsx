import { fireEvent, render, screen } from "@testing-library/react";

import { UserAvatar, UserCell, avatarColor, initials } from "./user-cell";

describe("initials", () => {
  it("uses the first letter of up to two words", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("ada byron lovelace")).toBe("AB");
    expect(initials("  ")).toBe("?");
  });

  it("uses the first two letters of a single word", () => {
    expect(initials("krishna")).toBe("KR");
    expect(initials(" ada@example.com ")).toBe("AD");
    expect(initials("Q")).toBe("Q");
  });

  it("keeps whole graphemes and skips leading symbols", () => {
    expect(initials("@ada (lovelace)")).toBe("AL");
    expect(initials("élodie")).toBe("ÉL");
    expect(initials("ßa")).toBe("ßA");
    expect(initials("👩‍💻 dev")).toBe("DE");
  });
});

describe("avatarColor", () => {
  it("gives the same person the same colour and spreads names across the palette", () => {
    expect(avatarColor("Ada Lovelace")).toBe(avatarColor("Ada Lovelace"));
    const colours = new Set(["Ada", "Grace", "Linus", "Margaret", "Alan", "Barbara", "Dennis", "Ken"].map(avatarColor));
    expect(colours.size).toBeGreaterThan(3);
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

describe("UserAvatar image source", () => {
  const appAvatar = "/api/users/018f0000-0000-7000-8000-000000000001/avatar?v=0123456789abcdef0123456789abcdef.png";
  const imgSrc = (container: HTMLElement) => container.querySelector("img")?.getAttribute("src") ?? null;

  beforeAll(() => {
    // jsdom never loads images; make Radix treat every src as loaded.
    Object.defineProperty(window.HTMLImageElement.prototype, "complete", { get: () => true });
    Object.defineProperty(window.HTMLImageElement.prototype, "naturalWidth", { get: () => 1 });
  });

  it("renders the app's own avatar route", () => {
    const { container } = render(<UserAvatar name="Ada" image={appAvatar} />);
    expect(imgSrc(container)).toBe(appAvatar);
  });

  it("never loads an arbitrary URL for someone else", () => {
    const { container } = render(<UserAvatar name="Ada" image="https://evil.example/t.png" />);
    expect(imgSrc(container)).toBeNull();
    expect(screen.getByText("AD")).toBeInTheDocument();
  });

  it("loads an external photo only when allowed (own account)", () => {
    const { container } = render(<UserAvatar name="Ada" image="https://lh3.googleusercontent.com/a/x" allowExternalImage />);
    expect(imgSrc(container)).toBe("https://lh3.googleusercontent.com/a/x");
  });
});

describe("UserCell", () => {
  it("shows the name inline, the email only in the tooltip and to screen readers", async () => {
    render(<UserCell name="Ada Lovelace" email="ada@example.com" />);
    const trigger = screen.getByText("Ada Lovelace").closest("[data-state]");
    expect(trigger).not.toBeNull();
    expect(screen.getByText(", ada@example.com")).toHaveClass("sr-only");
    fireEvent.focus(trigger!);
    expect((await screen.findAllByText("ada@example.com")).length).toBeGreaterThan(0);
  });

  it("shows the full name in the tooltip when there is no email", async () => {
    render(<UserCell name="A very long display name" />);
    const trigger = screen.getByText("A very long display name").closest("[data-state]");
    fireEvent.focus(trigger!);
    expect((await screen.findAllByText("A very long display name")).length).toBeGreaterThan(1);
  });

  it("falls back to the email when there is no name", () => {
    render(<UserCell name={null} email="ada@example.com" />);
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.queryByText(", ada@example.com")).toBeNull();
  });

  it("shows the empty label without a tooltip when there is no person", () => {
    const { container } = render(<UserCell name={null} emptyLabel="System" />);
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(container.querySelector("[data-state]")).toBeNull();
  });

  it("defaults the empty label to Unassigned and passes class names through", () => {
    const { container } = render(<UserCell name={undefined} className="text-xs" avatarClassName="h-5 w-5" />);
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("text-xs");
    expect(container.querySelector("[data-slot='avatar']")).toHaveClass("h-5", "w-5");
  });

  it("avatar-only keeps the name for screen readers and in the tooltip", async () => {
    render(<UserCell name="Ada Lovelace" email="ada@example.com" avatarOnly />);
    const name = screen.getByText("Ada Lovelace");
    expect(name).toHaveClass("sr-only");
    fireEvent.focus(name.closest("[data-state]")!);
    expect((await screen.findAllByText("ada@example.com")).length).toBeGreaterThan(0);
  });

  it("avatar-only shows the empty label in a tooltip", async () => {
    const { container } = render(<UserCell name={null} emptyLabel="System" avatarOnly />);
    const trigger = container.querySelector("[data-state]");
    expect(trigger).not.toBeNull();
    expect(trigger).not.toHaveAttribute("tabindex");
    fireEvent.focus(trigger!);
    expect((await screen.findAllByText("System")).length).toBeGreaterThan(1);
  });
});
