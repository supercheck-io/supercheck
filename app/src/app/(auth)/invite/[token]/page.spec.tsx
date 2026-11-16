import { act, fireEvent, render, screen } from "@testing-library/react";
import InvitePage from "./page";

const mockReload = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
jest.mock("@/hooks/use-app-config", () => ({ useAppConfig: () => ({ isCloudHosted: false, isFetched: true, error: null }) }));
jest.mock("@/hooks/use-project-context", () => ({ clearProjectsCache: jest.fn() }));
jest.mock("@/lib/project-navigation", () => ({
  announceProjectChange: jest.fn(),
  reloadProjectContext: (...args: unknown[]) => mockReload(...args),
}));

describe("invite accept page", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    jest.useFakeTimers();
    mockReload.mockReset();
    global.fetch = jest.fn(async (_url: string, init?: { method?: string }) => ({
      json: async () =>
        init?.method === "POST"
          ? { success: true, data: { organizationName: "Acme", role: "project_editor", message: "ok" } }
          : { success: true, data: { organizationName: "Acme", role: "project_editor", expiresAt: "2099-01-01T00:00:00Z" } },
    })) as unknown as typeof fetch;
  });
  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  async function accept() {
    render(<InvitePage params={Promise.resolve({ token: "t" })} />);
    fireEvent.click(await screen.findByRole("button", { name: /accept invitation/i }));
    await screen.findByRole("button", { name: /go to dashboard/i });
  }

  it("lands on persona selection after the automatic redirect", async () => {
    await accept();
    expect(mockReload).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(3000); });
    expect(mockReload).toHaveBeenCalledWith(expect.any(Function), "/setup/welcome");
  });

  it("lands on persona selection from the button", async () => {
    await accept();
    fireEvent.click(screen.getByRole("button", { name: /go to dashboard/i }));
    expect(mockReload).toHaveBeenCalledWith(expect.any(Function), "/setup/welcome");
  });
});
