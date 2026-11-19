import { render, screen } from "@testing-library/react";
import VerifyLayout from "./layout";

const session = jest.fn();
const redirect = jest.fn((path: string) => {
  throw new Error(`redirect:${path}`);
});
jest.mock("@/lib/session-cache", () => ({ getCachedAuthSession: () => session() }));
jest.mock("next/navigation", () => ({ redirect: (p: string) => redirect(p) }));

describe("verify-email layout", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders for visitors without a session", async () => {
    session.mockResolvedValue(null);
    render(await VerifyLayout({ children: <p>verify</p> }));
    expect(screen.getByText("verify")).toBeInTheDocument();
  });

  it("renders for a signed-in user whose email is not verified yet", async () => {
    session.mockResolvedValue({ user: { emailVerified: false } });
    render(await VerifyLayout({ children: <p>verify</p> }));
    expect(screen.getByText("verify")).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sends a verified user home", async () => {
    session.mockResolvedValue({ user: { emailVerified: true } });
    await expect(VerifyLayout({ children: <p>verify</p> })).rejects.toThrow("redirect:/");
  });
});
