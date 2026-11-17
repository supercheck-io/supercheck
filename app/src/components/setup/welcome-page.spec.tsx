import { render, screen, waitFor } from "@testing-library/react";

import { createWrapper } from "./test-wrapper";
import { WelcomePage } from "./welcome-page";

const replace = jest.fn();
const push = jest.fn();
const back = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace, push, back }) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: () => ({ currentProject: { name: "Web App", organizationName: "Acme" } }) }));

beforeEach(() => {
  replace.mockReset();
  push.mockReset();
  back.mockReset();
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ persona: "sre", seen: true }) })) as unknown as typeof fetch;
});

describe("WelcomePage", () => {
  it("sends a user who already answered back to the dashboard", async () => {
    const { Wrapper } = createWrapper();
    render(<WelcomePage />, { wrapper: Wrapper });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("change mode opens for a user who already answered, with the saved persona selected", async () => {
    const { Wrapper } = createWrapper();
    render(<WelcomePage change />, { wrapper: Wrapper });
    expect(await screen.findByText("Choose your focus")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /SRE and platform/ })).toBeChecked();
    expect(replace).not.toHaveBeenCalled();
  });
});
