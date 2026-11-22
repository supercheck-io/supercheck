import { fireEvent, render, screen } from "@testing-library/react";
import { StatusPagePreview } from "./status-page-preview";

it("opens the signed-in preview full screen, links a new tab, and closes with Escape", () => {
  render(<StatusPagePreview statusPageId="p1" statusPageName="Acme status" />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /preview/i }));
  const dialog = screen.getByRole("dialog", { name: "Acme status" });
  expect(dialog.querySelector("iframe")).toHaveAttribute("src", "/status-pages/p1/public");
  expect(screen.getByRole("link", { name: /open in new tab/i })).toHaveAttribute("href", "/status-pages/p1/public");
  expect(screen.getByRole("button", { name: /close preview/i })).toHaveFocus();
  expect(document.body.style.overflow).toBe("hidden");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(document.body.style.overflow).toBe("");
});
