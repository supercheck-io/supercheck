import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CopyValueButton } from "./copy-value-button";

jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));
const { toast } = jest.requireMock("sonner") as { toast: { error: jest.Mock } };

describe("CopyValueButton", () => {
  it("copies the value and confirms", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CopyValueButton value="npx supercheck login --json" label="Copy login" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy login" }));
    expect(await screen.findByText("Copied")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith("npx supercheck login --json");
  });

  it("tells the user when the clipboard is unavailable", async () => {
    Object.assign(navigator, { clipboard: { writeText: jest.fn().mockRejectedValue(new Error("denied")) } });
    render(<CopyValueButton value="x" label="Copy x" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy x" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});
