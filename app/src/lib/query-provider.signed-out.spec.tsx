import { render, screen, waitFor } from "@testing-library/react";
import { QueryProvider } from "./query-provider";

// Its own file: the provider keeps module state per page load, so this must start fresh.
let mockSession: { data: null; isPending: boolean; error?: Error } = { data: null, isPending: false };
jest.mock("@/utils/auth-client", () => ({ useSession: () => mockSession }));

const CACHE_KEY = "supercheck-cache-v4:user-a";

it("removes every saved cache once a completed check finds nobody signed in, but not after a failed check", async () => {
  localStorage.setItem("supercheck-cache-v3:user-old", "{}");
  localStorage.setItem(CACHE_KEY, "{}");
  localStorage.setItem("unrelated-key", "keep");

  mockSession = { data: null, isPending: false, error: new Error("network") };
  const failed = render(<QueryProvider><div>ready</div></QueryProvider>);
  await screen.findByText("ready");
  expect(localStorage.getItem(CACHE_KEY)).toBe("{}");
  failed.unmount();

  mockSession = { data: null, isPending: false };
  render(<QueryProvider><div>signed out</div></QueryProvider>);
  await screen.findByText("signed out");
  await waitFor(() => expect(localStorage.getItem(CACHE_KEY)).toBeNull());
  expect(localStorage.getItem("supercheck-cache-v3:user-old")).toBeNull();
  expect(localStorage.getItem("unrelated-key")).toBe("keep");
});
