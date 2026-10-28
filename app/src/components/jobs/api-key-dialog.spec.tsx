import { fireEvent, render, screen } from "@testing-library/react";
import { ApiKeyDialog } from "./api-key-dialog";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/components/ui/calendar", () => ({ Calendar: () => null }));

it("gives the reveal and copy icon buttons accessible names", async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ apiKey: { id: "k1", name: "CI", key: "sck_secret" } }),
  }) as unknown as typeof fetch;
  render(<ApiKeyDialog jobId="j1" />);
  fireEvent.click(screen.getByRole("button", { name: /Create Key/ }));
  fireEvent.change(screen.getByLabelText("Key Name"), { target: { value: "CI" } });
  fireEvent.submit(screen.getByLabelText("Key Name").closest("form")!);

  const show = await screen.findByRole("button", { name: "Show API key" });
  fireEvent.click(show);
  expect(screen.getByRole("button", { name: "Hide API key" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Copy API key" })).toBeInTheDocument();
});
