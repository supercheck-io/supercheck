import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Variables from "./index";

jest.mock("@/hooks/use-project-context", () => ({
  useProjectContext: () => ({ projectId: "p1", loading: false }),
}));
jest.mock("./columns", () => ({ columns: [] }));
jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));
jest.mock("./data-table", () => ({
  DataTable: ({ data, meta }: { data: { id: string }[]; meta: Record<string, any> }) => (
    <div>
      <span data-testid="count">{data.length}</span>
      <span data-testid="decrypted">{meta.decryptedValues.v1 ?? ""}</span>
      <button onClick={() => meta.onToggleSecretVisibility("v1")}>reveal</button>
      <button onClick={() => meta.onSuccess()}>saved</button>
    </div>
  ),
}));

const listOk = {
  ok: true,
  json: async () => ({ success: true, data: [{ id: "v1", key: "K", isSecret: true, type: "secret", createdAt: "2024-01-01", updatedAt: "2024-01-01" }] }),
};

beforeEach(() => {
  global.fetch = jest.fn() as unknown as typeof fetch;
});

it("drops the cached revealed secret after the variable is saved", async () => {
  (global.fetch as jest.Mock).mockImplementation(async (url: string) =>
    url.endsWith("/decrypt") ? { ok: true, json: async () => ({ data: { value: "old" } }) } : listOk
  );
  render(<Variables />);
  await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
  fireEvent.click(screen.getByText("reveal"));
  await waitFor(() => expect(screen.getByTestId("decrypted")).toHaveTextContent("old"));
  await act(async () => {
    fireEvent.click(screen.getByText("saved"));
  });
  await waitFor(() => expect(screen.getByTestId("decrypted")).toBeEmptyDOMElement());
});

it("shows an error with Retry on first-load failure, not an empty table", async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, json: async () => ({ success: false, error: "nope" }) });
  render(<Variables />);
  expect(await screen.findByRole("alert")).toHaveTextContent("nope");
  (global.fetch as jest.Mock).mockResolvedValue(listOk);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
});

it("keeps the previous rows when a refresh fails", async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(listOk);
  render(<Variables />);
  await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
  (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("network"));
  await act(async () => {
    fireEvent.click(screen.getByText("saved"));
  });
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId("count")).toHaveTextContent("1");
});
